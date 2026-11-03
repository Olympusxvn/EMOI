// Preflight helper tests: tracked shell scripts must carry +x in the git
// index, or CI checkout on Linux cannot execute them (2026-11-03 outage).
import assert from "node:assert";
import { nonExecutableShFiles } from "../scripts/preflight.js";

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

check("all_executable_returns_empty", () => {
  const out = "100755 abc123 0\tscripts/setup.sh\n100755 def456 0\tscripts/run-local.sh\n";
  assert.deepEqual(nonExecutableShFiles(out), []);
});

check("missing_exec_bit_is_reported", () => {
  const out = "100644 abc123 0\tscripts/setup.sh\n100755 def456 0\tscripts/run-local.sh\n";
  assert.deepEqual(nonExecutableShFiles(out), ["scripts/setup.sh"]);
});

check("non_sh_lines_are_ignored", () => {
  const out = "100644 abc123 0\tscripts/setup.sh.bak\n";
  assert.deepEqual(nonExecutableShFiles(out), []);
});

check("empty_output_returns_empty", () => {
  assert.deepEqual(nonExecutableShFiles(""), []);
});

if (failures > 0) {
  console.error(`${failures} preflight test(s) failed`);
  process.exit(1);
}
console.log("preflight tests: all passed");
