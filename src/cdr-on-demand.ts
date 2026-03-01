import { resolveAuth, resolveTarget, type DimeAuth } from "./dime.js";
import { fetchServiceabilitySoap, toArray } from "./soap.js";

const CDR_ON_DEMAND_PATH = "/CDRonDemandService2/services/CDRonDemandService";

const MAX_RANGE_MS = 60 * 60 * 1000; // 1 hour in milliseconds

export type CdrFileInfo = {
  fileName: string;
  fileSize: number;
  timestamp: string;
  [k: string]: unknown;
};

/**
 * Format a Date as a 12-digit UTC string: YYYYMMDDHHMM
 */
export function formatCdrTime(date: Date): string {
  const y = date.getUTCFullYear().toString();
  const m = (date.getUTCMonth() + 1).toString().padStart(2, "0");
  const d = date.getUTCDate().toString().padStart(2, "0");
  const h = date.getUTCHours().toString().padStart(2, "0");
  const min = date.getUTCMinutes().toString().padStart(2, "0");
  return `${y}${m}${d}${h}${min}`;
}

function buildGetFileListEnvelope(startTime: string, endTime: string): string {
  return (
    '<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:soap="http://schemas.cisco.com/ast/soap">' +
    "<soapenv:Header/>" +
    "<soapenv:Body>" +
    "<soap:get_file_list>" +
    `<soap:in0>${startTime}</soap:in0>` +
    `<soap:in1>${endTime}</soap:in1>` +
    "<soap:in2>True</soap:in2>" +
    "</soap:get_file_list>" +
    "</soapenv:Body>" +
    "</soapenv:Envelope>"
  );
}

/**
 * List CDR/CMR files from CUCM CDRonDemandService within a time range.
 *
 * @param hostOrUrl  CUCM hostname or URL
 * @param fromTime   12-digit UTC start time (YYYYMMDDHHMM)
 * @param toTime     12-digit UTC end time (YYYYMMDDHHMM)
 * @param auth       Optional credentials (falls back to env vars)
 * @param port       Optional port (defaults to 8443)
 * @param timeoutMs  Optional request timeout (defaults to 30s)
 * @throws If time range exceeds 60 minutes
 */
export async function cdrGetFileList(
  hostOrUrl: string,
  fromTime: string,
  toTime: string,
  auth?: DimeAuth,
  port?: number,
  timeoutMs?: number,
): Promise<CdrFileInfo[]> {
  // Validate time range does not exceed 60 minutes
  const fromDate = parseCdrTime(fromTime);
  const toDate = parseCdrTime(toTime);
  const rangeMs = toDate.getTime() - fromDate.getTime();
  if (rangeMs > MAX_RANGE_MS) {
    throw new Error(
      `CDR on-demand time range exceeds 60 minutes (got ${Math.round(rangeMs / 60_000)} min)`,
    );
  }
  if (rangeMs < 0) {
    throw new Error("CDR on-demand fromTime must be before toTime");
  }

  const target = resolveTarget(hostOrUrl, port);
  const resolvedAuth = resolveAuth(auth);
  const envelope = buildGetFileListEnvelope(fromTime, toTime);

  const body = await fetchServiceabilitySoap(
    target.host,
    target.port!,
    resolvedAuth,
    CDR_ON_DEMAND_PATH,
    "CDRonDemandService",
    envelope,
    timeoutMs ?? 30_000,
  );

  const resp = body.get_file_listResponse as Record<string, unknown> | undefined;
  if (!resp) return [];

  const items = toArray(resp.item ?? resp.get_file_listReturn) as Record<string, unknown>[];

  return items.map((item) => ({
    fileName: String(item.FileName ?? item.fileName ?? ""),
    fileSize: Number(item.FileSize ?? item.fileSize ?? 0),
    timestamp: String(item.Timestamp ?? item.timestamp ?? ""),
    ...item,
  }));
}

/**
 * List CDR/CMR files from the last N minutes (max 60).
 *
 * @param hostOrUrl    CUCM hostname or URL
 * @param minutesBack  How many minutes to look back (max 60)
 * @param auth         Optional credentials
 * @param port         Optional port
 * @param timeoutMs    Optional request timeout
 */
export async function cdrGetFileListMinutes(
  hostOrUrl: string,
  minutesBack: number,
  auth?: DimeAuth,
  port?: number,
  timeoutMs?: number,
): Promise<CdrFileInfo[]> {
  if (minutesBack > 60) {
    throw new Error(
      `CDR on-demand minutesBack exceeds 60 minutes (got ${minutesBack})`,
    );
  }
  if (minutesBack <= 0) {
    throw new Error("CDR on-demand minutesBack must be positive");
  }

  const now = new Date();
  const past = new Date(now.getTime() - minutesBack * 60_000);
  const fromTime = formatCdrTime(past);
  const toTime = formatCdrTime(now);

  return cdrGetFileList(hostOrUrl, fromTime, toTime, auth, port, timeoutMs);
}

/**
 * Parse a 12-digit CDR time string (YYYYMMDDHHMM) into a Date (UTC).
 */
function parseCdrTime(s: string): Date {
  if (!/^\d{12}$/.test(s)) {
    throw new Error(`Invalid CDR time format: expected 12 digits (YYYYMMDDHHMM), got "${s}"`);
  }
  const year = Number(s.slice(0, 4));
  const month = Number(s.slice(4, 6)) - 1;
  const day = Number(s.slice(6, 8));
  const hour = Number(s.slice(8, 10));
  const minute = Number(s.slice(10, 12));
  return new Date(Date.UTC(year, month, day, hour, minute));
}
