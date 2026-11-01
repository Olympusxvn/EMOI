export const POLICY_CONTRACT_ID = "policy.emoi.testnet";
export const AGENT_SERVICE_URL = "http://localhost:3001";
export const KNOWN_AGENTS = ["agent.emoi.testnet", "demo2.emoi.testnet"];

export function yoctoToNear(yocto: string | bigint): string {
  const v = typeof yocto === "string" ? BigInt(yocto) : yocto;
  const whole = v / 10n ** 24n;
  const frac = v % 10n ** 24n;
  if (frac === 0n) return whole.toString();
  return `${whole}.${frac.toString().padStart(24, "0").replace(/0+$/, "")}`;
}

export function nearToYocto(amountNear: string): string {
  const [whole, frac = ""] = amountNear.trim().split(".");
  return (BigInt(whole) * 10n ** 24n + BigInt((frac + "0".repeat(24)).slice(0, 24) || "0")).toString();
}

export function vendorRole(recipient: string): string {
  if (recipient === "emoi01.testnet") return "API/compute provider";
  if (recipient === "emoi02.testnet") return "data provider";
  return "vendor";
}

export function nearBlocksAccountLink(accountId: string): string {
  return `https://explorer.testnet.near.org/accounts/${accountId}`;
}

export function nearBlocksTxLink(txHash: string): string {
  return `https://explorer.testnet.near.org/transactions/${txHash}`;
}

export function agentName(agentId: string): string {
  return agentId.replace(/\.emoi\.testnet$/, "");
}

export function slugify(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "agent";
}

export async function copyText(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    // Clipboard may be unavailable in some contexts; the ID is still
    // shown in full and selectable.
  }
}
