# Cisco CUCM MCP

[![npm](https://img.shields.io/npm/v/@calltelemetry/cisco-cucm-mcp)](https://www.npmjs.com/package/@calltelemetry/cisco-cucm-mcp)
[![CI](https://github.com/calltelemetry/cisco-cucm-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/calltelemetry/cisco-cucm-mcp/actions/workflows/ci.yml)
[![codecov](https://codecov.io/gh/calltelemetry/cisco-cucm-mcp/branch/main/graph/badge.svg)](https://codecov.io/gh/calltelemetry/cisco-cucm-mcp)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

[![Install in Claude Code](https://img.shields.io/badge/Claude_Code-Install-5A28E4?logo=claude)](https://claude.ai/mcp/install?repo=calltelemetry/cisco-cucm-mcp)
[![Install in Cursor](https://img.shields.io/badge/Cursor-Install-2D2D2D?logo=cursor)](https://cursor.com/mcp/install?repo=calltelemetry/cisco-cucm-mcp)

MCP (Model Context Protocol) server for Cisco CUCM operational debugging — 47 tools covering logs, device inventory, performance monitoring, packet capture, call analysis, certificates, backups, CTI status, cluster topology, and more.

## Capabilities

- **DIME Log Collection** — Query and download trace/log files via CUCM DIME SOAP services on `:8443`
- **Syslog** — Query and download system log files via DIME
- **RisPort70 (Real-time Device Status)** — Query phone/gateway/trunk registration status via selectCmDevice, auto-paginating for large clusters (>1000 devices)
- **CTI Status** — Query real-time CTI ports, route points, and application connections via selectCtiItem
- **PerfMon (Performance Monitoring)** — Collect real-time counters, open monitoring sessions for continuous polling, add/remove counters
- **ControlCenter (Service Status)** — Query CUCM service health: Started, Stopped, Not Activated (read-only)
- **CDR on Demand** — List and download CDR/CMR files by time range via CDRonDemandService + DIME
- **Cluster Health Check** — One-shot health: devices + counters + services in parallel with partial failure tolerance
- **SSH CLI Tools** — Version info, cluster topology via CUCM CLI over SSH
- **Certificate Status** — List TLS certificates (own/trust) via CUCM CLI over SSH
- **DRF Backup Status** — Check backup job status and history via CUCM CLI over SSH
- **Packet Capture** — Start/stop captures via CUCM CLI over SSH, download `.cap` files via DIME
- **Pcap Analysis** — Analyze captured pcaps locally via tshark: SIP flows, SCCP messages, RTP quality metrics
- **SDL Trace Parser** — Parse SDL trace files into structured signals and call flows (local analysis)

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

## Configuration

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
| `download_file` | Download a single file via DIME |

### AXL (Phone Configuration)

| Tool | Description |
|------|-------------|
| `axl_execute` | Execute any AXL SOAP operation |
| `axl_download_wsdl` | Download the AXL WSDL schema |
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

## Examples (Real CUCM 15 Output)

All examples below are verified output from a live CUCM 15.0.1 cluster.

### Discover Cluster Nodes and Service Logs

```
→ list_node_service_logs({ host: "192.168.125.10" })

[
  {
    "server": "cucm15-cluster1.calltelemetry.local",
    "count": 150,
    "serviceLogs": [
      "Cisco CallManager",
      "Cisco CTIManager",
      "Cisco Tftp",
      "Cisco Certificate Change Notification",
      "Cisco DRF Master",
      ...
    ]
  }
]
```

### Query Phone Inventory via AXL

```
→ axl_execute({
    cucm_host: "192.168.125.10",
    operation: "listPhone",
    data: {
      searchCriteria: { name: "SEP%" },
      returnedTags: { name: "", model: "", description: "" }
    }
  })

{
  "phone": [
    { "name": "SEP0022905C7710", "model": "Cisco 7975",  "description": "Auto 1000 7975 Phone3" },
    { "name": "SEP000832C78E0F", "model": "Cisco 7821",  "description": "Jason 7821"            },
    { "name": "SEP505C885DF37F", "model": "Cisco 9841",  "description": "Cisco 9841 SIP"        }
  ]
}
```

### Collect Recent Trace Files

```
→ select_logs_minutes({
    host: "192.168.125.10",
    serviceLogs: ["Cisco CallManager"],
    minutesBack: 1440
  })

{
  "fromDate": "02/28/26 9:45 AM",
  "toDate": "03/01/26 9:45 AM",
  "timezone": "Client: (GMT-6:0)America/Chicago",
  "files": [
    {
      "server": "192.168.125.10",
      "absolutePath": "/var/log/active/cm/trace/ccm/sdl/SDL001_100_000448.txt.gz",
      "name": "SDL001_100_000448.txt.gz",
      "filesize": 1049171,
      "modifiedDate": "Sat Feb 28 15:05:28 PST 2026"
    },
    ...
  ]
}
```

### Query Registered Phones (RisPort70)

```
→ select_cm_device({
    host: "192.168.125.10",
    deviceClass: "Phone",
    status: "Any",
    selectItems: ["*"]
  })

{
  "totalDevicesFound": 3,
  "cmNodes": [
    {
      "name": "cucm15-cluster1",
      "returnCode": "Ok",
      "devices": [
        {
          "name": "SEP0022905C7710",
          "ipAddress": "192.168.125.178",
          "description": "Auto 1000 7975 Phone3",
          "dirNumber": "1000-Registered",
          "status": "Registered",
          "protocol": "SCCP",
          "activeLoadId": "SCCP75.9-4-2SR4-3S"
        },
        {
          "name": "SEP505C885DF37F",
          "ipAddress": "192.168.125.234",
          "description": "Auto 1003 9841",
          "dirNumber": "1003-Registered",
          "status": "Registered",
          "protocol": "SIP",
          "activeLoadId": "PHONEOS.3-2-1-0003-28"
        },
        {
          "name": "SEP000832C78E0F",
          "ipAddress": "192.168.125.85",
          "description": "Auto 1001",
          "dirNumber": "1001-Registered",
          "status": "Registered",
          "protocol": "SIP",
          "activeLoadId": "sip78xx.14-3-1-0001-60"
        }
      ]
    }
  ]
}
```

### Look Up Device by IP (RisPort70)

```
→ select_cm_device_by_ip({
    host: "192.168.125.10",
    ipAddress: "192.168.125.*"
  })

{
  "totalDevicesFound": 3,
  "cmNodes": [
    {
      "name": "cucm15-cluster1",
      "returnCode": "Ok",
      "devices": [
        { "name": "SEP0022905C7710", "ipAddress": "192.168.125.178", "status": "Registered", "protocol": "SCCP" },
        { "name": "SEP505C885DF37F", "ipAddress": "192.168.125.234", "status": "Registered", "protocol": "SIP"  },
        { "name": "SEP000832C78E0F", "ipAddress": "192.168.125.85",  "status": "Registered", "protocol": "SIP"  }
      ]
    }
  ]
}
```

### Collect Performance Counters (PerfMon — One-Shot)

```
→ perfmon_collect_counter_data({
    host: "192.168.125.10",
    perfmonHost: "192.168.125.10",
    object: "Cisco CallManager"
  })

[
  { "name": "\\\\192.168.125.10\\Cisco CallManager\\CallsActive", "value": 0, "cStatus": 0 },
  { "name": "\\\\192.168.125.10\\Cisco CallManager\\CallsAttempted", "value": 54, "cStatus": 0 },
  { "name": "\\\\192.168.125.10\\Cisco CallManager\\CallsCompleted", "value": 44, "cStatus": 0 },
  { "name": "\\\\192.168.125.10\\Cisco CallManager\\RegisteredHardwarePhones", "value": 3, "cStatus": 0 },
  { "name": "\\\\192.168.125.10\\Cisco CallManager\\RegisteredOtherStationDevices", "value": 5, "cStatus": 0 }
  // ... 134 counters total
]
```

### PerfMon Session Lifecycle (Continuous Monitoring)

**1. Open session:**

```
→ perfmon_open_session({ host: "192.168.125.10" })

{ "sessionHandle": "087b08be-1585-11f1-8000-000c2917beb2" }
```

**2. Add counters (use `\\host\Object\Counter` format):**

```
→ perfmon_add_counter({
    host: "192.168.125.10",
    sessionHandle: "087b08be-1585-11f1-8000-000c2917beb2",
    counters: [
      "\\\\192.168.125.10\\Cisco CallManager\\CallsActive",
      "\\\\192.168.125.10\\Cisco CallManager\\RegisteredHardwarePhones",
      "\\\\192.168.125.10\\Processor\\% CPU Time"
    ]
  })

Added 3 counter(s) to session 087b08be-1585-11f1-8000-000c2917beb2
```

**3. Poll values (call repeatedly to monitor trends):**

```
→ perfmon_collect_session_data({
    host: "192.168.125.10",
    sessionHandle: "087b08be-1585-11f1-8000-000c2917beb2"
  })

[
  { "name": "\\\\192.168.125.10\\Cisco CallManager\\CallsActive", "value": 0, "cStatus": 0 },
  { "name": "\\\\192.168.125.10\\Cisco CallManager\\RegisteredHardwarePhones", "value": 3, "cStatus": 0 },
  { "name": "\\\\192.168.125.10\\Processor\\% CPU Time", "value": 0, "cStatus": 2 }
]
```

**4. Close session when done:**

```
→ perfmon_close_session({
    host: "192.168.125.10",
    sessionHandle: "087b08be-1585-11f1-8000-000c2917beb2"
  })

Session 087b08be-1585-11f1-8000-000c2917beb2 closed
```

### Check Service Health (ControlCenter)

```
→ get_service_status({ host: "192.168.125.10" })

[
  { "serviceName": "Cisco CallManager",            "serviceStatus": "Started", "startTime": "..." },
  { "serviceName": "Cisco CTIManager",             "serviceStatus": "Started", "startTime": "..." },
  { "serviceName": "Cisco Tftp",                   "serviceStatus": "Started", "startTime": "..." },
  { "serviceName": "Cisco AXL Web Service",        "serviceStatus": "Started", "startTime": "..." },
  { "serviceName": "Cisco RIS Data Collector",     "serviceStatus": "Started", "startTime": "..." },
  { "serviceName": "Cisco CDR Agent",              "serviceStatus": "Started", "startTime": "..." },
  { "serviceName": "Cisco DHCP Monitor Service",   "serviceStatus": "Stopped", "startTime": ""    }
  // ... 81 services total (65 Started, 16 Stopped)
]
```

### Cluster Health Check (Parallel One-Shot)

```
→ cluster_health_check({ host: "192.168.125.10" })

{
  "devices": {
    "totalDevicesFound": 3,
    "cmNodes": [ ... ]
  },
  "counters": [
    { "name": "\\\\192.168.125.10\\Cisco CallManager\\CallsActive", "value": 0 },
    { "name": "\\\\192.168.125.10\\Cisco CallManager\\RegisteredHardwarePhones", "value": 3 }
    // ... 134 counters
  ],
  "services": [
    { "serviceName": "Cisco CallManager", "serviceStatus": "Started" },
    ...
  ],
  "errors": []
}
```

### List TLS Certificates (SSH CLI)

```
→ cert_list({ host: "192.168.125.10", type: "own" })

[
  { "unit": "tomcat",            "type": "own", "name": "tomcat",            "issuer": "Self-signed certificate generated by system" },
  { "unit": "tomcat-ECDSA",     "type": "own", "name": "tomcat-ECDSA",     "issuer": "Self-signed certificate generated by system" },
  { "unit": "ipsec",            "type": "own", "name": "ipsec",            "issuer": "Self-signed certificate generated by system" },
  { "unit": "ITLRecovery",      "type": "own", "name": "ITLRecovery",      "issuer": "Self-signed certificate generated by system" },
  { "unit": "CallManager-ECDSA","type": "own", "name": "CallManager-ECDSA","issuer": "Self-signed certificate generated by system" },
  { "unit": "CallManager",      "type": "own", "name": "CallManager",      "issuer": "Self-signed certificate generated by system" },
  { "unit": "CAPF",             "type": "own", "name": "CAPF",             "issuer": "Self-signed certificate generated by system" },
  { "unit": "TVS",              "type": "own", "name": "TVS",              "issuer": "Self-signed certificate generated by system" }
]
```

### DRF Backup Status (SSH CLI)

```
→ drf_backup_status({ host: "192.168.125.10" })

{ "status": "IDLE", "rawOutput": "drfCliMsg: No backup status available" }
```

```
→ drf_backup_history({ host: "192.168.125.10" })

[
  {
    "date": "Fri Dec 12 13:45:19 PST 2025",
    "component": "2025-12-12-13-44-12.tar",
    "status": "SUCCESS",
    "device": "NETWORK"
  }
]
```

### CDR on Demand

```
→ cdr_get_file_list_minutes({
    host: "192.168.125.10",
    minutesBack: 60
  })

// When CDR files exist:
{ "files": [ { "fileName": "cdr_...", "fileSize": 1234 }, ... ] }

// When none found (clean SOAP fault extraction):
"No file found within the specified time range"
```

### CUCM Version Info (SSH CLI)

```
→ show_version({ host: "192.168.125.10" })

{
  "activeVersion": "15.0.1.12900",
  "activeBuild": "234",
  "inactiveVersion": "",
  "inactiveBuild": ""
}
```

### Cluster Topology (SSH CLI)

```
→ show_network_cluster({ host: "192.168.125.10" })

{
  "nodes": [
    {
      "id": "",
      "hostname": "cucm15-cluster1",
      "ipAddress": "192.168.125.10",
      "type": "Publisher",
      "replicationStatus": "authenticated"
    }
  ]
}
```

### Auto-Paginate All Devices (RIS)

For clusters with >1000 phones, `select_cm_device_all` automatically iterates StateInfo pages:

```
→ select_cm_device_all({ host: "192.168.125.10" })

{
  "totalDevicesFound": 3,
  "cmNodes": [
    {
      "name": "cucm15-cluster1",
      "returnCode": "Ok",
      "devices": [
        { "name": "SEP0022905C7710", "ipAddress": "192.168.125.178", "status": "Registered", "protocol": "SCCP" },
        { "name": "SEP505C885DF37F", "ipAddress": "192.168.125.234", "status": "Registered", "protocol": "SIP"  },
        { "name": "SEP000832C78E0F", "ipAddress": "192.168.125.85",  "status": "Registered", "protocol": "SIP"  }
      ]
    }
  ]
}
```

### PerfMon Remove Counter

Remove specific counters from a session without closing it:

```
→ perfmon_remove_counter({
    host: "192.168.125.10",
    sessionHandle: "963603f4-15b0-11f1-8000-000c2917beb2",
    counters: ["\\\\192.168.125.10\\Cisco CallManager\\CallsActive"]
  })

Removed 1 counter(s) from session 963603f4-15b0-11f1-8000-000c2917beb2
```

### SDL Trace Analysis (Local)

**1. Download an SDL trace:**

```
→ download_file({
    host: "192.168.125.10",
    filePath: "/var/log/active/cm/trace/ccm/sdl/SDL001_100_000448.txt.gz"
  })

{
  "savedPath": "/tmp/cucm-mcp/SDL001_100_000448.txt.gz",
  "bytes": 1049171
}
```

**2. Parse into structured signals (.gz auto-decompressed):**

```
→ sdl_trace_parse({ filePath: "/tmp/cucm-mcp/SDL001_100_000448.txt.gz" })

{
  "totalLines": 47896,
  "parsedSignals": 17410,
  "unparsedLines": 30393,
  "callFlows": [
    { "callId": "0", "signals": [ ... ] }
  ],
  "signalSummary": {
    "CtiGetDeviceAndLineInfoReq": 3090,
    "CtiExistingCallEventReq": 3322,
    "DbObjectCacheTimer": 2308,
    "SIPRegisterInd": 82,
    "StationRegister": 10,
    ...
  }
}
```

**3. Drill into a specific call flow:**

```
→ sdl_trace_call_flow({
    filePath: "/tmp/cucm-mcp/SDL001_100_000448.txt.gz",
    callId: "0"
  })

{
  "callId": "0",
  "signals": [
    {
      "timestamp": "14:58:59.390",
      "signalName": "StationUserToDeviceData",
      "state": "restart0",
      "from": "StationD(1,100,199,1)",
      "to": "StationD(1,100,199,1)",
      "tag": "...SEP0022905C7710 | CI=0..."
    },
    ...
  ]
}
```

### Packet Capture Workflow (End-to-End)

**1. Start capture with SIP filter:**

```
→ packet_capture_start({
    host: "192.168.125.10",
    portFilter: 5060,
    count: 5000
  })

{
  "captureId": "c2439a09-b082-4c91-ba1e-20b211f1a217",
  "status": "running",
  "fileBase": "packets",
  "startedAt": "2026-02-28T08:25:44.000Z"
}
```

**2. Reproduce the issue** (place a test call, trigger the problem, etc.)

**3. Stop and download:**

```
→ packet_capture_stop_and_download({
    host: "192.168.125.10",
    captureId: "c2439a09-b082-4c91-ba1e-20b211f1a217"
  })

{
  "localPath": "/tmp/cucm-mcp/readme-demo.cap",
  "fileSize": 10532,
  "status": "downloaded"
}
```

**4. Triage — what's in the capture?**

```
→ pcap_call_summary({ filePath: "/tmp/cucm-mcp/readme-demo.cap" })

{
  "totalPackets": 20,
  "protocols": ["SIP", "SDP"],
  "sipCalls": 2,
  "rtpStreams": 1,
  "endpoints": [
    { "ip": "192.168.125.10", "packets": 10 },
    { "ip": "192.168.125.85", "packets": 10 }
  ]
}
```

**5. SIP call flow detail:**

```
→ pcap_sip_calls({ filePath: "/tmp/cucm-mcp/readme-demo.cap" })

{
  "calls": [
    {
      "callId": "6e51c0-60e94629-6-64257ec0@192.168.125.10",
      "from": "\"1000\" <sip:1000@192.168.125.10>",
      "to": "<sip:1001@192.168.125.10>",
      "messages": [
        { "method": "INVITE",      "status": null,          "timestamp": "08:25:56.742" },
        { "method": null,          "status": "100 Trying",  "timestamp": "08:25:56.743" },
        { "method": null,          "status": "180 Ringing", "timestamp": "08:25:56.754" },
        { "method": null,          "status": "200 OK",      "timestamp": "08:25:57.899" },
        { "method": "ACK",         "status": null,          "timestamp": "08:25:57.901" },
        { "method": "BYE",         "status": null,          "timestamp": "08:26:12.555" },
        { "method": null,          "status": "200 OK",      "timestamp": "08:26:12.556" }
      ],
      "setupTime": "1157 ms",
      "codec": "PCMU (G.711 u-law)",
      "sdpMedia": "audio 29390 RTP/AVP 0"
    }
  ]
}
```

**6. RTP audio quality:**

```
→ pcap_rtp_streams({ filePath: "/tmp/cucm-mcp/readme-demo.cap" })

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

## v0.6.0 Changes

### New Tools (7)

- **RIS Pagination** — `select_cm_device_all` auto-paginates via StateInfo to return ALL devices (clusters >1000 phones). `select_cm_device` now returns `stateInfo` cursor for manual pagination.
- **CTI Status** — `select_cti_item` queries real-time CTI ports, route points, and application connections via RisPort70
- **PerfMon** — `perfmon_remove_counter` removes counters from a session without closing it (completes the session lifecycle)
- **SSH CLI** — `show_version` and `show_network_cluster` for version info and cluster topology
- **CDR Download** — `cdr_download_file` downloads CDR/CMR files by filename (closes the CDR workflow)

### Improvements

- **Rate Limit Handling** — All Serviceability SOAP calls (RIS, PerfMon, ControlCenter) now auto-retry on CUCM rate limits (HTTP 503 or "Exceeded allowed rate" SOAP faults) with exponential backoff: 5s → 10s → 20s (3 retries max).

### Bug Fixes

| Fix | Details |
|-----|---------|
| RIS StateInfo pagination | `selectCmDevice` now extracts and returns the `StateInfo` pagination cursor from SOAP responses. Previously hardcoded empty, silently truncating results at 1000 devices. |
| RIS maxReturnedDevices cap | Fixed from 2000 to 1000 (CUCM's actual per-call limit) |
| cluster_health_check pagination | Now uses `selectCmDeviceAll` instead of single-page query — gets all devices instead of capping at 1000 |
| CUCM 15 `show network cluster` | Parser handles headerless IP-first format used by CUCM 15 |

### Test Suite

181 tests across 17 files (15 new tests for pagination, CTI items, perfmon remove, CLI parsers).

## v0.5.0 Changes

### New Tools (12)

- **PerfMon Sessions** — `perfmon_open_session`, `perfmon_add_counter`, `perfmon_collect_session_data`, `perfmon_close_session` for continuous counter monitoring
- **Cluster Health** — `cluster_health_check` runs device registration + PerfMon + service status in parallel with partial failure tolerance
- **Certificates** — `cert_list` lists own/trust TLS certificates via SSH CLI (supports both CUCM 15 single-line and older block formats)
- **Backups** — `drf_backup_status` and `drf_backup_history` via SSH CLI
- **CDR on Demand** — `cdr_get_file_list` and `cdr_get_file_list_minutes` via CDRonDemandService
- **SDL Traces** — `sdl_trace_parse` and `sdl_trace_call_flow` for local SDL trace analysis

### Bug Fixes

| Fix | Details |
|-----|---------|
| SSH keyboard-interactive auth | CUCM rejects plain `password` auth — now forces `keyboard-interactive` via `authHandler` to prevent "too many authentication failures" |
| SSH prompt detection | CUCM sends `\r\n` (CRLF) and standalone `\r` — prompt regex now normalizes line endings before matching |
| SSH VT100 ANSI stripping | `stripAnsi()` removes escape codes from SSH terminal output before parsing — fixes cert/backup/CLI tools returning empty results |
| CUCM 15 cert list format | `cert_list` now parses the CUCM 15 single-line format (`unit/name.pem: description`) in addition to the older multi-line block format |
| SDL .gz decompression | `sdl_trace_parse` and `sdl_trace_call_flow` auto-decompress `.gz` files via `gunzipSync` |
| SOAP HTTP 500 error parsing | HTTP 500 with SOAP fault body now extracts the `faultstring` instead of dumping raw XML |
| DRF backup history parser | Handles CUCM 15 column order (device before date) via date-detection heuristic |
| ControlCenter error format | Service status errors now return readable strings instead of `[object Object]` |

### Test Suite

166 tests across 16 files covering SOAP fault extraction, SSH prompt patterns, ANSI stripping, certificate parsing (both formats), CDR parsing, backup history, pcap analysis, SDL traces, and more.

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
