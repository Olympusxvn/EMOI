// Research slice tests (2026-11-02). No chain, no network, no keys:
// negotiation is pure, and runResearch is driven by mock pay/report.
import assert from "node:assert";
import {
  COMPUTE_COST_NEAR,
  DATA_COST_NEAR,
  MIN_PRICE_NEAR,
  negotiate,
  runResearch,
  type ResearchJob,
} from "../src/research.js";

function baseJob(over: Partial<ResearchJob> = {}): ResearchJob {
  return {
    id: "test-1",
    topic: "NEAR staking",
    agent: "research.emoi.testnet",
    offerNear: "0.4",
    minPriceNear: MIN_PRICE_NEAR,
    status: "countered",
    counterNear: MIN_PRICE_NEAR,
    reasoning: "test",
    steps: [],
    report: null,
    reportNote: "",
    createdAt: new Date().toISOString(),
    ...over,
  };
}

// Negotiation: offer below minimum -> exactly one counter at min price.
{
  const job = negotiate("NEAR staking", "0.4", "research.emoi.testnet");
  assert.equal(job.status, "countered");
  assert.equal(job.counterNear, MIN_PRICE_NEAR);
  assert.ok(job.reasoning?.includes(DATA_COST_NEAR));
  assert.ok(job.reasoning?.includes(COMPUTE_COST_NEAR));
}
// Negotiation: offer at/above minimum -> accepted directly, no counter.
{
  const job = negotiate("NEAR staking", "1.0", "research.emoi.testnet");
  assert.equal(job.status, "accepted-direct");
  assert.equal(job.counterNear, undefined);
  const job2 = negotiate("NEAR staking", "2.5", "research.emoi.testnet");
  assert.equal(job2.status, "accepted-direct");
}
// Negotiation: invalid offer and empty topic throw, never start a job.
{
  assert.throws(() => negotiate("NEAR staking", "-1", "research.emoi.testnet"));
  assert.throws(() => negotiate("NEAR staking", "abc", "research.emoi.testnet"));
  assert.throws(() => negotiate("   ", "0.4", "research.emoi.testnet"));
}
// Run: both vendor payments succeed -> completed with report.
{
  const calls: Array<{ recipient: string; amountNear: string }> = [];
  const done = await runResearch(baseJob({ status: "accepted", decision: "accept" }), {
    pay: async (recipient, amountNear) => {
      calls.push({ recipient, amountNear });
      return { status: "success", recipient, amountNear, txHash: "mock-tx", intentLine: "mock" };
    },
    report: async () => "Mock report.",
  });
  assert.equal(done.status, "completed");
  assert.equal(calls.length, 2);
  assert.equal(calls[0].recipient, "emoi02.testnet");
  assert.equal(calls[0].amountNear, DATA_COST_NEAR);
  assert.equal(calls[1].recipient, "emoi01.testnet");
  assert.equal(calls[1].amountNear, COMPUTE_COST_NEAR);
  assert.equal(done.report, "Mock report.");
}
// Run: first payment rejected -> fail-fast, second vendor never paid.
{
  const calls: string[] = [];
  const done = await runResearch(baseJob({ status: "accepted", decision: "accept" }), {
    pay: async (recipient, amountNear) => {
      calls.push(recipient);
      return { status: "rejected", recipient, amountNear, reason: "ExceedsDailyLimit", intentLine: "mock" };
    },
    report: async () => "should not be generated",
  });
  assert.equal(done.status, "failed");
  assert.equal(calls.length, 1);
  assert.equal(done.report, null);
}
// Run: payments succeed but report unavailable -> completed with null
// report and an honest note (payments are NOT undone).
{
  const done = await runResearch(baseJob({ status: "accepted", decision: "accept" }), {
    pay: async (recipient, amountNear) => ({
      status: "success",
      recipient,
      amountNear,
      txHash: "mock-tx",
      intentLine: "mock",
    }),
    report: async () => null,
  });
  assert.equal(done.status, "completed");
  assert.equal(done.report, null);
  assert.ok(done.reportNote.includes("still happened"));
}

console.log("research tests pass");
