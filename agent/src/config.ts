// Agent service configuration. Reads ONLY the agent FCK key and the
// optional NEAR AI Cloud key. The agent service NEVER reads the
// owner full key. Owner keys are used only by owner-operated
// scripts in scripts/.

import { config as loadDotenv } from "dotenv";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../..");
const envPath = path.join(repoRoot, ".env");
if (fs.existsSync(envPath)) {
  loadDotenv({ path: envPath });
}

export const config = {
  network: (process.env.NEAR_NETWORK ?? "testnet") as "testnet" | "mainnet",
  ownerAccountId: process.env.OWNER_ACCOUNT_ID ?? "emoi.testnet",
  policyContractId: process.env.POLICY_CONTRACT_ID ?? "policy.emoi.testnet",
  agentAccountId: process.env.AGENT_ACCOUNT_ID ?? "agent.emoi.testnet",
  agentFckPrivateKey: process.env.AGENT_FCK_PRIVATE_KEY ?? "",
  nearAiCloudApiKey: process.env.NEAR_AI_CLOUD_API_KEY ?? "",
  nearAiModel: process.env.NEAR_AI_MODEL ?? "deepseek-ai/DeepSeek-V3.1",
  activityLogPath: path.join(repoRoot, "activity.log"),
  repoRoot,
};

export function requireAgentFck(): string {
  if (!config.agentFckPrivateKey) {
    throw new Error(
      "AGENT_FCK_PRIVATE_KEY is not set in .env. Run the create-agent script first.",
    );
  }
  return config.agentFckPrivateKey;
}
