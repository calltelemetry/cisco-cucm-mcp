# cisco-cucm-mcp

[![CI](https://github.com/calltelemetry/cisco-cucm-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/calltelemetry/cisco-cucm-mcp/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/@calltelemetry/cisco-cucm-mcp)](https://www.npmjs.com/package/@calltelemetry/cisco-cucm-mcp)
[![npm downloads](https://img.shields.io/npm/dm/@calltelemetry/cisco-cucm-mcp)](https://www.npmjs.com/package/@calltelemetry/cisco-cucm-mcp)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Built by [Call Telemetry](https://calltelemetry.com) — realtime tools for Cisco Collaboration.

[![Install in Claude Code](https://img.shields.io/badge/Claude_Code-Install-5A28E4?logo=claude)](https://claude.ai/mcp/install?repo=calltelemetry/cisco-cucm-mcp)
[![Install in Cursor](https://img.shields.io/badge/Cursor-Install-2D2D2D?logo=cursor)](https://cursor.com/mcp/install?repo=calltelemetry/cisco-cucm-mcp)

MCP (Model Context Protocol) server for Cisco CUCM operational debugging — 61 tools covering logs, device inventory, performance monitoring, packet capture, call analysis, service control, AXL discovery, certificates, backups, CTI status, cluster topology, and more.

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        CUCM Cluster                             │
├──────────┬──────────┬──────────┬──────────────┬────────────────┤
│ DIME     │ RisPort  │ PerfMon  │ ControlCenter│ ControlCenter  │
│ :8443    │ :8443    │ :8443    │ :8443        │ Extended :8443 │
│          │          │          │              │                │
│ Logs     │ Device   │ Counters │ Service      │ Start/Stop/    │
│ CDR      │ status   │ Sessions │ status       │ Restart        │
│ Files    │ CTI      │          │              │ Service list   │
├──────────┴──────────┼──────────┴──────────────┴────────────────┤
│ AXL :8443           │ SSH :22                                  │
│                     │                                          │
│ Phone config        │ Version, cluster, status, network,       │
│ 300+ operations     │ certs, backups, packet capture           │
│ WSDL discovery      │                                          │
└─────────────────────┴──────────────────────────────────────────┘
                      ▲
                      │  cisco-cucm-mcp — 61 MCP tools
                      ▼
              ┌───────────────┐
              │  MCP Client   │
              │ (Claude, etc) │
              └───────────────┘
```

## Capabilities

- **DIME Log Collection** — Query and download trace/log files via CUCM DIME SOAP services on `:8443`
- **Log Presets** — Schema-aware presets for SIP traces, CTI traces, and CURRI routing logs
- **Batch Download** — Download multiple log files in one operation with partial failure tolerance
- **Syslog** — Query and download system log files via DIME
- **RisPort70 (Real-time Device Status)** — Query phone/gateway/trunk registration status via selectCmDevice, auto-paginating for large clusters (>1000 devices)
- **CTI Status** — Query real-time CTI ports, route points, and application connections via selectCtiItem
- **PerfMon (Performance Monitoring)** — Collect real-time counters, open monitoring sessions for continuous polling, add/remove counters
- **ControlCenter (Service Status)** — Query CUCM service health: Started, Stopped, Not Activated (read-only)
- **Service Control** — Start, stop, restart CUCM services via ControlCenterServicesEx; list all deployable services
- **CDR on Demand** — List and download CDR/CMR files by time range via CDRonDemandService + DIME
- **Cluster Health Check** — One-shot health: devices + counters + services in parallel with partial failure tolerance
- **AXL Discovery** — Parse WSDL to list all AXL operations and describe their input/output schemas
- **SSH CLI Tools** — Version info, cluster topology, system status, network details via CUCM CLI over SSH
- **Certificate Status** — List TLS certificates (own/trust) via CUCM CLI over SSH
- **DRF Backup Status** — Check backup job status and history via CUCM CLI over SSH
- **Packet Capture** — Start/stop captures via CUCM CLI over SSH, download `.cap` files via DIME
- **Pcap Analysis** — Analyze captured pcaps locally via tshark: SIP flows, SCCP messages, RTP quality metrics
- **SDL Trace Parser** — Parse SDL trace files into structured signals and call flows (local analysis)
- **Rate Limiting** — Auto-retry with exponential backoff on CUCM rate limits (HTTP 503)

## Installation

```bash
npx @calltelemetry/cisco-cucm-mcp
```

## Quick Start

### Claude Code

```bash
claude mcp add cucm -- npx -y @calltelemetry/cisco-cucm-mcp@latest
```

### Manual Configuration

Add to your `.mcp.json` (credentials come from env vars — see [Auth Best Practices](#auth-best-practices)):

```json
{
  "mcpServers": {
    "cucm": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@calltelemetry/cisco-cucm-mcp@latest"]
    }
  }
}
```

Or pass credentials explicitly via the `env` block (not recommended — prefer shell env vars):

```json
{
  "mcpServers": {
    "cucm": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@calltelemetry/cisco-cucm-mcp@latest"],
      "env": {
        "CUCM_DIME_USERNAME": "<dime-user>",
        "CUCM_DIME_PASSWORD": "<dime-pass>",
        "CUCM_SSH_USERNAME": "<ssh-user>",
        "CUCM_SSH_PASSWORD": "<ssh-pass>"
      }
    }
  }
}
```

### Verify Installation

After setup, verify the connection by running:

```
→ guess_timezone_string({})
{ "timezone": "Client: (GMT-6:0)America/Chicago" }
```

## Configuration

### Shared Credentials

| Variable | Description |
|----------|-------------|
| `CUCM_USERNAME` | Shared default username (fallback for DIME, AXL, RIS, PerfMon, ControlCenter) |
| `CUCM_PASSWORD` | Shared default password |

### DIME (HTTPS on :8443)

| Variable | Description |
|----------|-------------|
| `CUCM_DIME_USERNAME` | DIME SOAP username |
| `CUCM_DIME_PASSWORD` | DIME SOAP password |
| `CUCM_DIME_PORT` | DIME port (default: `8443`) |

### SSH (CLI)

| Variable | Description |
|----------|-------------|
| `CUCM_SSH_USERNAME` | SSH username (often `administrator`) |
| `CUCM_SSH_PASSWORD` | SSH password |
| `CUCM_SSH_PORT` | SSH port (default: `22`) |

### AXL (Phone Configuration)

| Variable | Description |
|----------|-------------|
| `CUCM_AXL_USERNAME` | AXL username (falls back to DIME creds) |
| `CUCM_AXL_PASSWORD` | AXL password (falls back to DIME creds) |

### TLS

CUCM lab environments often use self-signed certificates. By default this server sets `NODE_TLS_REJECT_UNAUTHORIZED=0`.

| Variable | Description |
|----------|-------------|
| `CUCM_MCP_TLS_MODE` | `permissive` (default) or `strict` |

### tshark (Pcap Analysis)

The pcap analysis tools require **tshark** (Wireshark CLI). Discovered automatically:

1. `TSHARK_PATH` env var
2. `tshark` in PATH
3. `/Applications/Wireshark.app/Contents/MacOS/tshark` (macOS)
4. `/usr/bin/tshark` (Linux)
5. `/opt/homebrew/bin/tshark` (Homebrew)

| Variable | Description |
|----------|-------------|
| `TSHARK_PATH` | Override tshark binary location |
| `CUCM_MCP_TSHARK_TIMEOUT_MS` | Execution timeout (default: `60000`) |

### Serviceability APIs (RIS, PerfMon, ControlCenter)

These APIs share the same credentials and port as DIME. No additional environment variables needed.

### AXL WSDL Cache

AXL WSDL and XSD schemas are cached to disk so `axl_list_operations` and `axl_describe_operation` return instantly after the first fetch. The cache has no expiration — it persists until manually cleared.

| Variable | Description |
|----------|-------------|
| `CUCM_MCP_WSDL_CACHE_DIR` | Cache directory (default: `~/.cisco-cucm-mcp/wsdl-cache/`) |

Cache files are stored as `{host}_{port}.json`. To force a re-fetch, delete the cache directory or call `clearWsdlCache()` programmatically.

### Capture State Persistence

Packet capture metadata is persisted to a local JSON file for recovery after MCP restarts.

| Variable | Description |
|----------|-------------|
| `CUCM_MCP_STATE_PATH` | State file path (default: `./.cucm-mcp-state.json`) |
| `CUCM_MCP_CAPTURE_RUNNING_TTL_MS` | Running capture TTL (default: 6 hours) |
| `CUCM_MCP_CAPTURE_STOPPED_TTL_MS` | Stopped capture TTL (default: 24 hours) |

## Tools

### Log Collection (DIME)

| Tool | Description |
|------|-------------|
| `list_node_service_logs` | List CUCM cluster nodes and their available service logs |
| `select_logs` | Query log files with date/time criteria |
| `select_logs_minutes` | Convenience: find logs from the last N minutes |
| `select_syslog_minutes` | Convenience: find system logs from the last N minutes |
| `select_sip_traces` | Preset: collect SIP traces (CallManager + CTIManager) |
| `select_cti_traces` | Preset: collect CTI traces (CTIManager + Extension Mobility) |
| `select_curri_logs` | Preset: collect CURRI external call control logs |
| `download_file` | Download a single file via DIME |
| `download_batch` | Download multiple files in one operation (max 20, partial failure tolerant) |

### AXL (Phone Configuration)

| Tool | Description |
|------|-------------|
| `axl_execute` | Execute any AXL SOAP operation |
| `axl_download_wsdl` | Download the AXL WSDL schema |
| `axl_list_operations` | Parse WSDL — list all AXL operations grouped by type (list/get/add/update/remove) |
| `axl_describe_operation` | Parse WSDL — describe input/output schema for a specific operation |
| `get_trace_config` | Get current trace/debug level for a service (via AXL SQL) |
| `set_trace_level` | Set debug trace level for a service — Error through Detailed |
| `phone_packet_capture_enable` | Enable packet capture on a phone (updatePhone + applyPhone) |

### RisPort70 (Real-time Device Status)

| Tool | Description |
|------|-------------|
| `select_cm_device` | Query device registration status (phones, gateways, trunks) with filters. Returns `stateInfo` pagination cursor. |
| `select_cm_device_by_ip` | Convenience: look up device registration by IP address |
| `select_cm_device_all` | Auto-paginating query — iterates StateInfo to return ALL devices (clusters >1000 phones) |
| `select_cti_item` | Query real-time CTI ports, route points, and application connections |

### PerfMon (Performance Monitoring)

| Tool | Description |
|------|-------------|
| `perfmon_collect_counter_data` | Collect counter values for a PerfMon object (e.g. "Cisco CallManager") |
| `perfmon_list_counter` | Discover available PerfMon objects and counters |
| `perfmon_list_instance` | List instances of a PerfMon object |
| `perfmon_open_session` | Open a PerfMon monitoring session (returns handle) |
| `perfmon_add_counter` | Add counters to a session |
| `perfmon_collect_session_data` | Poll counter values from a session |
| `perfmon_remove_counter` | Remove counter(s) from a session without closing it |
| `perfmon_close_session` | Close a session |

### CDR on Demand

| Tool | Description |
|------|-------------|
| `cdr_get_file_list` | List CDR/CMR files by UTC time range (max 1 hour) |
| `cdr_get_file_list_minutes` | List CDR/CMR files from last N minutes (max 60) |
| `cdr_download_file` | Download a CDR/CMR file by filename (from `cdr_get_file_list` results) |

### ControlCenter (Service Status)

| Tool | Description |
|------|-------------|
| `get_service_status` | Query CUCM service status — Started, Stopped, Not Activated (read-only) |
| `list_services_extended` | List all deployable services with activation status (ControlCenterServicesEx) |
| `start_service` | Start one or more CUCM services (destructive) |
| `stop_service` | Stop one or more CUCM services (destructive) |
| `restart_service` | Restart one or more CUCM services (destructive) |

### Cluster Health

| Tool | Description |
|------|-------------|
| `cluster_health_check` | One-shot health: devices + counters + services in parallel |

### Certificate Status (SSH CLI)

| Tool | Description |
|------|-------------|
| `cert_list` | List TLS certificates on a CUCM node (own/trust/both) |

### DRF Backup Status (SSH CLI)

| Tool | Description |
|------|-------------|
| `drf_backup_status` | Current backup job status |
| `drf_backup_history` | Past backup history entries |

### SSH CLI Tools

| Tool | Description |
|------|-------------|
| `show_version` | Get CUCM version info (active/inactive version + build) |
| `show_network_cluster` | Get cluster node topology — hostname, IP, type, hub/spoke, replication status |
| `show_status` | System health: hostname, platform, CPU%, memory, disk usage, uptime |
| `show_network_eth0` | Network details: IP address, subnet, gateway, DNS, link speed, duplex |

### Packet Capture (SSH + DIME)

| Tool | Description |
|------|-------------|
| `packet_capture_start` | Start capture via CUCM CLI over SSH |
| `packet_capture_stop` | Stop a running capture |
| `packet_capture_stop_and_download` | Stop + download `.cap` via DIME (with retries) |
| `packet_capture_list` | List active in-memory captures |
| `packet_capture_state_list` | List captures from persistent state file |
| `packet_capture_state_get` | Get one capture record from state |
| `packet_capture_state_clear` | Delete a capture record from state |
| `packet_capture_download_from_state` | Download by captureId after MCP restart |

### Pcap Analysis (tshark)

These tools analyze downloaded `.cap` files so an LLM can reason about VoIP calls without opening Wireshark.

| Tool | Description |
|------|-------------|
| `pcap_call_summary` | High-level overview: protocols, endpoints, SIP/RTP counts |
| `pcap_sip_calls` | SIP call flows grouped by Call-ID with setup timing |
| `pcap_sccp_messages` | SCCP/Skinny messages with human-readable type names |
| `pcap_rtp_streams` | RTP quality per stream: jitter, packet loss, codec, duration |
| `pcap_protocol_filter` | Arbitrary tshark display filter for deeper investigation |

### SDL Trace Parser (Local Analysis)

| Tool | Description |
|------|-------------|
| `sdl_trace_parse` | Parse SDL trace into structured signals and call flows |
| `sdl_trace_call_flow` | Extract call flow for a specific call-id |

### Utility

| Tool | Description |
|------|-------------|
| `guess_timezone_string` | Build a DIME-compatible timezone string |

## Examples — LLM Conversations (Real CUCM 15 Output)

All examples below are real interactions with a live CUCM 15.0.1 cluster, showing how an LLM uses the tools conversationally.

---

### "What version of CUCM is running?"

> **User:** What version is my CUCM running?

<details><summary>Tool call: <code>show_version</code></summary>

```json
{ "host": "192.168.125.10" }
```

```json
{
  "activeVersion": "15.0.1.12900",
  "activeBuild": "234",
  "inactiveVersion": "",
  "inactiveBuild": ""
}
```

</details>

> **Assistant:** Your CUCM is running **15.0.1.12900** (build 234). There's no inactive version installed — this is a single-partition deployment.

---

### "How's the cluster health looking?"

> **User:** Give me a quick health check on the cluster.

The LLM calls three tools in parallel to assess system health:

<details><summary>Tool call: <code>show_status</code> — CPU, memory, disk</summary>

```json
{ "host": "192.168.125.10" }
```

```json
{
  "hostname": "cucm15-cluster1",
  "platform": "15.0.1.12900-234.x86_64",
  "cpuPercent": 49.75,
  "memoryTotalMb": 11718,
  "memoryUsedMb": 7173,
  "disks": [
    { "partition": "Disk/active",  "usedMb": 15765, "totalMb": 19297, "percent": 83 },
    { "partition": "Disk/logging", "usedMb": 24616, "totalMb": 67176, "percent": 39 }
  ],
  "uptime": "12:29"
}
```

</details>

<details><summary>Tool call: <code>show_network_cluster</code> — topology + replication</summary>

```json
{ "host": "192.168.125.10" }
```

```json
{
  "nodes": [
    {
      "hostname": "cucm15-cluster1",
      "ipAddress": "192.168.125.10",
      "type": "Publisher",
      "replicationStatus": "authenticated"
    }
  ]
}
```

</details>

<details><summary>Tool call: <code>get_service_status</code> — 81 services</summary>

```json
{ "host": "192.168.125.10" }
```

```json
[
  { "serviceName": "Cisco CallManager",        "serviceStatus": "Started" },
  { "serviceName": "Cisco CTIManager",         "serviceStatus": "Started" },
  { "serviceName": "Cisco Tftp",               "serviceStatus": "Started" },
  { "serviceName": "Cisco AXL Web Service",    "serviceStatus": "Started" },
  { "serviceName": "Cisco RIS Data Collector", "serviceStatus": "Started" },
  { "serviceName": "Cisco CDR Agent",          "serviceStatus": "Started" },
  "... 75 more services ..."
]
```

</details>

> **Assistant:** Cluster looks healthy:
>
> - **Node:** cucm15-cluster1 (Publisher, replication authenticated)
> - **CPU:** 49.75% — moderate load
> - **Memory:** 7,173 / 11,718 MB (61% used)
> - **Disk:** Active partition at 83% — keep an eye on this. Logging at 39%, plenty of room.
> - **Services:** 65 of 81 started — the 16 stopped are all "Not Activated" (Bulk Provisioning, DHCP, etc.), which is normal for a lab.
> - **Uptime:** 12 hours 29 minutes

---

### "Are all my phones registered?"

> **User:** Show me which phones are registered.

<details><summary>Tool call: <code>select_cm_device</code> — RIS real-time query</summary>

```json
{
  "host": "192.168.125.10",
  "deviceClass": "Phone",
  "status": "Any",
  "selectItems": ["*"]
}
```

```json
{
  "totalDevicesFound": 3,
  "cmNodes": [
    {
      "name": "cucm15-cluster1",
      "returnCode": "Ok",
      "devices": [
        {
          "name": "SEP000832C78E0F",
          "ipAddress": "192.168.125.85",
          "description": "Auto 1001",
          "dirNumber": "1001",
          "status": "Registered",
          "protocol": "SIP",
          "activeLoadId": "sip78xx.14-3-1-0001-60"
        },
        {
          "name": "SEP0022905C7710",
          "ipAddress": "192.168.125.178",
          "description": "Auto 1000 7975 Phone3",
          "dirNumber": "1000",
          "status": "Registered",
          "protocol": "SCCP",
          "activeLoadId": "SCCP75.9-4-2SR4-3S"
        },
        {
          "name": "SEP505C885DF37F",
          "ipAddress": "192.168.125.234",
          "description": "Auto 1003 9841",
          "dirNumber": "1003",
          "status": "Registered",
          "protocol": "SIP",
          "activeLoadId": "PHONEOS.3-2-1-0003-28"
        }
      ]
    }
  ]
}
```

</details>

> **Assistant:** All 3 phones are **Registered** on cucm15-cluster1:
>
> | Phone | DN | IP | Protocol | Firmware |
> |-------|----|----|----------|----------|
> | SEP000832C78E0F (7821) | 1001 | 192.168.125.85 | SIP | sip78xx.14-3-1 |
> | SEP0022905C7710 (7975) | 1000 | 192.168.125.178 | SCCP | SCCP75.9-4-2SR4 |
> | SEP505C885DF37F (9841) | 1003 | 192.168.125.234 | SIP | PHONEOS.3-2-1 |
>
> No unregistered or rejected devices found.

---

### "Check the certificates on CUCM"

> **User:** What TLS certs does CUCM have?

<details><summary>Tool call: <code>cert_list</code> — SSH CLI</summary>

```json
{ "host": "192.168.125.10", "type": "own" }
```

```json
[
  { "unit": "tomcat",            "name": "tomcat",            "issuer": "Self-signed" },
  { "unit": "tomcat-ECDSA",     "name": "tomcat-ECDSA",     "issuer": "Self-signed" },
  { "unit": "ipsec",            "name": "ipsec",            "issuer": "Self-signed" },
  { "unit": "ITLRecovery",      "name": "ITLRecovery",      "issuer": "Self-signed" },
  { "unit": "CallManager-ECDSA","name": "CallManager-ECDSA","issuer": "Self-signed" },
  { "unit": "CallManager",      "name": "CallManager",      "issuer": "Self-signed" },
  { "unit": "CAPF",             "name": "CAPF",             "issuer": "Self-signed" },
  { "unit": "TVS",              "name": "TVS",              "issuer": "Self-signed" }
]
```

</details>

> **Assistant:** CUCM has **8 identity certificates**, all self-signed:
>
> - **tomcat** / **tomcat-ECDSA** — Web admin UI
> - **CallManager** / **CallManager-ECDSA** — SIP TLS, phone signaling
> - **ipsec** — DRF backup encryption, IPSec tunnels
> - **ITLRecovery** — Initial Trust List recovery
> - **CAPF** — Certificate Authority Proxy Function (phone certs)
> - **TVS** — Trust Verification Service
>
> All are self-signed, which is typical for a lab. For production you'd want CA-signed certs on at least tomcat and CallManager.

---

### "Debug a call routing issue"

> **User:** A call from 1000 to 1001 isn't connecting. Can you capture what's happening?

The LLM chains multiple tools — starting a packet capture, then analyzing the SIP flow:

<details><summary>Tool call: <code>packet_capture_start</code> — filter SIP port 5060</summary>

```json
{
  "host": "192.168.125.10",
  "portFilter": 5060,
  "count": 5000
}
```

```json
{
  "captureId": "c2439a09-b082-4c91-ba1e-20b211f1a217",
  "status": "running",
  "startedAt": "2026-03-11T18:25:44.000Z"
}
```

</details>

> **Assistant:** Capture is running. Go ahead and place the call from 1000 to 1001 now — I'll stop and analyze when you're ready.

> **User:** Ok, call is done.

<details><summary>Tool call: <code>packet_capture_stop_and_download</code></summary>

```json
{
  "host": "192.168.125.10",
  "captureId": "c2439a09-b082-4c91-ba1e-20b211f1a217"
}
```

```json
{
  "localPath": "/tmp/cucm-mcp/readme-demo.cap",
  "fileSize": 10532,
  "status": "downloaded"
}
```

</details>

<details><summary>Tool call: <code>pcap_sip_calls</code> — SIP call ladder</summary>

```json
{ "filePath": "/tmp/cucm-mcp/readme-demo.cap" }
```

```json
{
  "calls": [
    {
      "callId": "6e51c0-60e94629-6-64257ec0@192.168.125.10",
      "from": "\"1000\" <sip:1000@192.168.125.10>",
      "to": "<sip:1001@192.168.125.10>",
      "messages": [
        { "method": "INVITE",  "timestamp": "18:25:56.742" },
        { "status": "100 Trying",  "timestamp": "18:25:56.743" },
        { "status": "180 Ringing", "timestamp": "18:25:56.754" },
        { "status": "200 OK",      "timestamp": "18:25:57.899" },
        { "method": "ACK",         "timestamp": "18:25:57.901" },
        { "method": "BYE",         "timestamp": "18:26:12.555" },
        { "status": "200 OK",      "timestamp": "18:26:12.556" }
      ],
      "setupTime": "1157 ms",
      "codec": "PCMU (G.711 u-law)"
    }
  ]
}
```

</details>

<details><summary>Tool call: <code>pcap_rtp_streams</code> — audio quality</summary>

```json
{ "filePath": "/tmp/cucm-mcp/readme-demo.cap" }
```

```json
{
  "streams": [
    {
      "src": "192.168.125.85:29390",
      "dst": "192.168.125.10:28770",
      "codec": "PCMU (G.711 u-law)",
      "packets": 748,
      "lost": 0,
      "lossPercent": "0.00%",
      "maxJitter": "0.00 ms",
      "duration": "14.9 s"
    }
  ]
}
```

</details>

> **Assistant:** The call actually completed successfully:
>
> - **INVITE → 100 → 180 → 200 OK → ACK** — clean setup in 1,157ms
> - **BYE → 200 OK** — clean teardown after ~15 seconds
> - **RTP:** 748 packets, **0% loss**, **0ms jitter** — perfect audio quality
> - **Codec:** G.711 u-law (PCMU)
>
> The SIP flow looks textbook. If the issue is intermittent, I'd suggest enabling Detailed trace level on Cisco CallManager and reproducing again — we can then pull the SDL traces for deeper analysis.

---

### "Pull recent CallManager traces"

> **User:** Get me the last hour of CallManager logs.

<details><summary>Tool call: <code>select_logs_minutes</code></summary>

```json
{
  "host": "192.168.125.10",
  "serviceLogs": ["Cisco CallManager"],
  "minutesBack": 60
}
```

```json
{
  "fromDate": "03/11/26 5:10 PM",
  "toDate": "03/11/26 6:10 PM",
  "files": [
    {
      "absolutePath": "/var/log/active/cm/trace/ccm/sdl/SDL001_100_000448.txt.gz",
      "name": "SDL001_100_000448.txt.gz",
      "filesize": 1049171,
      "modifiedDate": "Tue Mar 11 17:05:28 PDT 2026"
    }
  ]
}
```

</details>

<details><summary>Tool call: <code>download_file</code> → <code>sdl_trace_parse</code> (chained)</summary>

```json
{
  "savedPath": "/tmp/cucm-mcp/SDL001_100_000448.txt.gz",
  "bytes": 1049171
}
```

```json
{
  "totalLines": 47896,
  "parsedSignals": 17410,
  "signalSummary": {
    "CtiGetDeviceAndLineInfoReq": 3090,
    "CtiExistingCallEventReq": 3322,
    "SIPRegisterInd": 82,
    "StationRegister": 10
  }
}
```

</details>

> **Assistant:** Downloaded and parsed the SDL trace — **17,410 signals** across 47,896 lines. Key activity:
>
> - **CTI events** dominate (3,322 existing call events + 3,090 device info requests) — typical for a monitored cluster
> - **SIP registrations:** 82 re-registration events
> - **Station registrations:** 10 (likely phone reboots or config changes)
>
> Want me to drill into a specific call ID or look for error signals?

---

### "What AXL operations can I use for phones?"

> **User:** What can I do with phones through AXL?

<details><summary>Tool call: <code>axl_list_operations</code> (via <code>axl_execute</code>)</summary>

```json
{
  "operation": "listPhone",
  "data": {
    "searchCriteria": { "name": "SEP%" },
    "returnedTags": { "name": "", "model": "", "description": "" }
  }
}
```

```json
{
  "phone": [
    { "name": "SEP0022905C7710", "model": "Cisco 7975",  "description": "Auto 1000 7975 Phone3" },
    { "name": "SEP000832C78E0F", "model": "Cisco 7821",  "description": "Auto 1001" },
    { "name": "SEP505C885DF37F", "model": "Cisco 9841",  "description": "Auto 1003 9841" }
  ]
}
```

</details>

> **Assistant:** Your cluster has 3 phones configured in AXL:
>
> | Device | Model | Description |
> |--------|-------|-------------|
> | SEP0022905C7710 | Cisco 7975 | Auto 1000 7975 Phone3 |
> | SEP000832C78E0F | Cisco 7821 | Auto 1001 |
> | SEP505C885DF37F | Cisco 9841 | Auto 1003 9841 |
>
> Via `axl_execute` you can run any AXL operation — `getPhone`, `updatePhone`, `addPhone`, `removePhone`, `listPhone`. Use `axl_describe_operation` to see required fields for any operation.

## What Tool Do I Use?

| I want to... | Use these tools |
|---|---|
| Check phone registration | `select_cm_device` or `select_cm_device_all` |
| Debug SIP call setup | `select_sip_traces` → `download_batch` → `sdl_trace_parse` |
| Debug CURRI routing | `select_curri_logs` → `download_file` |
| Monitor call volume | `perfmon_collect_counter_data` (Cisco CallManager object) |
| Debug call quality | `packet_capture_start` → `pcap_sip_calls` + `pcap_rtp_streams` |
| Check cluster health | `cluster_health_check` (one-shot parallel) |
| Find recent logs | `select_logs_minutes` → `download_file` |
| Download many logs | `select_sip_traces` → `download_batch` |
| Query phone config | `axl_execute` with listPhone/getPhone |
| Discover AXL operations | `axl_list_operations` → `axl_describe_operation` |
| Check system resources | `show_status` (CPU, memory, disk, uptime) |
| Debug network issues | `show_network_eth0` (IP, gateway, DNS) |
| Check/change trace level | `get_trace_config` → `set_trace_level` (Detailed for debugging) |
| Restart stuck service | `restart_service` (requires confirmation) |

## Recommended Workflows

### Cluster Health Assessment

```
1. show_version             → CUCM version + build number
2. show_network_cluster     → Node topology, replication status
3. cluster_health_check     → One-shot: devices + counters + services (parallel)
4. select_cm_device_all     → Full device inventory (auto-paginates >1000 devices)
5. cert_list                → TLS certificate inventory (own + trust)
6. drf_backup_status        → Current backup job status
7. drf_backup_history       → Last successful backup date
```

### Log Investigation

```
1. list_node_service_logs   → Discover available services per node
2. select_logs_minutes      → Find trace files from last N minutes
3. download_file            → Download a specific trace to /tmp/cucm-mcp/
4. sdl_trace_parse          → Parse SDL trace into signals + call flows
5. sdl_trace_call_flow      → Drill into a specific call-id
```

### Continuous Performance Monitoring

```
1. perfmon_open_session     → Get session handle
2. perfmon_add_counter      → Subscribe to specific counters
3. perfmon_collect_session_data → Poll (repeat as needed)
4. perfmon_remove_counter   → Remove counters without closing session
5. perfmon_close_session    → Cleanup when done
```

### Packet Capture + Analysis

```
1. packet_capture_start     → Start capture (runs on CUCM in background)
2. (reproduce the issue)
3. packet_capture_stop_and_download → Stop + download .cap file
4. pcap_call_summary        → Quick triage: what's in the capture?
5. pcap_sip_calls           → SIP INVITE → 200 OK → BYE flows
6. pcap_rtp_streams         → Audio quality: jitter, loss, codec
```

### Auth Best Practices

**Use environment variables for credentials** — never hardcode them in `.mcp.json` or tool parameters. Set credentials in your shell profile (e.g. `~/.zshrc`) or use a secrets manager:

```bash
# In ~/.zshrc
export CUCM_DIME_USERNAME="your-cucm-admin"
export CUCM_DIME_PASSWORD="your-password"
export CUCM_SSH_USERNAME="your-ssh-user"
export CUCM_SSH_PASSWORD="your-ssh-password"
```

Then your `.mcp.json` stays credential-free:

```json
{
  "mcpServers": {
    "cucm": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@calltelemetry/cisco-cucm-mcp@latest"]
    }
  }
}
```

All tools accept optional `auth` parameters as overrides, but env vars are the recommended approach. Tool parameters are visible in LLM conversation history.

### Auth Fallback Chains

Each API resolves credentials through its own fallback chain:

| API | Fallback Order |
|-----|---------------|
| **DIME** | `auth` param → `CUCM_DIME_USERNAME` → `CUCM_USERNAME` |
| **AXL** | `auth` param → `CUCM_AXL_USERNAME` → `CUCM_USERNAME` → `CUCM_DIME_USERNAME` |
| **SSH** | `auth` param → `CUCM_SSH_USERNAME` *(no fallback)* |
| **RIS/PerfMon/ControlCenter** | Same as DIME |

Set `CUCM_USERNAME` / `CUCM_PASSWORD` as a shared default, then override per-API only when credentials differ.

CUCM deployments vary — SSH and DIME may accept different credentials:

```bash
# Verify DIME credentials (WSDL should return HTTP 200)
curl -k -u "$CUCM_DIME_USERNAME:$CUCM_DIME_PASSWORD" \
  "https://<cucm-host>:8443/logcollectionservice2/services/LogCollectionPortTypeService?wsdl" \
  -o /dev/null -w "%{http_code}\n"
```

## Troubleshooting

| Problem | Solution |
|---------|----------|
| Auth failures | Verify with `curl -k -u "$CUCM_DIME_USERNAME:$CUCM_DIME_PASSWORD" "https://host:8443/logcollectionservice2/services/LogCollectionPortTypeService?wsdl" -o /dev/null -w "%{http_code}\n"` — should return `200` |
| Rate limiting (HTTP 503) | RIS/PerfMon enforce ~15 req/min. Auto-retry with 5s→10s→20s backoff is built in. |
| `tshark` not found | pcap analysis tools require Wireshark CLI — `brew install wireshark` (macOS) or `apt install tshark` (Linux) |
| Self-signed TLS errors | Set `CUCM_MCP_TLS_MODE=permissive` (default) or add CUCM cert to system trust store |
| SSH "too many auth failures" | CUCM requires `keyboard-interactive` auth — handled automatically by this server |
| Node.js version | Requires Node.js >= 18 (for native `fetch` API) |
| Service control fails | ControlCenterServicesEx requires Standard Admin role on the CUCM user account |

## Changelog

See [CHANGELOG.md](CHANGELOG.md) for version history.

## Development

```bash
yarn install          # Install dependencies
yarn build            # Build with Vite
yarn test             # Run tests (vitest)
yarn test:coverage    # Run tests with coverage
yarn typecheck        # TypeScript type checking
yarn lint             # ESLint
yarn validate         # typecheck + lint + test
yarn dev              # Run from source (tsx)
```

## Publishing

Releases are automated via GitHub Actions on version tags:

```bash
# Bump version and tag
npm version patch     # or minor, major
git push --follow-tags
```

The publish workflow runs typecheck, tests, builds, publishes to npm, and creates a GitHub release.

## Acknowledgments

- [MCP SDK](https://github.com/modelcontextprotocol/sdk) — Model Context Protocol framework
- [fast-xml-parser](https://github.com/NaturalIntelligence/fast-xml-parser) — XML parsing
- [ssh2](https://github.com/mscdex/ssh2) — SSH client for CUCM CLI
- [tshark/Wireshark](https://www.wireshark.org/) — Pcap analysis

## License

MIT — see [LICENSE](LICENSE)
