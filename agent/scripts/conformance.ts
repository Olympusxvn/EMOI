// conformance.ts — check that the CONTRACT, the README error table, and
// live on-chain behavior agree on every PolicyViolation, without trusting
// the frontend or the agent service.
//
// How it works (borrowed from Veto's conformance idea, adapted to EMOI):
// for each case it calls the contract DIRECTLY with an agent FCK and asserts
// the failure reason it gets back matches the expected PolicyViolation.
// It also asserts the same reason string appears in contract/src/lib.rs
// and in the README error table, so docs cannot drift from code.
//
// Safe by construction: every case below REVERTS, so no NEAR leaves the
// vault and no agent status changes. The daily-limit case is guarded: it
// runs only if the audit agent's daily limit is already exhausted, and is
// SKIPPED otherwise, so it can never become a successful spend on a new
// day. The paused-transfer case is deliberately NOT here: pausing changes
// state, and it is already covered by `npm run demo:pause` + the 2026-11-02
// audit (pause -> AgentPaused -> resume -> Active).
//
// Usage: npx tsx scripts/conformance.ts
// Exit code 0 = all PASS (or SKIP); 1 = any FAIL.

import { config, requireAgentFck } from "../src/config.js";
import { fckPrivateKeyFor } from "../src/fck.js";
import { nearToYocto } from "../src/validation.js";
import { createViewNear } from "../src/nearClient.js";
import { Near } from "near-kit";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const POLICY = config.policyContractId;
const MAIN = config.agentAccountId;
const FCKONLY = "fckonly-test.emoi.testnet";
const AUDIT_AGENT = "audit2-test.emoi.testnet";
const FCKONLY_FCK_PUB = "ed25519:2EC21JE2U9sYZpbkuFJsEtnSm7HsDb7ijBLcb48qKwDc";


function keyFileFor(agentId: string, publicKey: string): string {
  const dir = path.join(os.homedir(), ".near-credentials", "testnet", agentId);
  const bare = publicKey.startsWith("ed25519:") ? publicKey.slice(8) : publicKey;
  const data = JSON.parse(fs.readFileSync(path.join(dir, `ed25519_${bare}.json`), "utf-8")) as {
    private_key: string;
  };
  return data.private_key;
}

async function auditFckPrivateKey(): Promise<string> {
  return (await fckPrivateKeyFor(AUDIT_AGENT)).privateKey;
}

function nearFor(agentId: string, privateKey: string): Near {
  return new Near({
    network: config.network,
    privateKey: privateKey as `ed25519:${string}`,
    defaultSignerId: agentId,
  });
}

async function viewPolicy(agentId: string) {
  const near = createViewNear();
  const policy = (await near.view(POLICY, "get_policy", { agent_account_id: agentId })) as Record<
    string,
    unknown
  > | null;
  const state = (await near.view(POLICY, "get_agent_state", { agent_account_id: agentId })) as {
    status: string;
  } | null;
  return { policy, status: state?.status ?? null };
}

async function viewVault(): Promise<string> {
  const near = createViewNear();
  const bal = (await near.view(POLICY, "get_balance", { owner: config.ownerAccountId })) as string;
  return bal;
}

type Result = { name: string; verdict: "PASS" | "FAIL" | "SKIP"; detail: string };

async function directTransfer(
  near: Near,
  recipient: string,
  amountYocto: string,
): Promise<{ ok: boolean; error: string }> {
  try {
    await near.call(POLICY, "agent_transfer", { recipient, amount: amountYocto }, { gas: "100 Tgas", attachedDeposit: 0n });
    return { ok: true, error: "" };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

async function main() {
  const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");
  const libRs = fs.readFileSync(path.join(repoRoot, "contract", "src", "lib.rs"), "utf-8");
  const readme = fs.readFileSync(path.join(repoRoot, "README.md"), "utf-8");
  const results: Result[] = [];

  const vaultBefore = await viewVault();
  const mainBefore = await viewPolicy(MAIN);

  const mainNear = nearFor(MAIN, requireAgentFck());
  const fckonlyNear = nearFor(FCKONLY, keyFileFor(FCKONLY, FCKONLY_FCK_PUB));

  const transferCases = [
    { name: "non-whitelisted direct", near: mainNear, recipient: "attacker.near", amount: "0.5", expected: "RecipientNotWhitelisted" },
    { name: "over-max direct", near: mainNear, recipient: "emoi01.testnet", amount: "1.5", expected: "ExceedsMaxPerTx" },
    { name: "zero-amount direct", near: mainNear, recipient: "emoi01.testnet", amount: "0", expected: "InvalidAmount" },
    { name: "revoked FCK-only direct", near: fckonlyNear, recipient: "emoi01.testnet", amount: "0.5", expected: "AgentRevoked" },
  ];
  for (const c of transferCases) {
    const r = await directTransfer(c.near, c.recipient, nearToYocto(c.amount).toString());
    const liveOk = !r.ok && r.error.includes(`PolicyViolation: ${c.expected}`);
    const inContract = libRs.includes(`PolicyViolation: ${c.expected}`);
    const inReadme = readme.includes(`PolicyViolation: ${c.expected}`);
    const pass = liveOk && inContract && inReadme;
    results.push({
      name: c.name,
      verdict: pass ? "PASS" : "FAIL",
      detail: pass
        ? `live=${c.expected}, in contract, in README`
        : `liveOk=${liveOk} (error: ${r.error.slice(0, 160)}), inContract=${inContract}, inReadme=${inReadme}`,
    });
  }

  // Agent cannot set its own policy: FCK call must fail AND policy unchanged.
  const policyBefore = JSON.stringify(mainBefore.policy);
  let setPolicyFailed = false;
  let setPolicyError = "";
  try {
    await mainNear.call(
      POLICY,
      "set_policy",
      { agent_account_id: MAIN, max_per_tx: nearToYocto("1").toString(), daily_limit: nearToYocto("2").toString(), whitelist: ["emoi01.testnet"] },
      { gas: "100 Tgas", attachedDeposit: 0n },
    );
  } catch (e) {
    setPolicyFailed = true;
    setPolicyError = String(e).slice(0, 160);
  }
  const mainAfterSet = await viewPolicy(MAIN);
  const unchanged = JSON.stringify(mainAfterSet.policy) === policyBefore;
  const cannotDoDoc = readme.includes("What the agent key cannot do") && readme.includes("set_policy");
  results.push({
    name: "agent cannot set own policy",
    verdict: setPolicyFailed && unchanged && cannotDoDoc ? "PASS" : "FAIL",
    detail: `failed=${setPolicyFailed} (${setPolicyError}), policyUnchanged=${unchanged}, documented=${cannotDoDoc}`,
  });

  // Daily-limit case, guarded: only if the audit agent already spent its day.
  const auditBefore = await viewPolicy(AUDIT_AGENT);
  const spent = BigInt((auditBefore.policy?.spent_today as string) ?? "0");
  const daily = BigInt((auditBefore.policy?.daily_limit as string) ?? "0");
  if (auditBefore.policy && daily > 0n && spent >= daily) {
    const auditNear = nearFor(AUDIT_AGENT, await auditFckPrivateKey());
    const r = await directTransfer(auditNear, "emoi01.testnet", nearToYocto("1").toString());
    const liveOk = !r.ok && r.error.includes("PolicyViolation: ExceedsDailyLimit");
    results.push({
      name: "daily-limit direct (guarded)",
      verdict: liveOk ? "PASS" : "FAIL",
      detail: liveOk ? "live=ExceedsDailyLimit" : `error: ${r.error.slice(0, 160)}`,
    });
  } else {
    results.push({
      name: "daily-limit direct (guarded)",
      verdict: "SKIP",
      detail: `audit agent daily not exhausted (spent=${spent}, daily=${daily}); skipped so it cannot become a spend`,
    });
  }

  // Guard: vault and main status must be unchanged (all cases revert).
  const vaultAfter = await viewVault();
  const mainAfter = await viewPolicy(MAIN);
  const guardOk = vaultAfter === vaultBefore && mainAfter.status === mainBefore.status;
  results.push({
    name: "vault + main status unchanged",
    verdict: guardOk ? "PASS" : "FAIL",
    detail: `vault ${vaultBefore} -> ${vaultAfter}, main status ${mainBefore.status} -> ${mainAfter.status}`,
  });

  for (const r of results) console.log(`${r.verdict} — ${r.name} — ${r.detail}`);
  const failed = results.filter((r) => r.verdict === "FAIL").length;
  console.log(`\nConformance: ${results.filter((r) => r.verdict === "PASS").length} PASS, ${results.filter((r) => r.verdict === "SKIP").length} SKIP, ${failed} FAIL`);
  if (failed > 0) process.exit(1);
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
