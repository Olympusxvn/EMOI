// Deterministic intent parser (T2.4).
// Accepts exactly one shape, in English:
//   send <amount> NEAR to <account>
// Anything else — ambiguous, extra recipients, extra amounts, missing
// parts — is ParseFailed. The parser never guesses a recipient, never
// guesses an amount, never reduces an amount to fit a limit, and never
// swaps a recipient to a whitelisted one. A policy failure is NOT a
// parse failure and must never be re-parsed to make it pass.

import { nearToYocto } from "./validation.js";

export interface ParsedIntent {
  recipient: string;
  amountNear: string;
  amountYocto: bigint;
}

export type ParseResult =
  | { ok: true; intent: ParsedIntent }
  | { ok: false; reason: "ParseFailed" };

const INTENT_RE =
  /^send\s+([0-9]+(?:\.[0-9]+)?)\s+NEAR\s+to\s+([a-z0-9][a-z0-9._-]*\.(?:testnet|near))$/i;

export function parseIntent(text: string): ParseResult {
  const cleaned = text.trim().replace(/\.$/, "");
  const match = INTENT_RE.exec(cleaned);
  if (!match) {
    return { ok: false, reason: "ParseFailed" };
  }
  const amountNear = match[1];
  const recipient = match[2].toLowerCase();
  try {
    const amountYocto = nearToYocto(amountNear);
    return { ok: true, intent: { recipient, amountNear, amountYocto } };
  } catch {
    return { ok: false, reason: "ParseFailed" };
  }
}
