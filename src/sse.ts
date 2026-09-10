#!/usr/bin/env node

/**
 * Cisco CUCM MCP Server (cisco-cucm-mcp) HTTP/SSE Server
 *
 * Exposes the SSE transport interface and healthcheck endpoints for
 * in-cluster containerized execution under Kubernetes / Bifrost Gateway.
 */

import http from "node:http";
import { fileURLToPath } from "node:url";
import { realpathSync } from "node:fs";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { createMcpServer, SERVER_NAME, SERVER_VERSION } from "./server.js";

const DEFAULT_PORT = parseInt(process.env.PORT || "8009", 10);
const DEFAULT_HOST = process.env.HOST || "0.0.0.0";

export interface SseServerOptions {
  port?: number;
  host?: string;
}

export async function startSseServer(options: SseServerOptions = {}): Promise<http.Server> {
  const port = options.port ?? DEFAULT_PORT;
  const host = options.host ?? DEFAULT_HOST;

  const transports = new Map<string, SSEServerTransport>();

  const httpServer = http.createServer((req, res) => {
    void (async () => {
      const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);

      // CORS headers
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, x-session-id");

      if (req.method === "OPTIONS") {
        res.writeHead(204);
        res.end();
        return;
      }

      if (url.pathname === "/healthz" || url.pathname === "/health") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            status: "ok",
            service: SERVER_NAME,
            version: SERVER_VERSION,
            transport: "sse",
            uptime: process.uptime(),
          })
        );
        return;
      }

      if (url.pathname === "/sse" && req.method === "GET") {
        const transport = new SSEServerTransport("/messages", res);
        const sessionId = transport.sessionId;
        transports.set(sessionId, transport);

        const server = createMcpServer();

        res.on("close", () => {
          transports.delete(sessionId);
          void server.close().catch(() => {});
        });

        await server.connect(transport);
        return;
      }

      if (url.pathname === "/messages" && req.method === "POST") {
        const sessionId = url.searchParams.get("sessionId");
        const transport = sessionId ? transports.get(sessionId) : undefined;
        if (!transport) {
          res.writeHead(404, { "Content-Type": "text/plain" });
          res.end("Session not found");
          return;
        }
        await transport.handlePostMessage(req, res);
        return;
      }

      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("Not Found");
    })().catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[${SERVER_NAME}] SSE request error: ${message}`);
      if (!res.headersSent) {
        res.writeHead(500, { "Content-Type": "text/plain" });
        res.end("Internal Server Error");
      }
    });
  });

  const cleanup = () => {
    httpServer.close(() => {
      process.exit(0);
    });
  };
  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);

  return new Promise<http.Server>((resolve, reject) => {
    httpServer.on("error", reject);
    httpServer.listen(port, host, () => {
      console.error(`[${SERVER_NAME}] SSE server listening on ${host}:${port}`);
      resolve(httpServer);
    });
  });
}

function isDirectExecution(argvEntry: string | undefined, importMetaUrl: string): boolean {
  if (!argvEntry) return false;
  try {
    const currentFilePath = fileURLToPath(importMetaUrl);
    const entryPath = realpathSync(argvEntry);
    return entryPath === currentFilePath;
  } catch {
    return argvEntry.endsWith("/sse.js") || argvEntry.endsWith("/sse.ts");
  }
}

if (isDirectExecution(process.argv[1], import.meta.url)) {
  startSseServer().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[${SERVER_NAME}] Fatal SSE startup error: ${message}`);
    process.exit(1);
  });
}
