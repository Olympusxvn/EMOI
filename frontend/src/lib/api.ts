import { AGENT_SERVICE_URL } from "./near";

export interface ActivityEntry {
  timestamp: string;
  agent: string;
  recipient: string;
  amountNear: string;
  status: "success" | "rejected";
  reason?: string;
  txHash?: string;
  intentLine?: string;
  source: string;
  policyAtTime?: { maxNear: string; dailyNear: string };
}

export async function checkAgentService(): Promise<boolean> {
  try {
    const res = await fetch(`${AGENT_SERVICE_URL}/health`, { signal: AbortSignal.timeout(3000) });
    return res.ok;
  } catch {
    return false;
  }
}

export async function fetchActivity(): Promise<ActivityEntry[]> {
  const res = await fetch(`${AGENT_SERVICE_URL}/activity`, { signal: AbortSignal.timeout(10000) });
  if (!res.ok) throw new Error("agent service /activity failed");
  const data = (await res.json()) as { entries: ActivityEntry[] };
  return data.entries;
}

export async function postTransfer(text: string, agent: string): Promise<unknown> {
  const res = await fetch(`${AGENT_SERVICE_URL}/transfer`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text, agent }),
  });
  if (!res.ok) throw new Error("agent service /transfer failed");
  return res.json();
}

export async function postAttackDemo(): Promise<unknown> {
  const res = await fetch(`${AGENT_SERVICE_URL}/attack-demo`, { method: "POST" });
  if (!res.ok) throw new Error("agent service /attack-demo failed");
  return res.json();
}
