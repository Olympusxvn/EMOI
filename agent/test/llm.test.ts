// LLM harness tests (1a/1b/1c). Fully offline: resolveLlmIntent takes an
// injected mock, so no network, no keys, no chain, no signer involved.
import assert from "node:assert";
import { resolveLlmIntent } from "../src/service.js";
import { parseIntent, type ParseResult } from "../src/parser.js";

let failures = 0;
function mockLlm(result: ParseResult | null) {
  let calls = 0;
  const fn = async (_text: string): Promise<ParseResult | null> => {
    calls++;
    return result;
  };
  return { fn, calls: () => calls };
}
async function check(name: string, fn: () => Promise<void> | void) {
  try {
    await fn();
    console.log(`ok - ${name}`);
  } catch (e) {
    failures++;
    console.error(`FAIL - ${name}:`, e);
  }
}

await check("1a-multi-recipient-rejected-before-llm", async () => {
  const m = mockLlm(parseIntent("send 1 NEAR to emoi01.testnet"));
  const r = await resolveLlmIntent(
    "send 1 NEAR to emoi01.testnet and 1 NEAR to emoi02.testnet",
    m.fn,
  );
  assert.equal(r.ok, false);
  assert.equal(m.calls(), 0);
});

await check("1a-multi-amount-rejected-before-llm", async () => {
  const m = mockLlm(parseIntent("send 0.5 NEAR to emoi01.testnet"));
  const r = await resolveLlmIntent(
    "send 0.5 NEAR to emoi01.testnet or send 1 NEAR to emoi01.testnet",
    m.fn,
  );
  assert.equal(r.ok, false);
  assert.equal(m.calls(), 0);
});

await check("1a-same-amount-spellings-count-as-one", async () => {
  const m = mockLlm(parseIntent("send 0.5 NEAR to emoi01.testnet"));
  const r = await resolveLlmIntent(
    "send 0.5 NEAR to emoi01.testnet or send 0.50 NEAR to emoi01.testnet",
    m.fn,
  );
  assert.equal(r.ok, true);
  assert.equal(m.calls(), 1);
});

await check("1b-missing-llm-result-is-failure", async () => {
  const m = mockLlm(null);
  const r = await resolveLlmIntent("send 0.5 NEAR to emoi01.testnet", m.fn);
  assert.equal(r.ok, false);
  assert.equal(m.calls(), 1);
});

await check("1c-hallucinated-recipient-rejected", async () => {
  const m = mockLlm(parseIntent("send 0.5 NEAR to emoi02.testnet"));
  const r = await resolveLlmIntent("send 0.5 NEAR to emoi01.testnet", m.fn);
  assert.equal(r.ok, false);
});

await check("1c-hallucinated-amount-rejected", async () => {
  const m = mockLlm(parseIntent("send 9 NEAR to emoi01.testnet"));
  const r = await resolveLlmIntent("send 0.5 NEAR to emoi01.testnet", m.fn);
  assert.equal(r.ok, false);
});

await check("1c-grounded-intent-accepted", async () => {
  const m = mockLlm(parseIntent("send 0.5 NEAR to emoi01.testnet"));
  const r = await resolveLlmIntent("send 0.5 NEAR to emoi01.testnet", m.fn);
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.intent.recipient, "emoi01.testnet");
    assert.equal(r.intent.amountYocto, 500000000000000000000000n);
  }
});

if (failures > 0) {
  console.error(`${failures} llm test(s) failed`);
  process.exit(1);
}
console.log("llm tests: all passed");