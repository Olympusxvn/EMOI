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
- R-2 Main agent full-access key interim until the 13-14/11 key ceremony
  (planned deletion, then `demo:valid` re-run as FCK-only proof).
- R-3 No formal verification; no per-run HTTP token; no per-transaction
  cooldown (all P1).

## Verification log 2026-11-08

- `npm test`: 10 files green, including new `httpGuards` checks and the 3
  new regression checks (each observed failing before its fix).
- Live server probes (port 3999, zero spend): loopback-only bind (LAN
  refused), CORS allowlist (localhost echoed, evil absent), agent
  mismatch 400, attack intent rejected pre-signing.
- Vault untouched by audit tooling: 4.5 NEAR before and after (Strix
  dynamic probes triggered no spend; conformance and attack demos revert
  by construction).
- Method hygiene: the Strix sandbox runs with a writable live mount. Mid-run,
  agents rewrote `node_modules` platform bins (restored via `npm ci`), touched
  `frontend/package-lock.json` (reverted), and reverted in-progress source
  fixes plus two new files; the tree was restored from git, every fix
  re-applied and re-verified (`npm test` green, live probes repeated).
  Rule learned: future agent scans target a COPY of the repo, never the
  live tree. No secrets in any report.