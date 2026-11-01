// Reissue FCK script (T2.2, flag-gated).
// FCK gas exhaustion is NOT a PolicyViolation: the key simply cannot
// pay gas any more, and an existing key's allowance cannot be changed.
// This script adds a fresh FCK (same receiver, same single method,
// same allowance) and updates .env with the new key, without printing
// the new private key. It refuses to run without --confirm.
// Usage: tsx scripts/reissue-fck.ts --agent agent.emoi.testnet --confirm

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { config as loadDotenv } from "dotenv";

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");
loadDotenv({ path: path.join(repoRoot, ".env") });

function stripAnsi(s: string): string {
  return s.replace(/\x1b\[[0-9;]*m/g, "");
}

async function runNear(args: string[]): Promise<{ stdout: string; ok: boolean }> {
  try {
    const cargoBin = `${os.homedir()}/.cargo/bin`;
    const pathEnv = process.env.PATH ? `${process.env.PATH}:${cargoBin}` : cargoBin;
    const { stdout, stderr } = await execFileAsync("near", args, { env: { ...process.env, PATH: pathEnv } });
    return { stdout: stripAnsi(stdout + stderr), ok: true };
  } catch (e) {
    const err = e as { stdout?: string; stderr?: string };
    return { stdout: stripAnsi((err.stdout ?? "") + (err.stderr ?? "")), ok: false };
  }
}

async function main() {
  if (!process.argv.includes("--confirm")) {
    console.error("Refusing to reissue without --confirm. Re-run with --confirm to proceed.");
    process.exit(1);
  }
  const nameIdx = process.argv.indexOf("--agent");
  const agentId = nameIdx >= 0 ? process.argv[nameIdx + 1] : (process.env.AGENT_ACCOUNT_ID ?? "agent.emoi.testnet");
  const policyId = process.env.POLICY_CONTRACT_ID ?? "policy.emoi.testnet";
  const allowanceIdx = process.argv.indexOf("--allowance");
  const allowance = allowanceIdx >= 0 ? process.argv[allowanceIdx + 1] : "0.25";
  const agentKeyFile = path.join(os.homedir(), ".near-credentials", "testnet", `${agentId}.json`);
  if (!fs.existsSync(agentKeyFile)) {
    throw new Error(`agent full key file not found at ${agentKeyFile}`);
  }
  const added = await runNear([
    "account", "add-key", agentId, "grant-function-call-access",
    "--allowance", `${allowance} NEAR`, "--contract-account-id", policyId,
    "--function-names", "agent_transfer", "autogenerate-new-keypair", "save-to-keychain",
    "network-config", "testnet", "sign-with-access-key-file", agentKeyFile, "send",
  ]);
  if (!added.ok) throw new Error(`FCK add failed: ${added.stdout.slice(-500)}`);
  const newPub = /Added access key = (ed25519:\S+)/.exec(added.stdout)?.[1];
  if (!newPub) throw new Error("could not parse new FCK public key from near-cli output");
  const tx = /Transaction ID: (\S+)/.exec(added.stdout)?.[1];
  // Find the new key file. Only update .env if this is the configured
  // default agent; other agents use their key file directly, so their
  // reissue must never overwrite the default agent's FCK in .env.
  const keyDir = path.join(os.homedir(), ".near-credentials", "testnet", agentId);
  const keyFile = path.join(keyDir, `ed25519_${newPub.replace("ed25519:", "")}.json`);
  if (!fs.existsSync(keyFile)) {
    throw new Error(`new FCK key file not found at ${keyFile}; old FCK is still in place`);
  }
  const configuredAgent = process.env.AGENT_ACCOUNT_ID ?? "agent.emoi.testnet";
  let envUpdated = false;
  if (agentId === configuredAgent) {
    const data = JSON.parse(fs.readFileSync(keyFile, "utf-8")) as { private_key: string };
    const envPath = path.join(repoRoot, ".env");
    const envText = fs.readFileSync(envPath, "utf-8");
    fs.writeFileSync(
      envPath,
      envText.replace(/^AGENT_FCK_PRIVATE_KEY=.*$/m, `AGENT_FCK_PRIVATE_KEY=${data.private_key}`),
      { mode: 0o600 },
    );
    envUpdated = true;
  }
  console.log(JSON.stringify({
    agentId,
    newFckPublicKey: newPub,
    newFckKeyFile: keyFile,
    envUpdated,
    tx: tx ?? "unknown",
    note: "Old FCK (if gas-exhausted) remains on-chain but unusable; delete it with near account delete-keys once the new key is verified working.",
  }, null, 2));
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
