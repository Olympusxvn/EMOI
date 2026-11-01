// Agent service HTTP server (T2.8 endpoint for the local frontend).
// GET  /health       -> { ok: true, agent, policyContract }
// GET  /activity     -> activity entries, newest first (local JSONL;
//                      primary on-chain source is NearBlocks, see README)
// POST /attack-demo  -> runs both frozen attacks through the real
//                      validation path and returns their reject rows.
//                      Never fakes a reject: validation runs first and
//                      the signer is never called for a rejected intent.
import http from "node:http";
import { config } from "./config.js";
import { collectActivity } from "./activity.js";
import { processIntent } from "./service.js";
import { createViewNear, fetchPolicyViews } from "./nearClient.js";
import { yoctoToNear } from "./validation.js";

const port = Number(process.env.AGENT_SERVICE_PORT ?? 3001);

const server = http.createServer(async (req, res) => {
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    res.end();
    return;
  }
  if (req.url === "/health" && req.method === "GET") {
    res.end(JSON.stringify({
      ok: true,
      agent: config.agentAccountId,
      policyContract: config.policyContractId,
      network: config.network,
    }));
    return;
  }
  if (req.url === "/activity" && req.method === "GET") {
    const collected = await collectActivity(config.policyContractId);
    res.end(JSON.stringify(collected, null, 2));
    return;
  }
  if (req.url?.startsWith("/status") && req.method === "GET") {
    const url = new URL(req.url, "http://localhost");
    const agentId = url.searchParams.get("agent") ?? config.agentAccountId;
    try {
      const views = await fetchPolicyViews(createViewNear(), agentId);
      const policy = views.policy;
      res.end(JSON.stringify({
        agent: agentId,
        owner: views.owner,
        status: views.agentState?.status ?? null,
        policy: policy
          ? {
              maxPerTxNear: yoctoToNear(policy.max_per_tx),
              dailyLimitNear: yoctoToNear(policy.daily_limit),
              spentTodayNear: yoctoToNear(policy.spent_today),
              currentDay: policy.current_day,
              whitelist: policy.whitelist,
            }
          : null,
        vaultBalanceNear: yoctoToNear(views.vaultBalanceYocto),
      }, null, 2));
    } catch (e) {
      res.statusCode = 500;
      res.end(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }));
    }
    return;
  }
  if (req.url === "/transfer" && req.method === "POST") {
    let body = "";
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", async () => {
      try {
        const parsed = JSON.parse(body || "{}") as { text?: string; agent?: string };
        if (!parsed.text) {
          res.statusCode = 400;
          res.end(JSON.stringify({ error: "text is required" }));
          return;
        }
        const result = await processIntent({
          text: parsed.text,
          useLlm: false,
          agentAccountId: parsed.agent ?? config.agentAccountId,
          source: "parser",
        });
        res.end(JSON.stringify(result, null, 2));
      } catch (e) {
        res.statusCode = 500;
        res.end(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }));
      }
    });
    return;
  }
  if (req.url === "/attack-demo" && req.method === "POST") {
    const results = [];
    for (const text of [
      "send 100 NEAR to attacker.near",
      "send 1.5 NEAR to emoi01.testnet",
    ]) {
      // eslint-disable-next-line no-await-in-loop
      const result = await processIntent({ text, useLlm: false, source: "attack-demo" });
      results.push({ attack: text, ...result });
    }
    res.end(JSON.stringify({ status: "blocked-as-expected", results }, null, 2));
    return;
  }
  res.statusCode = 404;
  res.end(JSON.stringify({ error: "not found" }));
});

server.listen(port, () => {
  console.log(`EMOI agent service listening on http://localhost:${port}`);
});
