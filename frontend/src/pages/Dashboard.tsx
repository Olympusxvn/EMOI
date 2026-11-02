import { useEffect, useState } from "react";
import { useNearWallet } from "near-connect-hooks";
import { KNOWN_AGENTS, agentName, vendorLabel, vendorRole } from "../lib/near";
import { fetchAgentData, type AgentData } from "../lib/agentData";
import { fetchActivity, type ActivityEntry } from "../lib/api";
import { AgentIdDisplay, SpentProgress, StatusBadge } from "../components/common";

export default function Dashboard({
  onOpenAgent,
  onCreate,
}: {
  onOpenAgent: (agentId: string) => void;
  onCreate: () => void;
}) {
  const { viewFunction } = useNearWallet();
  const [agents, setAgents] = useState<AgentData[]>([]);
  const [activity, setActivity] = useState<ActivityEntry[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const rows: AgentData[] = [];
        for (const id of KNOWN_AGENTS) {
          // eslint-disable-next-line no-await-in-loop
          rows.push(await fetchAgentData(viewFunction, id));
        }
        setAgents(rows);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
      try {
        setActivity(await fetchActivity());
      } catch {
        // Agent service is optional for the dashboard; contract views
        // above are the primary source.
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", flexWrap: "wrap", gap: 12 }}>
        <div>
          <h1 style={{ margin: "0 0 6px", fontSize: 32 }}>Dashboard</h1>
          <p style={{ color: "#D4D4D4", margin: 0, maxWidth: 640 }}>
            Give AI a wallet, without giving it the keys to everything. Each agent can spend
            only within the owner&apos;s on-chain policy.
          </p>
        </div>
        <button className="btn-primary" onClick={onCreate}>
          Create Agent
        </button>
      </div>

      {error && <p style={{ color: "#EF4444" }}>Could not load contract views: {error}</p>}
      <p style={{ color: "#A3A3A3", fontSize: 13 }}>
        Vault balance is per owner, so agents of the same owner share one vault. The list
        below is the known local agents; the contract does not enumerate agents on-chain.
      </p>

      {agents.map((a) => (
        <div key={a.agentId} className="card" onClick={() => onOpenAgent(a.agentId)} style={{ cursor: "pointer" }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
            <h2 style={{ margin: 0, fontSize: 20 }}>{agentName(a.agentId)}</h2>
            <StatusBadge status={a.status} />
          </div>
          <div style={{ marginTop: 10 }}>
            <AgentIdDisplay agentId={a.agentId} />
          </div>
          <div style={{ marginTop: 12, color: "#D4D4D4", fontSize: 14 }}>
            Policy: max {a.maxPerTxNear} / daily {a.dailyLimitNear} NEAR · Whitelist:{" "}
            {a.whitelist.length
              ? a.whitelist
                  .map((w) => {
                    const role = vendorLabel(w);
                    return role ? `${w} (${role})` : w;
                  })
                  .join(", ")
              : "none"}{" "}
            · Vault: {a.vaultBalanceNear} NEAR
          </div>
          <div style={{ marginTop: 12 }}>
            <SpentProgress spentNear={a.spentTodayNear} dailyNear={a.dailyLimitNear} />
          </div>
        </div>
      ))}

      <h2 style={{ fontSize: 20, marginTop: 28 }}>Recent activity</h2>
      {activity.slice(0, 5).map((e, i) => (
        <div key={i} style={{ fontSize: 14, color: "#D4D4D4", padding: "6px 0", borderBottom: "1px solid #262626" }}>
          <span style={{ color: e.status === "rejected" ? "#EF4444" : "#00EC97", fontWeight: 600 }}>
            {e.status === "rejected" ? `Rejected (${e.reason ?? ""})` : "Success"}
          </span>{" "}
          — {e.agent} — {vendorRole(e.recipient)} ({e.recipient}) — {e.amountNear} NEAR
          {e.txHash ? ` — tx ${e.txHash.slice(0, 12)}…` : " — no tx hash"}
        </div>
      ))}
      {!activity.length && (
        <p style={{ color: "#A3A3A3", fontSize: 14 }}>
          No local activity yet. Start the agent service to see activity here, or run a demo script.
        </p>
      )}
    </div>
  );
}
