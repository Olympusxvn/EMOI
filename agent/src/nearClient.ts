// near-kit clients (T2.3). View client needs no key; signing client
// uses ONLY the agent FCK, never the owner full key.

import { Near } from "near-kit";
import { config, requireAgentFck } from "./config.js";
import type { AgentState, Policy } from "./validation.js";

export function createViewNear(): Near {
  return new Near({ network: config.network });
}

export function createAgentNear(): Near {
  return new Near({
    network: config.network,
    privateKey: requireAgentFck() as `ed25519:${string}`,
    defaultSignerId: config.agentAccountId,
  });
}

/** Fresh on-chain views, read immediately before signing. Never cached. */
export async function fetchPolicyViews(
  near: Near,
  agentAccountId: string,
): Promise<{
  agentState: AgentState | null;
  policy: Policy | null;
  vaultBalanceYocto: string;
  owner: string;
}> {
  const agentState = (await near.view(
    config.policyContractId,
    "get_agent_state",
    { agent_account_id: agentAccountId },
  )) as AgentState | null;
  const policy = (await near.view(config.policyContractId, "get_policy", {
    agent_account_id: agentAccountId,
  })) as Policy | null;
  const owner = agentState?.owner ?? config.ownerAccountId;
  const vaultBalanceYocto = (await near.view(
    config.policyContractId,
    "get_balance",
    { owner },
  )) as string;
  return { agentState, policy, vaultBalanceYocto, owner };
}

export function extractTxHash(outcome: unknown): string | undefined {
  const o = outcome as {
    transaction?: { hash?: string };
    transaction_hash?: string;
  };
  return o?.transaction?.hash ?? o?.transaction_hash;
}
