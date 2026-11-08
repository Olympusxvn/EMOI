// validateBeforeSigning: the single pre-signing re-validation layer.
// Used by BOTH the deterministic parser path and the LLM path.
// No signing path may bypass it. On any failure, the caller must NOT
// call any signing method and must NOT broadcast anything.
//
// Local order mirrors the contract (STRATEGY 9.2 / 9.21) and stops
// at the first failure:
//   1. Agent registered + Active (Paused / Revoked rejected)
//   2. Recipient in whitelist
//   3. Amount > 0
//   4. Amount <= max_per_tx
//   5. Amount <= remaining daily limit (lazy day reset mirrored)
//   6. Amount <= owner vault balance (PolicyVault, NOT the agent balance)
// FCK gas exhaustion is NOT a PolicyViolation; it is a gas error at
// signing time and is handled by the flag-gated reissue script.

export type AgentStatus = "Active" | "Paused" | "Revoked";

export interface Policy {
  max_per_tx: string; // yoctoNEAR, as a decimal string
  daily_limit: string;
  whitelist: string[];
  spent_today: string;
  current_day: number;
}

export interface AgentState {
  owner: string;
  status: AgentStatus;
}

export type PolicyViolation =
  | "AgentNotRegistered"
  | "AgentPaused"
  | "AgentRevoked"
  | "RecipientNotWhitelisted"
  | "InvalidAmount"
  | "ExceedsMaxPerTx"
  | "ExceedsDailyLimit"
  | "InsufficientVaultBalance";

export type ValidationResult =
  | { ok: true }
  | { ok: false; reason: PolicyViolation };

export function currentDayFromMs(ms: number): number {
  return Math.floor(ms / 86_400_000);
}

export function validateBeforeSigning(args: {
  agentState: AgentState | null;
  policy: Policy | null;
  vaultBalanceYocto: string;
  recipient: string;
  amountYocto: bigint;
  today: number;
}): ValidationResult {
  const { agentState, policy, vaultBalanceYocto, recipient, amountYocto, today } = args;
  if (!agentState || !policy) {
    return { ok: false, reason: "AgentNotRegistered" };
  }
  if (agentState.status === "Paused") {
    return { ok: false, reason: "AgentPaused" };
  }
  if (agentState.status === "Revoked") {
    return { ok: false, reason: "AgentRevoked" };
  }
  if (!policy.whitelist.includes(recipient)) {
    return { ok: false, reason: "RecipientNotWhitelisted" };
  }
  if (amountYocto <= 0n) {
    return { ok: false, reason: "InvalidAmount" };
  }
  if (amountYocto > BigInt(policy.max_per_tx)) {
    return { ok: false, reason: "ExceedsMaxPerTx" };
  }
  // Lazy day reset, mirrored from the contract.
  const spentToday =
    policy.current_day !== today ? 0n : BigInt(policy.spent_today);
  if (amountYocto > BigInt(policy.daily_limit) - spentToday) {
    return { ok: false, reason: "ExceedsDailyLimit" };
  }
  if (amountYocto > BigInt(vaultBalanceYocto)) {
    return { ok: false, reason: "InsufficientVaultBalance" };
  }
  return { ok: true };
}

/** Convert a decimal NEAR amount string ("0.5") to yoctoNEAR as bigint. */
export function nearToYocto(amountNear: string): bigint {
  const trimmed = amountNear.trim();
  if (!/^\d+(\.\d+)?$/.test(trimmed)) {
    throw new Error("ParseFailed");
  }
  const [whole, frac = ""] = trimmed.split(".");
  // No silent sub-yocto truncation: more than 24 decimals is a user
  // error, so fail closed instead of signing less than displayed.
  if (frac.length > 24) {
    throw new Error("ParseFailed");
  }
  const fracPadded = (frac + "0".repeat(24)).slice(0, 24);
  return BigInt(whole) * 10n ** 24n + BigInt(fracPadded || "0");
}

/** Convert yoctoNEAR (bigint or string) to a short NEAR string for display. */
export function yoctoToNear(yocto: bigint | string): string {
  const value = typeof yocto === "string" ? BigInt(yocto) : yocto;
  const whole = value / 10n ** 24n;
  const frac = value % 10n ** 24n;
  if (frac === 0n) return whole.toString();
  const fracStr = frac.toString().padStart(24, "0").replace(/0+$/, "");
  return `${whole}.${fracStr}`;
}
