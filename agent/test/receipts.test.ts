// Receipt export tests: row projection, CSV escaping, filename safety.
// Fully offline: synthetic ActivityEntry objects, no chain, no keychain.
import assert from "node:assert";
import type { ActivityEntry } from "../src/activity.js";
import {
  RECEIPT_CSV_HEADER,
  buildReceipts,
  receiptsFilename,
  receiptsToCsv,
} from "../src/receipts.js";

let failures = 0;
function check(name: string, fn: () => void) {
  try {
    fn();
    console.log(`ok - ${name}`);
  } catch (e) {
    failures++;
    console.error(`FAIL - ${name}:`, e);
  }
}

function entry(over: Partial<ActivityEntry>): ActivityEntry {
  return {
    timestamp: "2026-11-05T00:00:00.000Z",
    agent: "agent.emoi.testnet",
    recipient: "emoi01.testnet",
    amountNear: "0.5",
    status: "success",
    source: "parser",
    ...over,
  };
}

check("success_row_maps_vendor_role_and_tx", () => {
  const [row] = buildReceipts([entry({ txHash: "ABC123" })]);
  assert.equal(row.vendorRole, "API/compute provider");
  assert.equal(row.txHash, "ABC123");
  assert.equal(row.reason, "");
  assert.equal(row.status, "success");
});

check("rejected_row_has_reason_and_no_tx", () => {
  const [row] = buildReceipts([
    entry({ status: "rejected", reason: "PolicyViolation: RecipientNotWhitelisted" }),
  ]);
  assert.equal(row.reason, "PolicyViolation: RecipientNotWhitelisted");
  assert.equal(row.txHash, "");
});

check("unknown_vendor_gets_generic_role", () => {
  const [row] = buildReceipts([entry({ recipient: "someone.testnet" })]);
  assert.equal(row.vendorRole, "vendor");
});

check("csv_simple_row", () => {
  const csv = receiptsToCsv(
    buildReceipts([entry({ txHash: "ABC123" })]),
  );
  const lines = csv.split("\n").filter(Boolean);
  assert.equal(lines[0], RECEIPT_CSV_HEADER);
  assert.equal(
    lines[1],
    "2026-11-05T00:00:00.000Z,agent.emoi.testnet,emoi01.testnet,API/compute provider,0.5,success,,ABC123,parser",
  );
});

check("csv_escapes_commas_quotes_newlines", () => {
  const csv = receiptsToCsv(
    buildReceipts([
      entry({
        status: "rejected",
        reason: 'weird, "quoted"\nmultiline',
      }),
    ]),
  );
  assert.ok(csv.includes('"weird, ""quoted""\nmultiline"'), csv);
});

check("csv_empty_list_is_header_only", () => {
  assert.equal(receiptsToCsv([]), RECEIPT_CSV_HEADER + "\n");
});

check("filename_sanitizes_agent_and_dates", () => {
  const name = receiptsFilename("agent.emoi.testnet", "csv");
  assert.match(name, /^emoi-receipts-agent\.emoi\.testnet-\d{4}-\d{2}-\d{2}\.csv$/);
  assert.equal(
    receiptsFilename("weird/agent:id", "json"),
    `emoi-receipts-weird_agent_id-${new Date().toISOString().slice(0, 10)}.json`,
  );
});

if (failures > 0) {
  console.error(`${failures} receipts test(s) failed`);
  process.exit(1);
}
console.log("receipts tests: all passed");
