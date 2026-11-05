// Exportable spend receipts (agent-only, read-only). A receipt is a
// projection of an activity entry (/activity source: NearBlocks primary,
// local JSONL fallback) into a stable row shape, rendered as JSON or CSV.
// Rejected rows carry a reason and no txHash: they were blocked before
// signing, so nothing was ever broadcast. This module never signs,
// never spends, and never touches the chain.
import { vendorRole, type ActivityEntry } from "./activity.js";

export interface ReceiptRow {
  timestamp: string;
  agent: string;
  recipient: string;
  vendorRole: string;
  amountNear: string;
  status: "success" | "rejected";
  /** "" when none — keeps CSV columns stable. */
  reason: string;
  /** "" for local rejects (nothing was signed). */
  txHash: string;
  source: string;
}

export function buildReceipts(entries: ActivityEntry[]): ReceiptRow[] {
  return entries.map((e) => ({
    timestamp: e.timestamp,
    agent: e.agent,
    recipient: e.recipient,
    vendorRole: vendorRole(e.recipient),
    amountNear: e.amountNear,
    status: e.status,
    reason: e.reason ?? "",
    txHash: e.txHash ?? "",
    source: e.source,
  }));
}

function csvCell(value: string): string {
  return /[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

export const RECEIPT_CSV_HEADER =
  "timestamp,agent,recipient,vendor_role,amount_near,status,reason,tx_hash,source";

export function receiptsToCsv(rows: ReceiptRow[]): string {
  const lines = [RECEIPT_CSV_HEADER];
  for (const r of rows) {
    lines.push(
      [
        r.timestamp,
        r.agent,
        r.recipient,
        r.vendorRole,
        r.amountNear,
        r.status,
        r.reason,
        r.txHash,
        r.source,
      ]
        .map(csvCell)
        .join(","),
    );
  }
  return lines.join("\n") + "\n";
}

export function receiptsFilename(agent: string, format: "json" | "csv"): string {
  const date = new Date().toISOString().slice(0, 10);
  const safe = agent.replace(/[^a-zA-Z0-9.-]/g, "_");
  return `emoi-receipts-${safe}-${date}.${format}`;
}
