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
import { pcapCallSummary, pcapSipCalls, pcapScppMessages, pcapRtpStreams, pcapProtocolFilter } from "./pcap-analyze.js";
import { selectCmDevice, selectCmDeviceByIp, type SelectCmDeviceArgs } from "./risport.js";
import { perfmonCollectCounterData, perfmonListCounter, perfmonListInstance } from "./perfmon.js";
import { getServiceStatus } from "./controlcenter.js";

// Default to accepting self-signed/invalid certs (common on CUCM lab/dev).
// Opt back into strict verification with CUCM_MCP_TLS_MODE=strict.
const tlsMode = (process.env.CUCM_MCP_TLS_MODE || process.env.MCP_TLS_MODE || "").toLowerCase();
const strictTls = tlsMode === "strict" || tlsMode === "verify";
// Default: permissive TLS (accept self-signed). This is the common CUCM lab posture.
// Set CUCM_MCP_TLS_MODE=strict to enforce verification.
if (!strictTls) process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

const server = new McpServer({ name: "cucm", version: "0.4.0" });
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

// ---------------------------------------------------------------------------
// RisPort70 (Real-time Device Registration)
// ---------------------------------------------------------------------------

server.tool(
  "select_cm_device",
  "Query real-time device registration status via RisPort70 (selectCmDevice). " +
    "Returns registered/unregistered phones, gateways, trunks with IP, directory number, protocol, firmware.",
  {
    host: z.string().describe("CUCM host/IP"),
    port: z.number().int().min(1).max(65535).optional(),
    auth: dimeAuthSchema,
    maxReturnedDevices: z.number().int().min(1).max(2000).optional().describe("Max devices (default 200)"),
    deviceClass: z.enum(["Phone", "Gateway", "H323", "CTI", "VoiceMail", "MediaResources", "HuntList", "SIPTrunk", "Unknown"])
      .optional().describe("Device class filter (default Phone)"),
    model: z.number().int().optional().describe("Model number (255 = any, default 255)"),
    status: z.enum(["Any", "Registered", "UnRegistered", "Rejected", "PartiallyRegistered", "Unknown"])
      .optional().describe("Registration status filter (default Any)"),
    selectBy: z.enum(["Name", "IPV4Address", "IPV6Address", "DirNumber", "Description", "SIPStatus"])
      .optional().describe("Search field (default Name)"),
    selectItems: z.array(z.string()).optional().describe('Search values (* = wildcard, e.g. ["SEP*"] or ["192.168.1.*"])'),
    protocol: z.enum(["Any", "SIP", "SCCP", "Unknown"]).optional().describe("Protocol filter (default Any)"),
    timeoutMs: z.number().int().min(1000).max(120_000).optional().describe("Request timeout (default 60000, RIS can be slow on large clusters)"),
  },
  async ({ host, port, auth, timeoutMs, ...rest }) => {
    try {
      const args: SelectCmDeviceArgs = { ...rest, timeoutMs };
      const result = await selectCmDevice(host, args, auth as DimeAuth | undefined, port);
      const summary = `Found ${result.totalDevicesFound} device(s) across ${result.cmNodes.length} node(s)`;
      return { content: [{ type: "text", text: `${summary}\n\n${JSON.stringify(result, null, 2)}` }] };
    } catch (e) {
      return { content: [{ type: "text", text: JSON.stringify({ error: true, message: formatUnknownError(e) }, null, 2) }] };
    }
  }
);

server.tool(
  "select_cm_device_by_ip",
  "Convenience: query device registration status by IP address via RisPort70.",
  {
    host: z.string().describe("CUCM host/IP"),
    port: z.number().int().min(1).max(65535).optional(),
    auth: dimeAuthSchema,
    ipAddress: z.string().min(1).describe("IP address to search (e.g. 192.168.1.100 or 192.168.1.*)"),
    maxDevices: z.number().int().min(1).max(2000).optional(),
    status: z.enum(["Any", "Registered", "UnRegistered", "Rejected", "PartiallyRegistered", "Unknown"]).optional(),
    timeoutMs: z.number().int().min(1000).max(120_000).optional(),
  },
  async ({ host, port, auth, ipAddress, maxDevices, status, timeoutMs }) => {
    try {
      const result = await selectCmDeviceByIp(host, ipAddress, {
        maxDevices,
        status,
        auth: auth as DimeAuth | undefined,
        port,
        timeoutMs,
      });
      const summary = `Found ${result.totalDevicesFound} device(s) matching IP ${ipAddress}`;
      return { content: [{ type: "text", text: `${summary}\n\n${JSON.stringify(result, null, 2)}` }] };
    } catch (e) {
      return { content: [{ type: "text", text: JSON.stringify({ error: true, message: formatUnknownError(e) }, null, 2) }] };
    }
  }
);

// ---------------------------------------------------------------------------
// PerfMon (Performance Monitoring)
// ---------------------------------------------------------------------------

server.tool(
  "perfmon_collect_counter_data",
  "Collect real-time performance counter values from a CUCM node. " +
    'Common objects: "Cisco CallManager", "Cisco Tftp", "Processor", "Memory", "Cisco SIP", "Cisco SIP Station".',
  {
    host: z.string().describe("CUCM API host/IP (Serviceability endpoint)"),
    port: z.number().int().min(1).max(65535).optional(),
    auth: dimeAuthSchema,
    perfmonHost: z.string().describe("Target CUCM node hostname/IP to collect counters from"),
    object: z.string().min(1).describe('PerfMon object name, e.g. "Cisco CallManager"'),
    timeoutMs: z.number().int().min(1000).max(120_000).optional(),
  },
  async ({ host, port, auth, perfmonHost, object, timeoutMs }) => {
    try {
      const result = await perfmonCollectCounterData(host, perfmonHost, object, auth as DimeAuth | undefined, port, timeoutMs);
      const summary = `Collected ${result.length} counter(s) for "${object}" from ${perfmonHost}`;
      return { content: [{ type: "text", text: `${summary}\n\n${JSON.stringify(result, null, 2)}` }] };
    } catch (e) {
      return { content: [{ type: "text", text: JSON.stringify({ error: true, message: formatUnknownError(e) }, null, 2) }] };
    }
  }
);

server.tool(
  "perfmon_list_counter",
  "List all available PerfMon counter objects and their counters on a CUCM node. " +
    "Use this to discover what counters are available before calling perfmon_collect_counter_data.",
  {
    host: z.string().describe("CUCM API host/IP"),
    port: z.number().int().min(1).max(65535).optional(),
    auth: dimeAuthSchema,
    perfmonHost: z.string().describe("Target CUCM node hostname/IP"),
    timeoutMs: z.number().int().min(1000).max(120_000).optional(),
  },
  async ({ host, port, auth, perfmonHost, timeoutMs }) => {
    try {
      const result = await perfmonListCounter(host, perfmonHost, auth as DimeAuth | undefined, port, timeoutMs);
      const totalCounters = result.reduce((sum, obj) => sum + obj.counters.length, 0);
      const summary = `Found ${result.length} object(s) with ${totalCounters} total counter(s) on ${perfmonHost}`;
      return { content: [{ type: "text", text: `${summary}\n\n${JSON.stringify(result, null, 2)}` }] };
    } catch (e) {
      return { content: [{ type: "text", text: JSON.stringify({ error: true, message: formatUnknownError(e) }, null, 2) }] };
    }
  }
);

server.tool(
  "perfmon_list_instance",
  "List instances of a PerfMon object on a CUCM node. " +
    'For example, listing instances of "Cisco Lines Active" returns each DN.',
  {
    host: z.string().describe("CUCM API host/IP"),
    port: z.number().int().min(1).max(65535).optional(),
    auth: dimeAuthSchema,
    perfmonHost: z.string().describe("Target CUCM node hostname/IP"),
    object: z.string().min(1).describe("PerfMon object name"),
    timeoutMs: z.number().int().min(1000).max(120_000).optional(),
  },
  async ({ host, port, auth, perfmonHost, object, timeoutMs }) => {
    try {
      const result = await perfmonListInstance(host, perfmonHost, object, auth as DimeAuth | undefined, port, timeoutMs);
      const summary = `Found ${result.length} instance(s) of "${object}" on ${perfmonHost}`;
      return { content: [{ type: "text", text: `${summary}\n\n${JSON.stringify(result, null, 2)}` }] };
    } catch (e) {
      return { content: [{ type: "text", text: JSON.stringify({ error: true, message: formatUnknownError(e) }, null, 2) }] };
    }
  }
);

// ---------------------------------------------------------------------------
// ControlCenter (Service Status)
// ---------------------------------------------------------------------------

server.tool(
  "get_service_status",
  "Get the status of CUCM services (Started/Stopped/Not Activated) via ControlCenter. " +
    "Read-only; does NOT start/stop/restart services.",
  {
    host: z.string().describe("CUCM host/IP"),
    port: z.number().int().min(1).max(65535).optional(),
    auth: dimeAuthSchema,
    serviceNames: z.array(z.string()).optional().describe("Filter to specific service names (empty = all services)"),
    timeoutMs: z.number().int().min(1000).max(120_000).optional(),
  },
  async ({ host, port, auth, serviceNames, timeoutMs }) => {
    try {
      const result = await getServiceStatus(host, serviceNames, auth as DimeAuth | undefined, port, timeoutMs);
      const started = result.filter((s) => s.serviceStatus === "Started").length;
      const stopped = result.filter((s) => s.serviceStatus === "Stopped").length;
      const summary = `${result.length} service(s): ${started} started, ${stopped} stopped`;
      return { content: [{ type: "text", text: `${summary}\n\n${JSON.stringify(result, null, 2)}` }] };
    } catch (e) {
      return { content: [{ type: "text", text: JSON.stringify({ error: true, message: formatUnknownError(e) }, null, 2) }] };
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

// ---------------------------------------------------------------------------
// PCAP Analysis Tools (requires tshark / Wireshark CLI)
// ---------------------------------------------------------------------------

function resolveCapturePath(input: string): string {
  // If it looks like a file path, use directly
  if (input.includes("/") || input.includes("\\") || input.endsWith(".cap") || input.endsWith(".pcap")) {
    return input;
  }
  // Otherwise treat as captureId and resolve from state
  const pruned = captureState.pruneExpired(captureState.load());
  const rec = pruned.captures[input];
  if (!rec) throw new Error(`No capture file path and no state record for: ${input}`);
  // Look for a downloaded file in /tmp/cucm-mcp/
  const basename = rec.remoteFilePath.split("/").pop() || `${rec.fileBase}.cap`;
  const localPath = `/tmp/cucm-mcp/${basename}`;
  return localPath;
}

server.tool(
  "pcap_call_summary",
  "High-level overview of a packet capture: protocols present, SIP call count, RTP streams, endpoints. " +
    "Use this first to understand what's in a capture before drilling into specific calls.",
  {
    filePath: z.string().min(1).describe("Path to .cap/.pcap file, or a captureId from packet_capture_start"),
  },
  async ({ filePath }) => {
    try {
      const resolved = resolveCapturePath(filePath);
      const result = await pcapCallSummary(resolved);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    } catch (e) {
      return { content: [{ type: "text", text: JSON.stringify({ error: true, message: formatUnknownError(e) }, null, 2) }] };
    }
  }
);

server.tool(
  "pcap_sip_calls",
  "Extract SIP call flows from a capture, grouped by Call-ID. " +
    "Shows INVITE/100/180/200/BYE sequences, From/To, SDP media info, and call setup timing.",
  {
    filePath: z.string().min(1).describe("Path to .cap/.pcap file, or a captureId"),
    callId: z.string().optional().describe("Filter to a specific SIP Call-ID"),
  },
  async ({ filePath, callId }) => {
    try {
      const resolved = resolveCapturePath(filePath);
      const result = await pcapSipCalls(resolved, callId);
      const summary = `Found ${result.length} SIP call(s)` +
        (result.length > 0 ? `: ${result.map((c) => `${c.callId} (${c.metrics.messageCount} msgs, ${c.metrics.answered ? "answered" : "unanswered"})`).join(", ")}` : "");
      return { content: [{ type: "text", text: `${summary}\n\n${JSON.stringify(result, null, 2)}` }] };
    } catch (e) {
      return { content: [{ type: "text", text: JSON.stringify({ error: true, message: formatUnknownError(e) }, null, 2) }] };
    }
  }
);

server.tool(
  "pcap_sccp_messages",
  "Extract Skinny/SCCP messages from a capture. " +
    "Shows phone registration, call state changes, media channel setup (OpenReceiveChannel, StartMediaTransmission), and key presses.",
  {
    filePath: z.string().min(1).describe("Path to .cap/.pcap file, or a captureId"),
    deviceFilter: z.string().optional().describe("Filter to a specific device IP address"),
  },
  async ({ filePath, deviceFilter }) => {
    try {
      const resolved = resolveCapturePath(filePath);
      const result = await pcapScppMessages(resolved, deviceFilter);
      const summary = `Found ${result.totalMessages} SCCP message(s) across ${result.devices.length} device(s). ` +
        `Top message types: ${Object.entries(result.messageTypes).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([k, v]) => `${k}(${v})`).join(", ")}`;
      return { content: [{ type: "text", text: `${summary}\n\n${JSON.stringify(result, null, 2)}` }] };
    } catch (e) {
      return { content: [{ type: "text", text: JSON.stringify({ error: true, message: formatUnknownError(e) }, null, 2) }] };
    }
  }
);

server.tool(
  "pcap_rtp_streams",
  "Analyze RTP media streams in a capture. " +
    "Shows per-stream jitter, packet loss, codec, duration. Use to assess call quality.",
  {
    filePath: z.string().min(1).describe("Path to .cap/.pcap file, or a captureId"),
    ssrcFilter: z.string().optional().describe("Filter to a specific RTP SSRC (hex, e.g. 0xABCD1234)"),
  },
  async ({ filePath, ssrcFilter }) => {
    try {
      const resolved = resolveCapturePath(filePath);
      const result = await pcapRtpStreams(resolved, ssrcFilter);
      const summary = `Found ${result.summary.totalStreams} RTP stream(s). ` +
        `Worst loss: ${result.summary.worstLoss}, worst jitter: ${result.summary.worstJitter}`;
      return { content: [{ type: "text", text: `${summary}\n\n${JSON.stringify(result, null, 2)}` }] };
    } catch (e) {
      return { content: [{ type: "text", text: JSON.stringify({ error: true, message: formatUnknownError(e) }, null, 2) }] };
    }
  }
);

server.tool(
  "pcap_protocol_filter",
  "Run an arbitrary tshark display filter on a capture and extract specific fields. " +
    "Escape hatch for deep protocol investigation. Examples: 'sip.Method == INVITE', 'skinny.callState == 12', 'rtp.ssrc == 0xABCD'.",
  {
    filePath: z.string().min(1).describe("Path to .cap/.pcap file, or a captureId"),
    displayFilter: z.string().min(1).describe("tshark display filter expression"),
    fields: z
      .array(z.string())
      .optional()
      .describe("Specific tshark fields to extract (e.g. ['sip.Call-ID', 'sip.from.addr']). If omitted, returns frame basics."),
    maxPackets: z.number().int().min(1).max(1000).optional().describe("Max packets to return (default 100, max 1000)"),
  },
  async ({ filePath, displayFilter, fields, maxPackets }) => {
    try {
      const resolved = resolveCapturePath(filePath);
      const result = await pcapProtocolFilter(resolved, displayFilter, fields, maxPackets);
      return { content: [{ type: "text", text: `${result.length} packet(s) matched filter "${displayFilter}"\n\n${JSON.stringify(result, null, 2)}` }] };
    } catch (e) {
      return { content: [{ type: "text", text: JSON.stringify({ error: true, message: formatUnknownError(e) }, null, 2) }] };
    }
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);
