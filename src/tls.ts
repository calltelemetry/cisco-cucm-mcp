/**
 * Shared TLS configuration for CUCM self-signed certificate handling.
 *
 * CUCM lab/dev environments commonly use self-signed certificates.
 * Call `setupPermissiveTls()` once at startup (from index.ts) to accept them.
 * Set CUCM_MCP_TLS_MODE=strict to enforce certificate verification.
 */

export function setupPermissiveTls(): void {
  const tlsMode = (process.env.CUCM_MCP_TLS_MODE || process.env.MCP_TLS_MODE || "").toLowerCase();
  const strictTls = tlsMode === "strict" || tlsMode === "verify";
  if (!strictTls) {
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
    // Silence Node's one-time TLS warning — we set this intentionally for CUCM self-signed certs
    const _ew = process.emitWarning.bind(process);
    process.emitWarning = ((w: string | Error, ...a: unknown[]) => {
      if (String(typeof w === "string" ? w : w?.message ?? "").includes("NODE_TLS_REJECT_UNAUTHORIZED")) return;
      _ew(w, ...(a as [string]));
    }) as typeof process.emitWarning;
  }
}
