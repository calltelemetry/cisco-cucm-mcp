#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import {
  listNodeServiceLogs,
  selectLogs,
  selectLogsMinutes,
  getOneFile,
  getOneFileAnyWithRetry,
  writeDownloadedFile,
  type DimeAuth,
} from "./dime.js";
import { guessTimezoneString } from "./time.js";
import { PacketCaptureManager, type SshAuth } from "./packetCapture.js";
import { defaultStateStore } from "./state.js";

// Default to accepting self-signed/invalid certs (common on CUCM lab/dev).
// Opt back into strict verification with CUCM_MCP_TLS_MODE=strict.
const tlsMode = (process.env.CUCM_MCP_TLS_MODE || process.env.MCP_TLS_MODE || "").toLowerCase();
const strictTls = tlsMode === "strict" || tlsMode === "verify";
// Default: permissive TLS (accept self-signed). This is the common CUCM lab posture.
// Set CUCM_MCP_TLS_MODE=strict to enforce verification.
if (!strictTls) process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

const server = new McpServer({ name: "cucm", version: "0.1.4" });
const captures = new PacketCaptureManager();
const captureState = defaultStateStore();

const dimeAuthSchema = z
  .object({
    username: z.string().optional(),
    password: z.string().optional(),
  })
  .optional();

const sshAuthSchema = z
  .object({
    username: z.string().optional(),
    password: z.string().optional(),
  })
  .optional();

server.tool(
  "guess_timezone_string",
  "Build a best-effort DIME timezone string for selectLogFiles.",
  {},
  async () => ({
    content: [{ type: "text", text: JSON.stringify({ timezone: guessTimezoneString(new Date()) }, null, 2) }],
  })
);

server.tool(
  "list_node_service_logs",
  "List CUCM cluster nodes and their available service logs (DIME listNodeServiceLogs).",
  {
    host: z.string(),
    port: z.number().int().min(1).max(65535).optional(),
    auth: dimeAuthSchema,
  },
  async ({ host, port, auth }) => {
    const result = await listNodeServiceLogs(host, auth as DimeAuth | undefined, port);
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  }
);

server.tool(
  "select_logs",
  "List log/trace files using DIME selectLogFiles. Supports ServiceLogs and SystemLogs.",
  {
    host: z.string(),
    port: z.number().int().min(1).max(65535).optional(),
    auth: dimeAuthSchema,
    serviceLogs: z.array(z.string()).optional().describe("ServiceLogs selections"),
    systemLogs: z.array(z.string()).optional().describe("SystemLogs selections"),
    searchStr: z.string().optional().describe("Optional filename substring filter"),
    fromDate: z.string(),
    toDate: z.string(),
    timezone: z.string(),
  },
  async ({ host, port, auth, serviceLogs, systemLogs, searchStr, fromDate, toDate, timezone }) => {
    const result = await selectLogs(
      host,
      { serviceLogs, systemLogs, searchStr, fromDate, toDate, timezone },
      auth as DimeAuth | undefined,
      port
    );
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  }
);

server.tool(
  "select_logs_minutes",
  "Convenience wrapper: select logs using a minutes-back window.",
  {
    host: z.string(),
    port: z.number().int().min(1).max(65535).optional(),
    auth: dimeAuthSchema,
    minutesBack: z.number().int().min(1).max(60 * 24 * 30),
    serviceLogs: z.array(z.string()).optional(),
    systemLogs: z.array(z.string()).optional(),
    searchStr: z.string().optional(),
    timezone: z.string().optional(),
  },
  async ({ host, port, auth, minutesBack, serviceLogs, systemLogs, searchStr, timezone }) => {
    const result = await selectLogsMinutes(
      host,
      minutesBack,
      { serviceLogs, systemLogs, searchStr },
      timezone,
      auth as DimeAuth | undefined,
      port
    );
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  }
);

server.tool(
  "select_syslog_minutes",
  "Convenience wrapper: select system log files (e.g. Syslog) using a minutes-back window.",
  {
    host: z.string(),
    port: z.number().int().min(1).max(65535).optional(),
    auth: dimeAuthSchema,
    minutesBack: z.number().int().min(1).max(60 * 24 * 30),
    systemLog: z
      .string()
      .optional()
      .describe("System log selection name. Default is 'Syslog' (may vary by CUCM version)."),
    searchStr: z.string().optional(),
    timezone: z.string().optional(),
  },
  async ({ host, port, auth, minutesBack, systemLog, searchStr, timezone }) => {
    const result = await selectLogsMinutes(
      host,
      minutesBack,
      { systemLogs: [systemLog || "Syslog"], searchStr },
      timezone,
      auth as DimeAuth | undefined,
      port
    );
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  }
);

server.tool(
  "download_file",
  "Download a single file via DIME GetOneFile and write it to disk.",
  {
    host: z.string(),
    port: z.number().int().min(1).max(65535).optional(),
    auth: dimeAuthSchema,
    filePath: z.string().min(1).describe("Absolute path on CUCM"),
    outFile: z.string().optional().describe("Optional output path. Default: /tmp/cucm-mcp/<basename>"),
  },
  async ({ host, port, auth, filePath, outFile }) => {
    const dl = await getOneFile(host, filePath, auth as DimeAuth | undefined, port);
    const saved = writeDownloadedFile(dl, outFile);
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({ server: dl.server, sourcePath: dl.filename, savedPath: saved.filePath, bytes: saved.bytes }, null, 2),
        },
      ],
    };
  }
);

server.tool(
  "packet_capture_start",
  "Start a packet capture on CUCM via SSH (utils network capture). Returns a captureId.",
  {
    host: z.string().describe("CUCM host/IP"),
    sshPort: z.number().int().min(1).max(65535).optional(),
    auth: sshAuthSchema,
    iface: z.string().optional().describe("Interface (default eth0)"),
    fileBase: z.string().optional().describe("Capture base name (no dots). Saved as <fileBase>.cap"),
    count: z.number().int().min(1).max(1_000_000).optional().describe("Packet count (common max is 1000000)"),
    maxPackets: z
      .boolean()
      .optional()
      .describe("If true and count is omitted, uses a high capture count (1,000,000)"),
    size: z.string().optional().describe("Packet size (e.g. all)"),
    hostFilterIp: z.string().optional().describe("Optional filter: host ip <addr>"),
    portFilter: z.number().int().min(1).max(65535).optional().describe("Optional filter: port <num>"),
    maxDurationMs: z
      .number()
      .int()
      .min(250)
      .max(24 * 60 * 60_000)
      .optional()
      .describe("Stop after this duration even if packet count isn't reached"),
    startTimeoutMs: z
      .number()
      .int()
      .min(2000)
      .max(120_000)
      .optional()
      .describe("Timeout for starting capture (SSH connect + command start)"),
  },
  async ({ host, sshPort, auth, iface, fileBase, count, maxPackets, size, hostFilterIp, portFilter, maxDurationMs, startTimeoutMs }) => {
    const resolvedCount = count ?? (maxPackets ? 1_000_000 : undefined);
    const result = await captures.start({
      host,
      sshPort,
      auth: auth as SshAuth | undefined,
      iface,
      fileBase,
      count: resolvedCount,
      size,
      hostFilterIp,
      portFilter,
      maxDurationMs,
      startTimeoutMs,
    });
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  }
);

server.tool(
  "packet_capture_list",
  "List active packet captures started by this MCP server.",
  {},
  async () => ({ content: [{ type: "text", text: JSON.stringify(captures.list(), null, 2) }] })
);

server.tool(
  "packet_capture_state_list",
  "List packet captures from the local state file (survives MCP restarts).",
  {},
  async () => {
    const pruned = captureState.pruneExpired(captureState.load());
    captureState.save(pruned);
    const items = Object.values(pruned.captures).sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
    return { content: [{ type: "text", text: JSON.stringify({ path: captureState.path, captures: items }, null, 2) }] };
  }
);

server.tool(
  "packet_capture_state_get",
  "Get a packet capture record from the local state file.",
  {
    captureId: z.string().min(1),
  },
  async ({ captureId }) => {
    const pruned = captureState.pruneExpired(captureState.load());
    const rec = pruned.captures[captureId];
    if (!rec) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ path: captureState.path, found: false, captureId }, null, 2),
          },
        ],
      };
    }
    return { content: [{ type: "text", text: JSON.stringify({ path: captureState.path, found: true, record: rec }, null, 2) }] };
  }
);

server.tool(
  "packet_capture_state_clear",
  "Delete a capture record from the local state file.",
  {
    captureId: z.string().min(1),
  },
  async ({ captureId }) => {
    captureState.remove(captureId);
    return { content: [{ type: "text", text: JSON.stringify({ removed: true, captureId }, null, 2) }] };
  }
);

server.tool(
  "packet_capture_stop",
  "Stop a packet capture by captureId (sends Ctrl-C).",
  {
    captureId: z.string().min(1),
    timeoutMs: z.number().int().min(1000).max(10 * 60_000).optional().describe("How long to wait for stop (default ~90s)"),
  },
  async ({ captureId, timeoutMs }) => {
    const result = await captures.stop(captureId, timeoutMs);
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  }
);

server.tool(
  "packet_capture_stop_and_download",
  "Stop a packet capture and download the resulting .cap file via DIME.",
  {
    captureId: z.string().min(1),
    dimePort: z.number().int().min(1).max(65535).optional(),
    auth: dimeAuthSchema.describe("DIME auth (optional; defaults to CUCM_DIME_USERNAME/CUCM_DIME_PASSWORD)"),
    outFile: z.string().optional().describe("Optional output path for the downloaded .cap file"),
    stopTimeoutMs: z.number().int().min(1000).max(10 * 60_000).optional().describe("How long to wait for SSH capture stop"),
    downloadTimeoutMs: z
      .number()
      .int()
      .min(1000)
      .max(10 * 60_000)
      .optional()
      .describe("How long to wait for the capture file to appear in DIME"),
    downloadPollIntervalMs: z
      .number()
      .int()
      .min(250)
      .max(30_000)
      .optional()
      .describe("How often to retry DIME GetOneFile when the file isn't there yet"),
  },
  async ({ captureId, dimePort, auth, outFile, stopTimeoutMs, downloadTimeoutMs, downloadPollIntervalMs }) => {
    const stopped = await captures.stop(captureId, stopTimeoutMs);
    const candidates = (stopped.remoteFileCandidates || []).length
      ? stopped.remoteFileCandidates
      : [stopped.remoteFilePath];

    const dl = await getOneFileAnyWithRetry(stopped.host, candidates, {
      auth: auth as DimeAuth | undefined,
      port: dimePort,
      timeoutMs: downloadTimeoutMs,
      pollIntervalMs: downloadPollIntervalMs,
    });
    const saved = writeDownloadedFile(dl, outFile);
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              captureId: stopped.id,
              host: stopped.host,
              remoteFilePath: dl.filename,
              stopTimedOut: stopped.stopTimedOut || false,
              savedPath: saved.filePath,
              bytes: saved.bytes,
              dimeAttempts: dl.attempts,
              dimeWaitedMs: dl.waitedMs,
            },
            null,
            2
          ),
        },
      ],
    };
  }
);

server.tool(
  "packet_capture_download_from_state",
  "Download a capture file using the local state record (useful after MCP restart).",
  {
    captureId: z.string().min(1),
    dimePort: z.number().int().min(1).max(65535).optional(),
    auth: dimeAuthSchema.describe("DIME auth (optional; defaults to CUCM_DIME_USERNAME/CUCM_DIME_PASSWORD)"),
    outFile: z.string().optional().describe("Optional output path for the downloaded .cap file"),
    downloadTimeoutMs: z
      .number()
      .int()
      .min(1000)
      .max(10 * 60_000)
      .optional()
      .describe("How long to wait for the capture file to appear in DIME"),
    downloadPollIntervalMs: z
      .number()
      .int()
      .min(250)
      .max(30_000)
      .optional()
      .describe("How often to retry DIME GetOneFile when the file isn't there yet"),
  },
  async ({ captureId, dimePort, auth, outFile, downloadTimeoutMs, downloadPollIntervalMs }) => {
    const pruned = captureState.pruneExpired(captureState.load());
    const rec = pruned.captures[captureId];
    if (!rec) throw new Error(`Capture not found in state: ${captureId}`);

    const dl = await getOneFileAnyWithRetry(rec.host, rec.remoteFileCandidates?.length ? rec.remoteFileCandidates : [rec.remoteFilePath], {
      auth: auth as DimeAuth | undefined,
      port: dimePort,
      timeoutMs: downloadTimeoutMs,
      pollIntervalMs: downloadPollIntervalMs,
    });
    const saved = writeDownloadedFile(dl, outFile);
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              captureId,
              host: rec.host,
              remoteFilePath: dl.filename,
              savedPath: saved.filePath,
              bytes: saved.bytes,
              dimeAttempts: dl.attempts,
              dimeWaitedMs: dl.waitedMs,
            },
            null,
            2
          ),
        },
      ],
    };
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);
