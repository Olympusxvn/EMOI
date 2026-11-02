import { useState } from "react";
import { NearProvider, useNearWallet } from "near-connect-hooks";
import Dashboard from "./pages/Dashboard";
import CreateAgent from "./pages/CreateAgent";
import AgentDetail from "./pages/AgentDetail";
import SetPolicy from "./pages/SetPolicy";
import ActivityPage from "./pages/ActivityPage";
import ResearchPage from "./pages/ResearchPage";

type Page = "dashboard" | "create" | "detail" | "policy" | "activity" | "research";

function Shell() {
  const { signedAccountId, signIn, signOut, loading } = useNearWallet();
  const [page, setPage] = useState<Page>("dashboard");
  const [selectedAgent, setSelectedAgent] = useState("agent.emoi.testnet");

  const openAgent = (agentId: string) => {
    setSelectedAgent(agentId);
    setPage("detail");
  };

  return (
    <div style={{ maxWidth: 900, margin: "0 auto", padding: "24px 20px 60px" }}>
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12, borderBottom: "1px solid #262626", paddingBottom: 16, marginBottom: 24 }}>
        <div>
          <div style={{ fontSize: 22, fontWeight: 800, letterSpacing: "-0.02em" }}>
            EMOI <span style={{ color: "#00EC97" }}>Safe Agent</span>
          </div>
          <div style={{ color: "#A3A3A3", fontSize: 13 }}>Give AI a wallet, without giving it the keys to everything.</div>
        </div>
        <div>
          {loading ? (
            <span style={{ color: "#A3A3A3", fontSize: 13 }}>Loading wallet…</span>
          ) : signedAccountId ? (
            <span>
              <span style={{ fontFamily: "ui-monospace, monospace", fontSize: 13 }}>{signedAccountId}</span>{" "}
              <button className="btn-secondary" onClick={() => signOut()}>Sign out</button>
            </span>
          ) : (
            <button className="btn-primary" onClick={() => signIn()}>Connect wallet</button>
          )}
        </div>
      </header>

      <nav style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 24 }}>
        {([
          ["dashboard", "Dashboard"],
          ["create", "Create Agent"],
          ["activity", "Activity"],
          ["research", "Research"],
        ] as Array<[Page, string]>).map(([p, label]) => (
          <button
            key={p}
            className={page === p ? "btn-primary" : "btn-secondary"}
            onClick={() => setPage(p)}
          >
            {label}
          </button>
        ))}
        {page === "detail" && (
          <span style={{ color: "#A3A3A3", fontSize: 13, alignSelf: "center" }}>Agent Detail: {selectedAgent}</span>
        )}
        {page === "policy" && (
          <span style={{ color: "#A3A3A3", fontSize: 13, alignSelf: "center" }}>Set Policy: {selectedAgent}</span>
        )}
      </nav>

      {page === "dashboard" && <Dashboard onOpenAgent={openAgent} onCreate={() => setPage("create")} />}
      {page === "create" && <CreateAgent onOpenAgent={openAgent} />}
      {page === "detail" && (
        <AgentDetail
          agentId={selectedAgent}
          onSetPolicy={(id) => {
            setSelectedAgent(id);
            setPage("policy");
          }}
        />
      )}
      {page === "policy" && <SetPolicy agentId={selectedAgent} />}
      {page === "activity" && <ActivityPage />}
      {page === "research" && <ResearchPage />}

      <footer style={{ color: "#A3A3A3", fontSize: 13, marginTop: 48, borderTop: "1px solid #262626", paddingTop: 16 }}>
        Local demo on NEAR testnet. Contract: policy.emoi.testnet. Funds stay in the
        PolicyVault; the agent service holds only a single-method Function Call Key
        (account-level FCK-only for the main agent is the final pre-flip step — see README Audit).
      </footer>
    </div>
  );
}

export default function App() {
  return (
    <NearProvider config={{ network: "testnet" }}>
      <Shell />
    </NearProvider>
  );
}
