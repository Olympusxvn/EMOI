// Create Agent script (T2.1, owner-operated).
// Steps, in the frozen order (STRATEGY 9.1):
//   1. Create <slug>.<OWNER_ACCOUNT_ID>, funded only for gas/storage.
//   2. Add an FCK: receiver = policy contract, method = agent_transfer only.
//   3. Register the agent on-chain.
//   4. Optionally top the shared owner vault up to --deposit.
//   5. Optionally set the policy (--set-policy).
// Idempotent: existing account / FCK / registration are skipped, never
// recreated. A revoked agent is an error: choose a different name.
// The script NEVER auto-appends a numeric suffix to a colliding name.
// Usage:
//   tsx scripts/create-agent.ts --name my-agent [--initial-balance 0.5]
//     [--fck-allowance 0.25] [--deposit 5] [--set-policy]
//     [--max 1] [--daily 2] [--whitelist emoi01.testnet,emoi02.testnet]
// The owner key is used only here, by the owner, to create and register.
// It is never passed on a command line: it is written to a temporary
// access-key file (mode 600) and deleted in a finally block.

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { config as loadDotenv } from "dotenv";
import bs58 from "bs58";
import { nearToYocto } from "../src/validation.js";
import { fckPrivateKeyFor } from "../src/fck.js";

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");
loadDotenv({ path: path.join(repoRoot, ".env") });

function argValue(name: string, def?: string): string | undefined {
  const idx = process.argv.indexOf(name);
  return idx >= 0 ? process.argv[idx + 1] : def;
}
function hasFlag(name: string): boolean {
  return process.argv.includes(name);
}

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

function slugify(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "agent";
}

function publicKeyFromPrivateKey(privateKey: string): string {
  const raw = bs58.decode(privateKey.replace(/^ed25519:/, ""));
  const pub = raw.slice(32);
  return `ed25519:${bs58.encode(pub)}`;
}

async function main() {
  const name = argValue("--name", "agent")!;
  const slug = slugify(name);
  const ownerId = process.env.OWNER_ACCOUNT_ID ?? "emoi.testnet";
  const policyId = process.env.POLICY_CONTRACT_ID ?? "policy.emoi.testnet";
  // Namespace derives from the owner: judges create under their own account.
  const agentId = `${slug}.${ownerId.toLowerCase()}`;
  const initialBalance = argValue("--initial-balance", "0.5")!;
  const fckAllowance = argValue("--fck-allowance", "0.25")!;
  const depositTarget = Number(argValue("--deposit", "0")!);
  const doSetPolicy = hasFlag("--set-policy");
  const maxNear = argValue("--max", "1")!;
  const dailyNear = argValue("--daily", "2")!;
  const whitelist = (argValue("--whitelist", "emoi01.testnet,emoi02.testnet")!)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const ownerPrivateKey = process.env.OWNER_PRIVATE_KEY;
  if (!ownerPrivateKey) throw new Error("OWNER_PRIVATE_KEY is not set in .env");
  const ownerKeyFile = path.join(os.tmpdir(), `emoi-owner-${process.pid}.json`);
  fs.writeFileSync(
    ownerKeyFile,
    JSON.stringify({
      account_id: ownerId,
      public_key: publicKeyFromPrivateKey(ownerPrivateKey),
      private_key: ownerPrivateKey,
    }),
    { mode: 0o600 },
  );

  const steps: Record<string, string> = {};
  try {
    // 1. Account exists?
    const accountCheck = await runNear([
      "account", "view-account-summary", agentId, "network-config", "testnet", "now",
    ]);
    if (accountCheck.ok) {
      steps.account = "skipped (already exists)";
    } else {
      const created = await runNear([
        "account", "create-account", "fund-myself", agentId, `${initialBalance} NEAR`,
        "autogenerate-new-keypair", "save-to-keychain", "sign-as", ownerId,
        "network-config", "testnet", "sign-with-access-key-file", ownerKeyFile, "send",
      ]);
      if (!created.ok) throw new Error(`account creation failed: ${created.stdout.slice(-500)}`);
      const tx = /Transaction ID: (\S+)/.exec(created.stdout)?.[1];
      steps.account = `created (tx ${tx ?? "unknown"})`;
    }

    // Agent full key file (legacy keychain) for signing the FCK add.
    const agentKeyFile = path.join(os.homedir(), ".near-credentials", "testnet", `${agentId}.json`);
    if (!fs.existsSync(agentKeyFile)) {
      throw new Error(`agent key file not found at ${agentKeyFile}; account creation did not save a key`);
    }

    // 2. FCK exists?
    const keys = await runNear(["account", "list-keys", agentId, "network-config", "testnet", "now"]);
    const fckExists = keys.stdout.includes(policyId) && keys.stdout.includes("agent_transfer");
    let fckPublicKey: string | undefined;
    if (fckExists) {
      steps.fck = "skipped (already exists)";
      const m = /ed25519:[A-Za-z0-9]+(?=[^\n]*agent_transfer)/.exec(keys.stdout);
      // Fallback: find the FCK public key from the keychain folder below.
      fckPublicKey = m?.[0];
    } else {
      const added = await runNear([
        "account", "add-key", agentId, "grant-function-call-access",
        "--allowance", `${fckAllowance} NEAR`, "--contract-account-id", policyId,
        "--function-names", "agent_transfer", "autogenerate-new-keypair", "save-to-keychain",
        "network-config", "testnet", "sign-with-access-key-file", agentKeyFile, "send",
      ]);
      if (!added.ok) throw new Error(`FCK add failed: ${added.stdout.slice(-500)}`);
      fckPublicKey = /Added access key = (ed25519:\S+)/.exec(added.stdout)?.[1];
      const tx = /Transaction ID: (\S+)/.exec(added.stdout)?.[1];
      steps.fck = `created ${fckPublicKey ?? ""} (tx ${tx ?? "unknown"})`;
    }

    // Backfill .env AGENT_FCK_PRIVATE_KEY from the FCK key file, if empty
    // and this is the configured agent. This is how the agent service
    // gets its FCK without ever holding the owner key.
    const envPath = path.join(repoRoot, ".env");
    const envText = fs.readFileSync(envPath, "utf-8");
    const fckLine = /^AGENT_FCK_PRIVATE_KEY=.*$/m.exec(envText);
    const configuredAgent = process.env.AGENT_ACCOUNT_ID ?? "agent.emoi.testnet";
    if (agentId === configuredAgent && (!fckLine || fckLine[0] === "AGENT_FCK_PRIVATE_KEY=")) {
      // Picked by on-chain scope (receiver + method), never by folder order.
      let fckPrivate: string | undefined;
      try {
        fckPrivate = (await fckPrivateKeyFor(agentId)).privateKey;
      } catch {
        // Leave envFck unset below: rerunning after fixing keys backfills it.
      }
      if (fckPrivate) {
        const updated = envText.replace(
          /^AGENT_FCK_PRIVATE_KEY=.*$/m,
          `AGENT_FCK_PRIVATE_KEY=${fckPrivate}`,
        );
        fs.writeFileSync(envPath, updated, { mode: 0o600 });
        steps.envFck = "backfilled from FCK key file (value not printed)";
      }
    }

    // 3. Registration: use a view, not a guess.
    const viewNear = await runNear([
      "contract", "call-function", "as-read-only", policyId, "get_agent_state",
      "json-args", JSON.stringify({ agent_account_id: agentId }),
      "network-config", "testnet", "now",
    ]);
    // near-cli view output contains the JSON return value; parse the
    // last JSON object in the output if present.
    const stateMatch = /\{\s*"owner"[^}]*\}/.exec(viewNear.stdout);
    if (stateMatch) {
      const state = JSON.parse(stateMatch[0]) as { status: string };
      if (state.status === "Revoked") {
        throw new Error(
          `Agent ${agentId} is revoked and cannot be re-registered. Choose a different name; no numeric suffix is added automatically.`,
        );
      }
      steps.register = `skipped (already registered, status ${state.status})`;
    } else {
      const reg = await runNear([
        "contract", "call-function", "as-transaction", policyId, "register_agent",
        "json-args", JSON.stringify({ agent_account_id: agentId }),
        "prepaid-gas", "100 Tgas", "attached-deposit", "0 NEAR",
        "sign-as", ownerId, "network-config", "testnet",
        "sign-with-access-key-file", ownerKeyFile, "send",
      ]);
      if (!reg.ok) throw new Error(`register_agent failed: ${reg.stdout.slice(-500)}`);
      const tx = /Transaction ID: (\S+)/.exec(reg.stdout)?.[1];
      steps.register = `registered (tx ${tx ?? "unknown"})`;
    }

    // 4. Deposit, idempotent to a target balance.
    if (depositTarget > 0) {
      const bal = await runNear([
        "contract", "call-function", "as-read-only", policyId, "get_balance",
        "json-args", JSON.stringify({ owner: ownerId }),
        "network-config", "testnet", "now",
      ]);
      const balMatch = /"(\d+)"/.exec(bal.stdout);
      const currentNear = balMatch ? Number(BigInt(balMatch[1])) / 1e24 : 0;
      if (currentNear >= depositTarget) {
        steps.deposit = `skipped (vault ${currentNear} NEAR >= target ${depositTarget} NEAR)`;
      } else {
        const diff = depositTarget - currentNear;
        const dep = await runNear([
          "contract", "call-function", "as-transaction", policyId, "deposit_funds",
          "json-args", "{}", "prepaid-gas", "100 Tgas", "attached-deposit", `${diff} NEAR`,
          "sign-as", ownerId, "network-config", "testnet",
          "sign-with-access-key-file", ownerKeyFile, "send",
        ]);
        if (!dep.ok) throw new Error(`deposit failed: ${dep.stdout.slice(-500)}`);
        const tx = /Transaction ID: (\S+)/.exec(dep.stdout)?.[1];
        steps.deposit = `deposited ${diff} NEAR to reach ${depositTarget} NEAR (tx ${tx ?? "unknown"})`;
      }
    }

    // 5. Set policy, if requested.
    if (doSetPolicy) {

      const pol = await runNear([
        "contract", "call-function", "as-transaction", policyId, "set_policy",
        "json-args", JSON.stringify({
          agent_account_id: agentId,
          max_per_tx: nearToYocto(maxNear).toString(),
          daily_limit: nearToYocto(dailyNear).toString(),
          whitelist,
        }),
        "prepaid-gas", "100 Tgas", "attached-deposit", "0 NEAR",
        "sign-as", ownerId, "network-config", "testnet",
        "sign-with-access-key-file", ownerKeyFile, "send",
      ]);
      if (!pol.ok) throw new Error(`set_policy failed: ${pol.stdout.slice(-500)}`);
      const tx = /Transaction ID: (\S+)/.exec(pol.stdout)?.[1];
      steps.policy = `set max ${maxNear} / daily ${dailyNear} / whitelist ${whitelist.join(",")} (tx ${tx ?? "unknown"})`;
    }

    console.log(JSON.stringify({ agentId, steps }, null, 2));
  } finally {
    try { fs.unlinkSync(ownerKeyFile); } catch { /* already removed */ }
  }
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
