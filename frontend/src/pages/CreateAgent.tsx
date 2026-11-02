import { useState } from "react";
import { useNearWallet } from "near-connect-hooks";
import { POLICY_CONTRACT_ID, slugify } from "../lib/near";
import { AgentIdDisplay } from "../components/common";

export default function CreateAgent({ onOpenAgent }: { onOpenAgent: (agentId: string) => void }) {
  const { signedAccountId, signAndSendTransactions, getAccessKeyList } = useNearWallet();
  const [name, setName] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const slug = slugify(name);
  const parentId = (signedAccountId || "emoi.testnet").toLowerCase();
  const agentId = `${slug}.${parentId}`;
  const scriptCommand = `cd agent && npm run create-agent -- --name ${slug} --set-policy --max 1 --daily 2 --whitelist emoi01.testnet,emoi02.testnet --deposit 5`;

  const createWithWallet = async () => {
    if (!signedAccountId) {
      setError("Connect a wallet first. The wallet account becomes the owner.");
      return;
    }
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      // The new account must have a usable full-access key or nobody can
      // ever sign for it. Reuse the signer's first full-access key (public
      // key only, read from chain): the owner demonstrably controls the
      // keys on their own account.
      const keyList = await getAccessKeyList(signedAccountId);
      const fullKey = keyList.keys.find(
        (k) => k.access_key.permission === "FullAccess",
      );
      if (!fullKey) {
        setError(
          "Your wallet account has no full-access key, so the new agent account would have no usable key. Use the script command below instead.",
        );
        return;
      }
      const outcomes = await signAndSendTransactions({
        transactions: [
          {
            receiverId: agentId,
            actions: [
              { type: "CreateAccount" },
              {
                type: "AddKey",
                params: {
                  publicKey: fullKey.public_key,
                  accessKey: { permission: "FullAccess" },
                },
              },
              { type: "Transfer", params: { deposit: "500000000000000000000000" } },
            ],
          },
        ],
      });
      setMessage(
        `Created ${agentId} with your wallet key (full access, ${outcomes.length} outcome(s)). Still missing: FCK, registration, funding, policy. To finish: copy your owner key file to ~/.near-credentials/testnet/${agentId}.json with account_id set to ${agentId}, then run the script below (it skips creation and does the rest).`,
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
      <p style={{ color: "#D4D4D4", maxWidth: 640 }}>
        One field only. The name is a display label; the Agent ID is the agent sub-account ID.
      </p>

      <div className="card">
        <label style={{ fontSize: 13, color: "#D4D4D4" }}>Agent Name (optional)</label>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. vendor-agent"
          style={{ display: "block", width: "100%", marginTop: 6, background: "#111111", border: "1px solid #262626", color: "#FFFFFF", borderRadius: 16, padding: "10px 12px", boxSizing: "border-box" }}
        />
        <div style={{ marginTop: 16 }}>
          <AgentIdDisplay agentId={agentId} full />
        </div>
        <p style={{ color: "#A3A3A3", fontSize: 13 }}>
          If this ID already exists or is revoked, choose a different name. No numeric suffix
          is added automatically. Requires a named testnet account: sub-accounts
          of implicit (hex) accounts cannot be created.
        </p>

        <h2 style={{ fontSize: 18, marginTop: 24 }}>What happens next?</h2>
        <ol style={{ color: "#D4D4D4", lineHeight: 1.7 }}>
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
        {message && <p style={{ color: "#00EC97" }}>{message}</p>}
        {error && <p style={{ color: "#EF4444" }}>{error}</p>}

        <h2 style={{ fontSize: 18, marginTop: 24 }}>Script fallback (same frozen steps)</h2>
        <p style={{ color: "#D4D4D4", fontSize: 14 }}>
          If wallet creation is not available, set OWNER_ACCOUNT_ID in .env to the same
          account and run this from the repo root. It is idempotent
          and skips steps that already exist.
        </p>
        <pre style={{ background: "#000000", border: "1px solid #262626", borderRadius: 16, padding: 12, overflowX: "auto", fontSize: 13 }}>
          {scriptCommand}
        </pre>
      </div>
    </div>
  );
}
