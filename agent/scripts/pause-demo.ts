// Pause demo script (Phase 4 video).
// Owner pauses the agent, a transfer attempt is blocked (AgentPaused,
// blocked before signing, no tx hash), then the owner resumes the agent.
// Usage: tsx scripts/pause-demo.ts [--json]
// The owner key is used only here, by the owner, via a temporary
// access-key file (mode 600) deleted in a finally block, never printed
// and never passed on a command line.

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { config as loadDotenv } from "dotenv";
import bs58 from "bs58";
import { processIntent } from "../src/service.js";

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
function publicKeyFromPrivateKey(privateKey: string): string {
  const raw = bs58.decode(privateKey.replace(/^ed25519:/, ""));
  return `ed25519:${bs58.encode(raw.slice(32))}`;
}
function txOf(out: string): string | null {
  return /Transaction ID: (\S+)/.exec(out)?.[1] ?? /transaction hash: (\S+)/i.exec(out)?.[1] ?? null;
}

async function main() {
  const json = process.argv.includes("--json");
  const ownerId = process.env.OWNER_ACCOUNT_ID ?? "emoi.testnet";
  const policyId = process.env.POLICY_CONTRACT_ID ?? "policy.emoi.testnet";
  const agentId = process.env.AGENT_ACCOUNT_ID ?? "agent.emoi.testnet";
  const ownerPrivateKey = process.env.OWNER_PRIVATE_KEY;
  if (!ownerPrivateKey) throw new Error("OWNER_PRIVATE_KEY is not set in .env");
  const ownerKeyFile = path.join(os.tmpdir(), `emoi-owner-${process.pid}.json`);
  fs.writeFileSync(
    ownerKeyFile,
    JSON.stringify({ account_id: ownerId, public_key: publicKeyFromPrivateKey(ownerPrivateKey), private_key: ownerPrivateKey }),
    { mode: 0o600 },
  );
  try {
    const pause = await runNear([
      "contract", "call-function", "as-transaction", policyId, "pause_agent",
      "json-args", JSON.stringify({ agent_account_id: agentId }),
      "prepaid-gas", "100.0 TeraGas", "attached-deposit", "0 NEAR",
      "sign-as", ownerId, "network-config", "testnet",
      "sign-with-access-key-file", ownerKeyFile, "send",
    ]);
    if (!pause.ok) throw new Error(`pause failed: ${pause.stdout.slice(-500)}`);
    const pauseTx = txOf(pause.stdout);

    const attempt = await processIntent({ text: "send 0.5 NEAR to emoi01.testnet", useLlm: false });

    const resume = await runNear([
      "contract", "call-function", "as-transaction", policyId, "resume_agent",
      "json-args", JSON.stringify({ agent_account_id: agentId }),
      "prepaid-gas", "100.0 TeraGas", "attached-deposit", "0 NEAR",
      "sign-as", ownerId, "network-config", "testnet",
      "sign-with-access-key-file", ownerKeyFile, "send",
    ]);
    if (!resume.ok) throw new Error(`resume failed: ${resume.stdout.slice(-500)}`);
    const resumeTx = txOf(resume.stdout);

    const result = {
      status: attempt.status === "rejected" && attempt.reason === "AgentPaused" ? "blocked-as-expected" : "unexpected",
      pauseTx, resumeTx,
      attempt: { status: attempt.status, reason: attempt.status === "rejected" ? attempt.reason : null, txHash: attempt.status === "success" ? (attempt.txHash ?? null) : null },
      note: "Paused transfer was blocked before signing, no transaction sent.",
    };
    if (json) console.log(JSON.stringify(result, null, 2));
    else console.log(result);
    process.exit(result.status === "blocked-as-expected" ? 0 : 1);
  } finally {
    try { fs.unlinkSync(ownerKeyFile); } catch { /* already deleted */ }
  }
}

main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
