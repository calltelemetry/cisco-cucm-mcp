import { test, expect } from "vitest";
import type { Server } from "node:http";
import { startSseServer } from "../src/sse.js";
import { SERVER_VERSION } from "../src/server.js";

test("SSE Server: responds 200 OK to /healthz and /health", async () => {
  const server: Server = await startSseServer({
    port: 0, // OS-assigned free port
    host: "127.0.0.1",
  });

  try {
    const address = server.address();
    expect(typeof address === "object" && address !== null).toBe(true);
    if (!address || typeof address !== "object") return;
    const baseUrl = `http://127.0.0.1:${address.port}`;

    // Test /healthz
    const resHealthz = await fetch(`${baseUrl}/healthz`);
    expect(resHealthz.status).toBe(200);
    const dataHealthz = (await resHealthz.json()) as { status: string; service: string; version: string };
    expect(dataHealthz.status).toBe("ok");
    expect(dataHealthz.service).toBe("cisco-cucm-mcp");
    expect(dataHealthz.version).toBe(SERVER_VERSION);

    // Test /health
    const resHealth = await fetch(`${baseUrl}/health`);
    expect(resHealth.status).toBe(200);
    const dataHealth = (await resHealth.json()) as { status: string };
    expect(dataHealth.status).toBe("ok");

    // Test 404
    const res404 = await fetch(`${baseUrl}/unknown-path`);
    expect(res404.status).toBe(404);

    // Test /messages without session
    const resMessages = await fetch(`${baseUrl}/messages?sessionId=nonexistent`, {
      method: "POST",
      body: JSON.stringify({}),
    });
    expect(resMessages.status).toBe(404);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
