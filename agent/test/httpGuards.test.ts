// HTTP guard tests (offline, pure functions only).
import assert from "node:assert";
import { isLocalhostOrigin, resolveTransferAgent, sanitizeErrorForHttp } from "../src/httpGuards.js";

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

check("localhost_origins_allowed", () => {
  for (const o of ["http://localhost:5173", "http://localhost:3000", "http://127.0.0.1:5173", "http://127.0.0.1:3001"]) {
    assert.equal(isLocalhostOrigin(o), true);
  }
});

check("non_localhost_origins_rejected", () => {
  for (const o of ["https://evil.com", "http://evil.com", "http://localhost.evil.com", "http://192.168.1.2:3000", "", "null"]) {
    assert.equal(isLocalhostOrigin(o), false);
  }
});

check("transfer_agent_defaults_to_configured", () => {
  assert.equal(resolveTransferAgent(undefined, "agent.emoi.testnet"), "agent.emoi.testnet");
});

check("transfer_agent_mismatch_throws", () => {
  assert.equal(resolveTransferAgent("agent.emoi.testnet", "agent.emoi.testnet"), "agent.emoi.testnet");
  assert.throws(() => resolveTransferAgent("research.emoi.testnet", "agent.emoi.testnet"), /signs only for/);
});

check("error_sanitizer_masks_home_dir", () => {
  assert.equal(
    sanitizeErrorForHttp("no key file at /home/op/.near-credentials/x.json", "/home/op"),
    "no key file at ~/.near-credentials/x.json",
  );
  assert.equal(sanitizeErrorForHttp("plain rpc error", "/home/op"), "plain rpc error");
});

if (failures > 0) {
  console.error(`${failures} httpGuards test(s) failed`);
  process.exit(1);
}
console.log("httpGuards tests: all passed");