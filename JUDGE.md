# EMOI -- Judge Guide (human, 5 minutes)

Safe Agent on NEAR testnet: an AI spending agent holds only a single-method
Function Call Key while the PolicyVault contract enforces every limit
on-chain. Tracks: Agent Economy, AI Security & Defense.

Live contract: `policy.emoi.testnet` (deployed code = commit `39e971e`,
wasm SHA-256 `3d66c2ad029a78e9ed390d3d549021500e23daa40f967eae9c95e0f2c7aed5e8`).
Main demo agent: `judgetest01.emoi.testnet`.
Frozen numbers: vault 5 NEAR * max 1 NEAR/tx * daily 2 NEAR *
whitelist `emoi01.testnet`, `emoi02.testnet`.

## 60-second check (no setup, just click)

1. A real payment, post-redeploy contract:
   https://explorer.testnet.near.org/transactions/7QVSEX2jgLbHXJvA9ertXWJfC7vgPNZ5dc6QsHrd7Dt1
2. A blocked attack leaves no transaction: the demo rejects `send 100 NEAR
   to attacker.near` with `RecipientNotWhitelisted` before signing, so there
   is deliberately no hash to show. Any claim of a hash for a rejected
   intent would be fake; we show none.
3. Owner control is instant and terminal (pause / resume / revoke receipts):
   https://explorer.testnet.near.org/transactions/2oK7C15iTF84fXM19BgiVVzgw4gLRDJpSDgFoG1w9Pj4
   https://explorer.testnet.near.org/transactions/6pMxWY6NYy5iZxGY71e1WGZFYWhdLmZwkxSWKWSm8f1B
   https://explorer.testnet.near.org/transactions/GE8zRKJ5iaujdYZiianPdg99q4KpKpkZyMG2zWCJovB1

## 5-minute run (your own vault)

```bash
git clone https://github.com/Olympusxvn/EMOI && cd EMOI
./scripts/setup.sh        # deps + .env from .env.example
make check                # Tier-1 offline gate (must be green)
```

Then either branch (README "Run it yourself" has the full steps):
- Script: `cd agent && npm run create-agent -- --name <you> --set-policy`
  creates `<you>.<your-account>` under YOUR namespace, funded by you.
- Wallet: frontend Create Agent page + Intear Wallet (testnet), then the
  printed script command finishes FCK + registration.

## Security claims and where each is proven

| Claim | Proof |
|---|---|
| Limits enforced on-chain, not in UI | Contract `agent_transfer` check order; direct over-max call reverts `ExceedsMaxPerTx` (conformance suite, Tier-2) |
| Agent key cannot change policy | FCK scoped to `agent_transfer` only; `set_policy` attempt fails at the access key (conformance: policy unchanged) |
| Registration bound to caller | Unowned-ID register reverts `AgentNotOwnedSubaccount`, no state written (verified live post-redeploy) |
| Storage caller-paid, measured, refunded | Register tx attached 0.05, `EXPERIMENTAL_tx_status` shows 0.04914 Transfer back (86 bytes kept): https://explorer.testnet.near.org/transactions/HpjiRSjJ1BEzX6EkaZnbPVa5FJLnSed6M9P4RzjwNWsH |
| Full lifecycle events (NEP-297) | `agent_registered`, `policy_updated`, `agent_paused`, `agent_resumed`, `agent_revoked`, `transfer_succeeded` -- all observed in tx logs above |
| Wallet path cannot brick accounts | Wallet creation includes full-access AddKey in the same tx: https://explorer.testnet.near.org/transactions/4QwcVoK46ArRCCPAx5n5o6gduJDpzgYnR8p8h2ffQuvH |
| LLM path signs only policy-legal transfers | Live LLM transfer 0.5 NEAR to emoi01: https://explorer.testnet.near.org/transactions/4KjeY9Nop8CSQX5qyhLTeYXgMy62y9CrUr4AtxWdBksv |
| Method audit applied | Cloudflare audit-skill run-1: 5 confirmed, both HIGH contract findings fixed by redeploy, rest dispositioned in README |
| AI pentest applied (Strix, local) | quick white-box: 3 vulns + 2 reviews, all fixed same-day, 57 checks ruled out (SECURITY.md) |

## Is this really Security & Defense?

Judge it by worst cases, not happy paths. "Keep the money" first:

| If ... | Then at most ... |
|---|---|
| The agent key leaks | One daily limit (2 NEAR) to whitelisted vendors only. The key cannot change policy, touch the vault, or call anything but `agent_transfer`. |
| The LLM gets prompt-injected | Only policy-legal transfers can sign. Everything else reverts on-chain with a named reason. |
| Transfers come as rapid small loops | Bounded by daily limit + whitelist (no per-tx cooldown yet -- a P1 item below, but the daily total is still capped). |
| The owner intervenes | Pause halts spending instantly; revoke is terminal. Both proven in the receipts above. |
| The owner key leaks | Full loss. The single known residual risk; P1 milestone. |
| The contract has a bug | Mitigated by 31 unit tests, green CI, two live re-audits -- but no formal verification. Stated here, not hidden. |

The industry's recurring failure mode is policy enforced by prompt,
middleware, or app code -- bypassable by construction. EMOI's policy is
enforced by the chain: the contract itself refuses illegal transfers.

## AI-security vocabulary -> EMOI

If you score the Security track by its vocabulary, here is where each term lives:

| Term | EMOI mechanism | Proof |
|---|---|---|
| Prompt injection | Attack demo: injected intents blocked pre-signing with named reasons | `npm run demo:attack` (tx-less rejects) |
| AI guardrails | Pre-signing re-validation plus on-chain policy (whitelist, max, daily, status) | `validateBeforeSigning`; rejects before any signature |
| Jailbreak / rule bypass | Parser accepts one exact shape; model output re-parsed and grounded, never trusted | `parser.ts`, `resolveLlmIntent` harness |
| Protecting the AI system | Spending authority protected, not model weights: single-method FCK, pause, terminal revoke | FCK scope, `demo:pause`, revoke tests |
| Never trust LLM output | Every money-touching action passes policy; HTTP routes cannot reach the LLM at all | `useLlm: false` on routes, grounding checks |

One line: EMOI applies AI guardrails to economic agents -- even if the LLM is prompt-injected, spending is still blocked by on-chain policy before any transaction is signed.

## Roadmap (funded separately, self-earning later)

- P0 (pre-submit): key ceremony 13-14/11, flip public. No new features.
- P1 (mainnet-ready, grants/prizes): owner multisig or timelock withdraw;
  per-vendor caps + cooldown against loops; periodic pentest; small bug bounty.
- P2 (earn): policy-as-a-service for teams running agents (fee on protected
  vaults); industry policy templates; cross-chain spending under the same
  policy via NEAR Intents. No token sale -- sell safety.

## The AI wallet landscape we build for

- Agent wallets are converging on scoped keys: spending caps, allowlists,
  expiry. The question is where the scope is enforced -- server config that
  can drift, or rules the chain refuses to break. EMOI bets the latter.
- NEAR gives this bet a native primitive: Function Call Keys scope an agent
  to one method on one contract with a capped allowance, no
  account-abstraction scaffolding required.
- Vision: any AI agent gets a wallet whose limits are law, not suggestions --
  portable across vendors and chains, legible to auditors, always revocable
  by a human.

## Honest notes (read before scoring security)

- Until 13-14/11 the demo agent account still carries its original full-access
  key alongside the FCK (creation artifact). The key ceremony deletes it and
  re-runs the valid demo; after that the account is FCK-only.
- Testnet demo, single owner key (no multisig yet). Owner-key compromise is
  the known residual risk and the first post-hackathon milestone.
- We claim no formal verification, no TEE, no cross-chain, no approval queue.
  The video numbers (5 / 1 / 2 / emoi01+02) match the frozen on-chain state.
