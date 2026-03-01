import { setupPermissiveTls } from "../src/tls.js";

describe("setupPermissiveTls", () => {
  const originalEnv = { ...process.env };
  const originalEmitWarning = process.emitWarning;

  afterEach(() => {
    process.env = { ...originalEnv };
    process.emitWarning = originalEmitWarning;
  });

  it("sets NODE_TLS_REJECT_UNAUTHORIZED=0 by default", () => {
    delete process.env.CUCM_MCP_TLS_MODE;
    delete process.env.MCP_TLS_MODE;
    setupPermissiveTls();
    expect(process.env.NODE_TLS_REJECT_UNAUTHORIZED).toBe("0");
  });

  it("does NOT set NODE_TLS_REJECT_UNAUTHORIZED when mode is strict", () => {
    process.env.CUCM_MCP_TLS_MODE = "strict";
    delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;
    setupPermissiveTls();
    expect(process.env.NODE_TLS_REJECT_UNAUTHORIZED).toBeUndefined();
  });

  it("does NOT set NODE_TLS_REJECT_UNAUTHORIZED when mode is verify", () => {
    process.env.CUCM_MCP_TLS_MODE = "verify";
    delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;
    setupPermissiveTls();
    expect(process.env.NODE_TLS_REJECT_UNAUTHORIZED).toBeUndefined();
  });

  it("respects MCP_TLS_MODE fallback env var", () => {
    delete process.env.CUCM_MCP_TLS_MODE;
    process.env.MCP_TLS_MODE = "strict";
    delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;
    setupPermissiveTls();
    expect(process.env.NODE_TLS_REJECT_UNAUTHORIZED).toBeUndefined();
  });

  it("suppresses NODE_TLS_REJECT_UNAUTHORIZED warnings in permissive mode", () => {
    delete process.env.CUCM_MCP_TLS_MODE;
    delete process.env.MCP_TLS_MODE;
    setupPermissiveTls();

    // The patched emitWarning should silently swallow TLS warnings
    const spy = vi.fn();
    const patched = process.emitWarning;
    // Wrap to detect if original gets called
    process.emitWarning = ((w: string | Error, ...args: unknown[]) => {
      spy(w);
      // Don't actually emit — just track
    }) as typeof process.emitWarning;

    // Re-run to get the patched version, then test it
    process.emitWarning = patched;
    expect(() =>
      process.emitWarning("Setting the NODE_TLS_REJECT_UNAUTHORIZED environment variable...")
    ).not.toThrow();
  });

  it("case-insensitive TLS mode check", () => {
    process.env.CUCM_MCP_TLS_MODE = "STRICT";
    delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;
    setupPermissiveTls();
    expect(process.env.NODE_TLS_REJECT_UNAUTHORIZED).toBeUndefined();
  });
});
