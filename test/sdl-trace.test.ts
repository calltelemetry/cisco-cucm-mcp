import { parseSdlLine, parseSdlTrace, extractCallFlow } from "../src/sdl-trace.js";

// ---------------------------------------------------------------------------
// Sample SDL lines
// ---------------------------------------------------------------------------

const WELL_FORMED_LINE =
  "00001234 | 26/02/2026 07:30:00.123 | SdlSig   | DbInfoInd              | waiting           | Oam(1,100,51,1)   | Oam(1,100,59,1)   | 1,100,185,1.2^10.0.0.1^*         | [T:N-H:0,N:1,SEQ:12345,LEN:200,RSEQ:0] CI=12345678 ConnType=6";

const LINE_WITH_CI =
  "00001235 | 26/02/2026 07:30:00.456 | SdlSig   | CcSetupInd             | waiting           | Ci(1,100,185,12)  | Cc(1,100,68,1)    | 1,100,185,1.2^10.0.0.1^*         | [T:N-H:0,N:1,SEQ:12346] CI=12345678";

const LINE_DIFFERENT_CALL =
  "00001236 | 26/02/2026 07:30:01.000 | SdlSig   | CcConnectedInd         | waiting           | Ci(1,100,185,14)  | Cc(1,100,68,1)    | 1,100,185,1.2^10.0.0.2^*         | [T:N-H:0,N:1,SEQ:12400] CI=99999999";

const LINE_NO_CI =
  "00001237 | 26/02/2026 07:30:02.000 | SdlSig   | KeepAlive              | active            | Oam(1,100,51,1)   | Oam(1,100,59,1)   | 1,100,185,1.2^10.0.0.1^*         | [T:N-H:0,N:1,SEQ:12500]";

// ---------------------------------------------------------------------------
// parseSdlLine
// ---------------------------------------------------------------------------

describe("parseSdlLine", () => {
  it("parses a well-formed line correctly", () => {
    const result = parseSdlLine(WELL_FORMED_LINE);
    expect(result).not.toBeNull();
    expect(result!.lineNumber).toBe("00001234");
    expect(result!.timestamp).toBe("26/02/2026 07:30:00.123");
    expect(result!.type).toBe("SdlSig");
    expect(result!.signalName).toBe("DbInfoInd");
    expect(result!.state).toBe("waiting");
    expect(result!.from).toBe("Oam(1,100,51,1)");
    expect(result!.to).toBe("Oam(1,100,59,1)");
    expect(result!.tag).toContain("CI=12345678");
  });

  it("extracts callId from CI= pattern", () => {
    const result = parseSdlLine(LINE_WITH_CI);
    expect(result).not.toBeNull();
    expect(result!.callId).toBe("12345678");
  });

  it("leaves callId undefined when no CI= present", () => {
    const result = parseSdlLine(LINE_NO_CI);
    expect(result).not.toBeNull();
    expect(result!.callId).toBeUndefined();
  });

  it("returns null for blank lines", () => {
    expect(parseSdlLine("")).toBeNull();
    expect(parseSdlLine("   ")).toBeNull();
    expect(parseSdlLine("\t")).toBeNull();
  });

  it("returns null for comment lines", () => {
    expect(parseSdlLine("# This is a comment")).toBeNull();
    expect(parseSdlLine("// Another comment")).toBeNull();
  });

  it("returns null for lines with too few fields", () => {
    expect(parseSdlLine("only | three | fields")).toBeNull();
    expect(parseSdlLine("just a line of text")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// parseSdlTrace
// ---------------------------------------------------------------------------

describe("parseSdlTrace", () => {
  it("groups signals by callId", () => {
    const content = [WELL_FORMED_LINE, LINE_WITH_CI, LINE_DIFFERENT_CALL].join("\n");
    const analysis = parseSdlTrace(content);

    // Two distinct callIds: 12345678 and 99999999
    expect(analysis.callFlows).toHaveLength(2);

    const flow1 = analysis.callFlows.find((f) => f.callId === "12345678");
    expect(flow1).toBeDefined();
    expect(flow1!.signals).toHaveLength(2);

    const flow2 = analysis.callFlows.find((f) => f.callId === "99999999");
    expect(flow2).toBeDefined();
    expect(flow2!.signals).toHaveLength(1);
  });

  it("counts unparseable lines", () => {
    const content = [
      WELL_FORMED_LINE,
      "# comment line",
      "garbage that is not SDL",
      LINE_WITH_CI,
      "",
    ].join("\n");
    const analysis = parseSdlTrace(content);

    // "# comment line" and "garbage that is not SDL" are unparseable non-empty lines
    expect(analysis.unparsedLines).toBe(2);
    expect(analysis.parsedSignals).toBe(2);
  });

  it("builds signalSummary with counts per signal name", () => {
    const content = [WELL_FORMED_LINE, LINE_WITH_CI, LINE_DIFFERENT_CALL].join("\n");
    const analysis = parseSdlTrace(content);

    expect(analysis.signalSummary["DbInfoInd"]).toBe(1);
    expect(analysis.signalSummary["CcSetupInd"]).toBe(1);
    expect(analysis.signalSummary["CcConnectedInd"]).toBe(1);
  });

  it("returns zero counts for empty input", () => {
    const analysis = parseSdlTrace("");
    expect(analysis.totalLines).toBe(1); // one empty line from split
    expect(analysis.parsedSignals).toBe(0);
    expect(analysis.unparsedLines).toBe(0);
    expect(analysis.callFlows).toHaveLength(0);
    expect(analysis.signalSummary).toEqual({});
  });

  it("does not include signals without callId in callFlows", () => {
    const content = [LINE_NO_CI].join("\n");
    const analysis = parseSdlTrace(content);

    expect(analysis.parsedSignals).toBe(1);
    expect(analysis.callFlows).toHaveLength(0);
  });

  it("reports totalLines correctly", () => {
    const content = [WELL_FORMED_LINE, LINE_WITH_CI, LINE_DIFFERENT_CALL, LINE_NO_CI].join("\n");
    const analysis = parseSdlTrace(content);

    expect(analysis.totalLines).toBe(4);
    expect(analysis.parsedSignals).toBe(4);
  });
});

// ---------------------------------------------------------------------------
// extractCallFlow
// ---------------------------------------------------------------------------

describe("extractCallFlow", () => {
  it("returns the correct call flow for a known callId", () => {
    const content = [WELL_FORMED_LINE, LINE_WITH_CI, LINE_DIFFERENT_CALL].join("\n");
    const analysis = parseSdlTrace(content);

    const flow = extractCallFlow(analysis, "12345678");
    expect(flow).toBeDefined();
    expect(flow!.callId).toBe("12345678");
    expect(flow!.signals).toHaveLength(2);
  });

  it("returns undefined for an unknown callId", () => {
    const content = [WELL_FORMED_LINE].join("\n");
    const analysis = parseSdlTrace(content);

    const flow = extractCallFlow(analysis, "nonexistent");
    expect(flow).toBeUndefined();
  });
});
