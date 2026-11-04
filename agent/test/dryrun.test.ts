// Dry-run preview tests: previewTransfer reuses validateBeforeSigning with
// caller-supplied views, never signs, and never returns a txHash.
// Fully offline: fixtures only, no chain, no keys.
import assert from "node:assert";
import { previewTransfer } from "../src/service.js";
import { currentDayFromMs } from "../src/validation.js";
import type { AgentState, Policy } from "../src/validation.js";

let failures = 0;
async function run(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    console.log(`ok - ${name}`);
  } catch (e) {
    failures++;
    console.error(`FAIL - ${name}:`, e);
  }
}

const TODAY = currentDayFromMs(Date.now());
const ONE = "1000000000000000000000000";
const TWO = "2000000000000000000000000";
const FIVE = "5000000000000000000000000";

function views(overrides: Partial<Policy> = {}, status: AgentState["status"] = "Active") {
  const policy: Policy = {
    max_per_tx: ONE,
    daily_limit: TWO,
    whitelist: ["emoi01.testnet", "emoi02.testnet"],
    spent_today: "0",
    current_day: TODAY,
    ...overrides,
  };
  return {
    agentState: { owner: "emoi.testnet", status } as AgentState,
    policy,
    vaultBalanceYocto: FIVE,
  };
}

const cases: Array<[string, () => Promise<void>]> = [
  [
    "valid_intent_would_succeed_without_txhash",
    async () => {
      const r = await previewTransfer({
        text: "send 0.5 NEAR to emoi01.testnet",
        useLlm: false,
        views: views(),
        today: TODAY,
      });
      assert.equal(r.status, "would-succeed");
      if (r.status === "would-succeed") {
        assert.equal(r.recipient, "emoi01.testnet");
        assert.equal(r.amountNear, "0.5");
        assert.ok(!("txHash" in r), "dry-run must never carry a txHash");
      }
    },
  ],
  [
    "non_whitelisted_rejected",
    async () => {
      const r = await previewTransfer({
        text: "send 100 NEAR to attacker.near",
        useLlm: false,
        views: views(),
        today: TODAY,
      });
      assert.equal(r.status, "rejected");
      if (r.status === "rejected") assert.equal(r.reason, "RecipientNotWhitelisted");
    },
  ],
  [
    "over_max_rejected",
    async () => {
      const r = await previewTransfer({
        text: "send 1.5 NEAR to emoi01.testnet",
        useLlm: false,
        views: views(),
        today: TODAY,
      });
      assert.equal(r.status, "rejected");
      if (r.status === "rejected") assert.equal(r.reason, "ExceedsMaxPerTx");
    },
  ],
  [
    "garbage_text_parse_failed",
    async () => {
      const r = await previewTransfer({
        text: "hello there",
        useLlm: false,
        views: views(),
        today: TODAY,
      });
      assert.equal(r.status, "rejected");
      if (r.status === "rejected") assert.equal(r.reason, "ParseFailed");
    },
  ],
  [
    "paused_agent_rejected",
    async () => {
      const r = await previewTransfer({
        text: "send 0.5 NEAR to emoi01.testnet",
        useLlm: false,
        views: views({}, "Paused"),
        today: TODAY,
      });
      assert.equal(r.status, "rejected");
      if (r.status === "rejected") assert.equal(r.reason, "AgentPaused");
    },
  ],
  [
    "llm_grounded_would_succeed",
    async () => {
      const r = await previewTransfer({
        text: "send 0.5 NEAR to emoi01.testnet",
        useLlm: true,
        llmFn: async () => ({
          ok: true as const,
          intent: {
            recipient: "emoi01.testnet",
            amountNear: "0.5",
            amountYocto: 500000000000000000000000n,
          },
        }),
        views: views(),
        today: TODAY,
      });
      assert.equal(r.status, "would-succeed");
    },
  ],
];

async function main() {
  for (const [name, fn] of cases) await run(name, fn);
  if (failures > 0) {
    console.error(`${failures} dryrun test(s) failed`);
    process.exit(1);
  }
  console.log("dryrun tests: all passed");
}

main();
