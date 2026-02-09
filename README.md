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
