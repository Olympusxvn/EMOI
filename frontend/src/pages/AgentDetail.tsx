import { useEffect, useState } from "react";
import { useNearWallet } from "near-connect-hooks";
import { POLICY_CONTRACT_ID, agentName } from "../lib/near";
import { fetchAgentData, txHashOf, type AgentData } from "../lib/agentData";
import {
  checkAgentService,
  fetchActivity,
  postAttackDemo,
  postTransfer,
  type ActivityEntry,
} from "../lib/api";
import { ActivityRow, AgentIdDisplay, SpentProgress, StatusBadge } from "../components/common";

export default function AgentDetail({
  agentId,
  onSetPolicy,
}: {
  agentId: string;
  onSetPolicy: (agentId: string) => void;
}) {
  const { viewFunction, callFunction, signedAccountId } = useNearWallet();
  const [data, setData] = useState<AgentData | null>(null);
  const [activity, setActivity] = useState<ActivityEntry[]>([]);
  const [serviceOk, setServiceOk] = useState(false);
  const [transferText, setTransferText] = useState("send 0.5 NEAR to emoi01.testnet");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    try {
      setData(await fetchAgentData(viewFunction, agentId));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
    try {
      const all = await fetchActivity();
      setActivity(all.filter((e) => e.agent === agentId));
    } catch {
      // Activity needs the local agent service; contract views still work.
    }
    setServiceOk(await checkAgentService());
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentId]);

  const walletCall = async (method: string, args: Record<string, unknown>) => {
    if (!signedAccountId) {
      setError("Connect a wallet first to sign an owner action.");
      return;
    }
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const outcome = await callFunction({
        contractId: POLICY_CONTRACT_ID,
        method,
        args,
        gas: "100000000000000",
        deposit: "0",
      });
      setMessage(`${method} succeeded. Tx: ${txHashOf(outcome) ?? "unknown"}`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const runTransfer = async () => {
    if (!serviceOk) return;
    setBusy(true);
    setError(null);
    try {
      const result = (await postTransfer(transferText, agentId)) as { status: string; reason?: string };
      setMessage(
        result.status === "success"
          ? "Transfer succeeded through the agent service."
          : `Transfer rejected: ${result.reason ?? "unknown"}. Blocked before signing, no transaction sent.`,
      );
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const runAttackDemo = async () => {
    if (!serviceOk) return;
    setBusy(true);
    setError(null);
    try {
      await postAttackDemo();
      setMessage("Attack demo ran through the real agent-service validation path. Both attacks should appear below as red rejects.");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <h1 style={{ margin: "0 0 4px", fontSize: 28 }}>{agentName(agentId)}</h1>
      <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
        <AgentIdDisplay agentId={agentId} full />
        <StatusBadge status={data?.status ?? null} />
      </div>
      {error && <p style={{ color: "#EF4444" }}>{error}</p>}
      {message && <p style={{ color: "#22C55E" }}>{message}</p>}

      {data && (
        <div className="card">
          <div style={{ color: "#B8C0C8", fontSize: 14 }}>
            Owner: {data.owner} · Vault balance: {data.vaultBalanceNear} NEAR
          </div>
          <div style={{ marginTop: 10, fontSize: 15 }}>
            Policy: max {data.maxPerTxNear} / daily {data.dailyLimitNear} NEAR
          </div>
          <div style={{ marginTop: 6, fontSize: 14, color: "#B8C0C8" }}>
            Whitelist: {data.whitelist.length ? data.whitelist.join(", ") : "none (no transfer can pass)"}
          </div>
          <div style={{ marginTop: 14 }}>
            <SpentProgress spentNear={data.spentTodayNear} dailyNear={data.dailyLimitNear} />
          </div>
          <div style={{ display: "flex", gap: 10, marginTop: 18, flexWrap: "wrap" }}>
            {data.status === "Paused" ? (
              <button className="btn-primary" disabled={busy} onClick={() => walletCall("resume_agent", { agent_account_id: agentId })}>
                Resume Agent
              </button>
            ) : (
              <button className="btn-primary" disabled={busy} onClick={() => walletCall("pause_agent", { agent_account_id: agentId })}>
                Pause Agent
              </button>
            )}
            <button className="btn-secondary" onClick={() => onSetPolicy(agentId)}>
              Set Policy
            </button>
            <button
              className="btn-danger"
              disabled={busy}
              onClick={() => {
                if (window.confirm("Revoke is terminal. This agent ID can never be re-registered. Continue?")) {
                  walletCall("revoke_agent", { agent_account_id: agentId });
                }
              }}
            >
              Revoke Agent
            </button>
          </div>
          <p style={{ color: "#8A949E", fontSize: 13, marginTop: 10 }}>
            Pause is prominent by design. Revoke cannot be undone for this Agent ID.
          </p>
        </div>
      )}

      <h2 style={{ fontSize: 20 }}>Try a transfer</h2>
      <p style={{ color: "#B8C0C8", fontSize: 14 }}>
        This goes through the local agent service, with the same parser and pre-signing
        re-validation as the demo scripts. It is not a wallet transfer.
      </p>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <input
          value={transferText}
          onChange={(e) => setTransferText(e.target.value)}
          style={{ flex: 1, minWidth: 280, background: "#12161A", border: "1px solid #232A30", color: "#E6E9EC", borderRadius: 8, padding: "10px 12px" }}
        />
        <button className="btn-primary" disabled={busy || !serviceOk} onClick={runTransfer}>
          Send via agent
        </button>
      </div>
      {!serviceOk && (
        <p style={{ color: "#F59E0B", fontSize: 13 }}>
          Transfer and attack demo require the local agent service (npm run server in agent/). The buttons are disabled until it is reachable.
        </p>
      )}

      <h2 style={{ fontSize: 20, marginTop: 28 }}>Attack Demo</h2>
      <p style={{ color: "#B8C0C8", fontSize: 14 }}>
        Runs both frozen attacks through the real agent-service validation path. Rejects are
        shown in red below, with no tx hash, because nothing was signed or broadcast.
      </p>
      <button className="btn-danger" disabled={busy || !serviceOk} onClick={runAttackDemo}>
        Run Attack Demo
      </button>
      {!serviceOk && (
        <p style={{ color: "#F59E0B", fontSize: 13 }}>Requires local agent service.</p>
      )}

      <h2 style={{ fontSize: 20, marginTop: 28 }}>Activity</h2>
      {activity.length ? (
        activity.map((e, i) => <ActivityRow key={i} entry={e} />)
      ) : (
        <p style={{ color: "#8A949E", fontSize: 14 }}>
          No local activity for this agent yet. Activity comes from the agent service log;
          on-chain success rows also have a NearBlocks receipt link.
        </p>
      )}
    </div>
  );
}
