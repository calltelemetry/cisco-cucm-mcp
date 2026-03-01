import { XMLParser } from "fast-xml-parser";

export const soapParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@",
  removeNSPrefix: true,
  trimValues: true,
});

export function basicAuthHeader(username: string, password: string): string {
  return `Basic ${Buffer.from(`${username}:${password}`, "utf8").toString("base64")}`;
}

export function escapeXml(s: string): string {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

/**
 * Generic SOAP fetch for Serviceability APIs (RisPort, PerfMon, ControlCenter).
 * Returns the parsed SOAP Body object. Unlike DIME, these APIs return plain text/xml.
 */
export async function fetchServiceabilitySoap(
  host: string,
  port: number,
  auth: { username: string; password: string },
  path: string,
  soapAction: string,
  xmlBody: string,
  timeoutMs = 30_000,
): Promise<Record<string, unknown>> {
  const url = `https://${host}:${port}${path}`;
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
    throw new Error(`CUCM Serviceability HTTP ${res.status}: ${text || res.statusText}`);
  }

  const text = await res.text();
  const parsed = soapParser.parse(text);
  const env = parsed.Envelope || parsed;
  const body = env.Body || env;

  const fault = body?.Fault;
  if (fault) {
    const faultString =
      fault.faultstring || fault.faultcode || fault.reason || JSON.stringify(fault);
    throw new Error(`CUCM SOAP fault: ${String(faultString)}`);
  }

  return body as Record<string, unknown>;
}

/** Normalize a single-item-or-array into an array. */
export function toArray<T>(x: T | T[] | null | undefined): T[] {
  if (x === null || x === undefined) return [];
  return Array.isArray(x) ? x : [x];
}
