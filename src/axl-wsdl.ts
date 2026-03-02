import { XMLParser } from "fast-xml-parser";
import { mkdirSync, readFileSync, readdirSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { inflateRawSync } from "node:zlib";
import { basicAuthHeader } from "./soap.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type AxlOperationGroup = {
  list: string[];
  get: string[];
  add: string[];
  update: string[];
  remove: string[];
  do: string[];
  apply: string[];
  reset: string[];
  other: string[];
};

export type AxlOperationList = {
  totalOperations: number;
  groups: AxlOperationGroup;
};

export type AxlFieldInfo = {
  name: string;
  type: string;
  optional: boolean;
};

export type AxlOperationDescription = {
  operation: string;
  inputFields: AxlFieldInfo[];
  outputFields: AxlFieldInfo[];
};

// ---------------------------------------------------------------------------
// WSDL / XSD Parser
// ---------------------------------------------------------------------------

const wsdlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@",
  removeNSPrefix: true,
  trimValues: true,
});

type WsdlCacheEntry = {
  wsdl: Record<string, unknown>;
  allSchemas: Record<string, unknown>[];
  fetchedAt: number;
};

/** In-memory cache: host → parsed WSDL + XSD schemas */
const wsdlCache = new Map<string, WsdlCacheEntry>();
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes

// ---------------------------------------------------------------------------
// Persistent disk cache
// ---------------------------------------------------------------------------

/** Override via env var for testing or custom location */
function getCacheDir(): string {
  return process.env.CUCM_MCP_WSDL_CACHE_DIR ?? join(homedir(), ".cisco-cucm-mcp", "wsdl-cache");
}

function diskCacheKey(host: string, port: number): string {
  return `${host}_${port}.json`;
}

type DiskCachePayload = {
  wsdl: Record<string, unknown>;
  allSchemas: Record<string, unknown>[];
};

function readDiskCache(host: string, port: number): WsdlCacheEntry | undefined {
  try {
    const filePath = join(getCacheDir(), diskCacheKey(host, port));
    const raw = readFileSync(filePath, "utf8");
    const data = JSON.parse(raw) as DiskCachePayload;
    if (data.wsdl && Array.isArray(data.allSchemas)) {
      return { wsdl: data.wsdl, allSchemas: data.allSchemas, fetchedAt: Date.now() };
    }
  } catch {
    // File doesn't exist or is corrupt — fall through to network
  }
  return undefined;
}

function writeDiskCache(host: string, port: number, entry: WsdlCacheEntry): void {
  try {
    const dir = getCacheDir();
    mkdirSync(dir, { recursive: true });
    const filePath = join(dir, diskCacheKey(host, port));
    const tmpPath = filePath + ".tmp";
    const payload: DiskCachePayload = { wsdl: entry.wsdl, allSchemas: entry.allSchemas };
    writeFileSync(tmpPath, JSON.stringify(payload), "utf8");
    renameSync(tmpPath, filePath);
  } catch {
    // Disk write failure is non-fatal — in-memory cache still works
  }
}

function clearDiskCache(host?: string, port?: number): void {
  try {
    const dir = getCacheDir();
    if (host && port) {
      const filePath = join(dir, diskCacheKey(host, port));
      unlinkSync(filePath);
    } else {
      // Clear all cache files
      const files = readdirSync(dir).filter((f) => f.endsWith(".json"));
      for (const f of files) {
        try { unlinkSync(join(dir, f)); } catch { /* skip */ }
      }
    }
  } catch {
    // Directory or file doesn't exist — nothing to clear
  }
}

export function clearWsdlCache(host?: string, port?: number): void {
  if (host && port) {
    wsdlCache.delete(`${host}:${port}`);
  } else {
    wsdlCache.clear();
  }
  clearDiskCache(host, port);
}

// ---------------------------------------------------------------------------
// ZIP helpers
// ---------------------------------------------------------------------------

/**
 * Extract a single file from a ZIP buffer by filename pattern.
 * Uses raw ZIP parsing (no external deps) — reads local file headers.
 */
function extractFromZip(zipBuf: Buffer, namePattern: RegExp): Buffer | undefined {
  let offset = 0;
  while (offset < zipBuf.length - 4) {
    const sig = zipBuf.readUInt32LE(offset);
    if (sig !== 0x04034b50) break;

    const compressionMethod = zipBuf.readUInt16LE(offset + 8);
    const compressedSize = zipBuf.readUInt32LE(offset + 18);
    const fileNameLen = zipBuf.readUInt16LE(offset + 26);
    const extraLen = zipBuf.readUInt16LE(offset + 28);
    const fileName = zipBuf.subarray(offset + 30, offset + 30 + fileNameLen).toString("utf8");
    const dataStart = offset + 30 + fileNameLen + extraLen;

    if (namePattern.test(fileName)) {
      const rawData = zipBuf.subarray(dataStart, dataStart + compressedSize);
      if (compressionMethod === 0) return rawData; // stored
      if (compressionMethod === 8) return inflateRawSync(rawData); // deflated
    }

    offset = dataStart + compressedSize;
  }
  return undefined;
}

/**
 * Extract ALL files from a ZIP buffer matching a pattern.
 */
function extractAllFromZip(zipBuf: Buffer, namePattern: RegExp): Buffer[] {
  const results: Buffer[] = [];
  let offset = 0;
  while (offset < zipBuf.length - 4) {
    const sig = zipBuf.readUInt32LE(offset);
    if (sig !== 0x04034b50) break;

    const compressionMethod = zipBuf.readUInt16LE(offset + 8);
    const compressedSize = zipBuf.readUInt32LE(offset + 18);
    const fileNameLen = zipBuf.readUInt16LE(offset + 26);
    const extraLen = zipBuf.readUInt16LE(offset + 28);
    const fileName = zipBuf.subarray(offset + 30, offset + 30 + fileNameLen).toString("utf8");
    const dataStart = offset + 30 + fileNameLen + extraLen;

    if (namePattern.test(fileName)) {
      const rawData = zipBuf.subarray(dataStart, dataStart + compressedSize);
      if (compressionMethod === 0) results.push(rawData);
      else if (compressionMethod === 8) results.push(inflateRawSync(rawData));
    }

    offset = dataStart + compressedSize;
  }
  return results;
}

// ---------------------------------------------------------------------------
// Schema collection helpers
// ---------------------------------------------------------------------------

/** Collect all <schema> elements from a parsed WSDL or XSD document */
function collectSchemas(parsed: Record<string, unknown>): Record<string, unknown>[] {
  const schemas: Record<string, unknown>[] = [];
  const root = (parsed as Record<string, unknown>).definitions ?? parsed;
  const def = root as Record<string, unknown>;

  // WSDL path: definitions > types > schema
  const types = def.types as Record<string, unknown> | undefined;
  if (types) {
    const s = types.schema;
    if (Array.isArray(s)) schemas.push(...(s as Record<string, unknown>[]));
    else if (s) schemas.push(s as Record<string, unknown>);
  }

  // XSD path: top-level <schema>
  const topSchema = def.schema ?? (parsed as Record<string, unknown>).schema;
  if (topSchema && !types) {
    if (Array.isArray(topSchema)) schemas.push(...(topSchema as Record<string, unknown>[]));
    else schemas.push(topSchema as Record<string, unknown>);
  }

  return schemas;
}

// ---------------------------------------------------------------------------
// WSDL + XSD fetching
// ---------------------------------------------------------------------------

async function fetchWsdlData(
  host: string,
  port: number,
  auth: { username: string; password: string },
): Promise<WsdlCacheEntry> {
  const cacheKey = `${host}:${port}`;

  // 1. In-memory cache (fast, session-scoped with TTL)
  const cached = wsdlCache.get(cacheKey);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return cached;
  }

  // 2. Disk cache (persistent, no expiration)
  const diskCached = readDiskCache(host, port);
  if (diskCached) {
    wsdlCache.set(cacheKey, diskCached);
    return diskCached;
  }

  // Strategy 1: Direct WSDL endpoint (works on some CUCM versions)
  const wsdlUrl = `https://${host}:${port}/axl/AXLAPIService?wsdl`;
  const directRes = await fetch(wsdlUrl, {
    headers: { Authorization: basicAuthHeader(auth.username, auth.password), Accept: "*/*" },
    signal: AbortSignal.timeout(30_000),
  }).catch(() => null);

  if (directRes?.ok) {
    const ct = directRes.headers.get("content-type") ?? "";
    if (ct.includes("xml")) {
      const text = await directRes.text();
      const wsdl = wsdlParser.parse(text) as Record<string, unknown>;
      const entry: WsdlCacheEntry = { wsdl, allSchemas: collectSchemas(wsdl), fetchedAt: Date.now() };
      wsdlCache.set(cacheKey, entry);
      writeDiskCache(host, port, entry);
      return entry;
    }
  }

  // Strategy 2: Download AXL SQL Toolkit zip, extract WSDL + XSD schemas
  const toolkitUrl = `https://${host}:${port}/plugins/axlsqltoolkit.zip`;
  const zipRes = await fetch(toolkitUrl, {
    headers: { Authorization: basicAuthHeader(auth.username, auth.password) },
    signal: AbortSignal.timeout(60_000),
  });

  if (!zipRes.ok) {
    throw new Error(
      `Failed to download AXL WSDL: direct endpoint returned HTTP ${directRes?.status ?? "N/A"}, ` +
        `toolkit zip returned HTTP ${zipRes.status}`,
    );
  }

  const zipBuf = Buffer.from(await zipRes.arrayBuffer());

  // Extract WSDL
  const wsdlBuf =
    extractFromZip(zipBuf, /schema\/current\/AXLAPI\.wsdl$/) ??
    extractFromZip(zipBuf, /AXLAPI\.wsdl$/);

  if (!wsdlBuf) {
    throw new Error("AXL SQL Toolkit zip downloaded but no AXLAPI.wsdl found inside");
  }

  const wsdl = wsdlParser.parse(wsdlBuf.toString("utf8")) as Record<string, unknown>;

  // Extract all XSD files from same directory (AXLSoap.xsd, AXLEnums.xsd, etc.)
  const xsdBufs = extractAllFromZip(zipBuf, /schema\/current\/.*\.xsd$/i);

  // Collect schemas from WSDL + all XSD files
  const allSchemas = collectSchemas(wsdl);
  for (const xsdBuf of xsdBufs) {
    const xsdParsed = wsdlParser.parse(xsdBuf.toString("utf8")) as Record<string, unknown>;
    allSchemas.push(...collectSchemas(xsdParsed));
  }

  // 3. Cache to both memory + disk
  const entry: WsdlCacheEntry = { wsdl, allSchemas, fetchedAt: Date.now() };
  wsdlCache.set(cacheKey, entry);
  writeDiskCache(host, port, entry);
  return entry;
}

// ---------------------------------------------------------------------------
// Operation listing
// ---------------------------------------------------------------------------

function extractOperationNames(wsdl: Record<string, unknown>): string[] {
  const definitions = wsdl.definitions ?? wsdl;
  const def = definitions as Record<string, unknown>;
  const portType = def.portType as Record<string, unknown> | undefined;

  let operations: unknown[];
  if (portType) {
    const op = (portType as Record<string, unknown>).operation;
    operations = Array.isArray(op) ? op : op ? [op] : [];
  } else {
    // Try binding fallback
    const binding = def.binding as Record<string, unknown> | undefined;
    const op = binding?.operation;
    operations = Array.isArray(op) ? op : op ? [op] : [];
  }

  return operations
    .map((op) => {
      const o = op as Record<string, unknown>;
      return String(o["@name"] ?? o.name ?? "");
    })
    .filter((n) => n.length > 0)
    .sort();
}

function groupOperations(names: string[]): AxlOperationGroup {
  const groups: AxlOperationGroup = {
    list: [],
    get: [],
    add: [],
    update: [],
    remove: [],
    do: [],
    apply: [],
    reset: [],
    other: [],
  };

  for (const name of names) {
    const lower = name.toLowerCase();
    if (lower.startsWith("list")) groups.list.push(name);
    else if (lower.startsWith("get")) groups.get.push(name);
    else if (lower.startsWith("add")) groups.add.push(name);
    else if (lower.startsWith("update")) groups.update.push(name);
    else if (lower.startsWith("remove")) groups.remove.push(name);
    else if (lower.startsWith("do")) groups.do.push(name);
    else if (lower.startsWith("apply")) groups.apply.push(name);
    else if (lower.startsWith("reset")) groups.reset.push(name);
    else groups.other.push(name);
  }

  return groups;
}

export async function listAxlOperations(
  host: string,
  auth: { username: string; password: string },
  port = 8443,
): Promise<AxlOperationList> {
  const { wsdl } = await fetchWsdlData(host, port, auth);
  const names = extractOperationNames(wsdl);
  return {
    totalOperations: names.length,
    groups: groupOperations(names),
  };
}

// ---------------------------------------------------------------------------
// Operation description — field extraction
// ---------------------------------------------------------------------------

/** Map an XML element node to AxlFieldInfo */
function mapElementToField(el: unknown): AxlFieldInfo {
  const e = el as Record<string, unknown>;
  const fieldName = String(e["@name"] ?? "");
  let fieldType = String(e["@type"] ?? "");
  // Strip namespace prefix (e.g., "axlapi:XPhone" → "XPhone", "xsd:string" → "string")
  if (fieldType.includes(":")) {
    fieldType = fieldType.split(":").pop() ?? fieldType;
  }
  // Handle inline complexType (no @type attribute)
  if (!fieldType || fieldType === "undefined") {
    fieldType = "(complex)";
  }
  const minOccurs = e["@minOccurs"];
  const optional = minOccurs === "0" || minOccurs === 0;
  return { name: fieldName, type: fieldType, optional };
}

/** Extract element children from a <sequence> or <all> container */
function extractSequenceFields(container: Record<string, unknown>): AxlFieldInfo[] {
  const seq = container.sequence ?? container.all;
  if (!seq) return [];
  const elements = (seq as Record<string, unknown>).element;
  const elArray = Array.isArray(elements) ? elements : elements ? [elements] : [];
  return elArray.map(mapElementToField);
}

/**
 * Find a named complexType across all schemas and extract its fields.
 * Handles both direct sequence/all and complexContent > extension > sequence.
 */
function findComplexType(
  schemas: Record<string, unknown>[],
  typeName: string,
): AxlFieldInfo[] {
  for (const s of schemas) {
    const complexTypes = s.complexType;
    const ctArray = Array.isArray(complexTypes) ? complexTypes : complexTypes ? [complexTypes] : [];

    for (const ct of ctArray) {
      const c = ct as Record<string, unknown>;
      if (String(c["@name"] ?? "") !== typeName) continue;

      // Case 1: direct <sequence> or <all>
      const fields = extractSequenceFields(c);
      if (fields.length > 0) return fields;

      // Case 2: <complexContent><extension base="..."><sequence>
      const cc = c.complexContent as Record<string, unknown> | undefined;
      const ext = cc?.extension as Record<string, unknown> | undefined;
      if (ext) {
        const extFields = extractSequenceFields(ext);
        if (extFields.length > 0) return extFields;
      }

      // Found the type but it has no sequence elements
      return [];
    }
  }
  return [];
}

/**
 * Resolve an XSD element by name → follow @type to complexType, or extract inline type.
 * This handles the AXL pattern: <element name="listPhone" type="axlapi:ListPhoneReq"/>
 */
function resolveElementFields(
  schemas: Record<string, unknown>[],
  elementName: string,
): AxlFieldInfo[] {
  for (const s of schemas) {
    const elements = s.element;
    const elArray = Array.isArray(elements) ? elements : elements ? [elements] : [];

    for (const el of elArray) {
      const e = el as Record<string, unknown>;
      if (String(e["@name"] ?? "") !== elementName) continue;

      // Case 1: has @type → look up the referenced complexType
      const typeAttr = e["@type"];
      if (typeAttr) {
        let typeName = String(typeAttr);
        if (typeName.includes(":")) typeName = typeName.split(":").pop() ?? typeName;
        return findComplexType(schemas, typeName);
      }

      // Case 2: inline <complexType> nested under the element
      const inlineCT = e.complexType as Record<string, unknown> | undefined;
      if (inlineCT) {
        const fields = extractSequenceFields(inlineCT);
        if (fields.length > 0) return fields;
        const cc = inlineCT.complexContent as Record<string, unknown> | undefined;
        const ext = cc?.extension as Record<string, unknown> | undefined;
        if (ext) {
          const extFields = extractSequenceFields(ext);
          if (extFields.length > 0) return extFields;
        }
      }
    }
  }
  return [];
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * Look up input/output fields for an operation using multiple strategies:
 * 1. Element-based lookup (follows <element name="opName" type="OpNameReq"/>)
 * 2. Direct complexType name matching with various naming patterns
 */
function describeFromSchemas(
  schemas: Record<string, unknown>[],
  operationName: string,
): AxlOperationDescription {
  const cap = capitalize(operationName);

  // Naming candidates — AXL convention: ListPhoneReq / ListPhoneRes
  const inputCandidates = [
    `${operationName}Request`,
    `${operationName}Req`,
    operationName,
    `${cap}Req`,
    `${cap}Request`,
  ];
  const outputCandidates = [
    `${operationName}Response`,
    `${operationName}Res`,
    `${operationName}Return`,
    `${cap}Res`,
    `${cap}Response`,
    `${cap}Return`,
  ];

  let inputFields: AxlFieldInfo[] = [];
  let outputFields: AxlFieldInfo[] = [];

  // Strategy 1: Element-based lookup (most reliable for real AXL WSDL + XSD)
  inputFields = resolveElementFields(schemas, operationName);
  if (inputFields.length === 0) {
    // Strategy 2: Direct complexType name matching
    for (const candidate of inputCandidates) {
      inputFields = findComplexType(schemas, candidate);
      if (inputFields.length > 0) break;
    }
  }

  outputFields = resolveElementFields(schemas, `${operationName}Response`);
  if (outputFields.length === 0) {
    for (const candidate of outputCandidates) {
      outputFields = findComplexType(schemas, candidate);
      if (outputFields.length > 0) break;
    }
  }

  return { operation: operationName, inputFields, outputFields };
}

export async function describeAxlOperation(
  host: string,
  auth: { username: string; password: string },
  operationName: string,
  port = 8443,
): Promise<AxlOperationDescription> {
  const { allSchemas } = await fetchWsdlData(host, port, auth);
  return describeFromSchemas(allSchemas, operationName);
}

// ---------------------------------------------------------------------------
// Pure parsing for testing (no network)
// ---------------------------------------------------------------------------

export function parseWsdlOperations(wsdlText: string): AxlOperationList {
  const parsed = wsdlParser.parse(wsdlText) as Record<string, unknown>;
  const names = extractOperationNames(parsed);
  return { totalOperations: names.length, groups: groupOperations(names) };
}

export function parseWsdlOperationDescription(wsdlText: string, operationName: string): AxlOperationDescription {
  const parsed = wsdlParser.parse(wsdlText) as Record<string, unknown>;
  const schemas = collectSchemas(parsed);
  return describeFromSchemas(schemas, operationName);
}
