// Shared FCK picker (P2). Finds an agent's single-method Function Call Key
// by ON-CHAIN scope (receiver + method names) via RPC, then reads the
// matching private key from the local legacy keychain. Never guesses by
// folder order: when several FCKs exist, the one with the highest remaining
// allowance wins (a reissued key supersedes an exhausted one). Throws with
// a clear message when no scoped key exists on-chain or its key file is
// missing — callers must not silently fall back to another key.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { config } from "./config.js";

const RPC_URLS = {
  testnet: "https://rpc.testnet.near.org",
  mainnet: "https://rpc.mainnet.near.org",
} as const;

export interface FckKey {
  publicKey: string;
  privateKey: string;
  allowanceYocto: string;
}

export async function fckPrivateKeyFor(
  agentId: string,
  opts?: { contractId?: string; method?: string },
): Promise<FckKey> {
  const contractId = opts?.contractId ?? config.policyContractId;
  const method = opts?.method ?? "agent_transfer";
  const rpc = RPC_URLS[config.network as keyof typeof RPC_URLS] ?? RPC_URLS.testnet;
  const res = await fetch(rpc, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal: AbortSignal.timeout(15000),
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: "emoi-fck-picker",
      method: "query",
      params: {
        request_type: "view_access_key_list",
        account_id: agentId,
        finality: "final",
      },
    }),
  });
  const data = (await res.json()) as {
    error?: { message?: string };
    result?: { keys?: Array<{ public_key?: string; access_key?: { permission?: unknown } }> };
  };
  if (data.error) throw new Error(`key list for ${agentId} failed: ${data.error.message ?? "RPC error"}`);
  const keys = data.result?.keys ?? [];
  let best: { pub: string; allowance: bigint } | null = null;
  for (const k of keys) {
    const perm = k.access_key?.permission as
      | string
      | { FunctionCall?: { allowance?: string; receiver_id?: string; method_names?: string[] } }
      | undefined;
    if (typeof perm !== "object" || perm === null) continue;
    const fc = perm.FunctionCall;
    if (!fc || fc.receiver_id !== contractId) continue;
    if (!Array.isArray(fc.method_names) || fc.method_names.length !== 1 || fc.method_names[0] !== method) continue;
    const allowance = fc.allowance ? BigInt(fc.allowance) : 0n;
    if (!best || allowance > best.allowance) best = { pub: k.public_key ?? "", allowance };
  }
  if (!best || !best.pub) throw new Error(`no ${method}-only FCK on ${contractId} found on-chain for ${agentId}`);
  const bare = best.pub.replace(/^ed25519:/, "");
  const file = path.join(os.homedir(), ".near-credentials", config.network, agentId, `ed25519_${bare}.json`);
  if (!fs.existsSync(file)) throw new Error(`on-chain FCK ${best.pub} for ${agentId} has no local key file at ${file}`);
  const keyData = JSON.parse(fs.readFileSync(file, "utf-8")) as { private_key?: string };
  if (!keyData.private_key) throw new Error(`key file ${file} has no private_key`);
  return { publicKey: best.pub, privateKey: keyData.private_key, allowanceYocto: best.allowance.toString() };
}