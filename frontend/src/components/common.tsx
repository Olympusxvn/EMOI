import { useState } from "react";
import {
  copyText,
  nearBlocksAccountLink,
  nearBlocksTxLink,
  vendorRole,
} from "../lib/near";
import type { ActivityEntry } from "../lib/api";

export function AgentIdDisplay({ agentId, full = false }: { agentId: string; full?: boolean }) {
  const [copied, setCopied] = useState(false);
  const display = full
    ? agentId
    : agentId.length > 24
      ? `${agentId.slice(0, 10)}…${agentId.slice(-8)}`
      : agentId;
  return (
    <div>
      <div style={{ fontSize: 11, letterSpacing: "0.08em", color: "#A3A3A3", textTransform: "uppercase" }}>
        Agent ID
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span title={agentId} style={{ fontFamily: "ui-monospace, monospace", fontSize: 15 }}>
          {display}
        </span>
        <button
          className="btn-secondary"
          onClick={async () => {
            await copyText(agentId);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }}
        >
          {copied ? "Copied" : "Copy"}
        </button>
        <a href={nearBlocksAccountLink(agentId)} target="_blank" rel="noreferrer" className="link">
          NearBlocks
        </a>
      </div>
    </div>
  );
}

export function StatusBadge({ status }: { status: string | null }) {
  const color =
    status === "Active" ? "#00EC97" : status === "Paused" ? "#F59E0B" : status === "Revoked" ? "#EF4444" : "#A3A3A3";
  return (
    <span
      style={{
        border: `1px solid ${color}`,
        color,
        borderRadius: 999,
        padding: "2px 10px",
        fontSize: 13,
        fontWeight: 600,
      }}
    >
      {status ?? "Unknown"}
    </span>
  );
}

export function SpentProgress({
  spentNear,
  dailyNear,
}: {
  spentNear: string;
  dailyNear: string;
}) {
  const spent = Number(spentNear);
  const daily = Number(dailyNear);
  const pct = daily > 0 ? Math.min(100, (spent / daily) * 100) : 0;
  const nearLimit = pct >= 80;
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, color: "#D4D4D4" }}>
        <span>
          Spent today: {spentNear} / {dailyNear} NEAR
        </span>
        <span>{pct.toFixed(0)}%</span>
      </div>
      <div style={{ height: 8, background: "#262626", borderRadius: 999, marginTop: 6, overflow: "hidden" }}>
        <div
          style={{
            width: `${pct}%`,
            height: "100%",
            background: nearLimit ? "#F59E0B" : "#00EC97",
          }}
        />
      </div>
      {nearLimit && (
        <div style={{ color: "#F59E0B", fontSize: 13, marginTop: 6 }}>
          Near daily limit. This is a UI warning only, not a contract check.
        </div>
      )}
    </div>
  );
}

export function ActivityRow({ entry }: { entry: ActivityEntry }) {
  const isRejected = entry.status === "rejected";
  const color = isRejected ? "#EF4444" : "#00EC97";
  return (
    <div
      style={{
        border: "1px solid #262626",
        borderLeft: `4px solid ${color}`,
        borderRadius: 16,
        padding: "12px 14px",
        marginBottom: 10,
        background: "#111111",
        boxShadow: "0 8px 24px rgba(0, 0, 0, 0.45)",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <strong style={{ color }}>
          {isRejected ? "Rejected" : "Success"}
          {isRejected && entry.reason ? ` — ${entry.reason}` : ""}
        </strong>
        <span style={{ color: "#A3A3A3", fontSize: 13 }}>
          {new Date(entry.timestamp).toLocaleString()}
        </span>
      </div>
      <div style={{ marginTop: 6, fontSize: 14 }}>
        <div>
          <span style={{ color: "#A3A3A3", fontSize: 11, letterSpacing: "0.08em", textTransform: "uppercase" }}>
            Agent ID
          </span>{" "}
          <span style={{ fontFamily: "ui-monospace, monospace" }}>{entry.agent}</span>
        </div>
        <div>
          {entry.recipient
            ? `${vendorRole(entry.recipient)} — ${entry.recipient} — ${entry.amountNear} NEAR`
            : "No recipient (parse failed)"}
        </div>
        {entry.intentLine && <div style={{ color: "#D4D4D4" }}>{entry.intentLine}</div>}
        {entry.policyAtTime && (
          <div style={{ color: "#D4D4D4", fontSize: 13 }}>
            Policy at the time: max {entry.policyAtTime.maxNear} / daily {entry.policyAtTime.dailyNear} NEAR
          </div>
        )}
        {entry.txHash ? (
          <a href={nearBlocksTxLink(entry.txHash)} target="_blank" rel="noreferrer" className="link">
            NearBlocks receipt: {entry.txHash.slice(0, 16)}…
          </a>
        ) : (
          isRejected && (
            <div style={{ color: "#EF4444", fontSize: 13 }}>
              Blocked before signing, no transaction sent. No tx hash, no explorer link.
            </div>
          )
        )}
      </div>
    </div>
  );
}
