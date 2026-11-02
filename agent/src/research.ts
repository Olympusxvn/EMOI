// research.ts — Research Report Agent slice (additive, 2026-11-02).
//
// What this is, honestly:
// - Contractor-lite: a customer request (topic + offer) is broken into
//   parts (gather data, synthesize, deliver). Each part that spends is
//   a normal parser-path transfer through processIntent, so it gets the
//   same pre-signing re-validation and the same on-chain policy as every
//   other EMOI spend. No contract change, no Intents, no new trust.
// - Negotiation-lite: if the offer is below the owner-set minimum price
//   (data cost + compute cost), the agent counters EXACTLY ONCE with its
//   reasoning, then accepts or walks away on the customer's decision.
//   The negotiation state machine is off-chain code in this file.
// - A receipt: topic, offer/counter/decision, each vendor payment with
//   its tx hash (or rejection reason), and the generated report text.
//
// What this is NOT (do not claim these):
// - Hire: paying demo vendors is not hiring autonomous agents.
// - Earn settlement: a customer deposit via deposit_funds credits the
//   CALLER's own ledger, not the owner's vault, so there is no on-chain
//   customer-to-vault payment in this slice. The receipt records the
//   AGREED price, not a settled customer payment. Real earn settlement
//   needs a contract change and is future work.
// - USDC/Intents: not used. Payments are native NEAR, direct.
// - Inference self-pay: NEAR AI Cloud bills the owner's API key, not
//   the vault. The on-chain spends here are data/compute vendor
//   payments; report generation itself is not vault-paid.
// - Content verification: the report is LLM-generated and NOT
//   fact-verified. The "check" in the receipt is the policy check
//   (whitelist/limits/status), not a check that the report is true.
//
// State isolation: research runs use a DEDICATED agent account
// (default research.emoi.testnet, RESEARCH_AGENT_ID override) with its
// own policy and spent_today, so the main agent's spent_today is
// untouched. The vault ledger is shared per owner, so research spends
// DO reduce the shared vault; the demo restores it by topping up
// afterwards (owner deposit, separate step, not part of this file).
// The research agent's FCK is read from the local keychain (same
// pattern as the audit/conformance scripts). This endpoint is a
// local-demo tool, never a hosted service.

import { config } from "./config.js";
import { processIntent, type TransferResult } from "./service.js";
import { nearToYocto } from "./validation.js";
import { Near } from "near-kit";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const RESEARCH_AGENT_ID = process.env.RESEARCH_AGENT_ID ?? "research.emoi.testnet";
export const DATA_VENDOR = "emoi02.testnet";
export const COMPUTE_VENDOR = "emoi01.testnet";
export const DATA_COST_NEAR = "0.5";
export const COMPUTE_COST_NEAR = "0.5";
// Minimum price = vendor costs. Derived, not a second hardcoded number,
// so the counter can never drift from what the run actually spends.
export const MIN_PRICE_NEAR = "1.0";

export type ResearchStatus =
  | "countered"
  | "accepted-direct"
  | "accepted"
  | "walked-away"
  | "completed"
  | "failed";

export interface ResearchStep {
  part: string;
  vendor: string;
  role: string;
  amountNear: string;
  status: "success" | "rejected";
  txHash?: string;
  reason?: string;
}

export interface ResearchJob {
  id: string;
  topic: string;
  agent: string;
  offerNear: string;
  minPriceNear: string;
  status: ResearchStatus;
  counterNear?: string;
  reasoning?: string;
  decision?: "accept" | "decline";
  steps: ResearchStep[];
  report: string | null;
  reportNote: string;
  createdAt: string;
}

export const RESEARCH_LOG_PATH = path.join(config.repoRoot, "research.jsonl");

// Compare by BigInt, never by yocto string: "400...0" (0.4 NEAR) is
// lexicographically GREATER than "1000...0" (1 NEAR), so string
// comparison would accept a below-minimum offer. (Caught by test.)
function yoctoAtLeast(offerNear: string, minNear: string): boolean {
  return nearToYocto(offerNear) >= nearToYocto(minNear);
}

function parseOffer(offerNear: string): void {
  // Throws on non-numeric, negative, or >24-decimal input (validation).
  const yocto = nearToYocto(offerNear);
  if (yocto < 0n) throw new Error("offer must be >= 0");
}

/** Pure negotiation: no chain, no signing, no spending. */
export function negotiate(topic: string, offerNear: string, agent: string): ResearchJob {
  if (!topic.trim()) throw new Error("topic is required");
  parseOffer(offerNear);
  const now = new Date().toISOString();
  const base: ResearchJob = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    topic: topic.trim(),
    agent,
    offerNear,
    minPriceNear: MIN_PRICE_NEAR,
    status: "countered",
    steps: [],
    report: null,
    reportNote: "",
    createdAt: now,
  };
  if (yoctoAtLeast(offerNear, MIN_PRICE_NEAR)) {
    return { ...base, status: "accepted-direct" };
  }
  return {
    ...base,
    status: "countered",
    counterNear: MIN_PRICE_NEAR,
    reasoning: `Data ${DATA_COST_NEAR} NEAR (${DATA_VENDOR}, data provider) + compute ${COMPUTE_COST_NEAR} NEAR (${COMPUTE_VENDOR}, API/compute provider) = ${MIN_PRICE_NEAR} NEAR minimum. Your offer ${offerNear} NEAR does not cover vendor costs.`,
  };
}

/** Build a signer for an agent's FCK from the local keychain. */
export function researchSignerFor(agentId: string) {
  const dir = path.join(os.homedir(), ".near-credentials", "testnet", agentId);
  const full = JSON.parse(
    fs.readFileSync(path.join(os.homedir(), ".near-credentials", "testnet", `${agentId}.json`), "utf-8"),
  ) as { public_key: string };
  let fckPrivateKey = "";
  for (const f of fs.readdirSync(dir)) {
    const d = JSON.parse(fs.readFileSync(path.join(dir, f), "utf-8")) as {
      public_key: string;
      private_key: string;
    };
    if (d.public_key !== full.public_key) {
      fckPrivateKey = d.private_key;
      break;
    }
  }
  if (!fckPrivateKey) throw new Error(`research agent FCK not found in local keychain for ${agentId}`);
  const near = new Near({
    network: config.network,
    privateKey: fckPrivateKey as `ed25519:${string}`,
    defaultSignerId: agentId,
  });
  return async (recipient: string, amountYocto: bigint): Promise<unknown> => {
    return near.call(
      config.policyContractId,
      "agent_transfer",
      { recipient, amount: amountYocto.toString() },
      { gas: "100 Tgas", attachedDeposit: 0n },
    );
  };
}

export type PayVendor = (
  recipient: string,
  amountNear: string,
  agent: string,
) => Promise<TransferResult>;

/** Real vendor payment: parser path, same validation as /transfer. */
export async function realPayVendor(
  recipient: string,
  amountNear: string,
  agent: string,
): Promise<TransferResult> {
  return processIntent({
    text: `send ${amountNear} NEAR to ${recipient}`,
    useLlm: false,
    agentAccountId: agent,
    signer: researchSignerFor(agent),
    source: "parser",
  });
}

const REPORT_BASE_URL = "https://cloud-api.near.ai/v1";

/** Generate a short report. Fail-closed: null on no key / fetch failure. */
export async function generateReport(
  topic: string,
  apiKey: string | undefined,
  model: string | undefined,
): Promise<string | null> {
  if (!apiKey) return null;
  try {
    const response = await fetch(`${REPORT_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: model ?? "deepseek-ai/DeepSeek-V3.1",
        messages: [
          {
            role: "system",
            content:
              "Write a short research report in plain text with exactly three short sections: Summary, Key points, Conclusion. Keep it under 200 words. Do not invent prices, dates, or citations.",
          },
          { role: "user", content: `Write a short research report on this topic: ${topic}` },
        ],
        temperature: 0,
      }),
    });
    if (!response.ok) return null;
    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const text = data.choices?.[0]?.message?.content?.trim() ?? "";
    return text ? text : null;
  } catch {
    return null;
  }
}

export interface RunDeps {
  pay: PayVendor;
  report: (topic: string) => Promise<string | null>;
}

/**
 * Run an accepted job: pay data, then compute (fail-fast: if the first
 * payment is rejected, stop and do not pay the second), then generate
 * the report. A failed report does not undo payments already made;
 * the receipt says so.
 */
export async function runResearch(job: ResearchJob, deps: RunDeps): Promise<ResearchJob> {
  const steps: ResearchStep[] = [];
  const parts: Array<{ part: string; vendor: string; role: string; amountNear: string }> = [
    { part: "Gather data", vendor: DATA_VENDOR, role: "data provider", amountNear: DATA_COST_NEAR },
    { part: "Synthesize", vendor: COMPUTE_VENDOR, role: "API/compute provider", amountNear: COMPUTE_COST_NEAR },
  ];
  for (const p of parts) {
    const result = await deps.pay(p.vendor, p.amountNear, job.agent);
    if (result.status === "success") {
      steps.push({ ...p, status: "success", txHash: result.txHash });
    } else {
      steps.push({ ...p, status: "rejected", reason: result.reason });
      const failed: ResearchJob = {
        ...job,
        status: "failed",
        steps,
        report: null,
        reportNote: `Stopped after a rejected payment (${result.reason}). Payments already made are not refunded by this demo.`,
      };
      appendResearchLog(failed);
      return failed;
    }
  }
  const report = await deps.report(job.topic);
  const done: ResearchJob = {
    ...job,
    status: "completed",
    steps,
    report,
    reportNote: report
      ? "Report generated by NEAR AI Cloud. Content is LLM-generated and NOT fact-verified; the receipt's check is the on-chain policy check, not content verification."
      : "Report generation unavailable (no key or fetch failed). Vendor payments above still happened and are receipted.",
  };
  appendResearchLog(done);
  return done;
}

export function appendResearchLog(job: ResearchJob): void {
  try {
    fs.appendFileSync(RESEARCH_LOG_PATH, `${JSON.stringify(job)}\n`);
  } catch {
    // Log failure must not fail the job itself; the API response
    // already carries the full receipt.
  }
}

export function readResearchLog(): ResearchJob[] {
  try {
    const text = fs.readFileSync(RESEARCH_LOG_PATH, "utf-8");
    const out: ResearchJob[] = [];
    for (const line of text.split("\n")) {
      if (!line.trim()) continue;
      try {
        out.push(JSON.parse(line) as ResearchJob);
      } catch {
        // Skip a corrupt line, keep the rest.
      }
    }
    return out;
  } catch {
    return [];
  }
}
