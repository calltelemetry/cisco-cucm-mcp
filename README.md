# Cisco DIME MCP

[![npm](https://img.shields.io/npm/v/@calltelemetry/cisco-dime-mcp)](https://www.npmjs.com/package/@calltelemetry/cisco-dime-mcp)
[![CI](https://github.com/calltelemetry/cisco-dime-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/calltelemetry/cisco-dime-mcp/actions/workflows/ci.yml)
[![codecov](https://codecov.io/gh/calltelemetry/cisco-dime-mcp/branch/main/graph/badge.svg)](https://codecov.io/gh/calltelemetry/cisco-dime-mcp)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

MCP (Model Context Protocol) server for Cisco CUCM operational debugging.

## Capabilities

- **DIME Log Collection** — Query and download trace/log files via CUCM DIME SOAP services on `:8443`
- **Syslog** — Query and download system log files via DIME
- **RisPort70 (Real-time Device Status)** — Query phone/gateway/trunk registration status via selectCmDevice
- **PerfMon (Performance Monitoring)** — Collect real-time counters (call counts, CPU, memory, SIP stats)
- **ControlCenter (Service Status)** — Query CUCM service health: Started, Stopped, Not Activated (read-only)
- **Packet Capture** — Start/stop captures via CUCM CLI over SSH, download `.cap` files via DIME
- **Pcap Analysis** — Analyze captured pcaps locally via tshark: SIP flows, SCCP messages, RTP quality metrics

## Installation

```bash
npx @calltelemetry/cisco-dime-mcp
```

## Quick Start

### Claude Code

```bash
claude mcp add cucm -- npx -y @calltelemetry/cisco-dime-mcp@latest
```

### Manual Configuration

Add to your `.mcp.json`:

```json
{
  "mcpServers": {
    "cucm": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@calltelemetry/cisco-dime-mcp@latest"],
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
| `select_cm_device` | Query device registration status (phones, gateways, trunks) with filters |
| `select_cm_device_by_ip` | Convenience: look up device registration by IP address |

### PerfMon (Performance Monitoring)

| Tool | Description |
|------|-------------|
| `perfmon_collect_counter_data` | Collect counter values for a PerfMon object (e.g. "Cisco CallManager") |
| `perfmon_list_counter` | Discover available PerfMon objects and counters |
| `perfmon_list_instance` | List instances of a PerfMon object |

### ControlCenter (Service Status)

| Tool | Description |
|------|-------------|
| `get_service_status` | Query CUCM service status — Started, Stopped, Not Activated (read-only) |

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

### Utility

| Tool | Description |
|------|-------------|
| `guess_timezone_string` | Build a DIME-compatible timezone string |

## Examples (Real CUCM Output)

Examples below are from a live CUCM 15.0 cluster.

### Discover Cluster Nodes and Service Logs

```
→ list_node_service_logs({ host: "192.168.125.10" })

{
  "nodes": [
    {
      "name": "cucm15-cluster1.calltelemetry.local",
      "serviceCount": 150,
      "services": [
        "Cisco CallManager",
        "Cisco CTIManager",
        "Cisco Tftp",
        "Cisco Certificate Change Notification",
        "Cisco DRF Master",
        ...
      ]
    }
  ]
}
```

### Query Phone Inventory via AXL

```
→ axl_execute({
    host: "192.168.125.10",
    operation: "listPhone",
    body: {
      searchCriteria: { name: "SEP%" },
      returnedTags: { name: "", model: "", description: "" }
    }
  })

{
  "phone": [
    { "name": "SEP0022905C7710", "model": "Cisco 7975",  "description": "Auto 1000 7975 Phone3" },
    { "name": "SEP000832C78E0F", "model": "Cisco 7821",  "description": "Jason 7821"            },
    { "name": "SEP505C885DF37F", "model": "Cisco 9841",  "description": "Cisco 9841 SIP"        },
    ...
  ]
}
```

### Collect Recent Trace Files

```
→ select_logs_minutes({
    host: "192.168.125.10",
    serviceName: "Cisco CallManager",
    minutes: 30
  })

{
  "files": [
    {
      "name": "cdr_0000000004.txt",
      "node": "cucm15-cluster1.calltelemetry.local",
      "filesize": "47780",
      "modifiedDate": "Fri Feb 28 08:23:26 UTC 2026"
    },
    {
      "name": "cmr_0000000004.txt",
      "node": "cucm15-cluster1.calltelemetry.local",
      "filesize": "3830",
      "modifiedDate": "Fri Feb 28 08:23:26 UTC 2026"
    },
    {
      "name": "SDL001_100_001618.txt.gz",
      "node": "cucm15-cluster1.calltelemetry.local",
      "filesize": "1073817",
      "modifiedDate": "Fri Feb 28 08:22:15 UTC 2026"
    }
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
          "name": "SEP000832C78E0F",
          "ipAddress": "192.168.125.85",
          "dirNumber": "1001-Registered",
          "status": "Registered",
          "protocol": "SIP",
          "activeLoadId": "sip78xx.14-3-1-0001-60"
        },
        {
          "name": "SEP0022905C7710",
          "ipAddress": "192.168.125.178",
          "dirNumber": "1000-Registered",
          "status": "Registered",
          "protocol": "SCCP",
          "activeLoadId": "SCCP75.9-4-2SR4-3S"
        },
        {
          "name": "SEP505C885DF37F",
          "ipAddress": "192.168.125.234",
          "dirNumber": "1003-Registered",
          "status": "Registered",
          "protocol": "SIP",
          "activeLoadId": "PHONEOS.3-2-1-0003-28"
        }
      ]
    }
  ]
}
```

### Collect Performance Counters (PerfMon)

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

### Check Service Health (ControlCenter)

```
→ get_service_status({ host: "192.168.125.10" })

[
  { "serviceName": "Cisco CallManager",       "serviceStatus": "Started" },
  { "serviceName": "Cisco CTIManager",        "serviceStatus": "Started" },
  { "serviceName": "Cisco Tftp",              "serviceStatus": "Started" },
  { "serviceName": "Cisco AXL Web Service",   "serviceStatus": "Started" },
  { "serviceName": "Cisco RIS Data Collector","serviceStatus": "Started" },
  { "serviceName": "Cisco CDR Agent",         "serviceStatus": "Started" },
  { "serviceName": "Cisco DHCP Monitor Service", "serviceStatus": "Stopped" }
  // ... 81 services total (65 Started)
]
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

## Recommended Workflow

### Packet Capture + Analysis

```
1. packet_capture_start     → Start capture (runs on CUCM in background)
2. (reproduce the issue)
3. packet_capture_stop_and_download → Stop + download .cap file
4. pcap_call_summary        → Quick triage: what's in the capture?
5. pcap_sip_calls           → SIP INVITE → 200 OK → BYE flows
6. pcap_rtp_streams         → Audio quality: jitter, loss, codec
```

### Auth Note

CUCM deployments vary — SSH and DIME may accept different credentials:

```bash
# Verify DIME credentials (WSDL should return HTTP 200)
curl -k -u "<user>:<pass>" \
  "https://<cucm-host>:8443/logcollectionservice2/services/LogCollectionPortTypeService?wsdl" \
  -o /dev/null -w "%{http_code}\n"
```

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
