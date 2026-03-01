/**
 * SDL trace parser for CUCM diagnostic logs.
 *
 * SDL (Signal Distribution Layer) traces are pipe-delimited log files from
 * Cisco Unified Communications Manager. This module provides pure local
 * analysis — no network calls, no SSH, no SOAP.
 *
 * Example SDL line:
 * 00001234 | 26/02/2026 07:30:00.123 | SdlSig   | DbInfoInd              | waiting           | Oam(1,100,51,1)   | Oam(1,100,59,1)   | 1,100,185,1.2^10.0.0.1^*         | [T:N-H:0,N:1,SEQ:12345,LEN:200,RSEQ:0] CI=12345678 ConnType=6
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SdlSignal = {
  lineNumber: string;
  timestamp: string;
  type: string;
  signalName: string;
  state: string;
  from: string;
  to: string;
  tag: string;
  callId?: string;
};

export type SdlCallFlow = {
  callId: string;
  signals: SdlSignal[];
};

export type SdlAnalysis = {
  totalLines: number;
  parsedSignals: number;
  unparsedLines: number;
  callFlows: SdlCallFlow[];
  signalSummary: Record<string, number>;
};

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

/**
 * Parse a single SDL trace line into a structured signal object.
 *
 * Returns `null` for blank lines, comment lines, headers, or any line that
 * does not match the expected pipe-delimited format.
 */
export function parseSdlLine(line: string): SdlSignal | null {
  if (!line || !line.trim()) return null;

  const trimmed = line.trim();

  // Skip comment lines (starting with # or //)
  if (trimmed.startsWith("#") || trimmed.startsWith("//")) return null;

  // Split by pipe delimiter
  const parts = trimmed.split("|").map((p) => p.trim());

  // A well-formed SDL line has at least 8 pipe-delimited fields:
  // lineNumber | timestamp | type | signalName | state | from | to | tag
  if (parts.length < 8) return null;

  const lineNumber = parts[0] ?? "";
  const timestamp = parts[1] ?? "";
  const type = parts[2] ?? "";
  const signalName = parts[3] ?? "";
  const state = parts[4] ?? "";
  const from = parts[5] ?? "";
  const to = parts[6] ?? "";
  // The tag may span multiple pipe segments (rest of line after field 7)
  const tag = parts.slice(7).join(" | ");

  // Reject if key fields are empty (likely a header or separator line)
  if (!lineNumber || !timestamp || !signalName) return null;

  const signal: SdlSignal = {
    lineNumber,
    timestamp,
    type,
    signalName,
    state,
    from,
    to,
    tag,
  };

  // Extract callId from CI= pattern in the tag field
  const ciMatch = tag.match(/CI=(\d+)/);
  if (ciMatch) {
    signal.callId = ciMatch[1];
  }

  return signal;
}

/**
 * Parse an entire SDL trace file content into a structured analysis.
 *
 * Groups signals by callId (extracted from the CI= pattern) and builds
 * summary statistics including signal type counts.
 */
export function parseSdlTrace(content: string): SdlAnalysis {
  const lines = content.split("\n");
  const totalLines = lines.length;

  const signals: SdlSignal[] = [];
  let unparsedLines = 0;

  for (const line of lines) {
    const signal = parseSdlLine(line);
    if (signal) {
      signals.push(signal);
    } else {
      // Count non-empty lines that failed to parse as unparsed
      if (line.trim()) {
        unparsedLines++;
      }
    }
  }

  // Group signals by callId
  const callFlowMap = new Map<string, SdlSignal[]>();
  for (const signal of signals) {
    if (signal.callId) {
      const existing = callFlowMap.get(signal.callId);
      if (existing) {
        existing.push(signal);
      } else {
        callFlowMap.set(signal.callId, [signal]);
      }
    }
  }

  const callFlows: SdlCallFlow[] = [];
  for (const [callId, flowSignals] of callFlowMap) {
    callFlows.push({ callId, signals: flowSignals });
  }

  // Build signal name summary (count of each signal type)
  const signalSummary: Record<string, number> = {};
  for (const signal of signals) {
    signalSummary[signal.signalName] = (signalSummary[signal.signalName] ?? 0) + 1;
  }

  return {
    totalLines,
    parsedSignals: signals.length,
    unparsedLines,
    callFlows,
    signalSummary,
  };
}

// ---------------------------------------------------------------------------
// Extraction
// ---------------------------------------------------------------------------

/**
 * Extract a single call flow by callId from an existing analysis.
 *
 * Returns `undefined` if the callId is not found.
 */
export function extractCallFlow(analysis: SdlAnalysis, callId: string): SdlCallFlow | undefined {
  return analysis.callFlows.find((flow) => flow.callId === callId);
}
