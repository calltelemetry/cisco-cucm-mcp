import { XMLParser } from "fast-xml-parser";

export type AxlAuth = { username?: string; password?: string };

export type AxlTarget = {
  host: string;
  port: number;
  version: string;
};

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@",
  removeNSPrefix: true,
  trimValues: true,
});

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

function formatUnknownError(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === "string") return e;
  try {
    return JSON.stringify(e);
  } catch {
    return String(e);
  }
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function expandReturnedTagsPaths(paths: string[]): Record<string, unknown> {
  // Allows shorthand like:
  //   ["name", "model", "lines.line.dirn.pattern"]
  // into a nested returnedTags object shape.
  const root: Record<string, unknown> = {};
  for (const raw of paths) {
    const p = String(raw || "").trim();
    if (!p) continue;
    const parts = p.split(".").filter(Boolean);
    if (parts.length === 0) continue;
    let cur: Record<string, unknown> = root;
    for (let i = 0; i < parts.length; i++) {
      const key = parts[i];
      const isLeaf = i === parts.length - 1;
      const next = cur[key];
      if (isLeaf) {
        // Leaf tags are empty elements ("<foo/>")
        if (next == null) cur[key] = null;
      } else {
        if (!isPlainObject(next)) cur[key] = {};
        cur = cur[key] as Record<string, unknown>;
      }
    }
  }
  return root;
}

function objectToXml(tag: string, value: unknown): string {
  // Convention:
  // - null/undefined => <tag/>
  // - primitive => <tag>value</tag>
  // - array => repeated <tag>...</tag>
  // - object => nested elements, supports:
  //    - "@attr" keys for XML attributes
  //    - "#text" for text nodes
  if (Array.isArray(value)) {
    return value.map((v) => objectToXml(tag, v)).join("");
  }

  if (value == null) {
    return `<${tag}/>`;
  }

  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return `<${tag}>${escapeXml(String(value))}</${tag}>`;
  }

  if (!isPlainObject(value)) {
    return `<${tag}>${escapeXml(String(value))}</${tag}>`;
  }

  const attrs: string[] = [];
  const children: string[] = [];
  let text: string | null = null;
  for (const [k, v] of Object.entries(value)) {
    if (k === "#text") {
      text = v == null ? "" : String(v);
      continue;
    }
    if (k.startsWith("@")) {
      const attrName = k.slice(1);
      if (!attrName) continue;
      if (v == null) continue;
      attrs.push(`${attrName}="${escapeXml(String(v))}"`);
      continue;
    }
    children.push(objectToXml(k, v));
  }

  const attrStr = attrs.length ? " " + attrs.join(" ") : "";
  const childStr = children.join("");
  const textStr = text != null ? escapeXml(text) : "";

  if (!childStr && !textStr) {
    return `<${tag}${attrStr}/>`;
  }
  return `<${tag}${attrStr}>${textStr}${childStr}</${tag}>`;
}

export function normalizeHost(hostOrUrl: string): string {
  const s = String(hostOrUrl || "").trim();
  if (!s) throw new Error("host is required");
  if (s.includes("://")) {
    const u = new URL(s);
    return u.hostname;
  }
  return s.replace(/^https?:\/\//, "").replace(/\/+$/, "").split("/")[0];
}

export function resolveAxlAuth(auth?: AxlAuth): Required<AxlAuth> {
  const username = auth?.username || process.env.CUCM_AXL_USERNAME || process.env.CUCM_USERNAME || process.env.CUCM_DIME_USERNAME;
  const password = auth?.password || process.env.CUCM_AXL_PASSWORD || process.env.CUCM_PASSWORD || process.env.CUCM_DIME_PASSWORD;
  if (!username || !password) {
    throw new Error("Missing AXL credentials (provide auth or set CUCM_AXL_USERNAME/CUCM_AXL_PASSWORD)");
  }
  return { username, password };
}

export function resolveAxlTarget(hostOrUrl: string, port?: number, version?: string): AxlTarget {
  const host = normalizeHost(hostOrUrl);
  const envPort = process.env.CUCM_AXL_PORT ? Number.parseInt(process.env.CUCM_AXL_PORT, 10) : undefined;
  const resolvedPort = port ?? envPort ?? 8443;
  const resolvedVersion = version || process.env.CUCM_AXL_VERSION || "15.0";
  return { host, port: resolvedPort, version: resolvedVersion };
}

function soapEnvelope(axlVersion: string, innerXml: string): string {
  const ns = `http://www.cisco.com/AXL/API/${escapeXml(axlVersion)}`;
  return (
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:ns="${ns}">` +
    `<soapenv:Header/>` +
    `<soapenv:Body>` +
    innerXml +
    `</soapenv:Body>` +
    `</soapenv:Envelope>`
  );
}

async function fetchAxl(
  target: AxlTarget,
  auth: Required<AxlAuth>,
  operation: string,
  innerXml: string,
  timeoutMs = 30_000
): Promise<{ contentType: string | null; xml: string }> {
  const url = `https://${target.host}:${target.port}/axl/`;
  const xmlBody = soapEnvelope(target.version, innerXml);

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: basicAuthHeader(auth.username, auth.password),
      "Content-Type": "text/xml; charset=utf-8",
      SOAPAction: `CUCM:DB ver=${target.version} ${operation}`,
      Accept: "*/*",
    },
    body: Buffer.from(xmlBody, "utf8"),
    signal: AbortSignal.timeout(timeoutMs),
  });

  const contentType = res.headers.get("content-type");
  const text = await res.text().catch(() => "");
  if (!res.ok) {
    throw new Error(`CUCM AXL HTTP ${res.status}: ${text || res.statusText}`);
  }
  return { contentType, xml: text };
}

function parseSoapReturn(operation: string, xmlText: string): { returnValue?: string; fault?: string } {
  const parsed = parser.parse(xmlText);
  const env = parsed.Envelope || parsed;
  const body = env.Body || env;

  const fault = body?.Fault;
  if (fault) {
    const faultString = fault.faultstring || fault.faultcode || JSON.stringify(fault);
    return { fault: String(faultString) };
  }

  const resp = body?.[`${operation}Response`];
  const ret = resp?.return;
  if (ret == null) return {};
  if (typeof ret === "string") return { returnValue: ret };
  // Some AXL responses wrap the value.
  if (typeof ret === "object" && typeof ret["#text"] === "string") return { returnValue: ret["#text"] };
  return { returnValue: String(ret) };
}

function parseSoap(operation: string, xmlText: string): {
  fault?: unknown;
  faultString?: string;
  returnValue?: unknown;
} {
  const parsed = parser.parse(xmlText);
  const env = parsed.Envelope || parsed;
  const body = env.Body || env;

  const fault = body?.Fault;
  if (fault) {
    const faultString =
      (fault as any)?.faultstring || (fault as any)?.faultcode || (fault as any)?.reason || undefined;
    return { fault, faultString: faultString ? String(faultString) : JSON.stringify(fault) };
  }

  const resp = body?.[`${operation}Response`];
  const ret = resp?.return;
  return { returnValue: ret };
}

export async function axlExecute(
  hostOrUrl: string,
  args: {
    operation: string;
    data?: unknown;
    auth?: AxlAuth;
    port?: number;
    version?: string;
    timeoutMs?: number;
    includeRequestXml?: boolean;
    includeResponseXml?: boolean;
  }
): Promise<{
  host: string;
  port: number;
  version: string;
  operation: string;
  returnValue?: unknown;
  requestXml?: string;
  responseXml?: string;
}> {
  const operation = String(args.operation || "").trim();
  if (!operation) throw new Error("operation is required");

  const target = resolveAxlTarget(hostOrUrl, args.port, args.version);
  const auth = resolveAxlAuth(args.auth);

  let data = args.data;

  // Convenience: allow returnedTags as array of strings (including dotted paths)
  // and expand it into the nested XML structure AXL expects.
  if (isPlainObject(data) && Array.isArray((data as any).returnedTags)) {
    const rt = (data as any).returnedTags as unknown[];
    const paths = rt.map((p) => String(p));
    const expanded = expandReturnedTagsPaths(paths);
    const clone: Record<string, unknown> = { ...(data as any) };
    clone.returnedTags = expanded;
    data = clone;
  }

  const innerBody = isPlainObject(data)
    ? Object.entries(data)
        .map(([k, v]) => objectToXml(k, v))
        .join("")
    : data == null
      ? ""
      : objectToXml("value", data);

  const innerXml = `<ns:${escapeXml(operation)}>${innerBody}</ns:${escapeXml(operation)}>`;
  const requestXml = soapEnvelope(target.version, innerXml);

  try {
    const { xml } = await fetchAxl(target, auth, operation, innerXml, args.timeoutMs ?? 30_000);
    const parsed = parseSoap(operation, xml);
    if (parsed.fault) {
      const faultStr = parsed.faultString || "SOAP fault";
      throw new Error(`AXL ${operation} fault: ${faultStr}`);
    }
    return {
      host: target.host,
      port: target.port,
      version: target.version,
      operation,
      returnValue: parsed.returnValue,
      requestXml: args.includeRequestXml ? requestXml : undefined,
      responseXml: args.includeResponseXml ? xml : undefined,
    };
  } catch (e) {
    // Ensure we always throw an Error with a useful message.
    throw new Error(`AXL ${operation} failed: ${formatUnknownError(e)}`);
  }
}

export async function updatePhonePacketCapture(
  hostOrUrl: string,
  args: {
    deviceName: string;
    mode: string;
    durationSeconds: number;
    auth?: AxlAuth;
    port?: number;
    version?: string;
    timeoutMs?: number;
  }
): Promise<{ host: string; operation: "updatePhone"; returnValue?: string }> {
  const target = resolveAxlTarget(hostOrUrl, args.port, args.version);
  const auth = resolveAxlAuth(args.auth);

  const name = String(args.deviceName || "").trim();
  if (!name) throw new Error("deviceName is required");
  const mode = String(args.mode || "").trim();
  if (!mode) throw new Error("mode is required");
  const duration = Math.trunc(args.durationSeconds);
  if (!Number.isFinite(duration) || duration <= 0) throw new Error("durationSeconds must be > 0");

  const innerXml =
    `<ns:updatePhone>` +
    `<name>${escapeXml(name)}</name>` +
    `<packetCaptureMode>${escapeXml(mode)}</packetCaptureMode>` +
    `<packetCaptureDuration>${escapeXml(String(duration))}</packetCaptureDuration>` +
    `</ns:updatePhone>`;

  const { xml } = await fetchAxl(target, auth, "updatePhone", innerXml, args.timeoutMs ?? 30_000);
  const parsed = parseSoapReturn("updatePhone", xml);
  if (parsed.fault) throw new Error(`AXL updatePhone fault: ${parsed.fault}`);
  return { host: target.host, operation: "updatePhone", returnValue: parsed.returnValue };
}

export async function applyPhone(
  hostOrUrl: string,
  args: {
    deviceName: string;
    auth?: AxlAuth;
    port?: number;
    version?: string;
    timeoutMs?: number;
  }
): Promise<{ host: string; operation: "applyPhone"; returnValue?: string }> {
  const target = resolveAxlTarget(hostOrUrl, args.port, args.version);
  const auth = resolveAxlAuth(args.auth);

  const name = String(args.deviceName || "").trim();
  if (!name) throw new Error("deviceName is required");

  const innerXml = `<ns:applyPhone><name>${escapeXml(name)}</name></ns:applyPhone>`;
  const { xml } = await fetchAxl(target, auth, "applyPhone", innerXml, args.timeoutMs ?? 30_000);
  const parsed = parseSoapReturn("applyPhone", xml);
  if (parsed.fault) throw new Error(`AXL applyPhone fault: ${parsed.fault}`);
  return { host: target.host, operation: "applyPhone", returnValue: parsed.returnValue };
}
