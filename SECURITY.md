# EMOI Security Findings & Fixes

Detailed vulnerability register for the `agents` + `security` submission.
Every item below was verified against the code or live testnet; nothing is
claimed from reasoning alone. Raw tool bundles stay out of the repo
(Cloudflare skill `run-1/`, `strix_runs/`); this file is the citable record.

Core protection principles (frozen, 2-track scope):

1. The chain is authoritative. Local validation is a pre-check; every spend
   is re-checked on-chain in `agent_transfer`, so a local miss degrades to
   a failed transaction, never to an over-limit spend.
2. Fail closed. Ambiguous input, missing keys, and unreachable models reject
   (`ParseFailed` / named `PolicyViolation`); nothing signs on uncertainty.
3. No silent normalization. Displayed values must equal signed values.
4. The signer and the validated agent are the same identity.
5. Local-demo containment. The agent service and scripts are local tools,
   never hosted: loopback bind, localhost-only browser origins.
6. No scope expansion for fixes. Anything needing a contract change,
   redeploy, or new trust assumption is a P1 roadmap item, not a
   pre-submit patch.

## Sources

- Cloudflare `security-audit` skill, full-audit mode, quick profile
  (4 recon, 4 hunters, 13 verifiers), source `main@66aa2e1`, no code
  executed. Tally: 5 confirmed (3 high, 1 medium, 1 low),
  1 needs-validation, 9 rejected. See README "Method audit".
- Strix 1.7.0, local-only white-box `quick` scan of this repo at `2525ce6`
  (Docker sandbox, NEAR AI Cloud model, $5 budget cap, no cloud upload).
  Tally: 3 vulnerability findings + 2 needs-review, all fixed below;
  Triaged at 62 interim results, then the scan was stopped deliberately (see
  Method hygiene); no vulnerability-class item appeared after the first 20.
  Live side effect, disclosed: dynamic agents signed directly with the
  demo agent FCK and spent 1.5 NEAR to whitelisted vendors before the daily
  cap stopped them at exactly 2.0/2.0 (see S-10).
  57 coverage checks ruled out with evidence (register below).
- Live re-verification 2026-11-08: conformance 5 PASS / 2 SKIP / 0 FAIL,
  `demo:valid --llm` success tx `4KjeY9Nop8CSQX5qyhLTeYXgMy62y9CrUr4AtxWdBksv`,
  `demo:attack` blocked-as-expected, preflight 21 PASS / 1 WARN /
  1 environment-only FAIL. See README.

## Fixed findings

### S-01 Sub-yocto truncation in nearToYocto (Medium)

`agent/src/validation.ts` padded fractional digits and sliced them to 24,
silently rounding amounts with more than 24 decimals DOWN. The displayed
`amountNear` could differ from the signed `amountYocto`, and an over-limit
amount could pass local validation (the contract would still reject it
on-chain with `ExceedsMaxPerTx`, so the impact was failed transactions
and display/sign mismatch, never an over-limit spend).
Fix: reject more than 24 decimals with `ParseFailed` (fail closed). All
consumers already treat the throw as a reject (parser, research offers,
LLM grounding pre-check). Verified by `yocto_rejects_sub_yocto_precision`
(failed before the fix) and `yocto_accepts_exact_24_decimals`.

### S-02 Implicit second recipient invisible to the LLM pre-check (Medium)

`resolveLlmIntent` (`agent/src/service.ts`) rejects multi-recipient text
before calling the model, but only recognized `*.testnet` / `*.near`
names. A second recipient as a 64-hex implicit account was invisible, so
the model could narrow a two-recipient request to one. Bounds: the LLM
path runs only in operator scripts (`demo-valid --llm`; both HTTP routes
hardcode `useLlm: false`), the grounding check still requires verbatim
presence, and the whitelist still applies on-chain. Fix: the pre-check
now also counts 64-hex implicit accounts as recipients. Verified by
`1a-implicit-second-recipient-rejected-before-llm` (failed before the fix).

### S-03/S-04 Unauthenticated cross-origin POST /transfer + agent/views mismatch (Medium)

The agent service exposed `POST /transfer` with `Access-Control-Allow-Origin:
*`, bound on all interfaces, and accepted an `agent` body field used for
views while always signing with the configured agent FCK. Bounds: local-demo
tool never hosted; every intent still passed pre-signing re-validation and
on-chain policy (no cash-out outside the whitelist). Fix
(`agent/src/server.ts`, `agent/src/httpGuards.ts`): bind `127.0.0.1` only,
echo `Origin` only for `localhost` / `127.0.0.1` (any port), and return 400
when the requested agent differs from the signing agent. Verified by 5
`httpGuards` unit checks plus live zero-spend probes: localhost origin
echoed, evil origin absent, LAN connection refused, agent mismatch 400,
attack intent rejected pre-signing.

### S-05 Filesystem path disclosure in error responses (Low)

`/research/respond` returned the absolute local keychain path when the key
file was missing (OS user + home layout). Fix: all HTTP 500 handlers pass
messages through `sanitizeErrorForHttp`, which masks the home dir as `~`.
Verified by `error_sanitizer_masks_home_dir`.

### S-06 Predictable /tmp owner-key staging (High)

Owner key staged at PID-predictable `os.tmpdir()` paths allowed symlink
capture on shared-tmpdir systems. Already fixed before 2026-11-08 and
re-verified in current source: `create-agent.ts` and `pause-demo.ts` stage
via `fs.mkdtempSync` (0700 dir) plus `O_EXCL` file creation, 0600, with an
explanatory comment at each site.

### S-07 Static whitelist under a live banner (Low)

`proof-page/index.html` rendered policy/spent/vault live from `get_policy`
but left the whitelist line hardcoded under a LIVE FROM TESTNET banner.
Fix: the whitelist line now renders `policy.whitelist` from the same live
view (offline fallback label unchanged). Inline script syntax-checked.

### S-08/S-09 Permissionless registration + storage drain (High, contract)

Permissionless `register_agent` allowed agent-ID squatting; unauthenticated
storage-consuming writes drained vault storage. Fixed by redeploy before
2026-11-08: registration bound to the caller namespace, state writes
caller-paid at measured cost with excess refunded. Live proofs in JUDGE.md
(registration binding, 0.04914 NEAR storage refund tx).

### S-10 AI pentester spent real vault funds within policy (Observed behavior)

During the Strix run, dynamic agents bypassed the agent service, loaded the
demo agent (`judgetest01.emoi.testnet`) FCK from the local keychain, and
signed `agent_transfer` calls directly: 1.5 NEAR total to whitelisted
vendors (no `activity.log` rows, by construction). The on-chain policy held:
spending stopped at exactly `spent_today` 2.0/2.0 daily limit; nothing left
the whitelist; the vault was restored to 5.0 afterward (top-ups
`23aUq9UW4G4oWLAoYS3Ut1aBtZxjNih6KJgCzv5UfCiA`,
`EcHES6rgKpMvxYjuTsdtLr1SXJeeJnjpA3nBUwq7mzWf`).
This is both a method lesson (quarantine live keys from agent sandboxes -
see Method hygiene) and the strongest live evidence for principle 1: even
an autonomous attacker with the real key could not escape the policy.

## Accepted limitation

### L-01 No refund path on transfer-promise failure

`agent_transfer` (`contract/src/lib.rs`) updates `spent_today` and the owner
ledger BEFORE a bare `Promise::new(recipient).transfer(amount)` with no
`.then` callback, so a failed receipt would leave the ledger debited and
the quota spent. Reachability: the recipient must first pass the whitelist,
which holds long-lived existing accounts, so a live promise failure is
practically unreachable and has never been observed. No code fix pre-submit
by principle 6 (contract change + redeploy + re-audit days before submit);
documented in README Honest limitations since the start (no atomic-rollback
claim), with a promise-failure refund callback as a P1 item.

## Ruled out with evidence (selection)

Strix coverage agents plus prior audits closed these with measurements or
live probes, not reasoning: single signer call site always behind
`validateBeforeSigning`; LLM grounding rejects hallucinated recipients and
amounts; null LLM returns `ParseFailed` (no silent parser fallback);
parser normalization cannot change the named account; local/contract day
computation diverges only fail-safe across the UTC boundary; daily-limit
arithmetic matches the contract behavior; whitelist comparison is exact on
both sides; wrong-ledger fallback is unreachable (null state rejects
first); all 9 test files green with no skips; LLM unreachable from HTTP
routes; research prices derive exactly; no key material disclosed on any
endpoint (live-tested); research job machine rejects double-accept and
guessed ids (live-tested); no prototype pollution or type confusion on
JSON bodies (live-tested); keychain path traversal blocked by RPC
account-id parsing (live-tested); no XSS sink for attacker-controlled text
in the frontend; no secrets in the client bundle or committed anywhere;
dry-run and attack-demo routes cannot spend; no policy enforcement exists
only in the UI; no shell injection into `near` CLI calls; CI has no
over-broad permissions or secret exposure; contract check order matches
the frozen spec; no daily-limit bypass, re-set defeat, double-count, or
cross-owner bleed.

## Residual risks (not fixed pre-submit)

- R-1 Owner single key: full loss on owner-key compromise (P1: multisig or
  timelock withdraw).
- R-2 Main agent full-access key: CEREMONY DONE 2026-11-11 (ahead of the
  planned 13-14/11 window). Full key deleted with itself
  (`ELTUBB78FhkHYcohgYPMshjYsVFzg1235Pv4XYXeqb3d`); list-keys shows only
  the FCK; post-deletion `demo:valid` green on parser + LLM paths. No
  full key remains on the main account. (R-2 kept listed for the record;
  residual risk on this item is zero.)
- R-3 No formal verification; no per-run HTTP token; no per-transaction
  cooldown (all P1).

## Verification log 2026-11-08

- `npm test`: 10 files green, including the new `httpGuards` suite; every fix verified by a check
  observed failing before it was applied.
- Live server probes (port 3999, zero spend): loopback-only bind (LAN
  refused), CORS allowlist (localhost echoed, evil absent), agent
  mismatch 400, attack intent rejected pre-signing.
- Vault: 5.0 at session start; 4.5 after `demo:valid --llm`; 3.0 after Strix
  dynamic agents spent 1.5 NEAR within policy (capped at daily 2.0/2.0, see
  S-10); restored to 5.0 by owner top-ups (txs above). Conformance and attack
  demos revert by construction and move nothing.
- Method hygiene: the Strix sandbox runs with a writable live mount. Mid-run,
  agents rewrote `node_modules` platform bins (restored via `npm ci`), touched
  `frontend/package-lock.json` (reverted), and reverted in-progress source
  fixes plus two new files; the tree was restored from git, every fix
  re-applied and re-verified (`npm test` green, live probes repeated).
  Rule learned: future agent scans target a COPY of the repo, never the
  live tree. No secrets in any report.

## Verification log 2026-11-11 (key ceremony, done early)

- Reissue: fresh FCK `ed25519:9XbqxrzRXgxVeNvjXh2mxh1LvswjYHsVVhgMKF6tJdn7`
  (`H7Z9n4wpo9Z5c2vBgf9r7tEQzb5vJoojXYybXhEwQkZf`); `.env` backfilled by the
  script, private key never printed.
- Verify before deletion: `demo:valid` parser success 0.5 NEAR
  (`3mrHnkDfs8HqzpfiZHEgdKrAJFJmn7byGivjVmzyhX35`); conformance 5 PASS /
  2 SKIP / 0 FAIL (SKIPs are the two documented missing-throwaway-key
  cases); `demo:attack` blocked pre-signing; preflight 21 PASS / 2 WARN /
  1 env FAIL.
- Delete in order: old FCK first
  (`EhG3eKQDiwKVVh1q4YmugMKKVvtf5rcJgxDWZuVjjmyg`), full-access key LAST
  with itself (`ELTUBB78FhkHYcohgYPMshjYsVFzg1235Pv4XYXeqb3d`).
  List-keys after: exactly one key, the new FCK (`agent_transfer` only).
- FCK-only proof: `demo:valid` parser
  (`BcYyVHTPoVbEq2bEfhhRM9m9zMAtp9GASub8uAodXVwC`) + LLM
  (`7ZWYQ9sZ9Xf7zaGYvrY4ZFT1t19f4yUJysPVjE9pVjTy`), both 0.5 NEAR success
  with zero full-access keys on-chain.
- Vault: 5.0 -> 3.5 across the ceremony demos, restored to 5.0 by owner
  `deposit_funds` 1.5 NEAR (`6WC6NRnbnVjRhrQT4sTfzVEtGA8SkT6wiafhQ82a9kMj`;
  first view still showed 3.5, re-poll showed 5.0 -- the known view-lag
  finding again). Final preflight: 23 PASS, 0 WARN, 1 env-only FAIL.
- Hygiene: dead local key files renamed to `*.REVOKED-2026-11-11` /
  `*.DELETED-2026-11-11` (outside the repo); one-off top-up script
  deleted after use; no key material in git.

## Trust, but verify (self-interrogation, 2-track scope)

Hard questions we asked ourselves, with the verdict and how to re-check.

1. Can the agent sneak funds to a non-whitelisted address? No: the
   contract whitelist gate rejects first, conformance proves the live
   revert, and `demo:attack` reproduces it. Re-check: `npm run
   demo:attack`, `npx tsx scripts/conformance.ts`.
2. What if the LLM is prompt-injected? Its output goes through the same
   deterministic parser, the 1a/1c grounding harness, and the same
   pre-signing re-validation; HTTP routes cannot reach the LLM at all
   (`useLlm: false` hardcoded). Re-check: `test/llm.test.ts`.
3. What does a leaked FCK cost at most? The remaining daily limit, to
   whitelisted vendors only; the key cannot set policy, withdraw, or
   touch the vault. Re-check: `near account list-keys`, `get_policy`.
4. Can the owner cheat the daily limit via `set_policy`? No: it preserves
   `spent_today`/`current_day` by code and by test
   (`set_policy_does_not_reset_spent_today`).
5. Is revoke really terminal? Yes: re-registering the same id reverts
   (`revoked_agent_cannot_be_reregistered`, `attack_after_revoke_reverts`).
6. Does the display match what gets signed? Yes since S-01: more than 24
   decimals is rejected instead of silently truncated.
7. Can a strange website drive the local service? Not remotely:
   loopback-only bind plus localhost-only origins (live-probed). A
   same-machine browser attacker is out of threat model and stated as such.
8. Did the policy ever stop a REAL autonomous attacker? Yes: the Strix
   pentester holding the real FCK, capped at daily 2.0/2.0 (S-10).
