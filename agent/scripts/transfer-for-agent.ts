// Transfer for a specific agent (T2.9 helper, also useful for any
// agent other than the configured default). Reads the agent's FCK
// from a key file (the legacy keychain JSON for that agent's FCK),
// never prints the key, and runs the same processIntent path as
// demo:valid: parser -> fresh views -> validateBeforeSigning -> signer.
// Usage:
//   tsx scripts/transfer-for-agent.ts --agent demo2.emoi.testnet \
//     --key-file ~/.near-credentials/testnet/demo2.emoi.testnet/ed25519_<pub>.json \
//     --text "send 0.5 NEAR to emoi01.testnet" [--json]
import { Near } from "near-kit";
import fs from "node:fs";
import { processIntent } from "../src/service.js";
import { config } from "../src/config.js";
import { extractTxHash } from "../src/nearClient.js";

function argValue(name: string): string | undefined {
  const idx = process.argv.indexOf(name);
  return idx >= 0 ? process.argv[idx + 1] : undefined;
}

const agentId = argValue("--agent");
const keyFile = argValue("--key-file");
const text = argValue("--text") ?? "send 0.5 NEAR to emoi01.testnet";
if (!agentId || !keyFile) {
  console.error("Usage: --agent <id> --key-file <fck key json> [--text <intent>] [--json]");
  process.exit(1);
}
const keyData = JSON.parse(fs.readFileSync(keyFile, "utf-8")) as { private_key: string };
const near = new Near({
  network: config.network,
  privateKey: keyData.private_key as `ed25519:${string}`,
  defaultSignerId: agentId,
});
const signer = async (recipient: string, amountYocto: bigint) => {
  return near.call(
    config.policyContractId,
    "agent_transfer",
    { recipient, amount: amountYocto.toString() },
    { gas: "100 Tgas", attachedDeposit: "0 NEAR" },
  );
};
const result = await processIntent({
  text,
  useLlm: false,
  agentAccountId: agentId,
  signer,
  source: "parser",
});
console.log(JSON.stringify(result, null, 2));
process.exit(result.status === "success" ? 0 : 1);
