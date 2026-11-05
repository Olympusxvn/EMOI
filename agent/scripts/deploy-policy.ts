// Deploy a freshly built PolicyVault wasm to the policy account
// (owner-operated). Code-only redeploy: NO init call, on-chain state is
// preserved. Only valid when the contract struct is unchanged since the
// deployed version (no migration needed); if storage layout changed,
// write a migration first instead of using this script.
// The signing key must be a full-access key OF THE POLICY ACCOUNT
// (owner keys cannot deploy to a sub-account). The key file is only
// read by near-cli and never printed.
// Usage: tsx scripts/deploy-policy.ts --key-file <path> [--wasm <path>]
//   [--policy <account>] --confirm
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadDotenv } from "dotenv";

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
loadDotenv({ path: path.join(repoRoot, ".env") });

function stripAnsi(s: string): string {
  return s.replace(/\x1b\[[0-9;]*m/g, "");
}

function argValue(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  if (!process.argv.includes("--confirm")) {
    console.error("Refusing to deploy without --confirm. Re-run with --confirm to proceed.");
    process.exit(1);
  }
  const keyFile = argValue("--key-file");
  if (!keyFile || !fs.existsSync(keyFile)) {
    throw new Error("--key-file <path> is required and must exist (policy account full-access key)");
  }
  const policyId = argValue("--policy") ?? process.env.POLICY_CONTRACT_ID ?? "policy.emoi.testnet";
  const wasm = argValue("--wasm")
    ?? path.join(repoRoot, "contract", "target", "near", "emoi_contract.wasm");
  if (!fs.existsSync(wasm)) {
    throw new Error(`wasm not found at ${wasm}; build first: cd contract && cargo near build non-reproducible-wasm`);
  }
  const bytes = fs.readFileSync(wasm);
  console.log(JSON.stringify({
    wasm,
    bytes: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    policyId,
  }));
  const cargoBin = path.join(os.homedir(), ".cargo", "bin");
  const pathEnv = process.env.PATH ? `${process.env.PATH}${path.delimiter}${cargoBin}` : cargoBin;
  const { stdout, stderr } = await execFileAsync("near", [
    "contract", "deploy", policyId, "use-file", wasm,
    "without-init-call", "network-config", "testnet",
    "sign-with-access-key-file", keyFile, "send",
  ], { env: { ...process.env, PATH: pathEnv }, maxBuffer: 10 * 1024 * 1024 });
  const out = stripAnsi(stdout + stderr);
  const tx = /Transaction ID: (\S+)/.exec(out)?.[1];
  console.log(out.slice(-1500));
  if (!tx) throw new Error("deploy ran but no Transaction ID found in output");
  console.log(`DEPLOY_TX=${tx}`);
}

if (["deploy-policy.ts", "deploy-policy.js"].includes(path.basename(process.argv[1] ?? ""))) main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
