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

// Demo vendors are labels for whitelisted accounts, not a vendor system:
// there is no vendor registry, onboarding, or billing integration. The
// contract whitelist — not this list — decides whether a payment passes.
export const DEMO_VENDORS = [
  { account: "emoi01.testnet", role: "API/compute provider" },
  { account: "emoi02.testnet", role: "data provider" },
] as const;

export function vendorLabel(account: string): string | null {
  return DEMO_VENDORS.find((v) => v.account === account)?.role ?? null;
}

export function vendorRole(recipient: string): string {
  return vendorLabel(recipient) ?? "vendor";
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
