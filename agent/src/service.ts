// Agent transfer service (T2.3 / T2.5).
// Flow, with no bypass:
//   intent (parser or LLM) -> parse -> fresh on-chain views ->
//   validateBeforeSigning -> if fail: record rejected, NO signer call,
//   NO broadcast; if pass: call the signer exactly once.
// The signer is injected so unit tests can assert call count = 0 on
// failure without touching the chain.

import { config } from "./config.js";
import { parseIntent, type ParseResult } from "./parser.js";
import { getLlmIntent } from "./llm.js";
import {
  validateBeforeSigning,
  yoctoToNear,
  nearToYocto,
  currentDayFromMs,
  type AgentState,
  type Policy,
  type PolicyViolation,
} from "./validation.js";
import { appendActivity, vendorRole } from "./activity.js";
import { createAgentNear, createViewNear, fetchPolicyViews, extractTxHash } from "./nearClient.js";

export type TransferResult =
  | {
      status: "success";
      recipient: string;
      amountNear: string;
      txHash?: string;
      intentLine: string;
    }
  | {
      status: "rejected";
      recipient: string;
      amountNear: string;
      reason: PolicyViolation | "ParseFailed";
      intentLine: string;
    };

export function intentLineFor(
  recipient: string,
  amountNear: string,
  policy: { max_per_tx: string; daily_limit: string } | null,
): string {
  const role = vendorRole(recipient);
  if (!policy) {
    return `Pay ${amountNear} NEAR to ${recipient} (${role})`;
  }
  return `Pay ${amountNear} NEAR to ${recipient} (${role}), within max ${yoctoToNear(policy.max_per_tx)} / daily ${yoctoToNear(policy.daily_limit)}`;
}

export interface Signer {
  (recipient: string, amountYocto: bigint): Promise<unknown>;
}

/**
 * Testable core of the transfer flow, without chain reads or activity
 * logging: validate, then call the signer exactly once only if valid.
 * processIntent() supplies fresh on-chain views to this function.
 */
export async function transferWithValidation(args: {
  agentState: import("./validation.js").AgentState | null;
  policy: import("./validation.js").Policy | null;
  vaultBalanceYocto: string;
  recipient: string;
  amountYocto: bigint;
  amountNear: string;
  today: number;
  signer: Signer;
}): Promise<TransferResult> {
  const intentLine = intentLineFor(args.recipient, args.amountNear, args.policy);
  const validation = validateBeforeSigning({
    agentState: args.agentState,
    policy: args.policy,
    vaultBalanceYocto: args.vaultBalanceYocto,
    recipient: args.recipient,
    amountYocto: args.amountYocto,
    today: args.today,
  });
  if (!validation.ok) {
    return {
      status: "rejected",
      recipient: args.recipient,
      amountNear: args.amountNear,
      reason: validation.reason,
      intentLine,
    };
  }
  const outcome = await args.signer(args.recipient, args.amountYocto);
  return {
    status: "success",
    recipient: args.recipient,
    amountNear: args.amountNear,
    txHash: extractTxHash(outcome),
    intentLine,
  };
}

/** Real signer: calls agent_transfer on the policy contract via the FCK. */
export async function realSigner(
  recipient: string,
  amountYocto: bigint,
): Promise<unknown> {
  const near = createAgentNear();
  return near.call(
    config.policyContractId,
    "agent_transfer",
    { recipient, amount: amountYocto.toString() },
    { gas: "100 Tgas", attachedDeposit: "0 NEAR" },
  );
}

/**
 * LLM intent resolution: deterministic harness (1a/1b/1c) around an injected
 * LLM call. Extracted from processIntent so unit tests can drive it offline
 * with a mock. Never signs; returns a ParseResult only.
 */
export async function resolveLlmIntent(
  text: string,
  llmFn: (userText: string) => Promise<ParseResult | null>,
): Promise<ParseResult> {
  // 1a. Multi-intent pre-check: if the raw user text contains more
  // than one distinct recipient or more than one distinct amount,
  // reject before any LLM call. The model must never be allowed to
  // arbitrarily pick one of several intents.
  const rawRecipients = new Set(
    (text.match(/[a-z0-9][a-z0-9._-]*\.(?:testnet|near)/gi) ?? []).map(
      (r) => r.toLowerCase(),
    ),
  );
  // Implicit accounts (64 hex chars, no suffix) are valid recipients too:
  // without this, a second recipient in implicit form is invisible here
  // and the model would narrow a two-recipient request.
  for (const m of text.matchAll(/\b[0-9a-f]{64}\b/gi)) {
    rawRecipients.add(m[0].toLowerCase());
  }
  // Distinct amounts by exact yocto value, so "0.5" and "0.50"
  // count as one amount, not two. Only numbers directly before
  // "NEAR" count as amounts: digits inside an account name such
  // as "emoi01" must not be mistaken for an amount.
  const rawAmountYocto = new Set<string>();
  for (const m of text.matchAll(
    /([0-9]+(?:\.[0-9]+)?)\s+NEAR/gi,
  )) {
    try {
      rawAmountYocto.add(nearToYocto(m[1]).toString());
    } catch {
      // Unusable amounts are rejected by the parser and the
      // grounding check below.
    }
  }
  if (rawRecipients.size > 1 || rawAmountYocto.size > 1) {
    return { ok: false, reason: "ParseFailed" };
  }
  const llmResult = await llmFn(text);
  // 1b. Strict LLM mode: a missing LLM result (no key, no output)
  // is a failure, never a silent fallback to the parser result.
  // Parser-only mode (useLlm false) is the only path that works
  // without a key.
  if (llmResult === null) {
    return { ok: false, reason: "ParseFailed" };
  }
  // 1c. Grounding check: an LLM-produced intent is only accepted
  // if its recipient appears verbatim in the user text and its
  // amount matches a number in the user text. A hallucinated
  // recipient or amount is rejected here, even if the model
  // ignored its system prompt.
  if (llmResult.ok) {
    const recipientInText = rawRecipients.has(
      llmResult.intent.recipient.toLowerCase(),
    );
    const amountInText = rawAmountYocto.has(
      llmResult.intent.amountYocto.toString(),
    );
    if (!recipientInText || !amountInText) {
      return { ok: false, reason: "ParseFailed" };
    }
  }
  return llmResult;
}

export type DryRunResult =
  | {
      status: "would-succeed";
      recipient: string;
      amountNear: string;
      intentLine: string;
      policyAtTime?: { maxNear: string; dailyNear: string };
    }
  | {
      status: "rejected";
      recipient: string;
      amountNear: string;
      reason: PolicyViolation | "ParseFailed";
      intentLine: string;
    };

/**
 * Dry-run preview: parse + validate against caller-supplied views, then tell
 * whether the transfer WOULD succeed. Pure by construction: it takes no
 * signer, calls no signer, fetches no views, writes no activity log, and
 * never returns a txHash. The server supplies fresh views; tests inject
 * fixtures. Validation reuses validateBeforeSigning, so preview and signing
 * can never disagree on the verdict.
 */
export async function previewTransfer(args: {
  text: string;
  useLlm: boolean;
  agentAccountId?: string;
  llmFn?: (userText: string) => Promise<ParseResult | null>;
  views: {
    agentState: AgentState | null;
    policy: Policy | null;
    vaultBalanceYocto: string;
  };
  today?: number;
}): Promise<DryRunResult> {
  let parsed = parseIntent(args.text);
  if (args.useLlm) {
    const llm =
      args.llmFn ?? ((t: string) => getLlmIntent(t, config.nearAiCloudApiKey, config.nearAiModel));
    parsed = await resolveLlmIntent(args.text, llm);
  }
  if (!parsed.ok) {
    return {
      status: "rejected",
      recipient: "",
      amountNear: "",
      reason: "ParseFailed",
      intentLine: `Could not parse intent: ${args.text}`,
    };
  }
  const { recipient, amountNear, amountYocto } = parsed.intent;
  const { agentState, policy, vaultBalanceYocto } = args.views;
  const validation = validateBeforeSigning({
    agentState,
    policy,
    vaultBalanceYocto,
    recipient,
    amountYocto,
    today: args.today ?? currentDayFromMs(Date.now()),
  });
  const intentLine = intentLineFor(recipient, amountNear, policy);
  if (!validation.ok) {
    return {
      status: "rejected",
      recipient,
      amountNear,
      reason: validation.reason,
      intentLine,
    };
  }
  return {
    status: "would-succeed",
    recipient,
    amountNear,
    intentLine,
    policyAtTime: policy
      ? {
          maxNear: yoctoToNear(policy.max_per_tx),
          dailyNear: yoctoToNear(policy.daily_limit),
        }
      : undefined,
  };
}

export async function processIntent(args: {
  text: string;
  useLlm: boolean;
  agentAccountId?: string;
  signer?: Signer;
  source?: "parser" | "llm" | "attack-demo";
  llmFn?: (userText: string) => Promise<ParseResult | null>;
}): Promise<TransferResult> {
  const agentAccountId = args.agentAccountId ?? config.agentAccountId;
  const source = args.source ?? (args.useLlm ? "llm" : "parser");
  // 1. Parse. LLM output goes through the same deterministic parser.
  // Harness, not prompt: the checks below are deterministic code and
  // do not depend on the model obeying its system prompt.
  let parsed = parseIntent(args.text);
  if (args.useLlm) {
    const llm =
      args.llmFn ?? ((t: string) => getLlmIntent(t, config.nearAiCloudApiKey, config.nearAiModel));
    parsed = await resolveLlmIntent(args.text, llm);
  }
  if (!parsed.ok) {
    const result: TransferResult = {
      status: "rejected",
      recipient: "",
      amountNear: "",
      reason: "ParseFailed",
      intentLine: `Could not parse intent: ${args.text}`,
    };
    appendActivity({
      timestamp: new Date().toISOString(),
      agent: agentAccountId,
      recipient: "",
      amountNear: "",
      status: "rejected",
      reason: "ParseFailed",
      intentLine: result.intentLine,
      source,
    });
    return result;
  }
  const { recipient, amountNear, amountYocto } = parsed.intent;
  // 2. Fresh on-chain views, immediately before signing. Never cached.
  const viewNear = createViewNear();
  const { agentState, policy, vaultBalanceYocto } = await fetchPolicyViews(
    viewNear,
    agentAccountId,
  );
  // 3-4. Pre-signing re-validation, then the signer only if valid.
  const result = await transferWithValidation({
    agentState,
    policy,
    vaultBalanceYocto,
    recipient,
    amountYocto,
    amountNear,
    today: currentDayFromMs(Date.now()),
    signer: args.signer ?? realSigner,
  });
  const policyAtTime = policy
    ? {
        maxNear: yoctoToNear(policy.max_per_tx),
        dailyNear: yoctoToNear(policy.daily_limit),
      }
    : undefined;
  if (result.status === "rejected") {
    appendActivity({
      timestamp: new Date().toISOString(),
      agent: agentAccountId,
      recipient,
      amountNear,
      status: "rejected",
      reason: result.reason,
      intentLine: result.intentLine,
      source,
      policyAtTime,
    });
  } else {
    appendActivity({
      timestamp: new Date().toISOString(),
      agent: agentAccountId,
      recipient,
      amountNear,
      status: "success",
      txHash: result.txHash,
      intentLine: result.intentLine,
      source,
      policyAtTime,
    });
  }
  return result;
}
