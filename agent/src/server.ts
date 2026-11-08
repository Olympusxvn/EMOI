// Agent service HTTP server (T2.8 endpoint for the local frontend).
// GET  /health       -> { ok: true, agent, policyContract }
// GET  /activity     -> activity entries, newest first (local JSONL;
//                      primary on-chain source is NearBlocks, see README)
// POST /attack-demo  -> runs both frozen attacks through the real
//                      validation path and returns their reject rows.
//                      Never fakes a reject: validation runs first and
//                      the signer is never called for a rejected intent.
// POST /research/start   -> negotiation for a research report (no spend).
// POST /research/respond -> accept (pay vendors + generate report) or
//                           decline (walk away, no spend). See research.ts
//                           for the honest scope limits of this slice.
// GET  /research         -> research receipts from research.jsonl.
// POST /transfer/dry-run -> preview only: parse + validate against fresh
//                      views, return would-succeed/rejected. Never signs,
//                      never broadcasts, never logs activity, no txHash.
// GET  /receipts[?agent=&format=json|csv] -> exportable spend receipts
//                      (same source as /activity). CSV downloads as a file.
// GET  /fck-status[?agent=] -> FCK allowance vs threshold (ok/low).
//                      Read-only, never returns private-key material.
import http from "node:http";
import os from "node:os";
import { config } from "./config.js";
import { collectActivity } from "./activity.js";
import { fckStatusFor } from "./fck.js";
import { buildReceipts, receiptsFilename, receiptsToCsv } from "./receipts.js";
import { previewTransfer, processIntent } from "./service.js";
import {
  RESEARCH_AGENT_ID,
  appendResearchLog,
  generateReport,
  negotiate,
  readResearchLog,
  realPayVendor,
  runResearch,
  type ResearchJob,
} from "./research.js";
import { createViewNear, fetchPolicyViews } from "./nearClient.js";
import { yoctoToNear } from "./validation.js";
import { isLocalhostOrigin, resolveTransferAgent, sanitizeErrorForHttp } from "./httpGuards.js";

const port = Number(process.env.AGENT_SERVICE_PORT ?? 3001);
const researchJobs = new Map<string, ResearchJob>();

const server = http.createServer(async (req, res) => {
  res.setHeader("Content-Type", "application/json");
  const origin = req.headers.origin;
  if (typeof origin === "string" && isLocalhostOrigin(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  }
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
      signerReady: config.agentFckPrivateKey.length > 0,
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
      res.end(JSON.stringify({ error: sanitizeErrorForHttp(e instanceof Error ? e.message : String(e), os.homedir()) }));
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
        let transferAgent: string;
        try {
          transferAgent = resolveTransferAgent(parsed.agent, config.agentAccountId);
        } catch {
          res.statusCode = 400;
        res.end(JSON.stringify({ error: "this service signs only for " + config.agentAccountId }));
          return;
        }
        const result = await processIntent({
          text: parsed.text,
          useLlm: false,
          agentAccountId: transferAgent,
          source: "parser",
        });
        res.end(JSON.stringify(result, null, 2));
      } catch (e) {
        res.statusCode = 500;
        res.end(JSON.stringify({ error: sanitizeErrorForHttp(e instanceof Error ? e.message : String(e), os.homedir()) }));
      }
    });
    return;
  }
  if (req.url === "/transfer/dry-run" && req.method === "POST") {
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
        const agentAccountId = parsed.agent ?? config.agentAccountId;
        const views = await fetchPolicyViews(createViewNear(), agentAccountId);
        const result = await previewTransfer({
          text: parsed.text,
          useLlm: false,
          agentAccountId,
          views: {
            agentState: views.agentState,
            policy: views.policy,
            vaultBalanceYocto: views.vaultBalanceYocto,
          },
        });
        res.end(JSON.stringify({ ...result, note: "dry-run: nothing was signed" }, null, 2));
      } catch (e) {
        res.statusCode = 500;
        res.end(JSON.stringify({ error: sanitizeErrorForHttp(e instanceof Error ? e.message : String(e), os.homedir()) }));
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
  // Research slice (additive; see research.ts for scope limits).
  // In-memory jobs only live for this server process; completed and
  // walked-away jobs are also appended to research.jsonl, which
  // GET /research reads back.
  if (req.url === "/research" && req.method === "GET") {
    res.end(JSON.stringify({ entries: readResearchLog() }, null, 2));
    return;
  }
  if (req.url === "/research/start" && req.method === "POST") {
    let body = "";
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", () => {
      try {
        const parsed = JSON.parse(body || "{}") as {
          topic?: string;
          offerNear?: string;
          agent?: string;
        };
        const agent = parsed.agent ?? RESEARCH_AGENT_ID;
        const job = negotiate(parsed.topic ?? "", parsed.offerNear ?? "", agent);
        researchJobs.set(job.id, job);
        res.end(JSON.stringify(job, null, 2));
      } catch (e) {
        res.statusCode = 400;
        res.end(JSON.stringify({ error: sanitizeErrorForHttp(e instanceof Error ? e.message : String(e), os.homedir()) }));
      }
    });
    return;
  }
  if (req.url === "/research/respond" && req.method === "POST") {
    let body = "";
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", async () => {
      try {
        const parsed = JSON.parse(body || "{}") as { id?: string; decision?: string };
        const job = parsed.id ? researchJobs.get(parsed.id) : undefined;
        if (!job) {
          res.statusCode = 404;
          res.end(JSON.stringify({ error: "research job not found (start a new one)" }));
          return;
        }
        if (job.status === "walked-away" || job.status === "completed" || job.status === "failed") {
          res.statusCode = 400;
          res.end(JSON.stringify({ error: `job already ${job.status}` }));
          return;
        }
        // "accepted" means a run is in flight (runs always end terminal), so
        // this rejects both a concurrent double-accept and a mid-run decline.
        if (job.status === "accepted") {
          res.statusCode = 409;
          res.end(JSON.stringify({ error: "job already running" }));
          return;
        }
        if (parsed.decision === "decline") {
          const walked: ResearchJob = { ...job, status: "walked-away", decision: "decline" };
          researchJobs.set(job.id, walked);
          appendResearchLog(walked);
          res.end(JSON.stringify(walked, null, 2));
          return;
        }
        if (parsed.decision !== "accept") {
          res.statusCode = 400;
          res.end(JSON.stringify({ error: "decision must be 'accept' or 'decline'" }));
          return;
        }
        const accepted: ResearchJob = { ...job, status: "accepted", decision: "accept" };
        researchJobs.set(job.id, accepted);
        const done = await runResearch(accepted, {
          pay: realPayVendor,
          report: (topic) => generateReport(topic, config.nearAiCloudApiKey, config.nearAiModel),
        });
        researchJobs.set(job.id, done);
        res.end(JSON.stringify(done, null, 2));
      } catch (e) {
        res.statusCode = 500;
        res.end(JSON.stringify({ error: sanitizeErrorForHttp(e instanceof Error ? e.message : String(e), os.homedir()) }));
      }
    });
    return;
  }
  if (req.url?.startsWith("/receipts") && req.method === "GET") {
    const url = new URL(req.url, "http://localhost");
    const agentId = url.searchParams.get("agent") ?? config.agentAccountId;
    const format = url.searchParams.get("format") ?? "json";
    if (format !== "json" && format !== "csv") {
      res.statusCode = 400;
      res.end(JSON.stringify({ error: "format must be 'json' or 'csv'" }));
      return;
    }
    try {
      const collected = await collectActivity(config.policyContractId);
      const rows = buildReceipts(collected.entries.filter((e) => e.agent === agentId));
      if (format === "csv") {
        res.setHeader("Content-Type", "text/csv; charset=utf-8");
        res.setHeader("Content-Disposition", `attachment; filename="${receiptsFilename(agentId, "csv")}"`);
        res.end(receiptsToCsv(rows));
        return;
      }
      res.end(JSON.stringify({
        agent: agentId,
        exportedAt: new Date().toISOString(),
        nearblocksAvailable: collected.nearblocksAvailable,
        receipts: rows,
      }, null, 2));
    } catch (e) {
      res.statusCode = 500;
      res.end(JSON.stringify({ error: sanitizeErrorForHttp(e instanceof Error ? e.message : String(e), os.homedir()) }));
    }
    return;
  }
  if (req.url?.startsWith("/fck-status") && req.method === "GET") {
    const url = new URL(req.url, "http://localhost");
    const agentId = url.searchParams.get("agent") ?? config.agentAccountId;
    try {
      const status = await fckStatusFor(agentId);
      res.end(JSON.stringify(status, null, 2));
    } catch (e) {
      res.statusCode = 500;
      res.end(JSON.stringify({ error: sanitizeErrorForHttp(e instanceof Error ? e.message : String(e), os.homedir()) }));
    }
    return;
  }
  res.statusCode = 404;
  res.end(JSON.stringify({ error: "not found" }));
});

server.listen(port, "127.0.0.1", () => {
  console.log(`EMOI agent service listening on http://localhost:${port}`);
});
