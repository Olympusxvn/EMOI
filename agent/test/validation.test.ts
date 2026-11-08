// T2.5 test set (STRATEGY 9.21). Every failure test asserts the mock
// signer call count is 0, not merely "no tx seen on-chain".
import assert from "node:assert";
import { transferWithValidation } from "../src/service.js";
import {
  nearToYocto,
  validateBeforeSigning,
  type AgentState,
  type Policy,
} from "../src/validation.js";

const active: AgentState = { owner: "emoi.testnet", status: "Active" };
const paused: AgentState = { owner: "emoi.testnet", status: "Paused" };
const revoked: AgentState = { owner: "emoi.testnet", status: "Revoked" };

function policy(over: Partial<Policy> = {}): Policy {
  return {
    max_per_tx: "1000000000000000000000000", // 1 NEAR
    daily_limit: "2000000000000000000000000", // 2 NEAR
    whitelist: ["emoi01.testnet", "emoi02.testnet"],
    spent_today: "0",
    current_day: 20758,
    ...over,
  };
}

const ONE = 1000000000000000000000000n;
const VAULT = "5000000000000000000000000"; // 5 NEAR
const TODAY = 20758;

let failures = 0;
async function check(name: string, fn: () => void | Promise<void>) {
  try {
    await fn();
    console.log(`ok - ${name}`);
  } catch (e) {
    failures++;
    console.error(`FAIL - ${name}:`, e);
  }
}

function mockSigner() {
  let calls = 0;
  const signer = async () => {
    calls++;
    return { transaction: { hash: "mock-tx-hash" } };
  };
  return { signer, calls: () => calls };
}

async function run() {
  // Grok exit test: non-whitelisted recipient is blocked, signer = 0.
  await check("llm_non_whitelisted_blocked_signer_zero", async () => {
    const m = mockSigner();
    const r = await transferWithValidation({
      agentState: active,
      policy: policy(),
      vaultBalanceYocto: VAULT,
      recipient: "attacker.near",
      amountYocto: ONE,
      amountNear: "1",
      today: TODAY,
      signer: m.signer,
    });
    assert.equal(r.status, "rejected");
    assert.equal((r as { reason: string }).reason, "RecipientNotWhitelisted");
    assert.equal(m.calls(), 0);
  });

  await check("llm_whitelisted_exceeds_daily_blocked", async () => {
    const m = mockSigner();
    const r = await transferWithValidation({
      agentState: active,
      policy: policy({ spent_today: "1500000000000000000000000" }),
      vaultBalanceYocto: VAULT,
      recipient: "emoi01.testnet",
      amountYocto: ONE,
      amountNear: "1",
      today: TODAY,
      signer: m.signer,
    });
    assert.equal(r.status, "rejected");
    assert.equal((r as { reason: string }).reason, "ExceedsDailyLimit");
    assert.equal(m.calls(), 0);
  });

  await check("llm_fully_valid_proceeds_to_signing", async () => {
    const m = mockSigner();
    const r = await transferWithValidation({
      agentState: active,
      policy: policy(),
      vaultBalanceYocto: VAULT,
      recipient: "emoi01.testnet",
      amountYocto: 500000000000000000000000n,
      amountNear: "0.5",
      today: TODAY,
      signer: m.signer,
    });
    assert.equal(r.status, "success");
    assert.equal(m.calls(), 1);
  });

  // Order proofs.
  await check("order_paused_beats_whitelist", async () => {
    const v = validateBeforeSigning({
      agentState: paused,
      policy: policy(),
      vaultBalanceYocto: VAULT,
      recipient: "attacker.near",
      amountYocto: ONE,
      today: TODAY,
    });
    assert.deepEqual(v, { ok: false, reason: "AgentPaused" });
  });
  await check("order_whitelist_beats_max", async () => {
    const v = validateBeforeSigning({
      agentState: active,
      policy: policy(),
      vaultBalanceYocto: VAULT,
      recipient: "attacker.near",
      amountYocto: 2000000000000000000000000n,
      today: TODAY,
    });
    assert.deepEqual(v, { ok: false, reason: "RecipientNotWhitelisted" });
  });
  await check("order_max_beats_daily", async () => {
    const v = validateBeforeSigning({
      agentState: active,
      policy: policy({ spent_today: "1500000000000000000000000" }),
      vaultBalanceYocto: VAULT,
      recipient: "emoi01.testnet",
      amountYocto: 1500000000000000000000000n,
      today: TODAY,
    });
    assert.deepEqual(v, { ok: false, reason: "ExceedsMaxPerTx" });
  });

  await check("invalid_amount_zero_blocked", async () => {
    const m = mockSigner();
    const r = await transferWithValidation({
      agentState: active,
      policy: policy(),
      vaultBalanceYocto: VAULT,
      recipient: "emoi01.testnet",
      amountYocto: 0n,
      amountNear: "0",
      today: TODAY,
      signer: m.signer,
    });
    assert.equal(r.status, "rejected");
    assert.equal((r as { reason: string }).reason, "InvalidAmount");
    assert.equal(m.calls(), 0);
  });

  await check("vault_insufficient_blocked", async () => {
    const m = mockSigner();
    const r = await transferWithValidation({
      agentState: active,
      policy: policy(),
      vaultBalanceYocto: "300000000000000000000000",
      recipient: "emoi01.testnet",
      amountYocto: 500000000000000000000000n,
      amountNear: "0.5",
      today: TODAY,
      signer: m.signer,
    });
    assert.equal(r.status, "rejected");
    assert.equal((r as { reason: string }).reason, "InsufficientVaultBalance");
    assert.equal(m.calls(), 0);
  });

  await check("revoked_blocked_signer_zero", async () => {
    const m = mockSigner();
    const r = await transferWithValidation({
      agentState: revoked,
      policy: policy(),
      vaultBalanceYocto: VAULT,
      recipient: "emoi01.testnet",
      amountYocto: ONE,
      amountNear: "1",
      today: TODAY,
      signer: m.signer,
    });
    assert.equal(r.status, "rejected");
    assert.equal((r as { reason: string }).reason, "AgentRevoked");
    assert.equal(m.calls(), 0);
  });

  await check("lazy_day_reset_mirrored", async () => {
    // Policy stored day is yesterday, spent_today is full, but today is
    // a new day, so effective spent is 0 and the transfer passes.
    const m = mockSigner();
    const r = await transferWithValidation({
      agentState: active,
      policy: policy({
        spent_today: "2000000000000000000000000",
        current_day: 20757,
      }),
      vaultBalanceYocto: VAULT,
      recipient: "emoi01.testnet",
      amountYocto: ONE,
      amountNear: "1",
      today: TODAY,
      signer: m.signer,
    });
    assert.equal(r.status, "success");
    assert.equal(m.calls(), 1);
  });

  await check("unregistered_blocked", async () => {
    const m = mockSigner();
    const r = await transferWithValidation({
      agentState: null,
      policy: null,
      vaultBalanceYocto: VAULT,
      recipient: "emoi01.testnet",
      amountYocto: ONE,
      amountNear: "1",
      today: TODAY,
      signer: m.signer,
    });
    assert.equal(r.status, "rejected");
    assert.equal((r as { reason: string }).reason, "AgentNotRegistered");
    assert.equal(m.calls(), 0);
  });

  await check("yocto_rejects_sub_yocto_precision", async () => {
    assert.throws(() => nearToYocto("0.0000000000000000000000001"), /ParseFailed/);
    assert.throws(() => nearToYocto("1.0000000000000000000000009"), /ParseFailed/);
  });

  await check("yocto_accepts_exact_24_decimals", async () => {
    assert.equal(nearToYocto("0.000000000000000000000001"), 1n);
    assert.equal(nearToYocto("0.5"), 500000000000000000000000n);
    assert.equal(nearToYocto("1"), 1000000000000000000000000n);
  });
  if (failures > 0) {
    console.error(`${failures} validation test(s) failed`);
    process.exit(1);
  }
  console.log("validation tests: all passed");
}

await run();
