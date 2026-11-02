import { useState } from "react";
import { KeyPair } from "near-api-js";
import { useNearWallet } from "near-connect-hooks";
import { POLICY_CONTRACT_ID, copyText, slugify } from "../lib/near";
import { AgentIdDisplay } from "../components/common";

// Some wallets (notably Meteor) block any FullAccess AddKey by policy, which
// makes wallet-driven account creation impossible under them: a new account
// is unusable without a full-access key. Detect that block and point at the
// paths that work instead of showing a bare failure.
function walletBlockMessage(raw: string): string {
  if (/full[\s-]?access/i.test(raw)) {
    return (
      "Your wallet blocked the full-access key this new account needs (a known Meteor policy). " +
      "Retry with a wallet that permits full-access keys (e.g. MyNearWallet), " +
      "or use the script command below, which is the recommended route for account creation."
    );
  }
  return raw
    ? `Wallet creation did not complete: ${raw}. Use the script command below instead; it creates the account, FCK, registration, and policy in the frozen order.`
    : "Wallet creation did not complete. Use the script command below instead.";
}

export default function CreateAgent({ onOpenAgent }: { onOpenAgent: (agentId: string) => void }) {
  const { signedAccountId, signAndSendTransactions } = useNearWallet();
  const [name, setName] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [createdKey, setCreatedKey] = useState<{ accountId: string; publicKey: string; privateKey: string } | null>(null);

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
    setCreatedKey(null);
    try {
      // Fresh keypair generated locally: whoever creates the account provably
      // holds its only full-access key. Never reuse a wallet key instead: a
      // wallet may hold several full-access keys, and picking the wrong one
      // orphans the account with a key nobody holds (seen live on testnet).
      // The private key is shown once below and never leaves this browser
      // except through the user's own copy action.
      const agentKey = KeyPair.fromRandom("ed25519");
      const newPublicKey = agentKey.getPublicKey().toString();
      const newPrivateKey = agentKey.toString();
      const outcomes = await signAndSendTransactions({
        transactions: [
          {
            receiverId: agentId,
            actions: [
              { type: "CreateAccount" },
              {
                type: "AddKey",
                params: {
                  publicKey: newPublicKey,
                  accessKey: { permission: "FullAccess" },
                },
              },
              { type: "Transfer", params: { deposit: "500000000000000000000000" } },
            ],
          },
        ],
      });
      setCreatedKey({ accountId: agentId, publicKey: newPublicKey, privateKey: newPrivateKey });
      setMessage(
        `Created ${agentId} (${outcomes.length} outcome(s)). Save the key file below, then run the script to finish FCK + registration + funding + policy.`,
      );
    } catch (e) {
      setError(
        walletBlockMessage(e instanceof Error ? e.message : String(e)),
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
        {createdKey && (
          <div className="card" style={{ borderColor: "#F59E0B", marginTop: 12 }}>
            <p style={{ color: "#F59E0B", fontSize: 13, margin: "0 0 8px" }}>
              Save this key file now — shown once. Without it, this agent account can never be finished.
            </p>
            <pre style={{ background: "#000000", border: "1px solid #262626", borderRadius: 16, padding: 12, overflowX: "auto", fontSize: 13 }}>
              {JSON.stringify({ account_id: createdKey.accountId, public_key: createdKey.publicKey, private_key: createdKey.privateKey }, null, 2)}
            </pre>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 8 }}>
              <button
                className="btn-secondary"
                onClick={() => { void copyText(JSON.stringify({ account_id: createdKey.accountId, public_key: createdKey.publicKey, private_key: createdKey.privateKey }, null, 2)); }}
              >
                Copy key file
              </button>
            </div>
            <p style={{ color: "#A3A3A3", fontSize: 13 }}>
              Save as ~/.near-credentials/testnet/{createdKey.accountId}.json, set OWNER_ACCOUNT_ID in .env, then run the script below.
            </p>
          </div>
        )}
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
