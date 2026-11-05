// FCK allowance-alert tests: picker scope rules, threshold parsing,
// verdict boundary. Fully offline: no RPC, no keychain.
import assert from "node:assert";
import {
  allowanceVerdict,
  fckWarnThresholdYocto,
  pickScopedFck,
  type ListedKey,
} from "../src/fck.js";

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

const POLICY = "policy.emoi.testnet";
const METHOD = "agent_transfer";

function fckKey(pub: string, allowance: string, receiver = POLICY, methods = [METHOD]): ListedKey {
  return {
    public_key: pub,
    access_key: { permission: { FunctionCall: { allowance, receiver_id: receiver, method_names: methods } } },
  };
}

check("picker_skips_full_access_and_wrong_scope", () => {
  const keys: ListedKey[] = [
    { public_key: "ed25519:FULL", access_key: { permission: "FullAccess" } },
    fckKey("ed25519:WRONGMETHOD", "999", POLICY, ["set_policy"]),
    fckKey("ed25519:WRONGRECEIVER", "999", "other.testnet"),
    fckKey("ed25519:MULTI", "999", POLICY, [METHOD, "set_policy"]),
  ];
  assert.equal(pickScopedFck(keys, POLICY, METHOD), null);
});

check("picker_prefers_highest_allowance", () => {
  const keys: ListedKey[] = [
    fckKey("ed25519:LOW", "100"),
    fckKey("ed25519:HIGH", "200"),
  ];
  assert.equal(pickScopedFck(keys, POLICY, METHOD)?.publicKey, "ed25519:HIGH");
});

check("picker_missing_allowance_counts_as_zero", () => {
  const keys: ListedKey[] = [fckKey("ed25519:NOALLOW", "")];
  // "" is falsy, so the picker treats it as 0 — still a scoped key.
  assert.equal(pickScopedFck(keys, POLICY, METHOD)?.allowanceYocto, "0");
});

check("verdict_boundary_is_inclusive", () => {
  const t = 100000000000000000000000n;
  assert.equal(allowanceVerdict(t, t), "ok");
  assert.equal(allowanceVerdict(t - 1n, t), "low");
  assert.equal(allowanceVerdict(t + 1n, t), "ok");
});

check("threshold_defaults_to_0_1_near", () => {
  const saved = process.env.FCK_WARN_ALLOWANCE_NEAR;
  try {
    delete process.env.FCK_WARN_ALLOWANCE_NEAR;
    assert.equal(fckWarnThresholdYocto(), 100000000000000000000000n);
  } finally {
    if (saved === undefined) delete process.env.FCK_WARN_ALLOWANCE_NEAR;
    else process.env.FCK_WARN_ALLOWANCE_NEAR = saved;
  }
});

check("threshold_env_override_parses_decimals", () => {
  const saved = process.env.FCK_WARN_ALLOWANCE_NEAR;
  try {
    process.env.FCK_WARN_ALLOWANCE_NEAR = "0.25";
    assert.equal(fckWarnThresholdYocto(), 250000000000000000000000n);
    process.env.FCK_WARN_ALLOWANCE_NEAR = "2";
    assert.equal(fckWarnThresholdYocto(), 2000000000000000000000000n);
  } finally {
    if (saved === undefined) delete process.env.FCK_WARN_ALLOWANCE_NEAR;
    else process.env.FCK_WARN_ALLOWANCE_NEAR = saved;
  }
});

check("threshold_rejects_garbage", () => {
  const saved = process.env.FCK_WARN_ALLOWANCE_NEAR;
  try {
    for (const bad of ["abc", "-1", "0.0000000000000000000000001", "", "1.2.3"]) {
      process.env.FCK_WARN_ALLOWANCE_NEAR = bad;
      assert.throws(() => fckWarnThresholdYocto(), /invalid FCK_WARN_ALLOWANCE_NEAR/);
    }
  } finally {
    if (saved === undefined) delete process.env.FCK_WARN_ALLOWANCE_NEAR;
    else process.env.FCK_WARN_ALLOWANCE_NEAR = saved;
  }
});

if (failures > 0) {
  console.error(`${failures} fck test(s) failed`);
  process.exit(1);
}
console.log("fck tests: all passed");
