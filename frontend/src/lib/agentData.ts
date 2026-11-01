import { POLICY_CONTRACT_ID, yoctoToNear } from "./near";

export interface AgentData {
  agentId: string;
  owner: string;
  status: string | null;
  maxPerTxNear: string;
  dailyLimitNear: string;
  spentTodayNear: string;
  whitelist: string[];
  vaultBalanceNear: string;
}

export async function fetchAgentData(
  viewFunction: (params: {
    contractId: string;
    method: string;
    args: Record<string, unknown>;
  }) => Promise<unknown>,
  agentId: string,
): Promise<AgentData> {
  const state = (await viewFunction({
    contractId: POLICY_CONTRACT_ID,
    method: "get_agent_state",
    args: { agent_account_id: agentId },
  })) as { owner: string; status: string } | null;
  const policy = (await viewFunction({
    contractId: POLICY_CONTRACT_ID,
    method: "get_policy",
    args: { agent_account_id: agentId },
  })) as {
    max_per_tx: string;
    daily_limit: string;
    spent_today: string;
    whitelist: string[];
  } | null;
  const owner = state?.owner ?? "emoi.testnet";
  const balance = (await viewFunction({
    contractId: POLICY_CONTRACT_ID,
    method: "get_balance",
    args: { owner },
  })) as string;
  return {
    agentId,
    owner,
    status: state?.status ?? null,
    maxPerTxNear: policy ? yoctoToNear(policy.max_per_tx) : "0",
    dailyLimitNear: policy ? yoctoToNear(policy.daily_limit) : "0",
    spentTodayNear: policy ? yoctoToNear(policy.spent_today) : "0",
    whitelist: policy?.whitelist ?? [],
    vaultBalanceNear: yoctoToNear(balance),
  };
}

export function txHashOf(outcome: unknown): string | undefined {
  const o = outcome as { transaction?: { hash?: string }; transaction_hash?: string };
  return o?.transaction?.hash ?? o?.transaction_hash;
}
