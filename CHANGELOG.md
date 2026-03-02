# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.7.0] - 2026-03-01

### Added

- **Service Control** (4 tools) — `start_service`, `stop_service`, `restart_service` via ControlCenterServicesEx SOAP API; `list_services_extended` for full deployable service inventory with activation status
- **Log Presets** (3 tools) — `select_sip_traces` (CallManager + CTIManager), `select_cti_traces` (CTIManager + Extension Mobility), `select_curri_logs` (External Call Control) for schema-aware log collection
- **Batch Download** — `download_batch` downloads multiple files in one operation with partial failure tolerance (max 20 files)
- **Cluster-Wide Log Collection** — `select_logs_cluster` discovers all cluster nodes via SSH, then fans out DIME log queries to every node in parallel with partial failure tolerance
- **AXL WSDL Discovery** (2 tools) — `axl_list_operations` lists all AXL operations grouped by type (list/get/add/update/remove/do/apply); `axl_describe_operation` returns input/output field schema for any operation. WSDL/XSD schemas are cached to disk at `~/.cisco-cucm-mcp/wsdl-cache/` (no expiration) so subsequent calls return instantly without re-downloading from CUCM
- **SSH Diagnostics** (2 tools) — `show_status` (CPU, memory, disk, uptime) and `show_network_eth0` (IP, gateway, DNS, link speed)
- **Trace Configuration** (2 tools) — `get_trace_config` reads current trace level for any service; `set_trace_level` changes debug trace level (Error → Detailed) via AXL SQL — no GUI required
- Architecture diagram in README
- Troubleshooting section in README
- "What Tool Do I Use?" decision guide in README
- `CHANGELOG.md` (this file) — extracted from README

### Changed

- Tool count: 46 → 61 tools
- Version bump: 0.6.1 → 0.7.0

## [0.6.1] - 2026-03-01

### Fixed

- MCP annotations: `perfmon_collect_session_data` and `packet_capture_download_from_state` corrected from `WRITE_SAFE` to `READ_ONLY_NETWORK`
- `formatUnknownError(undefined)` now returns `"undefined"` instead of JS `undefined`

### Added

- `.gitignore` hardened with credential patterns (`.env*`, `*.key`, `*.pem`)
- `npm audit` step in CI workflow
- Test coverage boost: 217 tests across 23 files (added `tls.test.ts`, `time.test.ts`, `errors.test.ts`, expanded `state.test.ts`)

## [0.6.0] - 2026-03-01

### Added

- **RIS Pagination** — `select_cm_device_all` auto-paginates via StateInfo to return ALL devices (clusters >1000 phones); `select_cm_device` now returns `stateInfo` cursor for manual pagination
- **CTI Status** — `select_cti_item` queries real-time CTI ports, route points, and application connections via RisPort70
- **PerfMon** — `perfmon_remove_counter` removes counters from a session without closing it
- **SSH CLI** — `show_version` and `show_network_cluster` for version info and cluster topology
- **CDR Download** — `cdr_download_file` downloads CDR/CMR files by filename
- **Rate Limit Handling** — All Serviceability SOAP calls auto-retry on CUCM rate limits (HTTP 503 / "Exceeded allowed rate") with exponential backoff: 5s → 10s → 20s

### Fixed

- RIS StateInfo pagination — `selectCmDevice` now extracts and returns the `StateInfo` cursor from SOAP responses (previously hardcoded empty, silently truncating at 1000 devices)
- RIS maxReturnedDevices cap — fixed from 2000 to 1000 (CUCM's actual per-call limit)
- `cluster_health_check` pagination — uses `selectCmDeviceAll` instead of single-page query
- CUCM 15 `show network cluster` — parser handles headerless IP-first format

## [0.5.0] - 2026-02-28

### Added

- **PerfMon Sessions** — `perfmon_open_session`, `perfmon_add_counter`, `perfmon_collect_session_data`, `perfmon_close_session`
- **Cluster Health** — `cluster_health_check` runs device registration + PerfMon + service status in parallel
- **Certificates** — `cert_list` lists own/trust TLS certificates via SSH CLI
- **Backups** — `drf_backup_status` and `drf_backup_history` via SSH CLI
- **CDR on Demand** — `cdr_get_file_list` and `cdr_get_file_list_minutes` via CDRonDemandService
- **SDL Traces** — `sdl_trace_parse` and `sdl_trace_call_flow` for local SDL trace analysis

### Fixed

- SSH keyboard-interactive auth — CUCM rejects plain password auth; now forces keyboard-interactive
- SSH prompt detection — CUCM sends CRLF and standalone CR; prompt regex now normalizes line endings
- SSH VT100 ANSI stripping — removes escape codes before parsing
- CUCM 15 cert list format — parses single-line format in addition to multi-line block format
- SDL .gz decompression — auto-decompress `.gz` files via `gunzipSync`
- SOAP HTTP 500 error parsing — extracts `faultstring` instead of dumping raw XML
- DRF backup history parser — handles CUCM 15 column order via date-detection heuristic
- ControlCenter error format — returns readable strings instead of `[object Object]`
