import { useEffect, useState } from "react";
import { fetchActivity, type ActivityEntry } from "../lib/api";
import { ActivityRow } from "../components/common";

export default function ActivityPage() {
  const [entries, setEntries] = useState<ActivityEntry[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchActivity()
      .then(setEntries)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  return (
    <div>
      <h1 style={{ margin: "0 0 6px", fontSize: 28 }}>Activity</h1>
      <p style={{ color: "#B8C0C8", maxWidth: 640 }}>
        Receipt-style rows. A success row has a NearBlocks receipt link. A reject row has
        no tx hash, because a local reject is blocked before signing, not a failed on-chain
        transaction.
      </p>
      {error && <p style={{ color: "#EF4444" }}>Could not load activity from the agent service: {error}. Start the agent service (npm run server in agent/) to see local activity.</p>}
      {entries.map((e, i) => (
        <ActivityRow key={i} entry={e} />
      ))}
      {!entries.length && !error && <p style={{ color: "#8A949E" }}>No activity yet.</p>}
    </div>
  );
}
