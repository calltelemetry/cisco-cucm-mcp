import { selectLogsMinutes, type DimeAuth, type SelectedLogFile } from "./dime.js";

/**
 * Predefined service log name constants for common CUCM troubleshooting scenarios.
 */
export const SIP_TRACE_SERVICES = ["Cisco CallManager", "Cisco CTIManager"];
export const CTI_TRACE_SERVICES = ["Cisco CTIManager", "Cisco Extension Mobility"];
export const CURRI_LOG_SERVICES = ["Cisco External Call Control"];

export type LogPresetOptions = {
  host: string;
  minutesBack?: number;
  searchStr?: string;
  timezone?: string;
  auth?: DimeAuth;
  port?: number;
};

export type LogPresetResult = {
  fromDate: string;
  toDate: string;
  timezone: string;
  files: SelectedLogFile[];
  services: string[];
};

async function selectPreset(
  services: string[],
  opts: LogPresetOptions,
): Promise<LogPresetResult> {
  const minutesBack = opts.minutesBack ?? 60;
  const result = await selectLogsMinutes(
    opts.host,
    minutesBack,
    { serviceLogs: services, searchStr: opts.searchStr },
    opts.timezone,
    opts.auth,
    opts.port,
  );
  return { ...result, services };
}

/**
 * Collect SIP-related traces: Cisco CallManager + CTIManager.
 * These contain SDL traces with SIP signaling (INVITE, BYE, etc.) and call setup flows.
 */
export function selectSipTraces(opts: LogPresetOptions): Promise<LogPresetResult> {
  return selectPreset(SIP_TRACE_SERVICES, opts);
}

/**
 * Collect CTI traces: CTIManager + Extension Mobility.
 * Useful for debugging CTI port/route point issues and EM login problems.
 */
export function selectCtiTraces(opts: LogPresetOptions): Promise<LogPresetResult> {
  return selectPreset(CTI_TRACE_SERVICES, opts);
}

/**
 * Collect CURRI (Cisco Unified Routing Rules Interface) logs.
 * Captures external call control policy decisions for hybrid routing scenarios.
 */
export function selectCurriLogs(opts: LogPresetOptions): Promise<LogPresetResult> {
  return selectPreset(CURRI_LOG_SERVICES, opts);
}
