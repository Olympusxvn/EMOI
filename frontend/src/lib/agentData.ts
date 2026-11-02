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

export type ViewFunction = (params: {
  contractId: string;
  method: string;
  args: Record<string, unknown>;
}) => Promise<unknown>;

// Poll contract views until the agent status matches `expected`.
// RPC views can lag one transaction behind contract execution (observed
// 2026-11-02: a view right after pause still showed Active), so a single
// view after Pause/Revoke must not be trusted. The contract is
// authoritative; this only waits until a view catches up with it.
export async function pollAgentStatus(
  viewFunction: ViewFunction,
  agentId: string,
  expected: string,
  opts?: { timeoutMs?: number; intervalMs?: number },
): Promise<boolean> {
  const timeoutMs = opts?.timeoutMs ?? 30000;
  const intervalMs = opts?.intervalMs ?? 2000;
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      const fresh = await fetchAgentData(viewFunction, agentId);
      if (fresh.status === expected) return true;
    } catch {
      // Transient view/RPC failure: keep polling until the deadline.
    }
    if (Date.now() >= deadline) return false;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

export async function fetchAgentData(
  viewFunction: ViewFunction,
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
