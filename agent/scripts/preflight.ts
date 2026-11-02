// preflight.ts — flip/submission readiness checklist for EMOI.
//
// Run before the public flip (morning 14/11 Bangkok) and again after the
// final snapshot push. It NEVER spends, signs, or changes on-chain state:
// all chain checks are views. Exit code 0 = no FAIL (WARNs allowed);
// exit code 1 = at least one FAIL.
//
// Severity rules (deliberate, do not silently weaken):
// - Secrets, builds/tests, frozen demo policy, LICENSE, .gitignore, and
//   forbidden README wording are FAIL: the flip must not happen with them.
// - A full-access key still on the main account is WARN, not FAIL: deleting
//   it is the final step AFTER this check (video + all demo txs done),
//   so preflight must report it, not block on it.
// - Unpushed local changes and a vault balance != 2.0 NEAR are WARN:
//   they are expected during development and must be resolved by the
//   snapshot push / vault top-up, not by preflight itself.
//
// Usage: npx tsx scripts/preflight.ts

import { config } from "../src/config.js";
import { createViewNear } from "../src/nearClient.js";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");
type Verdict = "PASS" | "WARN" | "FAIL" | "SKIP";
type Check = { name: string; verdict: Verdict; detail: string };
const checks: Check[] = [];
function add(name: string, verdict: Verdict, detail: string) {
  checks.push({ name, verdict, detail });
  console.log(`${verdict} — ${name} — ${detail}`);
}

function walk(dir: string, out: string[] = []): string[] {
  const skip = new Set([".git", "node_modules", "target", "dist", ".next"]);
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (skip.has(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.isFile()) out.push(p);
  }
  return out;
}

function runCmd(cmd: string, args: string[], cwd: string): { ok: boolean; out: string } {
  try {
    // cargo lives in ~/.cargo/bin, which is not always on PATH for spawned
    // processes; without it "cargo test" fails with an empty error, which
    // preflight must not report as a test failure.
    const env = { ...process.env, PATH: `${path.join(os.homedir(), ".cargo", "bin")}:${process.env.PATH ?? ""}` };
    const r = spawnSync(cmd, args, { cwd, encoding: "utf-8", timeout: 600000, maxBuffer: 10 * 1024 * 1024, env });
    const err = (r as { error?: Error }).error;
    return { ok: r.status === 0, out: err ? String(err).slice(0, 800) : `${r.stdout ?? ""}\n${r.stderr ?? ""}`.slice(-800) };
  } catch (e) {
    return { ok: false, out: String(e).slice(0, 800) };
  }
}

async function main() {
  // 1. Secrets scan: no private-key material in files that could be pushed.
  // Public keys (ed25519:...) are on-chain public data and are NOT flagged;
  // only private-key assignments and tracked .env files are.
  const secretPatterns = [
    /"private_key"\s*:\s*"ed25519:/,
    /PRIVATE_KEY\s*=\s*ed25519:[A-Za-z0-9]{10,}/,
    /NEAR_AI_CLOUD_API_KEY\s*=\s*\S+/,
    /master_seed_phrase|seed_phrase_hd_path/,
  ];
  const secretHits: string[] = [];
  for (const f of walk(repoRoot)) {
    const rel = path.relative(repoRoot, f);
    if (rel === ".env" || rel.endsWith(".env")) continue; // .env itself is gitignored, never scanned as a leak
    if (rel === "agent/scripts/preflight.ts") continue; // this scanner's own pattern strings are not secrets
    if (rel.startsWith("video-edit/") && rel.endsWith(".mp4")) continue;
    if (rel.endsWith(".png")) continue;
    let text = "";
    try {
      text = fs.readFileSync(f, "utf-8");
    } catch {
      continue;
    }
    for (const re of secretPatterns) {
      if (re.test(text)) secretHits.push(`${rel} matches ${re}`);
    }
  }
  add("secrets scan", secretHits.length ? "FAIL" : "PASS", secretHits.length ? secretHits.slice(0, 5).join("; ") : "no private-key material in pushable files");

  // Tracked .env files must not exist (only .env.example may be tracked).
  try {
    const tracked = execFileSync("git", ["ls-files"], { cwd: repoRoot, encoding: "utf-8" });
    const bad = tracked.split("\n").filter((l) => l === ".env" || (l.endsWith(".env") && !l.endsWith(".env.example")));
    add("no tracked .env", bad.length ? "FAIL" : "PASS", bad.length ? `tracked: ${bad.join(", ")}` : "only .env.example tracked (or none)");
    const status = execFileSync("git", ["status", "--porcelain"], { cwd: repoRoot, encoding: "utf-8" }).trim();
    add(
      "unpushed local changes",
      status ? "WARN" : "PASS",
      status ? `push before flip:\n${status}` : "working tree clean",
    );
  } catch {
    add("git checks", "SKIP", "git not available in this environment");
  }

  // .gitignore must cover the secret and build artifacts.
  const gi = fs.existsSync(path.join(repoRoot, ".gitignore")) ? fs.readFileSync(path.join(repoRoot, ".gitignore"), "utf-8") : "";
  const missing = [".env", "node_modules", "target", "dist"].filter((s) => !gi.includes(s));
  add(".gitignore coverage", missing.length ? "FAIL" : "PASS", missing.length ? `missing: ${missing.join(", ")}` : ".env, node_modules, target, dist covered");

  // LICENSE (MIT, decided 2026-11-01) must exist before the flip.
  const lic = path.join(repoRoot, "LICENSE");
  add("LICENSE file", fs.existsSync(lic) && fs.readFileSync(lic, "utf-8").includes("MIT License") ? "PASS" : "FAIL", fs.existsSync(lic) ? "MIT LICENSE present" : "missing — add MIT LICENSE before flip");

  // 2. Builds and tests.
  const contractTest = runCmd("cargo", ["test", "--lib"], path.join(repoRoot, "contract"));
  add("contract tests", contractTest.ok ? "PASS" : "FAIL", contractTest.ok ? "cargo test --lib green" : contractTest.out);
  const agentTest = runCmd("npm", ["test"], path.join(repoRoot, "agent"));
  add("agent tests", agentTest.ok ? "PASS" : "FAIL", agentTest.ok ? "npm test green" : agentTest.out);
  const frontendBuild = runCmd("npm", ["run", "build"], path.join(repoRoot, "frontend"));
  add("frontend build", frontendBuild.ok ? "PASS" : "FAIL", frontendBuild.ok ? "tsc + vite build green" : frontendBuild.out);

  // 3. On-chain state (views only).
  try {
    const near = createViewNear();
    const state = (await near.view(config.policyContractId, "get_agent_state", { agent_account_id: config.agentAccountId })) as {
      status: string;
    } | null;
    const policy = (await near.view(config.policyContractId, "get_policy", { agent_account_id: config.agentAccountId })) as {
      max_per_tx: string;
      daily_limit: string;
      whitelist: string[];
      spent_today: string;
    } | null;
    const bal = (await near.view(config.policyContractId, "get_balance", { owner: config.ownerAccountId })) as string;
    add("main agent status", state?.status === "Active" ? "PASS" : "WARN", `status=${state?.status ?? "null"} (expected Active for demo)`);
    const frozen =
      policy &&
      policy.max_per_tx === "1000000000000000000000000" &&
      policy.daily_limit === "2000000000000000000000000" &&
      policy.whitelist.includes("emoi01.testnet") &&
      policy.whitelist.includes("emoi02.testnet");
    add("frozen demo policy", frozen ? "PASS" : "FAIL", policy ? `max=${policy.max_per_tx}, daily=${policy.daily_limit}, whitelist=${policy.whitelist.join(",")}` : "no policy");
    add("vault balance", bal === "2000000000000000000000000" ? "PASS" : "WARN", `vault=${bal} yocto (audited state is 2 NEAR; top up if different)`);
  } catch (e) {
    add("on-chain state", "FAIL", `view failed: ${String(e).slice(0, 200)}`);
  }

  // Main account keys: full key present is WARN (final deletion step), not FAIL.
  try {
    const keysOut = execFileSync(
      "near",
      ["account", "list-keys", config.agentAccountId, "network-config", "testnet", "now"],
      { encoding: "utf-8", env: { ...process.env, PATH: `${process.env.PATH}:${path.join(os.homedir(), ".cargo", "bin")}` } },
    );
    const hasFull = /full access/i.test(keysOut);
    const hasFck = keysOut.includes("agent_transfer");
    add(
      "main account keys",
      hasFck ? (hasFull ? "WARN" : "PASS") : "FAIL",
      hasFull ? "full-access key still present — delete as FINAL step after video + demos" : hasFck ? "FCK only" : "no FCK found",
    );
  } catch {
    add("main account keys", "SKIP", "near-cli list-keys failed; check manually");
  }

  // 4. README claim checks.
  const readme = fs.readFileSync(path.join(repoRoot, "README.md"), "utf-8");
  // "Payroll" is forbidden as a CLAIM, not as a negation: the README says
  // "not payroll" in its deliberately-not-claimed sections, and sentences
  // wrap across lines, so check per PARAGRAPH: a paragraph mentioning
  // payroll is a claim only if the whole paragraph contains no negation.
  const payrollClaims = readme
    .split(/\n\s*\n/)
    .filter((para) => /payroll/i.test(para) && !/\b(not|no|never)\b/i.test(para));
  add("README no payroll claim", payrollClaims.length ? "FAIL" : "PASS", payrollClaims.length ? payrollClaims.slice(0, 3).join(" | ") : "only negated mentions (not payroll)");
  add(
    "README interim FCK honesty",
    readme.includes("Main agent full-access key (interim)") ? "PASS" : "FAIL",
    readme.includes("Main agent full-access key (interim)") ? "interim note present" : "interim note missing — honesty claim at risk",
  );
  add(
    "README tracks",
    readme.includes("Agent Economy") && readme.includes("AI Security & Defense") ? "PASS" : "FAIL",
    "agents + security matrix present",
  );
  const srtFiles = walk(path.join(repoRoot, "video-edit")).filter((f) => f.endsWith(".srt"));
  const srtPayroll = srtFiles.filter((f) => /payroll/i.test(fs.readFileSync(f, "utf-8")));
  add("video subtitles no payroll", srtPayroll.length ? "FAIL" : "PASS", srtPayroll.length ? srtPayroll.join(", ") : "clean");

  const failed = checks.filter((c) => c.verdict === "FAIL").length;
  const warned = checks.filter((c) => c.verdict === "WARN").length;
  console.log(`\nPreflight: ${checks.filter((c) => c.verdict === "PASS").length} PASS, ${warned} WARN, ${failed} FAIL`);
  if (failed > 0) process.exit(1);
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
