#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { mkdirSync, writeFileSync } from "fs";
import { dirname, join } from "path";

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
import { applyPhone, updatePhonePacketCapture, axlExecute, type AxlAuth } from "./axl.js";

// Default to accepting self-signed/invalid certs (common on CUCM lab/dev).
// Opt back into strict verification with CUCM_MCP_TLS_MODE=strict.
const tlsMode = (process.env.CUCM_MCP_TLS_MODE || process.env.MCP_TLS_MODE || "").toLowerCase();
const strictTls = tlsMode === "strict" || tlsMode === "verify";
// Default: permissive TLS (accept self-signed). This is the common CUCM lab posture.
// Set CUCM_MCP_TLS_MODE=strict to enforce verification.
if (!strictTls) process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

const server = new McpServer({ name: "cucm", version: "0.1.8" });
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

const axlAuthSchema = z
  .object({
    username: z.string().optional(),
    password: z.string().optional(),
  })
  .optional();

function formatUnknownError(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === "string") return e;
  try {
    return JSON.stringify(e);
  } catch {
    return String(e);
  }
}

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
  "phone_packet_capture_enable",
  "Enable phone packet capture via CUCM AXL (updatePhone packetCaptureMode/Duration + applyPhone).",
  {
    host: z.string().describe("CUCM host/IP"),
    port: z.number().int().min(1).max(65535).optional().describe("AXL port (default 8443)"),
    axlVersion: z.string().optional().describe("AXL API version (default env CUCM_AXL_VERSION or 15.0)"),
    auth: axlAuthSchema.describe("AXL auth (optional; defaults to CUCM_AXL_USERNAME/CUCM_AXL_PASSWORD)"),
    deviceName: z.string().min(1).describe("Phone device name (e.g. SEP505C885DF37F)"),
    mode: z
      .string()
      .optional()
      .describe('packetCaptureMode value (commonly "Batch Processing Mode")'),
    durationSeconds: z
      .number()
      .int()
      .min(1)
      .max(60 * 60)
      .optional()
      .describe("packetCaptureDuration in seconds (default 60)"),
    apply: z.boolean().optional().describe("Run applyPhone after updatePhone (default true)"),
    timeoutMs: z.number().int().min(1000).max(5 * 60_000).optional().describe("AXL request timeout"),
  },
  async ({ host, port, axlVersion, auth, deviceName, mode, durationSeconds, apply, timeoutMs }) => {
    const update = await updatePhonePacketCapture(host, {
      deviceName,
      mode: mode || "Batch Processing Mode",
      durationSeconds: durationSeconds ?? 60,
      auth: auth as AxlAuth | undefined,
      port,
      version: axlVersion,
      timeoutMs,
    });

    const shouldApply = apply ?? true;
    const applied = shouldApply
      ? await applyPhone(host, {
          deviceName,
          auth: auth as AxlAuth | undefined,
          port,
          version: axlVersion,
          timeoutMs,
        })
      : undefined;

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              host: update.host,
              deviceName,
              packetCaptureMode: mode || "Batch Processing Mode",
              packetCaptureDuration: durationSeconds ?? 60,
              updatePhoneReturn: update.returnValue,
              applied: shouldApply,
              applyPhoneReturn: applied?.returnValue,
              notes: [
                "Phone may need to reset to pick up config.",
                "Place the call during the duration window; CUCM writes the capture to its TFTP directory (CUCM behavior/version dependent).",
              ],
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
  "axl_execute",
  "Execute an arbitrary CUCM AXL SOAP operation. " +
    "Accepts a JSON-ish data payload and converts it to XML. " +
    "Tip: for get* operations, returnedTags can be an array of strings (supports dotted paths like 'lines.line.dirn.pattern').",
  {
    operation: z.string().min(1).describe("AXL operation name, e.g. getPhone, updateLine, updateCtiRoutePoint"),
    data: z.any().optional().describe("Operation payload as an object. Keys become XML tags."),

    cucm_host: z.string().describe("CUCM host/IP"),
    cucm_port: z.number().int().min(1).max(65535).optional().describe("AXL port (default 8443)"),
    cucm_version: z.string().optional().describe("AXL API version (e.g. 15.0)"),
    cucm_username: z.string().optional().describe("AXL username (optional if env CUCM_AXL_USERNAME is set)"),
    cucm_password: z.string().optional().describe("AXL password (optional if env CUCM_AXL_PASSWORD is set)"),

    timeoutMs: z.number().int().min(1000).max(5 * 60_000).optional().describe("AXL request timeout"),
    includeRequestXml: z.boolean().optional().describe("Include SOAP request XML in response (debug)"),
    includeResponseXml: z.boolean().optional().describe("Include SOAP response XML in response (debug)"),
  },
  async ({
    operation,
    data,
    cucm_host,
    cucm_port,
    cucm_version,
    cucm_username,
    cucm_password,
    timeoutMs,
    includeRequestXml,
    includeResponseXml,
  }) => {
    const auth: AxlAuth | undefined =
      cucm_username && cucm_password ? { username: cucm_username, password: cucm_password } : undefined;

    try {
      const result = await axlExecute(cucm_host, {
        operation,
        data,
        auth,
        port: cucm_port,
        version: cucm_version,
        timeoutMs,
        includeRequestXml,
        includeResponseXml,
      });
      return { content: [{ type: "text", text: JSON.stringify({ ok: true, ...result }, null, 2) }] };
    } catch (e) {
      const msg = formatUnknownError(e);

      const guessGetOperation = (op: string): string | null => {
        const s = String(op || "").trim();
        if (!s) return null;
        const prefixes = ["update", "add", "remove", "set"] as const;
        for (const p of prefixes) {
          if (s.startsWith(p) && s.length > p.length) {
            return `get${s.slice(p.length)}`;
          }
        }
        return null;
      };

      const getOp = guessGetOperation(operation);

      const hints: string[] = [
        "If the error is opaque, retry with includeRequestXml=true and includeResponseXml=true to see the SOAP fault.",
        "For get* operations, try returnedTags as an array of strings (supports dotted paths).",
        "For update* operations, first run the corresponding get* to copy the exact nested shape and/or uuids.",
        "If you see schema/version errors, make sure cucm_version matches your CUCM AXL version (Help > About in CUCM).",
      ];
      if (/self-signed certificate|unable to verify|CERT/i.test(msg)) {
        hints.unshift(
          "TLS: this MCP defaults to permissive TLS, but your runtime may still be enforcing verification. Set CUCM_MCP_TLS_MODE=permissive (or MCP_TLS_MODE=permissive)."
        );
      }
      if (/401|403|auth/i.test(msg)) {
        hints.unshift(
          "Auth: verify AXL credentials and that the CUCM user has AXL permissions for this operation (AXL role/group)."
        );
      }
      if (/not found|does not exist|unknown/i.test(msg)) {
        hints.unshift(
          "Existence: confirm the target object exists by calling a get* operation first (e.g. getCtiRoutePoint/getLine)."
        );
      }

      const nextToolCalls = [
        ...(getOp
          ? [
              {
                tool: "axl_execute",
                args: {
                  operation: getOp,
                  cucm_host,
                  cucm_port,
                  cucm_version,
                  cucm_username,
                  cucm_password,
                  includeResponseXml: true,
                },
                note:
                  "Fetch the current object first (add an appropriate data payload, e.g. {name: \"...\"} or {uuid: \"...\"}) to learn nesting/uuid requirements.",
              },
            ]
          : []),
        {
          tool: "axl_execute",
          args: {
            operation,
            cucm_host,
            cucm_port,
            cucm_version,
            cucm_username,
            cucm_password,
            includeRequestXml: true,
            includeResponseXml: true,
          },
          note: "Re-run with debug XML included to capture the SOAP Fault details.",
        },
      ];

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                ok: false,
                error: true,
                message: msg,
                operation,
                cucm_host,
                hints,
                nextToolCalls,
              },
              null,
              2
            ),
          },
        ],
      };
    }
  }
);

server.tool(
  "axl_download_wsdl",
  "Download the CUCM AXL WSDL to a local file. Useful when you need schema hints for an operation.",
  {
    cucm_host: z.string().describe("CUCM host/IP"),
    cucm_port: z.number().int().min(1).max(65535).optional().describe("AXL port (default 8443)"),
    cucm_username: z.string().optional().describe("AXL username (optional if env CUCM_AXL_USERNAME is set)"),
    cucm_password: z.string().optional().describe("AXL password (optional if env CUCM_AXL_PASSWORD is set)"),
    outFile: z.string().optional().describe("Optional output file path (default /tmp/cucm-mcp/axl.wsdl)")
  },
  async ({ cucm_host, cucm_port, cucm_username, cucm_password, outFile }) => {
    const port = cucm_port ?? 8443;
    const user = cucm_username || process.env.CUCM_AXL_USERNAME || process.env.CUCM_USERNAME;
    const pass = cucm_password || process.env.CUCM_AXL_PASSWORD || process.env.CUCM_PASSWORD;
    if (!user || !pass) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                ok: false,
                error: true,
                message: "Missing AXL credentials (provide cucm_username/cucm_password or set CUCM_AXL_USERNAME/CUCM_AXL_PASSWORD)",
              },
              null,
              2
            ),
          },
        ],
      };
    }

    const url = `https://${cucm_host}:${port}/axl/?wsdl`;
    try {
      const res = await fetch(url, {
        headers: {
          Authorization: `Basic ${Buffer.from(`${user}:${pass}`, "utf8").toString("base64")}`,
          Accept: "application/xml, text/xml, */*",
        },
        signal: AbortSignal.timeout(30_000),
      });

      const text = await res.text().catch(() => "");
      const file = outFile || join("/tmp", "cucm-mcp", "axl.wsdl");
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, text, "utf8");

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                ok: res.ok,
                url,
                status: res.status,
                savedPath: file,
                bytes: Buffer.byteLength(text, "utf8"),
                note: "WSDL often imports XSDs; you may need to fetch those referenced URLs too.",
              },
              null,
              2
            ),
          },
        ],
      };
    } catch (e) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                ok: false,
                error: true,
                url,
                message: formatUnknownError(e),
              },
              null,
              2
            ),
          },
        ],
      };
    }
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
    const summary =
      `Started CUCM packet capture (SSH). ` +
      `id=${result.id} host=${result.host} fileBase=${result.fileBase} remoteFilePath=${result.remoteFilePath}. ` +
      `Stops when packet count is reached, when you call packet_capture_stop, or via maxDurationMs.`;

    return {
      content: [{ type: "text", text: `${summary}\n\n${JSON.stringify(result, null, 2)}` }],
    };
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
    try {
      const result = await captures.stop(captureId, timeoutMs);
      const summary = `Stopped capture. id=${result.id} stopTimedOut=${Boolean(result.stopTimedOut)} remoteFilePath=${result.remoteFilePath}`;
      return { content: [{ type: "text", text: `${summary}\n\n${JSON.stringify(result, null, 2)}` }] };
    } catch (e) {
      const stopError = e instanceof Error ? e.message : String(e || "");
      const pruned = captureState.pruneExpired(captureState.load());
      const rec = pruned.captures[captureId];
      if (!rec) throw e;
      const summary = `Failed to stop capture (returning state record). id=${captureId} stopError=${JSON.stringify(stopError)}`;
      return {
        content: [
          {
            type: "text",
            text: `${summary}\n\n${JSON.stringify({ stopError, record: rec }, null, 2)}`,
          },
        ],
      };
    }
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
    stopTimeoutMs: z
      .number()
      .int()
      .min(1000)
      .max(10 * 60_000)
      .optional()
      .describe("How long to wait for SSH capture stop (default 300000)"),
    downloadTimeoutMs: z
      .number()
      .int()
      .min(1000)
      .max(10 * 60_000)
      .optional()
      .describe("How long to wait for the capture file to appear in DIME (default 300000)"),
    downloadPollIntervalMs: z
      .number()
      .int()
      .min(250)
      .max(30_000)
      .optional()
      .describe("How often to retry DIME GetOneFile when the file isn't there yet"),
  },
  async ({ captureId, dimePort, auth, outFile, stopTimeoutMs, downloadTimeoutMs, downloadPollIntervalMs }) => {
    const stopTimeout = stopTimeoutMs ?? 300_000;
    const dlTimeout = downloadTimeoutMs ?? 300_000;
    const dlPoll = downloadPollIntervalMs ?? 2000;

    let stopped: { [k: string]: any };
    let stopError: string | undefined;
    try {
      stopped = await captures.stop(captureId, stopTimeout);
    } catch (e) {
      stopError = e instanceof Error ? e.message : String(e || "");
      // Fall back to state file (useful if stop failed or MCP restarted).
      const pruned = captureState.pruneExpired(captureState.load());
      const rec = pruned.captures[captureId];
      if (!rec) throw new Error(`Failed to stop capture and capture not found in state: ${captureId}. stopError=${stopError}`);
      stopped = rec;
    }

    const candidates = (stopped.remoteFileCandidates || []).length ? stopped.remoteFileCandidates : [stopped.remoteFilePath];

    const dl = await getOneFileAnyWithRetry(stopped.host, candidates, {
      auth: auth as DimeAuth | undefined,
      port: dimePort,
      timeoutMs: dlTimeout,
      pollIntervalMs: dlPoll,
    });
    const saved = writeDownloadedFile(dl, outFile);

    const summary =
      `Capture downloaded. ` +
      `id=${captureId} stopTimedOut=${Boolean(stopped.stopTimedOut)} remoteFilePath=${dl.filename} ` +
      `savedPath=${saved.filePath} bytes=${saved.bytes}` +
      (stopError ? ` stopError=${JSON.stringify(stopError)}` : "");

    return {
      content: [
        {
          type: "text",
          text: `${summary}\n\n${JSON.stringify(
            {
              captureId: stopped.id,
              host: stopped.host,
              remoteFilePath: dl.filename,
              stopTimedOut: stopped.stopTimedOut || false,
              stopError,
              savedPath: saved.filePath,
              bytes: saved.bytes,
              dimeAttempts: dl.attempts,
              dimeWaitedMs: dl.waitedMs,
            },
            null,
            2
          )}`,
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
    const summary =
      `Capture downloaded from state. id=${captureId} remoteFilePath=${dl.filename} savedPath=${saved.filePath} bytes=${saved.bytes}`;
    return {
      content: [
        {
          type: "text",
          text: `${summary}\n\n${JSON.stringify(
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
          )}`,
        },
      ],
    };
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);
