import { useState } from "react";
import { checkAgentService, postResearchRespond, postResearchStart, type ResearchJob } from "../lib/api";

// Research Report Agent (slice, 2026-11-02). No contract change, no
// Intents. The agent counters once below the minimum price, then the
// customer accepts (vendor payments + report) or walks away (no spend).
// Honest limits, shown on the page itself: vendor accounts are demo
// labels, not real API billing; the report is LLM-generated and not
// fact-verified; there is no on-chain customer-to-vault payment and
// no hiring of other agents in this slice.
export default function ResearchPage() {
  const [topic, setTopic] = useState("NEAR staking rewards for small holders");
  const [offer, setOffer] = useState("0.4");
  const [job, setJob] = useState<ResearchJob | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [serviceOk, setServiceOk] = useState<boolean | null>(null);

  async function start() {
    setError("");
    setBusy(true);
    try {
      const ok = await checkAgentService();
      setServiceOk(ok);
      if (!ok) throw new Error("Agent service is not running (npm run server, port 3001).");
      const j = await postResearchStart(topic, offer);
      setJob(j);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function respond(decision: "accept" | "decline") {
    if (!job) return;
    setError("");
    setBusy(true);
    try {
      const j = await postResearchRespond(job.id, decision);
      setJob(j);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const negotiable = job && (job.status === "countered" || job.status === "accepted-direct");
  const finished = job && (job.status === "completed" || job.status === "walked-away" || job.status === "failed");

  return (
    <div>
      <h2 style={{ marginTop: 0 }}>Research Report Agent</h2>
      <p style={{ color: "#D4D4D4" }}>
        Ask for a short report. The agent breaks the task into parts, checks each spend against its
        on-chain policy, and only pays demo vendors inside its limits. Agent: research.emoi.testnet
        (dedicated agent, so the main agent&apos;s spent_today is untouched).
      </p>

      <div className="card">
        <label style={{ display: "block", marginBottom: 8 }}>Topic</label>
        <input
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
          style={{ width: "100%", padding: 10, background: "#000", color: "#fff", border: "1px solid #262626", borderRadius: 12 }}
        />
        <label style={{ display: "block", margin: "16px 0 8px" }}>Your offer (NEAR)</label>
        <input
          value={offer}
          onChange={(e) => setOffer(e.target.value)}
          style={{ width: "100%", padding: 10, background: "#000", color: "#fff", border: "1px solid #262626", borderRadius: 12 }}
        />
        <p style={{ color: "#A3A3A3", fontSize: 13 }}>
          Minimum price is 1.0 NEAR: data 0.5 (emoi02, data provider) + compute 0.5 (emoi01, API/compute provider).
          Offer below that and the agent counters exactly once.
        </p>
        <button className="btn-primary" onClick={start} disabled={busy || !topic.trim()}>
          {busy ? "Working…" : "Start negotiation"}
        </button>
        {serviceOk === false && <p style={{ color: "#F59E0B" }}>Agent service not reachable. Start it with npm run server first.</p>}
        {error && <p style={{ color: "#EF4444" }}>{error}</p>}
      </div>

      {job && (
        <div className="card" style={{ marginTop: 16 }}>
          <div style={{ fontSize: 13, color: "#00EC97", fontWeight: 700 }}>NEGOTIATION — {job.status}</div>
          <p>Topic: {job.topic}</p>
          <p>Your offer: {job.offerNear} NEAR · Minimum: {job.minPriceNear} NEAR</p>
          {job.counterNear && <p>Counter: {job.counterNear} NEAR — {job.reasoning}</p>}
          {job.status === "accepted-direct" && <p>No counter needed: your offer covers vendor costs.</p>}
          {negotiable && (
            <div style={{ display: "flex", gap: 8 }}>
              <button className="btn-primary" onClick={() => respond("accept")} disabled={busy}>
                {job.status === "countered" ? "Accept counter (pay vendors + generate)" : "Accept and run"}
              </button>
              <button className="btn-secondary" onClick={() => respond("decline")} disabled={busy}>
                Decline (walk away, no spend)
              </button>
            </div>
          )}
        </div>
      )}

      {finished && job.steps.length > 0 && (
        <div className="card" style={{ marginTop: 16 }}>
          <div style={{ fontSize: 13, color: "#00EC97", fontWeight: 700 }}>RECEIPT</div>
          {job.steps.map((s, i) => (
            <p key={i}>
              {s.part}: {s.amountNear} NEAR to {s.vendor} ({s.role}) — {s.status}
              {s.txHash && (
                <> · <a href={`https://explorer.testnet.near.org/transactions/${s.txHash}`} target="_blank" rel="noreferrer">{s.txHash.slice(0, 16)}…</a></>
              )}
              {s.reason && <> · {s.reason}</>}
            </p>
          ))}
          {job.report && <pre style={{ whiteSpace: "pre-wrap", color: "#D4D4D4" }}>{job.report}</pre>}
          {job.reportNote && <p style={{ color: "#A3A3A3", fontSize: 13 }}>{job.reportNote}</p>}
        </div>
      )}

      {job?.status === "walked-away" && (
        <div className="card" style={{ marginTop: 16 }}>
          <p>Walked away. No payment was made, no report was generated.</p>
        </div>
      )}

      <p style={{ color: "#A3A3A3", fontSize: 13, marginTop: 16 }}>
        What this page does not claim: hiring other agents, on-chain customer payment into the vault
        (deposit_funds credits the caller, not the owner — agreed price only, settlement is future work),
        USDC/Intents, or verified report content. Vendor accounts are demo labels, not real API billing.
      </p>
    </div>
  );
}
