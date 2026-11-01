import { useState } from "react";
import { useNearWallet } from "near-connect-hooks";
import { POLICY_CONTRACT_ID, slugify } from "../lib/near";
import { AgentIdDisplay } from "../components/common";

export default function CreateAgent({ onOpenAgent }: { onOpenAgent: (agentId: string) => void }) {
  const { signedAccountId, signAndSendTransactions } = useNearWallet();
  const [name, setName] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const slug = slugify(name);
  const agentId = `${slug}.emoi.testnet`;
  const scriptCommand = `cd agent && npm run create-agent -- --name ${slug} --set-policy --max 1 --daily 2 --whitelist emoi01.testnet,emoi02.testnet`;

  const createWithWallet = async () => {
    if (!signedAccountId) {
      setError("Connect a wallet first. The wallet account becomes the owner.");
      return;
    }
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      // Wallet-signed sub-account creation. If the wallet or connector
      // does not support these actions, the error below shows the
      // honest script fallback instead of a faked creation.
      const outcomes = await signAndSendTransactions({
        transactions: [
          {
            receiverId: agentId,
            actions: [
              { type: "CreateAccount" },
              { type: "Transfer", params: { deposit: "500000000000000000000000" } },
            ],
          },
        ],
      });
      setMessage(
        `Wallet creation transaction sent (${outcomes.length} outcome(s)). Now register the agent and set its policy from the Agent Detail page, or run the script below to finish the FCK and registration steps.`,
      );
    } catch (e) {
      setError(
        `Wallet creation did not complete: ${e instanceof Error ? e.message : String(e)}. Use the script command below instead; it creates the account, FCK, registration, and policy in the frozen order.`,
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <h1 style={{ margin: "0 0 6px", fontSize: 28 }}>Create Agent</h1>
      <p style={{ color: "#B8C0C8", maxWidth: 640 }}>
        One field only. The name is a display label; the Agent ID is the agent sub-account ID.
      </p>

      <div className="card">
        <label style={{ fontSize: 13, color: "#B8C0C8" }}>Agent Name (optional)</label>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. vendor-agent"
          style={{ display: "block", width: "100%", marginTop: 6, background: "#12161A", border: "1px solid #232A30", color: "#E6E9EC", borderRadius: 8, padding: "10px 12px", boxSizing: "border-box" }}
        />
        <div style={{ marginTop: 16 }}>
          <AgentIdDisplay agentId={agentId} full />
        </div>
        <p style={{ color: "#8A949E", fontSize: 13 }}>
          If this ID already exists or is revoked, choose a different name. No numeric suffix
          is added automatically.
        </p>

        <h2 style={{ fontSize: 18, marginTop: 24 }}>What happens next?</h2>
        <ol style={{ color: "#B8C0C8", lineHeight: 1.7 }}>
          <li>Create a restricted wallet: a sub-account holding only a Function Call Key for {POLICY_CONTRACT_ID}, method agent_transfer only.</li>
          <li>Set limits and whitelist: max per transaction, daily limit, and approved vendors.</li>
          <li>The agent acts only within those rules. The owner can pause or revoke at any time.</li>
        </ol>

        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 16 }}>
          <button className="btn-primary" disabled={busy} onClick={createWithWallet}>
            Create with wallet
          </button>
          <button className="btn-secondary" onClick={() => onOpenAgent(agentId)}>
            Open Agent Detail
          </button>
        </div>
        {message && <p style={{ color: "#22C55E" }}>{message}</p>}
        {error && <p style={{ color: "#EF4444" }}>{error}</p>}

        <h2 style={{ fontSize: 18, marginTop: 24 }}>Script fallback (same frozen steps)</h2>
        <p style={{ color: "#B8C0C8", fontSize: 14 }}>
          If wallet creation is not available, run this from the repo root. It is idempotent
          and skips steps that already exist.
        </p>
        <pre style={{ background: "#0B0E11", border: "1px solid #232A30", borderRadius: 8, padding: 12, overflowX: "auto", fontSize: 13 }}>
          {scriptCommand}
        </pre>
      </div>
    </div>
  );
}
