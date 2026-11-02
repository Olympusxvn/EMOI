import { useEffect, useState } from "react";
import { useNearWallet } from "near-connect-hooks";
import {
  DEMO_VENDORS,
  POLICY_CONTRACT_ID,
  agentName,
  nearBlocksTxLink,
  vendorLabel,
  vendorRole,
} from "../lib/near";
import { fetchAgentData, pollAgentStatus, txHashOf, type AgentData } from "../lib/agentData";
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
  const [receipt, setReceipt] = useState<{
    recipient: string;
    amountNear: string;
    txHash: string;
    intentLine?: string;
  } | null>(null);
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
      const tx = txHashOf(outcome) ?? "unknown";
      // Pause/Revoke/Resume change on-chain status, but RPC views can lag
      // one tx behind. Poll until a view confirms the new status instead
      // of trusting the first view after the transaction.
      const expectedStatus: Record<string, string> = {
        pause_agent: "Paused",
        resume_agent: "Active",
        revoke_agent: "Revoked",
      };
      const expected = expectedStatus[method];
      if (expected) {
        setMessage(`${method} succeeded. Tx: ${tx}. Confirming on-chain status…`);
        const confirmed = await pollAgentStatus(viewFunction, agentId, expected);
        setMessage(
          confirmed
            ? `${method} succeeded. On-chain status confirmed: ${expected}. Tx: ${tx}`
            : `${method} succeeded (tx ${tx}) but the on-chain view still shows the old status after 30s. The contract is authoritative — reload to re-check.`,
        );
      } else {
        setMessage(`${method} succeeded. Tx: ${tx}`);
      }
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
    setReceipt(null);
    try {
      const result = (await postTransfer(transferText, agentId)) as {
        status: string;
        recipient?: string;
        amountNear?: string;
        txHash?: string;
        reason?: string;
        intentLine?: string;
      };
      if (result.status === "success" && result.txHash && result.recipient && result.amountNear) {
        setReceipt({
          recipient: result.recipient,
          amountNear: result.amountNear,
          txHash: result.txHash,
          intentLine: result.intentLine,
        });
        setMessage("Transfer succeeded through the agent service. Receipt below.");
      } else {
        setMessage(
          `Transfer rejected: ${result.reason ?? "unknown"}. Blocked before signing, no transaction sent.`,
        );
      }
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
      {message && <p style={{ color: "#00EC97" }}>{message}</p>}

      {data && (
        <div className="card">
          <div style={{ color: "#D4D4D4", fontSize: 14 }}>
            Owner: {data.owner} · Vault balance: {data.vaultBalanceNear} NEAR
          </div>
          <div style={{ marginTop: 10, fontSize: 15 }}>
            Policy: max {data.maxPerTxNear} / daily {data.dailyLimitNear} NEAR
          </div>
          <div style={{ marginTop: 6, fontSize: 14, color: "#D4D4D4" }}>
            Whitelist:{" "}
            {data.whitelist.length
              ? data.whitelist
                  .map((w) => {
                    const role = vendorLabel(w);
                    return role ? `${w} (${role})` : w;
                  })
                  .join(", ")
              : "none (no transfer can pass)"}
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
          <p style={{ color: "#A3A3A3", fontSize: 13, marginTop: 10 }}>
            Pause is prominent by design. Revoke cannot be undone for this Agent ID.
          </p>
        </div>
      )}

      <h2 style={{ fontSize: 20 }}>Pay a demo vendor</h2>
      <p style={{ color: "#D4D4D4", fontSize: 14 }}>
        Pick a vendor to fill in the transfer below, then send via the agent. These are
        labels for whitelisted accounts only — the contract whitelist, not this list,
        decides whether a payment passes. This goes through the local agent service,
        with the same parser and pre-signing re-validation as the demo scripts. It is
        not a wallet transfer.
      </p>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 12 }}>
        {DEMO_VENDORS.map((v) => (
          <div key={v.account} className="card" style={{ marginTop: 0, flex: "1 1 260px" }}>
            <div style={{ fontWeight: 700 }}>{v.role}</div>
            <div style={{ fontFamily: "ui-monospace, monospace", fontSize: 14, color: "#D4D4D4", marginTop: 4 }}>
              {v.account}
            </div>
            <button
              className="btn-secondary"
              style={{ marginTop: 10 }}
              disabled={busy || !serviceOk}
              onClick={() => setTransferText(`send 0.5 NEAR to ${v.account}`)}
            >
              Pay 0.5 NEAR
            </button>
          </div>
        ))}
      </div>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <input
          value={transferText}
          onChange={(e) => setTransferText(e.target.value)}
          style={{ flex: 1, minWidth: 280, background: "#111111", border: "1px solid #262626", color: "#FFFFFF", borderRadius: 16, padding: "10px 12px" }}
        />
        <button className="btn-primary" disabled={busy || !serviceOk} onClick={runTransfer}>
          Send via agent
        </button>
      </div>
      {receipt && (
        <div className="card" style={{ borderLeft: "4px solid #00EC97" }}>
          <div style={{ fontWeight: 700, color: "#00EC97" }}>Receipt — Success</div>
          <div style={{ marginTop: 8, fontSize: 14 }}>
            {vendorRole(receipt.recipient)} — {receipt.recipient} — {receipt.amountNear} NEAR
          </div>
          {receipt.intentLine && <div style={{ color: "#D4D4D4", fontSize: 14 }}>{receipt.intentLine}</div>}
          <a href={nearBlocksTxLink(receipt.txHash)} target="_blank" rel="noreferrer" className="link">
            NearBlocks receipt: {receipt.txHash.slice(0, 16)}…
          </a>
          <div style={{ color: "#A3A3A3", fontSize: 13, marginTop: 6 }}>
            The tx hash is the receipt. Policy at the time is shown in the Activity row below.
          </div>
        </div>
      )}
      {!serviceOk && (
        <p style={{ color: "#F59E0B", fontSize: 13 }}>
          Transfer and attack demo require the local agent service (npm run server in agent/). The buttons are disabled until it is reachable.
        </p>
      )}

      <h2 style={{ fontSize: 20, marginTop: 28 }}>Attack Demo</h2>
      <p style={{ color: "#D4D4D4", fontSize: 14 }}>
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
        <p style={{ color: "#A3A3A3", fontSize: 14 }}>
          No local activity for this agent yet. Activity comes from the agent service log;
          on-chain success rows also have a NearBlocks receipt link.
        </p>
      )}
    </div>
  );
}
