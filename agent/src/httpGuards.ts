// Pure HTTP guards for the local agent service (audited 2026-11-08).
// The service is a local-demo tool: it binds loopback only and accepts
// browser origins from loopback only. Kept pure (no imports) so unit
// tests cover the guards without booting the server.

/** True only for http(s) origins on localhost / 127.0.0.1 (any port). */
export function isLocalhostOrigin(origin: string): boolean {
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return false;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return false;
  return url.hostname === "localhost" || url.hostname === "127.0.0.1";
}

/**
 * POST /transfer signs with the configured agent FCK, so the views agent
 * must be that same agent. Anything else is a 400: signing for one agent
 * while validating for another must never happen silently.
 */
export function resolveTransferAgent(
  requested: string | undefined,
  configured: string,
): string {
  if (requested === undefined || requested === configured) return configured;
  throw new Error(
    `transfer agent mismatch: this service signs only for ${configured}`,
  );
}

/** Strip the operator home dir from error text before serving it. */
export function sanitizeErrorForHttp(message: string, homeDir: string): string {
  if (!homeDir) return message;
  return message.split(homeDir).join("~");
}