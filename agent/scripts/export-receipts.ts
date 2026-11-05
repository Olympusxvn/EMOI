// Export spend receipts to a file or stdout (agent-only, read-only).
// Same source as GET /activity: NearBlocks primary, local JSONL fallback.
// Rejected rows carry a reason and no txHash (blocked before signing).
// Usage: tsx scripts/export-receipts.ts [--agent <id>] [--format json|csv] [--out <path>]
// Without --out the export is printed to stdout (pipeable, nothing written).
import fs from "node:fs";
import path from "node:path";
import { config } from "../src/config.js";
import { collectActivity } from "../src/activity.js";
import { buildReceipts, receiptsFilename, receiptsToCsv } from "../src/receipts.js";

function argValue(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const agentId = argValue("--agent") ?? config.agentAccountId;
  const format = argValue("--format") ?? "json";
  if (format !== "json" && format !== "csv") {
    throw new Error("format must be 'json' or 'csv'");
  }
  const out = argValue("--out");
  const collected = await collectActivity(config.policyContractId);
  const rows = buildReceipts(collected.entries.filter((e) => e.agent === agentId));
  const body = format === "csv"
    ? receiptsToCsv(rows)
    : JSON.stringify({
      agent: agentId,
      exportedAt: new Date().toISOString(),
      nearblocksAvailable: collected.nearblocksAvailable,
      receipts: rows,
    }, null, 2) + "\n";
  if (out) {
    fs.writeFileSync(out, body, "utf-8");
    console.log(`exported ${rows.length} receipt(s) for ${agentId} to ${out} (${receiptsFilename(agentId, format)} suggested name)`);
  } else {
    process.stdout.write(body);
  }
}

if (["export-receipts.ts", "export-receipts.js"].includes(path.basename(process.argv[1] ?? ""))) main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
