// Key-file loader tests: conformance must SKIP (not crash) when the
// throwaway revoked-agent key file is absent from the legacy keychain.
import assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { tryKeyFileFor } from "../scripts/conformance.js";

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

function scratchKeychain(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "emoi-keyfile-"));
}

check("missing_key_file_returns_null", () => {
  const r = tryKeyFileFor(
    "nonexistent-agent.testnet",
    "ed25519:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
    scratchKeychain(),
  );
  assert.equal(r, null);
});

check("malformed_key_file_returns_null", () => {
  const base = scratchKeychain();
  const dir = path.join(base, "broken-agent.testnet");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "ed25519_BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB.json"), "not json{");
  const r = tryKeyFileFor(
    "broken-agent.testnet",
    "ed25519:BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
    base,
  );
  assert.equal(r, null);
});

check("valid_key_file_returns_private_key", () => {
  const base = scratchKeychain();
  const dir = path.join(base, "good-agent.testnet");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, "ed25519_CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC.json"),
    JSON.stringify({ account_id: "good-agent.testnet", private_key: "ed25519:PRIVATE_KEY_FOR_TEST_ONLY" }),
  );
  const r = tryKeyFileFor(
    "good-agent.testnet",
    "ed25519:CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC",
    base,
  );
  assert.equal(r, "ed25519:PRIVATE_KEY_FOR_TEST_ONLY");
});

if (failures > 0) {
  console.error(`${failures} keyfile test(s) failed`);
  process.exit(1);
}
console.log("keyfile tests: all passed");
