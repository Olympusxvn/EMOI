# EMOI

Safe Agent on NEAR Protocol.

EMOI allows a user to create an AI agent that has its own wallet and can spend NEAR, while enforcing hard on-chain limits and restrictions controlled by the user.

## Problem

Giving an AI agent the ability to spend crypto is useful but risky.  
Current solutions are usually either:

- Fully manual (human must sign every transaction), or
- Fully autonomous (AI has unrestricted access to keys).

EMOI provides a middle ground: the agent can spend, but only within clear on-chain rules defined by the owner.

## What EMOI does

- User creates an Agent
- User funds the Agent with NEAR
- User sets policies:
  - Daily spending limit
  - Maximum amount per transaction
  - Whitelist of allowed addresses
- The Agent can send NEAR autonomously **only if** the action respects the policies
- If the Agent tries to exceed limits or send to a non-whitelisted address, the transaction is rejected on-chain
- User can pause or revoke the Agent at any time

## Tracks

- `agents` (Agent Economy)
- `security` (AI Security & Defense)

## How to try it (Judge instructions)

Follow these steps:

1. Open the application and connect a NEAR wallet.
   - Expected result: Wallet is connected and the dashboard is visible.

2. Click “Create Agent”.
   - Expected result: A new Agent is created and appears in the dashboard.

3. Open the Agent and set a policy:
   - Set a low daily limit (for example 1 NEAR)
   - Set max per transaction (for example 0.5 NEAR)
   - Add at least one whitelisted address
   - Save the policy
   - Expected result: Policy is saved and visible on the Agent detail page.

4. Fund the Agent with a small amount of NEAR.
   - Expected result: Agent balance increases.

5. Trigger an allowed action (send an amount within the limits to a whitelisted address).
   - Expected result: Transaction succeeds and appears in activity history as “Success”.

6. Trigger a forbidden action (send more than the limit, or send to a non-whitelisted address).
   - Expected result: Transaction is rejected. Activity history shows “Rejected” with a clear reason.

7. Click “Revoke” on the Agent.
   - Expected result: Agent can no longer perform actions.

## Key Technical Points

- Uses NEAR Function Call Keys / Limited Access Keys to restrict the Agent’s power
- Spending limits and whitelist are enforced on-chain
- The Agent never receives full access to the user’s main account
- Owner can always revoke permissions

## Tech Stack

- NEAR Protocol
- React + TypeScript
- Tailwind CSS
- NEAR Wallet Selector
- NEAR smart contracts (for policy enforcement)

## Project Structure

```text
emoi/
├── frontend/
├── contracts/
├── docs/
├── PROJECT.md
├── PRD.md
├── SPEC.md
├── RULE.md
└── README.md
```

## How to run locallybash

```
git clone <repository-url>
cd emoi
npm install
npm run dev
```

## Additional contract deployment instructions are available in the /contracts folder.
LicenseMIT

