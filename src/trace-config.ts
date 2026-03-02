import { axlExecute, type AxlAuth } from "./axl.js";

// ---------------------------------------------------------------------------
// Trace level constants
// ---------------------------------------------------------------------------

/**
 * CUCM Debug Trace Levels (ordered from least to most verbose).
 * These map to the Serviceability > Trace > Configuration UI.
 */
export const TRACE_LEVELS = [
  "Error",
  "Special",
  "State Transition",
  "Significant",
  "Entry/Exit",
  "Arbitrary",
  "Detailed",
] as const;

export type TraceLevel = (typeof TRACE_LEVELS)[number];

/**
 * CUCM stores trace levels as cumulative bitmask values in the
 * `processnodeservice.tracelevel` column. Each level includes all lower levels.
 *
 * Error=1, Special=3, State Transition=7, Significant=15,
 * Entry/Exit=31, Arbitrary=63, Detailed=127
 */
export const TRACE_LEVEL_MAP: Record<TraceLevel, number> = {
  Error: 1,
  Special: 3,
  "State Transition": 7,
  Significant: 15,
  "Entry/Exit": 31,
  Arbitrary: 63,
  Detailed: 127,
};

export const TRACE_LEVEL_REVERSE: Record<number, TraceLevel> = Object.fromEntries(
  Object.entries(TRACE_LEVEL_MAP).map(([k, v]) => [v, k as TraceLevel]),
) as Record<number, TraceLevel>;

// ---------------------------------------------------------------------------
// Get trace configuration for a service
// ---------------------------------------------------------------------------

export type TraceConfigResult = {
  service: string;
  traceLevel: string;
  traceLevelNumeric: number;
  enabled: boolean;
  server: string;
  raw: Record<string, unknown>;
};

/**
 * Query the current trace configuration for a CUCM service via AXL SQL.
 *
 * Uses `executeSQLQuery` against the `processnodeservice` table joined with
 * `typeservice`. This is the actual runtime trace config per node.
 */
export async function getTraceConfig(
  host: string,
  serviceName: string,
  opts?: { auth?: AxlAuth; port?: number; version?: string },
): Promise<TraceConfigResult[]> {
  const queries = [
    // Primary: processnodeservice joined with typeservice (works on CUCM 12.x–15.x)
    `SELECT ts.name, pns.tracelevel, pns.enable, pns.servername FROM processnodeservice pns INNER JOIN typeservice ts ON pns.tkservice = ts.enum WHERE ts.name LIKE '%${escapeSql(serviceName)}%'`,
    // Fallback: broader search using isactive filter
    `SELECT ts.name, pns.tracelevel, pns.enable, pns.servername FROM processnodeservice pns INNER JOIN typeservice ts ON pns.tkservice = ts.enum WHERE ts.name LIKE '%${escapeSql(serviceName)}%' AND pns.isactive = 't'`,
  ];

  for (const sql of queries) {
    try {
      const result = await axlExecute(host, {
        operation: "executeSQLQuery",
        data: { sql },
        auth: opts?.auth,
        port: opts?.port,
        version: opts?.version,
      });

      const rows = extractRows(result.returnValue);
      if (rows.length > 0) {
        return rows.map((row) => {
          const level = Number(row.tracelevel ?? -1);
          return {
            service: String(row.name || serviceName),
            traceLevel: TRACE_LEVEL_REVERSE[level] || `Unknown(${level})`,
            traceLevelNumeric: level,
            enabled: String(row.enable) === "t",
            server: String(row.servername || ""),
            raw: row,
          };
        });
      }
    } catch {
      // Try next query variant
      continue;
    }
  }

  throw new Error(
    `Could not find trace configuration for service "${serviceName}". ` +
      `Try listing services first with list_node_service_logs.`,
  );
}

// ---------------------------------------------------------------------------
// Set trace level for a service
// ---------------------------------------------------------------------------

export type SetTraceLevelResult = {
  service: string;
  previousLevel: string;
  newLevel: string;
  rowsUpdated: number;
};

/**
 * Set the debug trace level for a CUCM service via AXL SQL.
 *
 * Updates `processnodeservice.tracelevel` using the cumulative bitmask value.
 * Changes take effect immediately for most services (no restart needed).
 */
export async function setTraceLevel(
  host: string,
  serviceName: string,
  level: TraceLevel,
  opts?: { auth?: AxlAuth; port?: number; version?: string; enableTrace?: boolean },
): Promise<SetTraceLevelResult> {
  const numericLevel = TRACE_LEVEL_MAP[level];
  if (numericLevel === undefined) {
    throw new Error(`Invalid trace level "${level}". Valid levels: ${TRACE_LEVELS.join(", ")}`);
  }

  // Get current level first
  let previousLevel = "Unknown";
  try {
    const current = await getTraceConfig(host, serviceName, opts);
    if (current.length > 0) {
      previousLevel = current[0]!.traceLevel;
    }
  } catch {
    // Continue even if we can't read current level
  }

  const enableTrace = opts?.enableTrace !== false;
  const traceOn = enableTrace ? "t" : "f";

  const sql =
    `UPDATE processnodeservice SET tracelevel = ${numericLevel}, enable = '${traceOn}' ` +
    `WHERE tkservice IN (SELECT enum FROM typeservice WHERE name LIKE '%${escapeSql(serviceName)}%')`;

  try {
    const result = await axlExecute(host, {
      operation: "executeSQLUpdate",
      data: { sql },
      auth: opts?.auth,
      port: opts?.port,
      version: opts?.version,
    });

    const rowsUpdated = extractRowsUpdated(result.returnValue);
    if (rowsUpdated > 0) {
      return {
        service: serviceName,
        previousLevel,
        newLevel: level,
        rowsUpdated,
      };
    }
  } catch {
    // Fall through to error
  }

  throw new Error(
    `Could not update trace level for service "${serviceName}". ` +
      `The service name may not match any CUCM service. ` +
      `Try listing services with list_node_service_logs first.`,
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function escapeSql(s: string): string {
  return s.replace(/'/g, "''").replace(/\\/g, "\\\\");
}

function extractRows(returnValue: unknown): Record<string, unknown>[] {
  if (!returnValue || typeof returnValue !== "object") return [];

  const rv = returnValue as Record<string, unknown>;
  const row = rv.row;
  if (!row) return [];

  const rows = Array.isArray(row) ? row : [row];
  return rows.filter((r): r is Record<string, unknown> => typeof r === "object" && r !== null);
}

function extractRowsUpdated(returnValue: unknown): number {
  if (typeof returnValue === "number") return returnValue;
  if (typeof returnValue === "string") {
    const match = returnValue.match(/(\d+)\s*row/i);
    if (match) return parseInt(match[1]!, 10);
    const num = parseInt(returnValue, 10);
    if (!isNaN(num)) return num;
  }
  if (typeof returnValue === "object" && returnValue !== null) {
    const rv = returnValue as Record<string, unknown>;
    const updated = rv.rowsUpdated ?? rv.rows_updated ?? rv.return;
    if (typeof updated === "number") return updated;
    if (typeof updated === "string") return parseInt(updated, 10) || 0;
  }
  return 0;
}
