// demo:valid (T2.6). One command, deterministic parser-only by default.
// --json prints only JSON. --llm uses the NEAR AI Cloud layer (if a key
// is set); the output still passes the same deterministic parser and
// the same pre-signing re-validation before any signing.
// Exit 0 on a real success (real tx hash), exit 1 on a rejection.
import { processIntent } from "../src/service.js";

const asJson = process.argv.includes("--json");
const useLlm = process.argv.includes("--llm");

const result = await processIntent({
  text: "send 0.5 NEAR to emoi01.testnet",
  useLlm,
  source: useLlm ? "llm" : "parser",
});

if (asJson) {
  console.log(JSON.stringify({ mode: useLlm ? "llm" : "parser", ...result }, null, 2));
} else {
  console.log(result.intentLine);
  console.log(JSON.stringify(result, null, 2));
}
process.exit(result.status === "success" ? 0 : 1);
