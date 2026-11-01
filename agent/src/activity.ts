// Activity log (T2.8 fallback). JSONL, not committed.
// Primary source in production use is NearBlocks for the policy
// contract; this local log is what carries local rejects, which have
// no tx hash because nothing was signed, and what the local frontend
// reads when it cannot reach NearBlocks.

import fs from "node:fs";
import { config } from "./config.js";

export interface ActivityEntry {
  timestamp: string;
  agent: string;
  recipient: string;
  amountNear: string;
  status: "success" | "rejected";
  reason?: string;
  txHash?: string;
  intentLine?: string;
  source: "parser" | "llm" | "attack-demo";
  /** Policy at the time of the attempt, for receipt-style rows. */
  policyAtTime?: { maxNear: string; dailyNear: string };
}

export function appendActivity(entry: ActivityEntry): void {
  fs.appendFileSync(config.activityLogPath, JSON.stringify(entry) + "\n", {
    encoding: "utf-8",
  });
}

export function readActivity(): ActivityEntry[] {
  if (!fs.existsSync(config.activityLogPath)) return [];
  const lines = fs
    .readFileSync(config.activityLogPath, "utf-8")
    .split("\n")
    .filter(Boolean);
  const entries: ActivityEntry[] = [];
  for (const line of lines) {
    try {
      entries.push(JSON.parse(line) as ActivityEntry);
    } catch {
      // Skip a corrupt line rather than failing the whole log.
    }
  }
  return entries;
}

/**
 * NearBlocks activity collector (T2.8, primary source per STRATEGY 9.3).
 * Tries the NearBlocks testnet API for the policy contract and maps
 * agent_transfer calls to activity entries. The API shape is handled
 * defensively: if the call fails, returns an unexpected shape, or
 * returns no rows, the caller falls back to the local JSONL log.
 * Note, verified 2026-11-01: the api3-testnet endpoint returned an
 * empty txns list for policy.emoi.testnet even though real txns exist
 * (verified via near-cli and the explorer), so the JSONL fallback is
 * currently the working source in this environment. The code keeps
 * trying NearBlocks first so it starts working if the indexer catches
 * up or the endpoint shape changes, without any code change.
 */
export async function fetchNearBlocksActivity(
  policyContractId: string,
): Promise<{ entries: ActivityEntry[]; available: boolean }> {
  try {
    const url =
      `https://api3-testnet.nearblocks.io/v1/account/${policyContractId}` +
      `/txns?page=1&per_page=25`;
    const response = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!response.ok) return { entries: [], available: false };
    const data = (await response.json()) as { txns?: unknown[] };
    if (!Array.isArray(data.txns) || data.txns.length === 0) {
      return { entries: [], available: false };
    }
    const entries: ActivityEntry[] = [];
    for (const txn of data.txns) {
      const t = txn as {
        transaction_hash?: string;
        signer_account_id?: string;
        block_timestamp?: number;
        actions?: Array<{
          action?: string;
          method_name?: string;
          args?: { recipient?: string; amount?: string };
        }>;
        outcomes?: { status?: boolean | string };
      };
      const call = t.actions?.find(
        (a) => a.method_name === "agent_transfer",
      );
      if (!call) continue;
      const amountYocto = call.args?.amount ?? "0";
      const amountNear = (() => {
        try {
          const v = BigInt(amountYocto);
          const whole = v / 10n ** 24n;
          const frac = v % 10n ** 24n;
          return frac === 0n
            ? whole.toString()
            : `${whole}.${frac.toString().padStart(24, "0").replace(/0+$/, "")}`;
        } catch {
          return "0";
        }
      })();
      entries.push({
        timestamp: t.block_timestamp
          ? new Date(Number(t.block_timestamp) / 1_000_000).toISOString()
          : new Date().toISOString(),
        agent: t.signer_account_id ?? "",
        recipient: call.args?.recipient ?? "",
        amountNear,
        status: t.outcomes?.status === false ? "rejected" : "success",
        txHash: t.transaction_hash,
        source: "parser",
      });
    }
    return { entries, available: entries.length > 0 };
  } catch {
    return { entries: [], available: false };
  }
}

/** Merge NearBlocks rows with local JSONL rows, newest first. */
export async function collectActivity(
  policyContractId: string,
): Promise<{ entries: ActivityEntry[]; nearblocksAvailable: boolean }> {
  const local = readActivity();
  const nearblocks = await fetchNearBlocksActivity(policyContractId);
  const seen = new Set<string>();
  const merged: ActivityEntry[] = [];
  for (const entry of [...nearblocks.entries, ...local]) {
    const key = entry.txHash
      ? `tx:${entry.txHash}`
      : `local:${entry.timestamp}:${entry.agent}:${entry.recipient}:${entry.amountNear}:${entry.status}:${entry.reason ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(entry);
  }
  merged.sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1));
  return { entries: merged, nearblocksAvailable: nearblocks.available };
}

/** Vendor role label for a recipient, for receipt-style display only. */
export function vendorRole(recipient: string): string {
  if (recipient === "emoi01.testnet") return "API/compute provider";
  if (recipient === "emoi02.testnet") return "data provider";
  return "vendor";
}
