# CUCM MCP

MCP (Model Context Protocol) server for CUCM tooling.

Included capabilities:

- Query + download trace/log files via CUCM DIME Log Collection SOAP services
- Query/download Syslog via DIME SystemLogs selections
- Start/stop packet captures via CUCM CLI over SSH, then download the resulting `.cap` via DIME

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

## Useful Tools

- `select_logs_minutes` - list recent ServiceLogs/SystemLogs files
- `select_syslog_minutes` - list recent system log files (defaults to `Syslog`)
- `packet_capture_start` / `packet_capture_stop` - control captures via SSH
- `packet_capture_stop_and_download` - stop capture + download `.cap` via DIME
- `packet_capture_state_list` - list captures from state file
- `packet_capture_download_from_state` - download by captureId after restart

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
