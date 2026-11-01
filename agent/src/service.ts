// Agent transfer service (T2.3 / T2.5).
// Flow, with no bypass:
//   intent (parser or LLM) -> parse -> fresh on-chain views ->
//   validateBeforeSigning -> if fail: record rejected, NO signer call,
//   NO broadcast; if pass: call the signer exactly once.
// The signer is injected so unit tests can assert call count = 0 on
// failure without touching the chain.

import { config } from "./config.js";
import { parseIntent } from "./parser.js";
import { getLlmIntent } from "./llm.js";
import {
  validateBeforeSigning,
  yoctoToNear,
  currentDayFromMs,
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

export async function processIntent(args: {
  text: string;
  useLlm: boolean;
  agentAccountId?: string;
  signer?: Signer;
  source?: "parser" | "llm" | "attack-demo";
}): Promise<TransferResult> {
  const agentAccountId = args.agentAccountId ?? config.agentAccountId;
  const source = args.source ?? (args.useLlm ? "llm" : "parser");
  // 1. Parse. LLM output goes through the same deterministic parser.
  let parsed = parseIntent(args.text);
  if (args.useLlm) {
    const llmResult = await getLlmIntent(
      args.text,
      config.nearAiCloudApiKey,
      config.nearAiModel,
    );
    if (llmResult) parsed = llmResult;
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
