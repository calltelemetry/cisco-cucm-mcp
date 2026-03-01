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

/** Detect rate-limit errors from CUCM RIS/PerfMon (HTTP 503 or "Exceeded allowed rate" SOAP fault). */
function isRateLimitError(status: number, bodyText: string): boolean {
  if (status === 503) return true;
  if (/exceeded allowed rate/i.test(bodyText)) return true;
  return false;
}

/** Retry delays (ms) for rate-limited requests: 5s, 10s, 20s */
const RATE_LIMIT_DELAYS = [5_000, 10_000, 20_000];

/**
 * Generic SOAP fetch for Serviceability APIs (RisPort, PerfMon, ControlCenter).
 * Returns the parsed SOAP Body object. Unlike DIME, these APIs return plain text/xml.
 *
 * Automatically retries on CUCM rate-limit responses (HTTP 503 or "Exceeded allowed rate"
 * SOAP faults) with exponential backoff: 5s → 10s → 20s (3 retries max).
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
  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= RATE_LIMIT_DELAYS.length; attempt++) {
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

      // Check for rate limiting — retry with backoff
      if (isRateLimitError(res.status, text) && attempt < RATE_LIMIT_DELAYS.length) {
        const delay = RATE_LIMIT_DELAYS[attempt]!;
        await new Promise((r) => setTimeout(r, delay));
        lastError = new Error(`CUCM rate limited (HTTP ${res.status}), retrying...`);
        continue;
      }

      // Try to extract a readable SOAP fault string instead of dumping raw XML
      if (text) {
        try {
          const parsed = soapParser.parse(text);
          const env = parsed.Envelope || parsed;
          const body = env.Body || env;
          const fault = body?.Fault;
          if (fault) {
            const faultString = fault.faultstring || fault.faultcode || fault.reason || JSON.stringify(fault);
            throw new Error(`CUCM SOAP fault (HTTP ${res.status}): ${String(faultString)}`);
          }
        } catch (e) {
          if (e instanceof Error && e.message.startsWith("CUCM SOAP fault")) throw e;
          // XML parse failed — fall through to raw text
        }
      }
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

      // Rate-limit fault in a 200 response body — retry
      if (isRateLimitError(200, String(faultString)) && attempt < RATE_LIMIT_DELAYS.length) {
        const delay = RATE_LIMIT_DELAYS[attempt]!;
        await new Promise((r) => setTimeout(r, delay));
        lastError = new Error(`CUCM rate limited (SOAP fault), retrying...`);
        continue;
      }

      throw new Error(`CUCM SOAP fault: ${String(faultString)}`);
    }

    return body as Record<string, unknown>;
  }

  // Should not reach here, but just in case
  throw lastError ?? new Error("CUCM request failed after retries");
}

/** Normalize a single-item-or-array into an array. */
export function toArray<T>(x: T | T[] | null | undefined): T[] {
  if (x === null || x === undefined) return [];
  return Array.isArray(x) ? x : [x];
}
