import { useState } from "react";
import { useNearWallet } from "near-connect-hooks";
import { POLICY_CONTRACT_ID, nearToYocto } from "../lib/near";
import { txHashOf } from "../lib/agentData";

const ACCOUNT_RE = /^[a-z0-9][a-z0-9._-]*\.(testnet|near)$/;

export default function SetPolicy({ agentId }: { agentId: string }) {
  const { signedAccountId, callFunction } = useNearWallet();
  const [max, setMax] = useState("1");
  const [daily, setDaily] = useState("2");
  const [whitelistText, setWhitelistText] = useState("emoi01.testnet\nemoi02.testnet");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const whitelist = Array.from(
    new Set(
      whitelistText
        .split(/[\n,]+/)
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean),
    ),
  );

  const validate = (): string | null => {
    const maxN = Number(max);
    const dailyN = Number(daily);
    if (!max || maxN <= 0) return "Max per transaction must be greater than 0.";
    if (!daily || dailyN <= 0) return "Daily limit must be greater than 0.";
    if (maxN > dailyN) return "Max per transaction must not exceed the daily limit.";
    if (whitelist.length > 20) return "Whitelist must have at most 20 entries.";
    for (const w of whitelist) {
      if (!ACCOUNT_RE.test(w)) return `Invalid account ID in whitelist: ${w}`;
    }
    return null;
  };

  const submit = async () => {
    const problem = validate();
    if (problem) {
      setError(problem);
      return;
    }
    if (!signedAccountId) {
      setError("Connect a wallet first. Only the agent's owner can set its policy.");
      return;
    }
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const outcome = await callFunction({
        contractId: POLICY_CONTRACT_ID,
        method: "set_policy",
        args: {
          agent_account_id: agentId,
          max_per_tx: nearToYocto(max),
          daily_limit: nearToYocto(daily),
          whitelist,
        },
        gas: "100000000000000",
        deposit: "0",
      });
      setMessage(`Policy set. Tx: ${txHashOf(outcome) ?? "unknown"}. Setting a policy does not reset spent_today and does not change the agent status.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <h1 style={{ margin: "0 0 6px", fontSize: 28 }}>Set Policy</h1>
      <p style={{ color: "#B8C0C8" }}>
        Agent: <span style={{ fontFamily: "ui-monospace, monospace" }}>{agentId}</span>
      </p>
      <div className="card">
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
          <div>
            <label style={{ fontSize: 13, color: "#B8C0C8" }}>Max per transaction (NEAR)</label>
            <input value={max} onChange={(e) => setMax(e.target.value)} style={{ display: "block", width: "100%", marginTop: 6, background: "#12161A", border: "1px solid #232A30", color: "#E6E9EC", borderRadius: 8, padding: "10px 12px", boxSizing: "border-box" }} />
          </div>
          <div>
            <label style={{ fontSize: 13, color: "#B8C0C8" }}>Daily limit (NEAR)</label>
            <input value={daily} onChange={(e) => setDaily(e.target.value)} style={{ display: "block", width: "100%", marginTop: 6, background: "#12161A", border: "1px solid #232A30", color: "#E6E9EC", borderRadius: 8, padding: "10px 12px", boxSizing: "border-box" }} />
          </div>
        </div>
        <div style={{ marginTop: 16 }}>
          <label style={{ fontSize: 13, color: "#B8C0C8" }}>Whitelist (one account per line, max 20)</label>
          <textarea
            value={whitelistText}
            onChange={(e) => setWhitelistText(e.target.value)}
            rows={4}
            style={{ display: "block", width: "100%", marginTop: 6, background: "#12161A", border: "1px solid #232A30", color: "#E6E9EC", borderRadius: 8, padding: "10px 12px", boxSizing: "border-box" }}
          />
          <p style={{ color: "#8A949E", fontSize: 13 }}>
            Deduplicated on submit. An empty whitelist means no transfer can pass. These
            frontend checks mirror the contract checks; the contract enforces them again.
          </p>
        </div>
        <button className="btn-primary" disabled={busy} onClick={submit}>
          Set Policy
        </button>
        {message && <p style={{ color: "#22C55E" }}>{message}</p>}
        {error && <p style={{ color: "#EF4444" }}>{error}</p>}
      </div>
    </div>
  );
}
