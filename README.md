# CUCM MCP

MCP (Model Context Protocol) server for CUCM tooling.

Included capabilities:

- Query + download trace/log files via CUCM DIME Log Collection SOAP services
- Query/download Syslog via DIME SystemLogs selections
- Start/stop packet captures via CUCM CLI over SSH, then download the resulting `.cap` via DIME
- Analyze captured pcaps: SIP call flows, SCCP/Skinny messages, RTP quality metrics (via tshark)

## Configuration

Credentials are read from tool args or environment variables.

### DIME (HTTPS)

- `CUCM_DIME_USERNAME`
- `CUCM_DIME_PASSWORD`
- `CUCM_DIME_PORT` (default `8443`)

### SSH (CLI)

- `CUCM_SSH_USERNAME` (often `administrator`)
- `CUCM_SSH_PASSWORD`
- `CUCM_SSH_PORT` (default `22`)

### tshark (Pcap Analysis)

The pcap analysis tools require **tshark** (Wireshark CLI). It is discovered automatically:

1. `TSHARK_PATH` env var (explicit override)
2. `tshark` in PATH
3. `/Applications/Wireshark.app/Contents/MacOS/tshark` (macOS Wireshark install)
4. `/usr/bin/tshark` (Linux)

If tshark is not found, pcap analysis tools return a helpful error instead of failing silently.

- `TSHARK_PATH` — override tshark binary location
- `CUCM_MCP_TSHARK_TIMEOUT_MS` — execution timeout (default: 60000ms)

### TLS

CUCM lab environments often use self-signed certificates. By default this server sets `NODE_TLS_REJECT_UNAUTHORIZED=0` unless you opt into strict verification:

- `CUCM_MCP_TLS_MODE=strict` (or `MCP_TLS_MODE=strict`)

### Local State (Capture Recovery)

This server persists packet capture metadata to a local JSON file so you can recover/download captures after an MCP restart.

- `CUCM_MCP_STATE_PATH` (default: `./.cucm-mcp-state.json`)
- `CUCM_MCP_CAPTURE_RUNNING_TTL_MS` (default: 6 hours)
- `CUCM_MCP_CAPTURE_STOPPED_TTL_MS` (default: 24 hours)

## Run

```bash
yarn install
yarn start
```

## MCP Config

Add to `.mcp.json`:

```json
{
  "mcpServers": {
    "cucm": {
      "type": "stdio",
      "command": "yarn",
      "args": ["--cwd", "cucm-mcp", "start"],
      "env": {
        "CUCM_DIME_USERNAME": "<cucm-username>",
        "CUCM_DIME_PASSWORD": "<cucm-password>",
        "CUCM_SSH_USERNAME": "administrator",
        "CUCM_SSH_PASSWORD": "<ssh-password>",
        "CUCM_MCP_TLS_MODE": "permissive"
      }
    }
  }
}
```

## Testing

```bash
yarn test
```

Live tests are opt-in via env vars; see `test/live.test.js`.

## Tools

### Log Collection (DIME)

| Tool | Description |
|------|-------------|
| `select_logs_minutes` | List recent ServiceLogs/SystemLogs files |
| `select_syslog_minutes` | List recent system log files (defaults to `Syslog`) |

### Packet Capture (SSH + DIME)

| Tool | Description |
|------|-------------|
| `packet_capture_start` | Start capture via CUCM CLI over SSH |
| `packet_capture_stop` | Stop a running capture |
| `packet_capture_stop_and_download` | Stop capture + download `.cap` via DIME |
| `packet_capture_state_list` | List captures from state file |
| `packet_capture_download_from_state` | Download by captureId after restart |

### Pcap Analysis (tshark)

These tools analyze downloaded `.cap` files so an LLM can reason about VoIP calls without opening Wireshark. All accept either a file path or a `captureId` from the state store.

| Tool | Description |
|------|-------------|
| `pcap_call_summary` | High-level overview — protocols, endpoints, SIP call count, RTP stream count |
| `pcap_sip_calls` | SIP call flows grouped by Call-ID with setup timing, SDP codec/media info |
| `pcap_sccp_messages` | Skinny/SCCP messages with human-readable message type names |
| `pcap_rtp_streams` | RTP quality per stream — jitter, packet loss, codec, duration |
| `pcap_protocol_filter` | Arbitrary tshark display filter for deeper investigation |

## Packet Capture Notes

- Use the platform/OS admin for SSH (`administrator` user on most lab systems)
- To request a high packet count without specifying an exact number, pass `maxPackets: true` to `packet_capture_start`
- If traffic is low, a small `count` can still run “forever” waiting for packets; use `packet_capture_stop` to cancel, or set `maxDurationMs` to auto-stop

### Auth Note (DIME vs SSH)

CUCM deployments vary:

- SSH and DIME may accept different usernames/passwords.
- Quick check: the right DIME user returns HTTP 200 for the WSDL.

```bash
curl -k -u "<user>:<pass>" \
  "https://<cucm-host>:8443/logcollectionservice2/services/LogCollectionPortTypeService?wsdl" \
  -o /dev/null -w "%{http_code}\n"
```

### Recommended Workflow

1) Start capture (returns quickly; capture continues on CUCM):

Tool: `packet_capture_start`

Useful options:

- `count`: stop after N packets (can wait indefinitely if traffic is low)
- `maxDurationMs`: stop after a fixed time even if packet count isn’t reached
- `startTimeoutMs`: fail fast if the CUCM CLI prompt isn’t reachable
- `maxPackets: true`: sets a high capture count (1,000,000) when `count` is omitted

2) Stop + download the capture:

Tool: `packet_capture_stop_and_download`

This:

- stops the SSH capture (best-effort)
- retries DIME downloads until the file appears
- tries rolled filenames (`.cap01`, `.cap02`, ...)

### What to Expect in Output

Many MCP clients truncate long JSON. The CUCM MCP tools print a one-line summary first, followed by the full JSON:

- `packet_capture_start`: prints `id`, `remoteFilePath`, and a reminder that capture continues on CUCM until stopped
- `packet_capture_stop_and_download`: prints `savedPath` and `bytes` so you can immediately open the file

### Viewing the Capture (macOS)

After download, you’ll get a `savedPath` like `/tmp/foo.cap`.

```bash
# Reveal in Finder
open -R "/tmp/foo.cap"

# Open in Wireshark
open -a Wireshark "/tmp/foo.cap"
```

### Analyzing the Capture (LLM)

After downloading, use the pcap analysis tools to query the capture without leaving the MCP session:

1. **Quick triage** — `pcap_call_summary` to see what protocols/calls are in the file
2. **SIP drill-down** — `pcap_sip_calls` to trace INVITE → 200 OK → BYE flows
3. **SCCP drill-down** — `pcap_sccp_messages` for Cisco phone ↔ CallManager signaling
4. **Audio quality** — `pcap_rtp_streams` for jitter, packet loss, codec per RTP stream
5. **Custom query** — `pcap_protocol_filter` with any tshark display filter (e.g., `sip.Method == INVITE`)
