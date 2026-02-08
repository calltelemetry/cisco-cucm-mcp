import { XMLParser } from "fast-xml-parser";
import { extractBoundary, parseMultipartRelated } from "./multipart.js";
import { formatCucmDateTime, guessTimezoneString } from "./time.js";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export type DimeAuth = { username?: string; password?: string };

export type DimeTarget = {
  host: string;
  port?: number;
};

export type NodeServiceLogs = {
  server: string;
  serviceLogs: string[];
  count: number;
};

export type SelectedLogFile = {
  server: string;
  absolutePath?: string;
  fileName?: string;
  [k: string]: unknown;
};

export type SelectLogsCriteria = {
  serviceLogs?: string[];
  systemLogs?: string[];
  searchStr?: string;
  fromDate: string;
  toDate: string;
  timezone: string;
};

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@",
  removeNSPrefix: true,
  trimValues: true,
});

export function normalizeHost(hostOrUrl: string): string {
  const s = String(hostOrUrl || "").trim();
  if (!s) throw new Error("host is required");
  if (s.includes("://")) {
    const u = new URL(s);
    return u.hostname;
  }
  return s.replace(/^https?:\/\//, "").replace(/\/+$/, "").split("/")[0];
}

export function resolveAuth(auth?: DimeAuth): Required<DimeAuth> {
  const username = auth?.username || process.env.CUCM_DIME_USERNAME || process.env.CUCM_USERNAME;
  const password = auth?.password || process.env.CUCM_DIME_PASSWORD || process.env.CUCM_PASSWORD;
  if (!username || !password) {
    throw new Error("Missing DIME credentials (provide auth or set CUCM_DIME_USERNAME/CUCM_DIME_PASSWORD)");
  }
  return { username, password };
}

export function resolveTarget(hostOrUrl: string, port?: number): DimeTarget {
  const host = normalizeHost(hostOrUrl);
  const envPort = process.env.CUCM_DIME_PORT ? Number.parseInt(process.env.CUCM_DIME_PORT, 10) : undefined;
  const resolvedPort = port ?? envPort ?? 8443;
  return { host, port: resolvedPort };
}

function basicAuthHeader(username: string, password: string): string {
  return `Basic ${Buffer.from(`${username}:${password}`, "utf8").toString("base64")}`;
}

function escapeXml(s: string): string {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function soapEnvelopeList(): string {
  return (
    '<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:soap="http://schemas.cisco.com/ast/soap">' +
    "<soapenv:Header/>" +
    "<soapenv:Body>" +
    "<soap:listNodeServiceLogs>" +
    "<soap:ListRequest></soap:ListRequest>" +
    "</soap:listNodeServiceLogs>" +
    "</soapenv:Body>" +
    "</soapenv:Envelope>"
  );
}

function soapItems(tag: string, values?: string[]): string {
  const vals = (values || []).filter((v) => String(v || "").trim() !== "");
  if (vals.length === 0) return `<soap:${tag}><soap:item></soap:item></soap:${tag}>`;
  return `<soap:${tag}>${vals.map((v) => `<soap:item>${escapeXml(v)}</soap:item>`).join("")}</soap:${tag}>`;
}

function soapEnvelopeSelect(criteria: SelectLogsCriteria): string {
  const serviceLogs = soapItems("ServiceLogs", criteria.serviceLogs);
  const systemLogs = soapItems("SystemLogs", criteria.systemLogs);
  const searchStr = escapeXml(criteria.searchStr || "");

  return (
    '<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:soap="http://schemas.cisco.com/ast/soap">' +
    "<soapenv:Header/>" +
    "<soapenv:Body>" +
    "<soap:selectLogFiles>" +
    "<soap:FileSelectionCriteria>" +
    serviceLogs +
    systemLogs +
    `<soap:SearchStr>${searchStr}</soap:SearchStr>` +
    "<soap:Frequency>OnDemand</soap:Frequency>" +
    "<soap:JobType>DownloadtoClient</soap:JobType>" +
    `<soap:ToDate>${escapeXml(criteria.toDate)}</soap:ToDate>` +
    `<soap:FromDate>${escapeXml(criteria.fromDate)}</soap:FromDate>` +
    `<soap:TimeZone>${escapeXml(criteria.timezone)}</soap:TimeZone>` +
    "<soap:RelText>None</soap:RelText>" +
    "<soap:RelTime>0</soap:RelTime>" +
    "<soap:Port></soap:Port>" +
    "<soap:IPAddress></soap:IPAddress>" +
    "<soap:UserName></soap:UserName>" +
    "<soap:Password></soap:Password>" +
    "<soap:ZipInfo></soap:ZipInfo>" +
    "<soap:RemoteFolder></soap:RemoteFolder>" +
    "</soap:FileSelectionCriteria>" +
    "</soap:selectLogFiles>" +
    "</soapenv:Body>" +
    "</soapenv:Envelope>"
  );
}

function soapEnvelopeGetOneFile(fileName: string): string {
  return (
    '<soapenv:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:soap="http://schemas.cisco.com/ast/soap/">' +
    "<soapenv:Header/>" +
    "<soapenv:Body>" +
    '<soap:GetOneFile soapenv:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">' +
    `<FileName xsi:type="get:FileName" xmlns:get="http://cisco.com/ccm/serviceability/soap/LogCollection/GetFile/">${escapeXml(fileName)}</FileName>` +
    "</soap:GetOneFile>" +
    "</soapenv:Body>" +
    "</soapenv:Envelope>"
  );
}

async function fetchSoap(
  target: DimeTarget,
  auth: Required<DimeAuth>,
  path: string,
  soapAction: string,
  xmlBody: string,
  timeoutMs = 30000
): Promise<{ contentType: string | null; bytes: Buffer }> {
  const url = `https://${target.host}:${target.port}${path}`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: basicAuthHeader(auth.username, auth.password),
      SOAPAction: soapAction,
      "Content-Type": "text/xml;charset=UTF-8",
      Accept: "*/*",
    },
    body: Buffer.from(xmlBody, "utf8"),
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`CUCM DIME HTTP ${res.status}: ${text || res.statusText}`);
  }

  const contentType = res.headers.get("content-type");
  const ab = await res.arrayBuffer();
  return { contentType, bytes: Buffer.from(ab) };
}

export async function listNodeServiceLogs(hostOrUrl: string, auth?: DimeAuth, port?: number): Promise<NodeServiceLogs[]> {
  const target = resolveTarget(hostOrUrl, port);
  const resolvedAuth = resolveAuth(auth);

  const { contentType, bytes } = await fetchSoap(
    target,
    resolvedAuth,
    "/logcollectionservice2/services/LogCollectionPortTypeService",
    "listNodeServiceLogs",
    soapEnvelopeList()
  );

  const boundary = extractBoundary(contentType);
  const parts = parseMultipartRelated(bytes, boundary);
  const xmlParts = parts.filter((p) => p.contentType.toLowerCase() === "text/xml");
  if (xmlParts.length === 0) throw new Error("DIME response missing text/xml part");

  const parsed = parser.parse(xmlParts[0].body.toString("utf8"));
  const env = parsed.Envelope || parsed;
  const body = env.Body || env;
  const resp = body.listNodeServiceLogsResponse;
  const ret = resp?.listNodeServiceLogsReturn;
  if (!ret) throw new Error("Unexpected listNodeServiceLogs response shape");

  const items = Array.isArray(ret) ? ret : [ret];
  return items.map((it: any) => {
    const serviceLogsRaw = it?.ServiceLog?.item;
    const serviceLogs = Array.isArray(serviceLogsRaw)
      ? serviceLogsRaw
      : typeof serviceLogsRaw === "string"
      ? [serviceLogsRaw]
      : [];
    return {
      server: String(it?.name || ""),
      serviceLogs,
      count: serviceLogs.length,
    };
  });
}

export async function selectLogs(
  hostOrUrl: string,
  criteria: SelectLogsCriteria,
  auth?: DimeAuth,
  port?: number
): Promise<SelectedLogFile[]> {
  const target = resolveTarget(hostOrUrl, port);
  const resolvedAuth = resolveAuth(auth);

  const hasService = (criteria.serviceLogs || []).some((x) => String(x || "").trim() !== "");
  const hasSystem = (criteria.systemLogs || []).some((x) => String(x || "").trim() !== "");
  if (!hasService && !hasSystem) {
    throw new Error("selectLogs requires at least one of serviceLogs or systemLogs");
  }

  const { contentType, bytes } = await fetchSoap(
    target,
    resolvedAuth,
    "/logcollectionservice2/services/LogCollectionPortTypeService",
    "selectLogFiles",
    soapEnvelopeSelect(criteria)
  );

  const boundary = extractBoundary(contentType);
  const parts = parseMultipartRelated(bytes, boundary);
  const xmlParts = parts.filter((p) => p.contentType.toLowerCase() === "text/xml");
  if (xmlParts.length === 0) throw new Error("DIME response missing text/xml part");

  const parsed = parser.parse(xmlParts[0].body.toString("utf8"));
  const env = parsed.Envelope || parsed;
  const body = env.Body || env;
  const resp = body.selectLogFilesResponse;
  const resultSet = resp?.ResultSet;
  const serviceFileList =
    resultSet?.SchemaFileSelectionResult?.Node?.ServiceList?.ServiceLogs?.SetOfFiles?.File;
  const systemFileList =
    resultSet?.SchemaFileSelectionResult?.Node?.ServiceList?.SystemLogs?.SetOfFiles?.File;

  const toArray = (x: any) => (x == null ? [] : Array.isArray(x) ? x : [x]);
  const combined = [...toArray(serviceFileList), ...toArray(systemFileList)];

  if (combined.length === 0) throw new Error("No files found (missing ServiceLogs/SystemLogs SetOfFiles/File)");

  return combined.map((f: any) => {
    const absolutePath = f?.absolutepath || f?.AbsolutePath || f?.Absolutepath;
    const fileName = f?.filename || f?.FileName || f?.Filename;
    return {
      server: target.host,
      absolutePath: absolutePath ? String(absolutePath) : undefined,
      fileName: fileName ? String(fileName) : undefined,
      ...f,
    };
  });
}

export async function selectLogsMinutes(
  hostOrUrl: string,
  minutesBack: number,
  select: Pick<SelectLogsCriteria, "serviceLogs" | "systemLogs" | "searchStr">,
  timezone?: string,
  auth?: DimeAuth,
  port?: number
): Promise<{ fromDate: string; toDate: string; timezone: string; files: SelectedLogFile[] }> {
  const now = new Date();
  const past = new Date(now.getTime() - minutesBack * 60_000);
  const fromDate = formatCucmDateTime(past);
  const toDate = formatCucmDateTime(now);
  const tz = timezone || guessTimezoneString(now);
  const files = await selectLogs(
    hostOrUrl,
    { ...select, fromDate, toDate, timezone: tz },
    auth,
    port
  );
  return { fromDate, toDate, timezone: tz, files };
}

export async function getOneFile(
  hostOrUrl: string,
  filePath: string,
  auth?: DimeAuth,
  port?: number
): Promise<{ server: string; filename: string; data: Buffer }> {
  const target = resolveTarget(hostOrUrl, port);
  const resolvedAuth = resolveAuth(auth);

  const { contentType, bytes } = await fetchSoap(
    target,
    resolvedAuth,
    "/logcollectionservice/services/DimeGetFileService",
    "http://schemas.cisco.com/ast/soap/action/#LogCollectionPort#GetOneFile",
    soapEnvelopeGetOneFile(filePath)
  );

  const boundary = extractBoundary(contentType);
  const parts = parseMultipartRelated(bytes, boundary);
  if (parts.length === 0) throw new Error("DIME GetOneFile returned no multipart parts");

  const nonXml = parts.find((p) => p.contentType.toLowerCase() !== "text/xml");
  if (!nonXml) throw new Error("DIME GetOneFile response missing non-XML file part");

  return { server: target.host, filename: filePath, data: nonXml.body };
}

export function writeDownloadedFile(result: { server: string; filename: string; data: Buffer }, outFile?: string) {
  const baseName = result.filename.split("/").filter(Boolean).pop() || "cucm-file.bin";
  const defaultDir = join("/tmp", "cucm-mcp");
  const filePath = outFile || join(defaultDir, baseName);
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, result.data);
  return { filePath, bytes: result.data.length, baseName };
}
