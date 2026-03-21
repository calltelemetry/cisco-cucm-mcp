#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import type { ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";
import { mkdirSync, readFileSync, writeFileSync } from "fs";
import { gunzipSync } from "zlib";
import { dirname, join } from "path";

import {
  listNodeServiceLogs,
  selectLogs,
  selectLogsMinutes,
  getOneFile,
  getOneFileAnyWithRetry,
  writeDownloadedFile,
  downloadBatch,
  selectLogsCluster,
  type DimeAuth,
} from "./dime.js";
import { guessTimezoneString } from "./time.js";
import { PacketCaptureManager, type SshAuth } from "./packetCapture.js";
import { defaultStateStore } from "./state.js";
import { applyPhone, updatePhonePacketCapture, axlExecute, type AxlAuth } from "./axl.js";
import { pcapCallSummary, pcapSipCalls, pcapScppMessages, pcapRtpStreams, pcapProtocolFilter } from "./pcap-analyze.js";
import { selectCmDevice, selectCmDeviceAll, selectCmDeviceByIp, selectCtiItem, type SelectCmDeviceArgs, type SelectCtiItemArgs } from "./risport.js";
import { perfmonCollectCounterData, perfmonListCounter, perfmonListInstance, perfmonOpenSession, perfmonAddCounter, perfmonRemoveCounter, perfmonCollectSessionData, perfmonCloseSession } from "./perfmon.js";
import { getServiceStatus } from "./controlcenter.js";
import { startService, stopService, restartService, getStaticServiceListExtended } from "./controlcenter-ext.js";
import { cdrGetFileList, cdrGetFileListMinutes, cdrDownloadFile } from "./cdr-on-demand.js";
import { showVersion, showNetworkCluster, showStatus, showNetworkEth0 } from "./cli-tools.js";
import { clusterHealthCheck } from "./cluster-health.js";
import { listCertificates } from "./certificates.js";
import { getBackupStatus, getBackupHistory } from "./drf-backup.js";
import { parseSdlTrace, extractCallFlow } from "./sdl-trace.js";
import { selectSipTraces, selectCtiTraces, selectCurriLogs } from "./log-presets.js";
import { getTraceConfig, setTraceLevel, TRACE_LEVELS } from "./trace-config.js";
import { listAxlOperations, describeAxlOperation } from "./axl-wsdl.js";
import { setupPermissiveTls } from "./tls.js";
import { formatUnknownError } from "./errors.js";
import {
  coordinatedCaptureStart,
  coordinatedCaptureStopAnalyze,
  phoneCaptureDownload,
  type CoordCaptureAuth,
} from "./coordinated-capture.js";

setupPermissiveTls();

const server = new McpServer({ name: "cucm", version: "0.7.1" });
const captures = new PacketCaptureManager();
const captureState = defaultStateStore();

/** Shared auth schema: when provided, both username and password are required. */
const authSchema = z
  .object({
    username: z.string().min(1),
    password: z.string().min(1),
  })
  .optional()
  .describe("Credentials override (optional — defaults to env vars)");

// Aliases for readability at tool registration sites
const dimeAuthSchema = authSchema;
const sshAuthSchema = authSchema;
const axlAuthSchema = authSchema;

// Tool annotation presets
const READ_ONLY_NETWORK: ToolAnnotations = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true };
const READ_ONLY_LOCAL: ToolAnnotations = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
const WRITE_DESTRUCTIVE: ToolAnnotations = { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true };
const WRITE_SAFE: ToolAnnotations = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true };

server.tool(
  "guess_timezone_string",
  "Build a best-effort DIME timezone string for selectLogFiles.",
  {},
  READ_ONLY_LOCAL,
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
  READ_ONLY_NETWORK,
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
  READ_ONLY_NETWORK,
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
  READ_ONLY_NETWORK,
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
  READ_ONLY_NETWORK,
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
    axlVersion: z.string().optional().describe("AXL API version (default env CUCM_VERSION or 15.0)"),
    auth: axlAuthSchema.describe("AXL auth (optional; defaults to CUCM_USERNAME/CUCM_PASSWORD)"),
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
  WRITE_DESTRUCTIVE,
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
    cucm_username: z.string().optional().describe("AXL username (optional if env CUCM_USERNAME is set)"),
    cucm_password: z.string().optional().describe("AXL password (optional if env CUCM_PASSWORD is set)"),

    timeoutMs: z.number().int().min(1000).max(5 * 60_000).optional().describe("AXL request timeout"),
    includeRequestXml: z.boolean().optional().describe("Include SOAP request XML in response (debug)"),
    includeResponseXml: z.boolean().optional().describe("Include SOAP response XML in response (debug)"),
  },
  WRITE_DESTRUCTIVE,
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

      // Never echo credentials in error responses — omit cucm_username/cucm_password
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
    cucm_username: z.string().optional().describe("AXL username (optional if env CUCM_USERNAME is set)"),
    cucm_password: z.string().optional().describe("AXL password (optional if env CUCM_PASSWORD is set)"),
    outFile: z.string().optional().describe("Optional output file path (default /tmp/cucm-mcp/axl.wsdl)")
  },
  READ_ONLY_NETWORK,
  async ({ cucm_host, cucm_port, cucm_username, cucm_password, outFile }) => {
    const port = cucm_port ?? 8443;
    const user = cucm_username || process.env.CUCM_USERNAME;
    const pass = cucm_password || process.env.CUCM_PASSWORD;
    if (!user || !pass) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                ok: false,
                error: true,
                message: "Missing AXL credentials (provide cucm_username/cucm_password or set CUCM_USERNAME/CUCM_PASSWORD)",
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
    maxReturnedDevices: z.number().int().min(1).max(1000).optional().describe("Max devices per page (default 200, CUCM caps at 1000)"),
    deviceClass: z.enum(["Phone", "Gateway", "H323", "CTI", "VoiceMail", "MediaResources", "HuntList", "SIPTrunk", "Unknown"])
      .optional().describe("Device class filter (default Phone)"),
    model: z.number().int().optional().describe("Model number (255 = any, default 255)"),
    status: z.enum(["Any", "Registered", "UnRegistered", "Rejected", "PartiallyRegistered", "Unknown"])
      .optional().describe("Registration status filter (default Any)"),
    selectBy: z.enum(["Name", "IPV4Address", "IPV6Address", "DirNumber", "Description", "SIPStatus"])
      .optional().describe("Search field (default Name)"),
    selectItems: z.array(z.string()).optional().describe('Search values (* = wildcard, e.g. ["SEP*"] or ["192.168.1.*"])'),
    protocol: z.enum(["Any", "SIP", "SCCP", "Unknown"]).optional().describe("Protocol filter (default Any)"),
    stateInfo: z.string().optional().describe("Pagination cursor from a previous response. Omit for first page."),
    timeoutMs: z.number().int().min(1000).max(120_000).optional().describe("Request timeout (default 60000, RIS can be slow on large clusters)"),
  },
  READ_ONLY_NETWORK,
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
  READ_ONLY_NETWORK,
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

server.tool(
  "select_cm_device_all",
  "Auto-paginating selectCmDevice — iterates with StateInfo to return ALL devices. " +
    "Use this instead of select_cm_device when you need a complete inventory (clusters with >1000 devices).",
  {
    host: z.string().describe("CUCM host/IP"),
    port: z.number().int().min(1).max(65535).optional(),
    auth: dimeAuthSchema,
    deviceClass: z.enum(["Phone", "Gateway", "H323", "CTI", "VoiceMail", "MediaResources", "HuntList", "SIPTrunk", "Unknown"])
      .optional().describe("Device class filter (default Phone)"),
    model: z.number().int().optional().describe("Model number (255 = any, default 255)"),
    status: z.enum(["Any", "Registered", "UnRegistered", "Rejected", "PartiallyRegistered", "Unknown"])
      .optional().describe("Registration status filter (default Any)"),
    selectBy: z.enum(["Name", "IPV4Address", "IPV6Address", "DirNumber", "Description", "SIPStatus"])
      .optional().describe("Search field (default Name)"),
    selectItems: z.array(z.string()).optional().describe('Search values (* = wildcard, e.g. ["SEP*"] or ["192.168.1.*"])'),
    protocol: z.enum(["Any", "SIP", "SCCP", "Unknown"]).optional().describe("Protocol filter (default Any)"),
    timeoutMs: z.number().int().min(1000).max(120_000).optional().describe("Request timeout per page (default 60000)"),
  },
  READ_ONLY_NETWORK,
  async ({ host, port, auth, timeoutMs, ...rest }) => {
    try {
      const result = await selectCmDeviceAll(host, { ...rest, timeoutMs }, auth as DimeAuth | undefined, port);
      const totalDevices = result.cmNodes.reduce((sum, n) => sum + n.devices.length, 0);
      const summary = `Found ${totalDevices} device(s) across ${result.cmNodes.length} node(s) (totalDevicesFound: ${result.totalDevicesFound})`;
      return { content: [{ type: "text", text: `${summary}\n\n${JSON.stringify(result, null, 2)}` }] };
    } catch (e) {
      return { content: [{ type: "text", text: JSON.stringify({ error: true, message: formatUnknownError(e) }, null, 2) }] };
    }
  }
);

server.tool(
  "select_cti_item",
  "Query real-time CTI device status via RisPort70 (selectCtiItem). " +
    "Returns CTI ports, route points, and application connections. Useful for JTAPI/CTI troubleshooting.",
  {
    host: z.string().describe("CUCM host/IP"),
    port: z.number().int().min(1).max(65535).optional(),
    auth: dimeAuthSchema,
    ctiMgrClass: z.enum(["Provider", "Device", "Line"]).optional().describe("CTI manager class filter (default Provider)"),
    maxItems: z.number().int().min(1).max(1000).optional().describe("Max items to return (default 200)"),
    appId: z.string().optional().describe("Filter by CTI application ID"),
    nodeName: z.string().optional().describe("Filter by CUCM node name"),
    status: z.enum(["Any", "Open", "Closed", "OpenFailed", "Unknown"]).optional().describe("Status filter (default Any)"),
    timeoutMs: z.number().int().min(1000).max(120_000).optional(),
  },
  READ_ONLY_NETWORK,
  async ({ host, port, auth, timeoutMs, ...rest }) => {
    try {
      const args: SelectCtiItemArgs = { ...rest, timeoutMs };
      const result = await selectCtiItem(host, args, auth as DimeAuth | undefined, port);
      const summary = `Found ${result.totalItemsFound} CTI item(s)`;
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
  READ_ONLY_NETWORK,
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
  READ_ONLY_NETWORK,
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
  READ_ONLY_NETWORK,
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
  READ_ONLY_NETWORK,
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
  READ_ONLY_NETWORK,
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
  WRITE_SAFE,
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
  READ_ONLY_LOCAL,
  async () => ({ content: [{ type: "text", text: JSON.stringify(captures.list(), null, 2) }] })
);

server.tool(
  "packet_capture_state_list",
  "List packet captures from the local state file (survives MCP restarts).",
  {},
  READ_ONLY_LOCAL,
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
  READ_ONLY_LOCAL,
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
  WRITE_DESTRUCTIVE,
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
  WRITE_SAFE,
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
    auth: dimeAuthSchema.describe("DIME auth (optional; defaults to CUCM_USERNAME/CUCM_PASSWORD)"),
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
  WRITE_SAFE,
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
    auth: dimeAuthSchema.describe("DIME auth (optional; defaults to CUCM_USERNAME/CUCM_PASSWORD)"),
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
  READ_ONLY_NETWORK,
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
  READ_ONLY_LOCAL,
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
  READ_ONLY_LOCAL,
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
  READ_ONLY_LOCAL,
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
  READ_ONLY_LOCAL,
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
  READ_ONLY_LOCAL,
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

// ---------------------------------------------------------------------------
// CDR on Demand
// ---------------------------------------------------------------------------

server.tool(
  "cdr_get_file_list",
  "List CDR/CMR files by UTC time range (max 1 hour). " +
    "Time format: 12-digit UTC YYYYMMDDHHMM (e.g. 202602280100).",
  {
    host: z.string().describe("CUCM host/IP"),
    port: z.number().int().min(1).max(65535).optional(),
    auth: dimeAuthSchema,
    fromTime: z.string().min(12).max(12).describe("Start time in 12-digit UTC YYYYMMDDHHMM"),
    toTime: z.string().min(12).max(12).describe("End time in 12-digit UTC YYYYMMDDHHMM"),
    timeoutMs: z.number().int().min(1000).max(120_000).optional(),
  },
  READ_ONLY_NETWORK,
  async ({ host, port, auth, fromTime, toTime, timeoutMs }) => {
    try {
      const result = await cdrGetFileList(host, fromTime, toTime, auth as DimeAuth | undefined, port, timeoutMs);
      return { content: [{ type: "text", text: `Found ${result.length} CDR/CMR file(s)\n\n${JSON.stringify(result, null, 2)}` }] };
    } catch (e) {
      return { content: [{ type: "text", text: JSON.stringify({ error: true, message: formatUnknownError(e) }, null, 2) }] };
    }
  }
);

server.tool(
  "cdr_get_file_list_minutes",
  "List CDR/CMR files from the last N minutes (max 60). Convenience wrapper around cdr_get_file_list.",
  {
    host: z.string().describe("CUCM host/IP"),
    port: z.number().int().min(1).max(65535).optional(),
    auth: dimeAuthSchema,
    minutesBack: z.number().int().min(1).max(60).describe("Minutes back from now (max 60)"),
    timeoutMs: z.number().int().min(1000).max(120_000).optional(),
  },
  READ_ONLY_NETWORK,
  async ({ host, port, auth, minutesBack, timeoutMs }) => {
    try {
      const result = await cdrGetFileListMinutes(host, minutesBack, auth as DimeAuth | undefined, port, timeoutMs);
      return { content: [{ type: "text", text: `Found ${result.length} CDR/CMR file(s) from last ${minutesBack} min\n\n${JSON.stringify(result, null, 2)}` }] };
    } catch (e) {
      return { content: [{ type: "text", text: JSON.stringify({ error: true, message: formatUnknownError(e) }, null, 2) }] };
    }
  }
);

// ---------------------------------------------------------------------------
// PerfMon Sessions
// ---------------------------------------------------------------------------

server.tool(
  "perfmon_open_session",
  "Open a PerfMon monitoring session. Returns a session handle UUID for use with perfmon_add_counter/perfmon_collect_session_data/perfmon_close_session. Sessions auto-expire after 25h.",
  {
    host: z.string().describe("CUCM API host/IP"),
    port: z.number().int().min(1).max(65535).optional(),
    auth: dimeAuthSchema,
    timeoutMs: z.number().int().min(1000).max(120_000).optional(),
  },
  WRITE_SAFE,
  async ({ host, port, auth, timeoutMs }) => {
    try {
      const handle = await perfmonOpenSession(host, auth as DimeAuth | undefined, port, timeoutMs);
      return { content: [{ type: "text", text: `Session opened: ${handle}\n\n${JSON.stringify({ sessionHandle: handle }, null, 2)}` }] };
    } catch (e) {
      return { content: [{ type: "text", text: JSON.stringify({ error: true, message: formatUnknownError(e) }, null, 2) }] };
    }
  }
);

server.tool(
  "perfmon_add_counter",
  "Add counters to a PerfMon session. Counter paths use the format: \\\\host\\Object\\Counter (e.g. \\\\192.168.1.1\\Cisco CallManager\\CallsActive).",
  {
    host: z.string().describe("CUCM API host/IP"),
    port: z.number().int().min(1).max(65535).optional(),
    auth: dimeAuthSchema,
    sessionHandle: z.string().min(1).describe("Session handle from perfmon_open_session"),
    counters: z.array(z.string().min(1)).min(1).describe("Counter paths to add"),
    timeoutMs: z.number().int().min(1000).max(120_000).optional(),
  },
  WRITE_SAFE,
  async ({ host, port, auth, sessionHandle, counters, timeoutMs }) => {
    try {
      await perfmonAddCounter(host, sessionHandle, counters, auth as DimeAuth | undefined, port, timeoutMs);
      return { content: [{ type: "text", text: `Added ${counters.length} counter(s) to session ${sessionHandle}` }] };
    } catch (e) {
      return { content: [{ type: "text", text: JSON.stringify({ error: true, message: formatUnknownError(e) }, null, 2) }] };
    }
  }
);

server.tool(
  "perfmon_collect_session_data",
  "Poll counter values from a PerfMon session. Call after perfmon_add_counter to read the latest values.",
  {
    host: z.string().describe("CUCM API host/IP"),
    port: z.number().int().min(1).max(65535).optional(),
    auth: dimeAuthSchema,
    sessionHandle: z.string().min(1).describe("Session handle from perfmon_open_session"),
    timeoutMs: z.number().int().min(1000).max(120_000).optional(),
  },
  READ_ONLY_NETWORK,
  async ({ host, port, auth, sessionHandle, timeoutMs }) => {
    try {
      const result = await perfmonCollectSessionData(host, sessionHandle, auth as DimeAuth | undefined, port, timeoutMs);
      return { content: [{ type: "text", text: `Collected ${result.length} counter(s)\n\n${JSON.stringify(result, null, 2)}` }] };
    } catch (e) {
      return { content: [{ type: "text", text: JSON.stringify({ error: true, message: formatUnknownError(e) }, null, 2) }] };
    }
  }
);

server.tool(
  "perfmon_close_session",
  "Close a PerfMon monitoring session. Best practice: close sessions when done to free server resources.",
  {
    host: z.string().describe("CUCM API host/IP"),
    port: z.number().int().min(1).max(65535).optional(),
    auth: dimeAuthSchema,
    sessionHandle: z.string().min(1).describe("Session handle from perfmon_open_session"),
    timeoutMs: z.number().int().min(1000).max(120_000).optional(),
  },
  WRITE_SAFE,
  async ({ host, port, auth, sessionHandle, timeoutMs }) => {
    try {
      await perfmonCloseSession(host, sessionHandle, auth as DimeAuth | undefined, port, timeoutMs);
      return { content: [{ type: "text", text: `Session ${sessionHandle} closed` }] };
    } catch (e) {
      return { content: [{ type: "text", text: JSON.stringify({ error: true, message: formatUnknownError(e) }, null, 2) }] };
    }
  }
);

server.tool(
  "perfmon_remove_counter",
  "Remove counter(s) from a PerfMon session. Use to stop monitoring specific counters without closing the session.",
  {
    host: z.string().describe("CUCM API host/IP"),
    port: z.number().int().min(1).max(65535).optional(),
    auth: dimeAuthSchema,
    sessionHandle: z.string().min(1).describe("Session handle from perfmon_open_session"),
    counters: z.array(z.string().min(1)).min(1).describe('Counter paths to remove, e.g. ["\\\\\\\\host\\\\Cisco CallManager\\\\CallsActive"]'),
    timeoutMs: z.number().int().min(1000).max(120_000).optional(),
  },
  WRITE_SAFE,
  async ({ host, port, auth, sessionHandle, counters, timeoutMs }) => {
    try {
      await perfmonRemoveCounter(host, sessionHandle, counters, auth as DimeAuth | undefined, port, timeoutMs);
      return { content: [{ type: "text", text: `Removed ${counters.length} counter(s) from session ${sessionHandle}` }] };
    } catch (e) {
      return { content: [{ type: "text", text: JSON.stringify({ error: true, message: formatUnknownError(e) }, null, 2) }] };
    }
  }
);

// ---------------------------------------------------------------------------
// Cluster Health Check
// ---------------------------------------------------------------------------

server.tool(
  "cluster_health_check",
  "One-shot cluster health check: device registration + performance counters + service status, all in parallel. " +
    "Partial failures are captured in errors[] — you still get results from the queries that succeeded.",
  {
    host: z.string().describe("CUCM host/IP"),
    port: z.number().int().min(1).max(65535).optional(),
    auth: dimeAuthSchema,
    timeoutMs: z.number().int().min(1000).max(120_000).optional(),
  },
  READ_ONLY_NETWORK,
  async ({ host, port, auth, timeoutMs }) => {
    try {
      const result = await clusterHealthCheck(host, { auth: auth as DimeAuth | undefined, port, timeoutMs });
      const parts: string[] = [];
      if (result.devices) parts.push(`Devices: ${result.devices.totalFound} (${result.devices.registered} registered)`);
      if (result.counters) parts.push(`Active calls: ${result.counters.callsActive}`);
      if (result.services) parts.push(`Services: ${result.services.started}/${result.services.total} started`);
      if (result.errors.length) parts.push(`Errors: ${result.errors.length}`);
      const summary = parts.join(" | ");
      return { content: [{ type: "text", text: `${summary}\n\n${JSON.stringify(result, null, 2)}` }] };
    } catch (e) {
      return { content: [{ type: "text", text: JSON.stringify({ error: true, message: formatUnknownError(e) }, null, 2) }] };
    }
  }
);

// ---------------------------------------------------------------------------
// Certificate Status (SSH CLI)
// ---------------------------------------------------------------------------

server.tool(
  "cert_list",
  "List TLS certificates on a CUCM node via SSH CLI (show cert list). " +
    'Returns certificate name, unit, issuer, and expiration. Type: "own", "trust", or "both".',
  {
    host: z.string().describe("CUCM host/IP"),
    sshPort: z.number().int().min(1).max(65535).optional(),
    auth: sshAuthSchema,
    type: z.enum(["own", "trust", "both"]).optional().describe('Certificate type (default "both")'),
    timeoutMs: z.number().int().min(1000).max(120_000).optional(),
  },
  READ_ONLY_NETWORK,
  async ({ host, sshPort, auth, type, timeoutMs }) => {
    try {
      const result = await listCertificates(host, type ?? "both", { auth: auth as SshAuth | undefined, sshPort, timeoutMs });
      return { content: [{ type: "text", text: `Found ${result.length} certificate(s)\n\n${JSON.stringify(result, null, 2)}` }] };
    } catch (e) {
      return { content: [{ type: "text", text: JSON.stringify({ error: true, message: formatUnknownError(e) }, null, 2) }] };
    }
  }
);

// ---------------------------------------------------------------------------
// DRF Backup Status (SSH CLI)
// ---------------------------------------------------------------------------

server.tool(
  "drf_backup_status",
  "Get current backup job status on a CUCM node via SSH CLI (utils disaster_recovery status backup).",
  {
    host: z.string().describe("CUCM host/IP"),
    sshPort: z.number().int().min(1).max(65535).optional(),
    auth: sshAuthSchema,
    timeoutMs: z.number().int().min(1000).max(120_000).optional(),
  },
  READ_ONLY_NETWORK,
  async ({ host, sshPort, auth, timeoutMs }) => {
    try {
      const result = await getBackupStatus(host, { auth: auth as SshAuth | undefined, sshPort, timeoutMs });
      return { content: [{ type: "text", text: `Backup status: ${result.status}\n\n${JSON.stringify(result, null, 2)}` }] };
    } catch (e) {
      return { content: [{ type: "text", text: JSON.stringify({ error: true, message: formatUnknownError(e) }, null, 2) }] };
    }
  }
);

server.tool(
  "drf_backup_history",
  "Get backup history on a CUCM node via SSH CLI (utils disaster_recovery history backup).",
  {
    host: z.string().describe("CUCM host/IP"),
    sshPort: z.number().int().min(1).max(65535).optional(),
    auth: sshAuthSchema,
    timeoutMs: z.number().int().min(1000).max(120_000).optional(),
  },
  READ_ONLY_NETWORK,
  async ({ host, sshPort, auth, timeoutMs }) => {
    try {
      const result = await getBackupHistory(host, { auth: auth as SshAuth | undefined, sshPort, timeoutMs });
      return { content: [{ type: "text", text: `Found ${result.length} backup history entries\n\n${JSON.stringify(result, null, 2)}` }] };
    } catch (e) {
      return { content: [{ type: "text", text: JSON.stringify({ error: true, message: formatUnknownError(e) }, null, 2) }] };
    }
  }
);

// ---------------------------------------------------------------------------
// SDL Trace Parser (Local Analysis)
// ---------------------------------------------------------------------------

server.tool(
  "sdl_trace_parse",
  "Parse a CUCM SDL trace file into structured signals and call flows. " +
    "Groups signals by call-id (CI= pattern), provides signal frequency summary. Pure local analysis.",
  {
    filePath: z.string().min(1).describe("Path to SDL trace file on disk"),
  },
  READ_ONLY_LOCAL,
  async ({ filePath }) => {
    try {
      const raw = readFileSync(filePath);
      const content = filePath.endsWith(".gz") ? gunzipSync(raw).toString("utf8") : raw.toString("utf8");
      const result = parseSdlTrace(content);
      const summary = `Parsed ${result.parsedSignals} signal(s) from ${result.totalLines} line(s), ${result.callFlows.length} call flow(s), ${result.unparsedLines} unparsed`;
      return { content: [{ type: "text", text: `${summary}\n\n${JSON.stringify(result, null, 2)}` }] };
    } catch (e) {
      return { content: [{ type: "text", text: JSON.stringify({ error: true, message: formatUnknownError(e) }, null, 2) }] };
    }
  }
);

server.tool(
  "sdl_trace_call_flow",
  "Extract the call flow for a specific call-id from an SDL trace. " +
    "Use sdl_trace_parse first to discover call-ids, then drill into a specific call.",
  {
    filePath: z.string().min(1).describe("Path to SDL trace file on disk (.gz supported)"),
    callId: z.string().min(1).describe("Call ID to extract (from CI= field in SDL signals)"),
  },
  READ_ONLY_LOCAL,
  async ({ filePath, callId }) => {
    try {
      const raw = readFileSync(filePath);
      const content = filePath.endsWith(".gz") ? gunzipSync(raw).toString("utf8") : raw.toString("utf8");
      const analysis = parseSdlTrace(content);
      const flow = extractCallFlow(analysis, callId);
      if (!flow) {
        return { content: [{ type: "text", text: JSON.stringify({ error: true, message: `Call-id ${callId} not found in trace` }, null, 2) }] };
      }
      return { content: [{ type: "text", text: `Call ${callId}: ${flow.signals.length} signal(s)\n\n${JSON.stringify(flow, null, 2)}` }] };
    } catch (e) {
      return { content: [{ type: "text", text: JSON.stringify({ error: true, message: formatUnknownError(e) }, null, 2) }] };
    }
  }
);

// ---------------------------------------------------------------------------
// SSH CLI Tools
// ---------------------------------------------------------------------------

server.tool(
  "show_version",
  "Get CUCM version info via SSH (show version active). Returns active/inactive version and build.",
  {
    host: z.string().describe("CUCM host/IP"),
    sshPort: z.number().int().min(1).max(65535).optional(),
    auth: sshAuthSchema,
    timeoutMs: z.number().int().min(5000).max(120_000).optional(),
  },
  READ_ONLY_NETWORK,
  async ({ host, sshPort, auth, timeoutMs }) => {
    try {
      const result = await showVersion(host, {
        auth: auth as SshAuth | undefined,
        sshPort,
        timeoutMs,
      });
      const summary = `CUCM ${result.activeVersion} (build ${result.activeBuild})`;
      return { content: [{ type: "text", text: `${summary}\n\n${JSON.stringify(result, null, 2)}` }] };
    } catch (e) {
      return { content: [{ type: "text", text: JSON.stringify({ error: true, message: formatUnknownError(e) }, null, 2) }] };
    }
  }
);

server.tool(
  "show_network_cluster",
  "Get CUCM cluster node topology via SSH (show network cluster). Returns all nodes with hostname, IP, type, hub/spoke, and replication status.",
  {
    host: z.string().describe("CUCM host/IP"),
    sshPort: z.number().int().min(1).max(65535).optional(),
    auth: sshAuthSchema,
    timeoutMs: z.number().int().min(5000).max(120_000).optional(),
  },
  READ_ONLY_NETWORK,
  async ({ host, sshPort, auth, timeoutMs }) => {
    try {
      const result = await showNetworkCluster(host, {
        auth: auth as SshAuth | undefined,
        sshPort,
        timeoutMs,
      });
      const summary = `${result.nodes.length} cluster node(s)`;
      return { content: [{ type: "text", text: `${summary}\n\n${JSON.stringify(result, null, 2)}` }] };
    } catch (e) {
      return { content: [{ type: "text", text: JSON.stringify({ error: true, message: formatUnknownError(e) }, null, 2) }] };
    }
  }
);

// ---------------------------------------------------------------------------
// CDR Download
// ---------------------------------------------------------------------------

server.tool(
  "cdr_download_file",
  "Download a CDR/CMR file by filename (from cdr_get_file_list results). " +
    "Uses DIME to fetch the file from CUCM's CDR repository.",
  {
    host: z.string().describe("CUCM host/IP"),
    port: z.number().int().min(1).max(65535).optional(),
    auth: dimeAuthSchema,
    fileName: z.string().min(1).describe("CDR filename from cdr_get_file_list results"),
    outFile: z.string().optional().describe("Optional output path. Default: /tmp/cucm-mcp/<filename>"),
  },
  READ_ONLY_NETWORK,
  async ({ host, port, auth, fileName, outFile }) => {
    try {
      const result = await cdrDownloadFile(host, fileName, outFile, auth as DimeAuth | undefined, port);
      return { content: [{ type: "text", text: `Downloaded ${fileName} (${result.bytes} bytes)\n\n${JSON.stringify(result, null, 2)}` }] };
    } catch (e) {
      return { content: [{ type: "text", text: JSON.stringify({ error: true, message: formatUnknownError(e) }, null, 2) }] };
    }
  }
);

// ---------------------------------------------------------------------------
// Service Control (ControlCenterServicesEx)
// ---------------------------------------------------------------------------

server.tool(
  "start_service",
  "Start one or more CUCM services via ControlCenterServicesEx. " +
    "DESTRUCTIVE: starts services on the CUCM node. Use with caution.",
  {
    host: z.string().describe("CUCM host/IP"),
    port: z.number().int().min(1).max(65535).optional(),
    auth: dimeAuthSchema,
    serviceNames: z.array(z.string().min(1)).min(1).describe("Service names to start (e.g. ['Cisco CallManager'])"),
    timeoutMs: z.number().int().min(1000).max(300_000).optional(),
  },
  WRITE_DESTRUCTIVE,
  async ({ host, port, auth, serviceNames, timeoutMs }) => {
    try {
      const result = await startService(host, serviceNames, auth as DimeAuth | undefined, port, timeoutMs);
      return { content: [{ type: "text", text: `Started ${serviceNames.length} service(s)\n\n${JSON.stringify(result, null, 2)}` }] };
    } catch (e) {
      return { content: [{ type: "text", text: JSON.stringify({ error: true, message: formatUnknownError(e) }, null, 2) }] };
    }
  }
);

server.tool(
  "stop_service",
  "Stop one or more CUCM services via ControlCenterServicesEx. " +
    "DESTRUCTIVE: stops services on the CUCM node. Use with caution.",
  {
    host: z.string().describe("CUCM host/IP"),
    port: z.number().int().min(1).max(65535).optional(),
    auth: dimeAuthSchema,
    serviceNames: z.array(z.string().min(1)).min(1).describe("Service names to stop"),
    timeoutMs: z.number().int().min(1000).max(300_000).optional(),
  },
  WRITE_DESTRUCTIVE,
  async ({ host, port, auth, serviceNames, timeoutMs }) => {
    try {
      const result = await stopService(host, serviceNames, auth as DimeAuth | undefined, port, timeoutMs);
      return { content: [{ type: "text", text: `Stopped ${serviceNames.length} service(s)\n\n${JSON.stringify(result, null, 2)}` }] };
    } catch (e) {
      return { content: [{ type: "text", text: JSON.stringify({ error: true, message: formatUnknownError(e) }, null, 2) }] };
    }
  }
);

server.tool(
  "restart_service",
  "Restart one or more CUCM services via ControlCenterServicesEx. " +
    "DESTRUCTIVE: restarts services on the CUCM node. Use with caution.",
  {
    host: z.string().describe("CUCM host/IP"),
    port: z.number().int().min(1).max(65535).optional(),
    auth: dimeAuthSchema,
    serviceNames: z.array(z.string().min(1)).min(1).describe("Service names to restart"),
    timeoutMs: z.number().int().min(1000).max(300_000).optional(),
  },
  WRITE_DESTRUCTIVE,
  async ({ host, port, auth, serviceNames, timeoutMs }) => {
    try {
      const result = await restartService(host, serviceNames, auth as DimeAuth | undefined, port, timeoutMs);
      return { content: [{ type: "text", text: `Restarted ${serviceNames.length} service(s)\n\n${JSON.stringify(result, null, 2)}` }] };
    } catch (e) {
      return { content: [{ type: "text", text: JSON.stringify({ error: true, message: formatUnknownError(e) }, null, 2) }] };
    }
  }
);

server.tool(
  "list_services_extended",
  "List all deployable CUCM services with activation status via ControlCenterServicesEx. " +
    "Richer than get_service_status — shows service type and whether each service is activated/deployable.",
  {
    host: z.string().describe("CUCM host/IP"),
    port: z.number().int().min(1).max(65535).optional(),
    auth: dimeAuthSchema,
    timeoutMs: z.number().int().min(1000).max(120_000).optional(),
  },
  READ_ONLY_NETWORK,
  async ({ host, port, auth, timeoutMs }) => {
    try {
      const result = await getStaticServiceListExtended(host, auth as DimeAuth | undefined, port, timeoutMs);
      return { content: [{ type: "text", text: `Found ${result.length} service(s)\n\n${JSON.stringify(result, null, 2)}` }] };
    } catch (e) {
      return { content: [{ type: "text", text: JSON.stringify({ error: true, message: formatUnknownError(e) }, null, 2) }] };
    }
  }
);

// ---------------------------------------------------------------------------
// Log Presets (Schema-Aware Service Discovery)
// ---------------------------------------------------------------------------

server.tool(
  "select_sip_traces",
  "Collect SIP-related traces from Cisco CallManager and CTIManager. " +
    "Returns SDL trace files containing SIP signaling (INVITE/BYE), call setup flows, and codec negotiation.",
  {
    host: z.string().describe("CUCM host/IP"),
    port: z.number().int().min(1).max(65535).optional(),
    auth: dimeAuthSchema,
    minutesBack: z.number().int().min(1).max(10080).optional().describe("Minutes back from now (default 60)"),
    searchStr: z.string().optional().describe("Optional filename substring filter"),
    timezone: z.string().optional().describe("DIME timezone string (auto-detected if omitted)"),
  },
  READ_ONLY_NETWORK,
  async ({ host, port, auth, minutesBack, searchStr, timezone }) => {
    try {
      const result = await selectSipTraces({ host, minutesBack, searchStr, timezone, auth: auth as DimeAuth | undefined, port });
      return { content: [{ type: "text", text: `Found ${result.files.length} SIP trace file(s) [${result.services.join(", ")}]\n\n${JSON.stringify(result, null, 2)}` }] };
    } catch (e) {
      return { content: [{ type: "text", text: JSON.stringify({ error: true, message: formatUnknownError(e) }, null, 2) }] };
    }
  }
);

server.tool(
  "select_cti_traces",
  "Collect CTI-related traces from CTIManager and Extension Mobility. " +
    "Useful for debugging CTI port/route point issues and Extension Mobility login problems.",
  {
    host: z.string().describe("CUCM host/IP"),
    port: z.number().int().min(1).max(65535).optional(),
    auth: dimeAuthSchema,
    minutesBack: z.number().int().min(1).max(10080).optional().describe("Minutes back from now (default 60)"),
    searchStr: z.string().optional().describe("Optional filename substring filter"),
    timezone: z.string().optional().describe("DIME timezone string (auto-detected if omitted)"),
  },
  READ_ONLY_NETWORK,
  async ({ host, port, auth, minutesBack, searchStr, timezone }) => {
    try {
      const result = await selectCtiTraces({ host, minutesBack, searchStr, timezone, auth: auth as DimeAuth | undefined, port });
      return { content: [{ type: "text", text: `Found ${result.files.length} CTI trace file(s) [${result.services.join(", ")}]\n\n${JSON.stringify(result, null, 2)}` }] };
    } catch (e) {
      return { content: [{ type: "text", text: JSON.stringify({ error: true, message: formatUnknownError(e) }, null, 2) }] };
    }
  }
);

server.tool(
  "select_curri_logs",
  "Collect CURRI (Cisco Unified Routing Rules Interface) logs for external call control. " +
    "Captures XACML policy decisions for hybrid call routing scenarios.",
  {
    host: z.string().describe("CUCM host/IP"),
    port: z.number().int().min(1).max(65535).optional(),
    auth: dimeAuthSchema,
    minutesBack: z.number().int().min(1).max(10080).optional().describe("Minutes back from now (default 60)"),
    searchStr: z.string().optional().describe("Optional filename substring filter"),
    timezone: z.string().optional().describe("DIME timezone string (auto-detected if omitted)"),
  },
  READ_ONLY_NETWORK,
  async ({ host, port, auth, minutesBack, searchStr, timezone }) => {
    try {
      const result = await selectCurriLogs({ host, minutesBack, searchStr, timezone, auth: auth as DimeAuth | undefined, port });
      return { content: [{ type: "text", text: `Found ${result.files.length} CURRI log file(s) [${result.services.join(", ")}]\n\n${JSON.stringify(result, null, 2)}` }] };
    } catch (e) {
      return { content: [{ type: "text", text: JSON.stringify({ error: true, message: formatUnknownError(e) }, null, 2) }] };
    }
  }
);

// ---------------------------------------------------------------------------
// Batch Download
// ---------------------------------------------------------------------------

server.tool(
  "download_batch",
  "Download multiple files from CUCM via DIME in one operation. " +
    "Partial failures are tolerated — successfully downloaded files are returned alongside errors. Max 20 files.",
  {
    host: z.string().describe("CUCM host/IP"),
    port: z.number().int().min(1).max(65535).optional(),
    auth: dimeAuthSchema,
    filePaths: z.array(z.string().min(1)).min(1).max(20).describe("File paths to download (from select_logs/select_sip_traces results)"),
    outDir: z.string().optional().describe("Output directory (default /tmp/cucm-mcp/)"),
  },
  READ_ONLY_NETWORK,
  async ({ host, port, auth, filePaths, outDir }) => {
    try {
      const result = await downloadBatch(host, filePaths, { auth: auth as DimeAuth | undefined, port, outDir });
      const summary = `Downloaded ${result.downloaded.length}/${filePaths.length} file(s)` +
        (result.errors.length > 0 ? `, ${result.errors.length} error(s)` : "");
      return { content: [{ type: "text", text: `${summary}\n\n${JSON.stringify(result, null, 2)}` }] };
    } catch (e) {
      return { content: [{ type: "text", text: JSON.stringify({ error: true, message: formatUnknownError(e) }, null, 2) }] };
    }
  }
);

server.tool(
  "select_logs_cluster",
  "Discover all cluster nodes via SSH, then query logs from EVERY node in parallel. " +
    "Partial failures are tolerated — nodes that fail return an error entry alongside successful results. " +
    "Requires SSH access (for cluster discovery) and DIME access (for log queries).",
  {
    host: z.string().describe("CUCM publisher host/IP (used for SSH cluster discovery)"),
    port: z.number().int().min(1).max(65535).optional().describe("DIME port (default 8443)"),
    sshPort: z.number().int().min(1).max(65535).optional().describe("SSH port (default 22)"),
    auth: dimeAuthSchema.describe("DIME auth (also used as SSH fallback)"),
    sshAuth: sshAuthSchema.describe("SSH auth override (optional — falls back to DIME auth / env vars)"),
    minutesBack: z.number().int().min(1).max(10080).default(60).describe("How many minutes of logs to collect (default 60)"),
    serviceLogs: z.array(z.string()).optional().describe("CUCM service names to collect logs from"),
    systemLogs: z.array(z.string()).optional().describe("System log names to collect"),
    searchStr: z.string().optional().describe("Filter string"),
    timezone: z.string().optional().describe("Timezone string (default: auto-detect)"),
  },
  READ_ONLY_NETWORK,
  async ({ host, port, sshPort, auth, sshAuth, minutesBack, serviceLogs, systemLogs, searchStr, timezone }) => {
    try {
      const result = await selectLogsCluster(
        host,
        minutesBack,
        { serviceLogs, systemLogs, searchStr },
        {
          timezone,
          auth: auth as DimeAuth | undefined,
          sshAuth: sshAuth as { username: string; password: string } | undefined,
          port,
          sshPort,
        },
      );
      const totalFiles = result.nodes.reduce((sum, n) => sum + n.files.length, 0);
      const errorNodes = result.nodes.filter((n) => n.error).length;
      const summary = `${result.nodes.length} node(s), ${totalFiles} file(s) found` +
        (errorNodes > 0 ? `, ${errorNodes} node(s) with errors` : "");
      return { content: [{ type: "text", text: `${summary}\n\n${JSON.stringify(result, null, 2)}` }] };
    } catch (e) {
      return { content: [{ type: "text", text: JSON.stringify({ error: true, message: formatUnknownError(e) }, null, 2) }] };
    }
  }
);

// ---------------------------------------------------------------------------
// AXL WSDL Self-Discovery
// ---------------------------------------------------------------------------

server.tool(
  "axl_list_operations",
  "Parse the AXL WSDL and return all available operations grouped by type (list/get/add/update/remove/do/apply). " +
    "Use this to discover what AXL operations are available before calling axl_execute.",
  {
    host: z.string().describe("CUCM host/IP"),
    port: z.number().int().min(1).max(65535).optional(),
    auth: axlAuthSchema,
  },
  READ_ONLY_NETWORK,
  async ({ host, port, auth }) => {
    try {
      const resolvedAuth = {
        username: auth?.username || process.env.CUCM_USERNAME || "",
        password: auth?.password || process.env.CUCM_PASSWORD || "",
      };
      if (!resolvedAuth.username || !resolvedAuth.password) throw new Error("Missing AXL credentials");
      const result = await listAxlOperations(host, resolvedAuth, port);
      return { content: [{ type: "text", text: `${result.totalOperations} AXL operation(s)\n\n${JSON.stringify(result, null, 2)}` }] };
    } catch (e) {
      return { content: [{ type: "text", text: JSON.stringify({ error: true, message: formatUnknownError(e) }, null, 2) }] };
    }
  }
);

server.tool(
  "axl_describe_operation",
  "Parse the AXL WSDL for a specific operation and return its input/output field schema. " +
    "Use after axl_list_operations to understand what fields an operation expects.",
  {
    host: z.string().describe("CUCM host/IP"),
    port: z.number().int().min(1).max(65535).optional(),
    auth: axlAuthSchema,
    operation: z.string().min(1).describe("AXL operation name (e.g. listPhone, getLine, addPhone)"),
  },
  READ_ONLY_NETWORK,
  async ({ host, port, auth, operation }) => {
    try {
      const resolvedAuth = {
        username: auth?.username || process.env.CUCM_USERNAME || "",
        password: auth?.password || process.env.CUCM_PASSWORD || "",
      };
      if (!resolvedAuth.username || !resolvedAuth.password) throw new Error("Missing AXL credentials");
      const result = await describeAxlOperation(host, resolvedAuth, operation, port);
      return { content: [{ type: "text", text: `${operation}: ${result.inputFields.length} input field(s), ${result.outputFields.length} output field(s)\n\n${JSON.stringify(result, null, 2)}` }] };
    } catch (e) {
      return { content: [{ type: "text", text: JSON.stringify({ error: true, message: formatUnknownError(e) }, null, 2) }] };
    }
  }
);

// ---------------------------------------------------------------------------
// Trace Configuration
// ---------------------------------------------------------------------------

server.tool(
  "get_trace_config",
  "Get the current trace/debug level for a CUCM service. " +
    "Uses AXL SQL to query the internal trace configuration tables. " +
    "Returns trace level (Error → Detailed), enabled status, and raw config.",
  {
    host: z.string().describe("CUCM host/IP"),
    port: z.number().int().min(1).max(65535).optional(),
    auth: axlAuthSchema,
    serviceName: z.string().min(1).describe("CUCM service name (e.g. 'Cisco CallManager', 'Cisco CTIManager')"),
  },
  READ_ONLY_NETWORK,
  async ({ host, port, auth, serviceName }) => {
    try {
      const result = await getTraceConfig(host, serviceName, {
        auth: auth as AxlAuth | undefined,
        port,
      });
      const summary = result.map((r) => `${r.service}: ${r.traceLevel} (enabled=${r.enabled})`).join(", ");
      return { content: [{ type: "text", text: `${summary}\n\n${JSON.stringify(result, null, 2)}` }] };
    } catch (e) {
      return { content: [{ type: "text", text: JSON.stringify({ error: true, message: formatUnknownError(e) }, null, 2) }] };
    }
  }
);

server.tool(
  "set_trace_level",
  "Set the debug trace level for a CUCM service via AXL SQL. " +
    "Changes take effect immediately for most services. " +
    "Levels (least→most verbose): Error, Special, State Transition, Significant, Entry/Exit, Arbitrary, Detailed. " +
    "WARNING: Detailed tracing impacts performance — use only for active debugging.",
  {
    host: z.string().describe("CUCM host/IP"),
    port: z.number().int().min(1).max(65535).optional(),
    auth: axlAuthSchema,
    serviceName: z.string().min(1).describe("CUCM service name (e.g. 'Cisco CallManager', 'Cisco CTIManager')"),
    level: z.enum(TRACE_LEVELS).describe("Debug trace level"),
    enableTrace: z.boolean().optional().default(true).describe("Enable tracing (default: true)"),
  },
  WRITE_DESTRUCTIVE,
  async ({ host, port, auth, serviceName, level, enableTrace }) => {
    try {
      const result = await setTraceLevel(host, serviceName, level, {
        auth: auth as AxlAuth | undefined,
        port,
        enableTrace,
      });
      const summary = `${result.service}: ${result.previousLevel} → ${result.newLevel} (${result.rowsUpdated} row(s) updated)`;
      return { content: [{ type: "text", text: `${summary}\n\n${JSON.stringify(result, null, 2)}` }] };
    } catch (e) {
      return { content: [{ type: "text", text: JSON.stringify({ error: true, message: formatUnknownError(e) }, null, 2) }] };
    }
  }
);

// ---------------------------------------------------------------------------
// SSH Diagnostic Tools (Extended)
// ---------------------------------------------------------------------------

server.tool(
  "show_status",
  "Get CUCM system status via SSH (show status). Returns hostname, platform, CPU%, memory, disk usage, and uptime.",
  {
    host: z.string().describe("CUCM host/IP"),
    sshPort: z.number().int().min(1).max(65535).optional(),
    auth: sshAuthSchema,
    timeoutMs: z.number().int().min(5000).max(120_000).optional(),
  },
  READ_ONLY_NETWORK,
  async ({ host, sshPort, auth, timeoutMs }) => {
    try {
      const result = await showStatus(host, {
        auth: auth as SshAuth | undefined,
        sshPort,
        timeoutMs,
      });
      const summary = `${result.hostname} | CPU: ${result.cpuPercent}% | Memory: ${result.memoryUsedMb}/${result.memoryTotalMb} MB | Uptime: ${result.uptime}`;
      return { content: [{ type: "text", text: `${summary}\n\n${JSON.stringify(result, null, 2)}` }] };
    } catch (e) {
      return { content: [{ type: "text", text: JSON.stringify({ error: true, message: formatUnknownError(e) }, null, 2) }] };
    }
  }
);

server.tool(
  "show_network_eth0",
  "Get CUCM network interface details via SSH (show network eth0 detail). Returns IP, subnet, gateway, DNS, link speed, duplex.",
  {
    host: z.string().describe("CUCM host/IP"),
    sshPort: z.number().int().min(1).max(65535).optional(),
    auth: sshAuthSchema,
    timeoutMs: z.number().int().min(5000).max(120_000).optional(),
  },
  READ_ONLY_NETWORK,
  async ({ host, sshPort, auth, timeoutMs }) => {
    try {
      const result = await showNetworkEth0(host, {
        auth: auth as SshAuth | undefined,
        sshPort,
        timeoutMs,
      });
      const summary = `${result.ipAddress}/${result.ipMask} | GW: ${result.gateway} | DNS: ${result.dnsPrimary} | ${result.speed} ${result.duplex}`;
      return { content: [{ type: "text", text: `${summary}\n\n${JSON.stringify(result, null, 2)}` }] };
    } catch (e) {
      return { content: [{ type: "text", text: JSON.stringify({ error: true, message: formatUnknownError(e) }, null, 2) }] };
    }
  }
);

// ---------------------------------------------------------------------------
// Coordinated dual-perspective call capture tools
// ---------------------------------------------------------------------------

/** Auth schema for coordinated capture: SSH, AXL, and DIME credentials unified */
const coordAuthSchema = z
  .object({
    sshUser: z.string().optional(),
    sshPassword: z.string().optional(),
    axlUser: z.string().optional(),
    axlPassword: z.string().optional(),
    dimeUser: z.string().optional(),
    dimePassword: z.string().optional(),
  })
  .optional()
  .describe(
    "Auth credentials. If axlUser/axlPassword are omitted, sshUser/sshPassword are used for AXL too. If dimeUser/dimePassword are omitted, sshUser/sshPassword are used for DIME."
  );

server.tool(
  "coordinated_capture_start",
  "Start a coordinated dual-perspective call capture: simultaneously begins a CUCM SSH packet capture (eth0, filtered to the phone's IP) AND enables Embedded Packet Capture (EPC) on the phone via AXL. Returns a coordId and session info. After starting, make a test call, then call coordinated_capture_stop_analyze to stop both, download both .cap files, and get a cross-correlated RTP/loss analysis.",
  {
    host: z.string().describe("CUCM IP or hostname"),
    auth: coordAuthSchema,
    deviceName: z.string().describe("Phone device name, e.g. SEP505C885DF37F"),
    fileBase: z.string().optional().describe("Base name for CUCM capture file (default: cap_<deviceName>_<timestamp>)"),
    phoneCaptureDurationSeconds: z.number().int().min(10).max(3600).optional().describe("How long the phone EPC runs in seconds (default: 60)"),
    dimePort: z.number().int().min(1).max(65535).optional().describe("DIME port (default: 8443)"),
    axlPort: z.number().int().min(1).max(65535).optional(),
    risPort: z.number().int().min(1).max(65535).optional(),
    sshPort: z.number().int().min(1).max(65535).optional(),
    portFilter: z.number().int().optional().describe("Optional packet capture port filter"),
    maxDurationMs: z.number().int().optional().describe("Max CUCM capture duration ms (default: 300000)"),
    startTimeoutMs: z.number().int().optional(),
  },
  WRITE_SAFE,
  async (args) => {
    try {
      const session = await coordinatedCaptureStart({
        ...args,
        auth: args.auth as CoordCaptureAuth | undefined,
      });
      const summary = `Coordinated capture started | coordId: ${session.coordId} | phone: ${session.deviceName} @ ${session.phoneIp} | cucmCaptureId: ${session.cucmCaptureId}`;
      return { content: [{ type: "text", text: `${summary}\n\nNow make a test call. Then call coordinated_capture_stop_analyze with the coordId.\n\n${JSON.stringify(session, null, 2)}` }] };
    } catch (e) {
      return { content: [{ type: "text", text: JSON.stringify({ error: true, message: formatUnknownError(e) }, null, 2) }] };
    }
  }
);

server.tool(
  "coordinated_capture_stop_analyze",
  "Stop a coordinated call capture (started with coordinated_capture_start), download both the CUCM SSH capture and the phone EPC capture, run tshark analysis on each, and cross-correlate RTP streams to diagnose where packet loss or jitter is occurring (last-mile between CUCM and phone, vs upstream before CUCM).",
  {
    coordId: z.string().optional().describe("coordId from coordinated_capture_start (optional if providing cucmCaptureId directly)"),
    cucmCaptureId: z.string().optional().describe("CUCM capture session ID (from coordinated_capture_start cucmCaptureId field)"),
    host: z.string().optional().describe("CUCM IP (required if not derivable from state)"),
    deviceName: z.string().optional().describe("Phone device name (e.g. SEP505C885DF37F)"),
    phoneIp: z.string().optional().describe("Phone IP address (used to scope analysis)"),
    phoneCaptureFileCandidates: z.array(z.string()).optional().describe("Override TFTP candidate paths for phone EPC file"),
    dimePort: z.number().int().min(1).max(65535).optional(),
    auth: coordAuthSchema,
    stopTimeoutMs: z.number().int().optional(),
    downloadTimeoutMs: z.number().int().optional(),
    downloadPollIntervalMs: z.number().int().optional(),
  },
  WRITE_SAFE,
  async (args) => {
    try {
      const analysis = await coordinatedCaptureStopAnalyze(
        { ...args, auth: args.auth as CoordCaptureAuth | undefined },
        captureState
      );
      const c = analysis.correlation;
      const summary = [
        `Coordinated capture analysis complete | ${analysis.deviceName} @ ${analysis.phoneIp}`,
        `CUCM capture: ${analysis.cucm.bytes} bytes | Phone capture: ${analysis.phone.available ? `${analysis.phone.bytes} bytes` : "NOT AVAILABLE"}`,
        `RTP coverage: ${c.rtpCoverage} | Common SSRCs: ${c.commonRtpSsrcs.length}`,
        `Verdict: ${c.verdict}`,
      ].join("\n");
      return { content: [{ type: "text", text: `${summary}\n\n${JSON.stringify(analysis, null, 2)}` }] };
    } catch (e) {
      return { content: [{ type: "text", text: JSON.stringify({ error: true, message: formatUnknownError(e) }, null, 2) }] };
    }
  }
);

server.tool(
  "phone_capture_download",
  "Standalone tool to download a phone's Embedded Packet Capture (EPC) file from CUCM's TFTP directory. Tries multiple candidate paths (CUCM version dependent). Use after a phone EPC session has been manually enabled or after coordinated_capture_start without a paired stop.",
  {
    host: z.string().describe("CUCM IP or hostname"),
    deviceName: z.string().describe("Phone device name, e.g. SEP505C885DF37F"),
    dimePort: z.number().int().min(1).max(65535).optional().describe("DIME port (default: 8443)"),
    auth: coordAuthSchema,
    outFile: z.string().optional().describe("Override output file path (default: /tmp/cucm-mcp/<DEVICE>_epc_<ts>.cap)"),
    downloadTimeoutMs: z.number().int().optional(),
  },
  WRITE_SAFE,
  async (args) => {
    try {
      const result = await phoneCaptureDownload({
        ...args,
        auth: args.auth as CoordCaptureAuth | undefined,
      });
      const summary = `Phone EPC downloaded: ${result.savedPath} (${result.bytes} bytes) | Found at: ${result.foundAt}`;
      return { content: [{ type: "text", text: `${summary}\n\n${JSON.stringify(result, null, 2)}` }] };
    } catch (e) {
      return { content: [{ type: "text", text: JSON.stringify({ error: true, message: formatUnknownError(e) }, null, 2) }] };
    }
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);
