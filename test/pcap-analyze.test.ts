import { vi, describe, it, expect, beforeEach } from "vitest";
import { execFile } from "node:child_process";
import { existsSync, statSync } from "node:fs";

vi.mock("node:child_process", () => ({
  execFile: vi.fn(),
}));

vi.mock("node:fs", () => ({
  existsSync: vi.fn(),
  statSync: vi.fn(),
}));

import {
  runTshark,
  pcapCallSummary,
  pcapSipCalls,
  pcapScppMessages,
  pcapRtpStreams,
  pcapProtocolFilter,
} from "../src/pcap-analyze.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Set up file-validation mocks so validateCapFile passes. */
function mockFileExists(size = 1024) {
  (existsSync as ReturnType<typeof vi.fn>).mockReturnValue(true);
  (statSync as ReturnType<typeof vi.fn>).mockReturnValue({ size });
}

/**
 * Queue a sequence of stdout values that execFile will return in order.
 * Each call to execFile resolves with the next string in the array.
 */
function mockTsharkSequence(outputs: string[]) {
  let callIndex = 0;
  (execFile as unknown as ReturnType<typeof vi.fn>).mockImplementation(
    (_bin: string, _args: string[], _opts: unknown, cb: (...args: unknown[]) => void) => {
      const output = outputs[callIndex] ?? "";
      callIndex++;
      cb(null, output, "");
    }
  );
}

/** Convenience: single-call mock. */
function mockTsharkOutput(stdout: string) {
  mockTsharkSequence([stdout]);
}

/** Make execFile invoke the callback with an error. */
function mockTsharkError(err: Error, stderr = "") {
  (execFile as unknown as ReturnType<typeof vi.fn>).mockImplementation(
    (_bin: string, _args: string[], _opts: unknown, cb: (...args: unknown[]) => void) => {
      cb(err, "", stderr);
    }
  );
}

// ---------------------------------------------------------------------------
// Reset between tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.resetAllMocks();
  mockFileExists();
});

// ===========================================================================
// runTshark
// ===========================================================================

describe("runTshark", () => {
  it("resolves with stdout from execFile", async () => {
    mockTsharkOutput("hello world\n");
    const result = await runTshark(["-v"]);
    expect(result).toBe("hello world\n");
  });

  it("passes args array to execFile", async () => {
    mockTsharkOutput("");
    await runTshark(["-r", "/tmp/test.cap", "-q", "-z", "io,phs"]);

    const call = (execFile as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    const args: string[] = call[1];
    expect(args).toEqual(["-r", "/tmp/test.cap", "-q", "-z", "io,phs"]);
  });

  it("sets maxBuffer to 50 MB and uses default timeout", async () => {
    mockTsharkOutput("");
    await runTshark(["-v"]);

    const call = (execFile as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    const opts = call[2] as { timeout: number; maxBuffer: number };
    expect(opts.maxBuffer).toBe(50 * 1024 * 1024);
    expect(opts.timeout).toBeGreaterThan(0);
  });

  it("rejects when execFile returns an error with stderr", async () => {
    mockTsharkError(new Error("exit 1"), "tshark error: bad filter");
    await expect(runTshark(["-Y", "bad"])).rejects.toThrow("tshark error:");
  });

  it("rejects with 'tshark not found' when ENOENT", async () => {
    mockTsharkError(new Error("ENOENT"), "ENOENT");
    await expect(runTshark(["-v"])).rejects.toThrow("tshark not found");
  });

  it("rejects with 'File not found' when cap file missing", async () => {
    mockTsharkError(
      new Error("exit 2"),
      "No such file or directory: /tmp/missing.cap"
    );
    await expect(runTshark(["-r", "/tmp/missing.cap"])).rejects.toThrow(
      "File not found"
    );
  });
});

// ===========================================================================
// pcapCallSummary
// ===========================================================================

describe("pcapCallSummary", () => {
  const FAKE_FILE = "/tmp/call.cap";

  // Protocol hierarchy (io,phs) output
  const phsOutput = [
    "===================================================================",
    "Protocol Hierarchy Statistics",
    "Filter:",
    "",
    "eth                              frames:500 bytes:350000",
    "  ip                             frames:500 bytes:340000",
    "    udp                          frames:480 bytes:330000",
    "      sip                        frames:50  bytes:45000",
    "        sdp                      frames:20  bytes:18000",
    "      rtp                        frames:400 bytes:280000",
    "      rtcp                       frames:30  bytes:7000",
    "    tcp                          frames:20  bytes:10000",
    "      skinny                     frames:20  bytes:10000",
    "===================================================================",
  ].join("\n");

  // SIP Call-ID extraction
  const sipCallIdOutput = [
    "abc123@10.0.0.1",
    "abc123@10.0.0.1",
    "def456@10.0.0.2",
    "",
  ].join("\n");

  // RTP streams
  const rtpStreamsOutput = [
    "========================= RTP Streams ========================",
    "    Start: 2024-01-01 00:00:00",
    "      End: 2024-01-01 00:01:00",
    "  Src Addr  Src Port  Dst Addr  Dst Port  SSRC  Payload  Packets  Lost  Max Delta  Max Jitter  Mean Jitter",
    "  10.0.0.1  20000     10.0.0.2  20002     0x1234  0      200      0     20.5       1.2         0.8",
    "  10.0.0.2  20002     10.0.0.1  20000     0x5678  0      198      2     22.1       1.5         0.9",
    "========================= RTP Streams ========================",
  ].join("\n");

  // IP conversations
  const convIpOutput = [
    "================================================================================",
    "IPv4 Conversations",
    "Filter:<No Filter>",
    "                                               |       <-      | |       ->      | |     Total     |    Rel Start    |   Duration   |",
    "                                               | Frames  Bytes | | Frames  Bytes | | Frames  Bytes | |               |              |",
    "10.0.0.1         <->  10.0.0.2                     200  140000     200  140000       400  280000       0.000            60.5",
    "10.0.0.1         <->  10.0.0.3                      50   40000      50   40000       100   80000       0.000            60.5",
    "================================================================================",
  ].join("\n");

  // Empty placeholder for the -c 1 frame.time_relative call
  const frameTimeEmpty = "";

  // io,stat for duration
  const ioStatOutput = [
    "===================================================================",
    "IO Statistics",
    "                     |",
    "Duration: 62.5 secs",
    "===================================================================",
  ].join("\n");

  it("returns a well-shaped summary object", async () => {
    mockTsharkSequence([
      phsOutput,         // 1. io,phs
      sipCallIdOutput,   // 2. SIP Call-IDs
      rtpStreamsOutput,   // 3. rtp,streams
      convIpOutput,      // 4. conv,ip
      frameTimeEmpty,    // 5. frame.time_relative -c 1
      ioStatOutput,      // 6. io,stat,0
    ]);

    const result = (await pcapCallSummary(FAKE_FILE)) as Record<string, unknown>;

    expect(result.file).toBe(FAKE_FILE);
    expect(result.bytes).toBe(1024); // from statSync mock
    expect(result.packets).toBe(500); // ip frames
    expect(result.duration).toBe("62.5s");

    const protocols = result.protocols as Record<string, number>;
    expect(protocols.sip).toBe(50);
    expect(protocols.skinny).toBe(20);
    expect(protocols.rtp).toBe(400);
    expect(protocols.rtcp).toBe(30);
    expect(protocols.sdp).toBe(20);

    expect(result.sipCalls).toBe(2);
    expect(result.sipCallIds).toEqual(["abc123@10.0.0.1", "def456@10.0.0.2"]);
    expect(result.rtpStreams).toBe(2);

    const endpoints = result.endpoints as string[];
    expect(endpoints).toContain("10.0.0.1");
    expect(endpoints).toContain("10.0.0.2");
    expect(endpoints).toContain("10.0.0.3");
  });

  it("handles missing SIP/RTP gracefully (catch blocks)", async () => {
    let callIndex = 0;
    (execFile as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      (_bin: string, args: string[], _opts: unknown, cb: (...args: unknown[]) => void) => {
        callIndex++;
        // First call: io,phs — minimal output with only eth+ip
        if (callIndex === 1) {
          cb(null, "eth frames:10 bytes:5000\n  ip frames:10 bytes:4800\n", "");
          return;
        }
        // SIP call (2) — error → caught
        if (callIndex === 2) {
          cb(new Error("no sip"), "", "tshark error: no sip packets");
          return;
        }
        // RTP streams (3) — error → caught
        if (callIndex === 3) {
          cb(new Error("no rtp"), "", "tshark error: no rtp");
          return;
        }
        // conv,ip (4) — error → caught
        if (callIndex === 4) {
          cb(new Error("no conv"), "", "tshark error: no conversations");
          return;
        }
        // Remaining duration calls
        cb(null, "", "");
      }
    );

    const result = (await pcapCallSummary(FAKE_FILE)) as Record<string, unknown>;
    expect(result.sipCalls).toBe(0);
    expect(result.sipCallIds).toEqual([]);
    expect(result.rtpStreams).toBe(0);
    expect(result.endpoints).toEqual([]);
  });

  it("truncates sipCallIds to 20 when there are more", async () => {
    const manyIds = Array.from({ length: 25 }, (_, i) => `call-${i}@host`).join("\n") + "\n";
    mockTsharkSequence([
      phsOutput,
      manyIds,
      rtpStreamsOutput,
      convIpOutput,
      frameTimeEmpty,
      ioStatOutput,
    ]);

    const result = (await pcapCallSummary(FAKE_FILE)) as Record<string, unknown>;
    expect(result.sipCalls).toBe(25);
    expect((result.sipCallIds as string[]).length).toBe(20);
  });
});

// ===========================================================================
// pcapSipCalls
// ===========================================================================

describe("pcapSipCalls", () => {
  const FAKE_FILE = "/tmp/sip.cap";

  // Tab-separated SIP messages:
  // frame.time_relative \t ip.src \t ip.dst \t sip.Method \t sip.Status-Code \t sip.Status-Line \t sip.Call-ID \t sip.from.addr \t sip.to.addr \t sip.CSeq \t sip.r-uri \t sdp.media \t sdp.connection_info
  const sipOutput = [
    "0.000\t10.0.0.1\t10.0.0.2\tINVITE\t\t\tabc123@10.0.0.1\talice@test\tbob@test\t1 INVITE\tsip:bob@10.0.0.2\taudio 20000 RTP/AVP 0\tIN IP4 10.0.0.1",
    "0.050\t10.0.0.2\t10.0.0.1\t\t100\tSIP/2.0 100 Trying\tabc123@10.0.0.1\talice@test\tbob@test\t1 INVITE\t\t\t",
    "0.200\t10.0.0.2\t10.0.0.1\t\t180\tSIP/2.0 180 Ringing\tabc123@10.0.0.1\talice@test\tbob@test\t1 INVITE\t\t\t",
    "1.500\t10.0.0.2\t10.0.0.1\t\t200\tSIP/2.0 200 OK\tabc123@10.0.0.1\talice@test\tbob@test\t1 INVITE\t\taudio 20002 RTP/AVP 0\tIN IP4 10.0.0.2",
    "1.510\t10.0.0.1\t10.0.0.2\tACK\t\t\tabc123@10.0.0.1\talice@test\tbob@test\t1 ACK\tsip:bob@10.0.0.2\t\t",
    "30.000\t10.0.0.1\t10.0.0.2\tBYE\t\t\tabc123@10.0.0.1\talice@test\tbob@test\t2 BYE\tsip:bob@10.0.0.2\t\t",
    "30.050\t10.0.0.2\t10.0.0.1\t\t200\tSIP/2.0 200 OK\tabc123@10.0.0.1\talice@test\tbob@test\t2 BYE\t\t\t",
    "",
  ].join("\n");

  it("groups messages by Call-ID into SipCallFlow objects", async () => {
    mockTsharkOutput(sipOutput);

    const flows = await pcapSipCalls(FAKE_FILE);
    expect(flows).toHaveLength(1);

    const flow = flows[0]!;
    expect(flow.callId).toBe("abc123@10.0.0.1");
    expect(flow.from).toBe("alice@test");
    expect(flow.to).toBe("bob@test");
    expect(flow.messages).toHaveLength(7);
  });

  it("calculates setup time from INVITE to 200 OK (INVITE CSeq)", async () => {
    mockTsharkOutput(sipOutput);

    const flows = await pcapSipCalls(FAKE_FILE);
    const flow = flows[0]!;

    // INVITE at 0.000, 200 OK for INVITE at 1.500 => 1500 ms
    expect(flow.metrics.setupTimeMs).toBe(1500);
  });

  it("detects answered calls (200 OK with INVITE CSeq)", async () => {
    mockTsharkOutput(sipOutput);

    const flows = await pcapSipCalls(FAKE_FILE);
    expect(flows[0]!.metrics.answered).toBe(true);
  });

  it("detects unanswered calls (no 200 OK for INVITE)", async () => {
    const unanswered = [
      "0.000\t10.0.0.1\t10.0.0.2\tINVITE\t\t\tcall-noanswer@host\talice@test\tbob@test\t1 INVITE\tsip:bob@10.0.0.2\t\t",
      "0.050\t10.0.0.2\t10.0.0.1\t\t100\tSIP/2.0 100 Trying\tcall-noanswer@host\talice@test\tbob@test\t1 INVITE\t\t\t",
      "10.000\t10.0.0.2\t10.0.0.1\t\t486\tSIP/2.0 486 Busy Here\tcall-noanswer@host\talice@test\tbob@test\t1 INVITE\t\t\t",
      "",
    ].join("\n");
    mockTsharkOutput(unanswered);

    const flows = await pcapSipCalls(FAKE_FILE);
    expect(flows[0]!.metrics.answered).toBe(false);
    expect(flows[0]!.metrics.setupTimeMs).toBeUndefined();
  });

  it("sets firstSeen and lastSeen from message timestamps", async () => {
    mockTsharkOutput(sipOutput);

    const flow = (await pcapSipCalls(FAKE_FILE))[0]!;
    expect(flow.metrics.firstSeen).toBe("0.000");
    expect(flow.metrics.lastSeen).toBe("30.050");
    expect(flow.metrics.messageCount).toBe(7);
  });

  it("handles multiple Call-IDs in the same capture", async () => {
    const multiCall = [
      "0.000\t10.0.0.1\t10.0.0.2\tINVITE\t\t\tcall-A@host\talice\tbob\t1 INVITE\t\t\t",
      "0.100\t10.0.0.3\t10.0.0.4\tINVITE\t\t\tcall-B@host\tcharlie\tdave\t1 INVITE\t\t\t",
      "1.000\t10.0.0.2\t10.0.0.1\t\t200\tSIP/2.0 200 OK\tcall-A@host\talice\tbob\t1 INVITE\t\t\t",
      "",
    ].join("\n");
    mockTsharkOutput(multiCall);

    const flows = await pcapSipCalls(FAKE_FILE);
    expect(flows).toHaveLength(2);
    expect(flows.map((f) => f.callId).sort()).toEqual(["call-A@host", "call-B@host"]);
  });

  it("applies callId filter to tshark args", async () => {
    mockTsharkOutput("");

    await pcapSipCalls(FAKE_FILE, "specific-call@host");

    const call = (execFile as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    const args: string[] = call[1];
    expect(args).toContain("-Y");
    const filterIdx = args.indexOf("-Y");
    expect(args[filterIdx + 1]).toContain('sip.Call-ID == "specific-call@host"');
  });

  it("parses SDP media and connection info when present", async () => {
    mockTsharkOutput(sipOutput);

    const flow = (await pcapSipCalls(FAKE_FILE))[0]!;
    const invite = flow.messages[0]!;
    expect(invite.sdpMedia).toBe("audio 20000 RTP/AVP 0");
    expect(invite.sdpConnectionInfo).toBe("IN IP4 10.0.0.1");
    expect(invite.requestUri).toBe("sip:bob@10.0.0.2");
  });
});

// ===========================================================================
// pcapScppMessages
// ===========================================================================

describe("pcapScppMessages", () => {
  const FAKE_FILE = "/tmp/skinny.cap";

  // Tab-separated SCCP output:
  // frame.time_relative \t ip.src \t ip.dst \t skinny.messageId \t callingPartyName \t callingPartyNumber \t calledPartyName \t calledParty \t callReference \t lineInstance \t callState
  const scppOutput = [
    "0.000\t10.0.0.10\t10.0.0.1\t6\t\t\t\t\t\t\t",
    "0.010\t10.0.0.1\t10.0.0.10\t130\t\t\t\t\t\t\t",
    "0.020\t10.0.0.1\t10.0.0.10\t134\t\t\t\t\t\t\t",
    "0.050\t10.0.0.10\t10.0.0.1\t3\t\t1001\t\t\t\t\t",
    "0.100\t10.0.0.1\t10.0.0.10\t285\tAlice\t1001\tBob\t2001\t42\t1\t3",
    "0.150\t10.0.0.1\t10.0.0.10\t273\t\t\t\t\t\t\t",
    "",
  ].join("\n");

  it("parses SCCP messages and looks up message names", async () => {
    mockTsharkOutput(scppOutput);

    const result = await pcapScppMessages(FAKE_FILE);
    expect(result.totalMessages).toBe(6);

    // 0x0006 = 6 = OffHookMessage
    const offHook = result.messages[0]!;
    expect(offHook.messageId).toBe(6);
    expect(offHook.messageName).toBe("OffHookMessage");

    // 0x0082 = 130 = StartToneMessage
    const startTone = result.messages[1]!;
    expect(startTone.messageId).toBe(130);
    expect(startTone.messageName).toBe("StartToneMessage");

    // 0x0086 = 134 = SetLampMessage
    expect(result.messages[2]!.messageName).toBe("SetLampMessage");
  });

  it("extracts unique device IPs", async () => {
    mockTsharkOutput(scppOutput);

    const result = await pcapScppMessages(FAKE_FILE);
    expect(result.devices).toContain("10.0.0.1");
    expect(result.devices).toContain("10.0.0.10");
    expect(result.devices).toHaveLength(2);
  });

  it("counts message types", async () => {
    mockTsharkOutput(scppOutput);

    const result = await pcapScppMessages(FAKE_FILE);
    expect(result.messageTypes["OffHookMessage"]).toBe(1);
    expect(result.messageTypes["StartToneMessage"]).toBe(1);
    expect(result.messageTypes["KeypadButtonMessage"]).toBe(1);
  });

  it("parses calling/called party info and call reference", async () => {
    mockTsharkOutput(scppOutput);

    const result = await pcapScppMessages(FAKE_FILE);
    // The CallInfoMessage (0x008f = 143, but here 285 = 0x011d = DialedNumberMessage)
    const callInfoMsg = result.messages[4]!;
    expect(callInfoMsg.callingPartyName).toBe("Alice");
    expect(callInfoMsg.callingPartyNumber).toBe("1001");
    expect(callInfoMsg.calledPartyName).toBe("Bob");
    expect(callInfoMsg.calledPartyNumber).toBe("2001");
    expect(callInfoMsg.callId).toBe("42");
    expect(callInfoMsg.lineInstance).toBe("1");
    expect(callInfoMsg.callState).toBe("3");
  });

  it("applies deviceFilter to tshark display filter", async () => {
    mockTsharkOutput("");

    await pcapScppMessages(FAKE_FILE, "10.0.0.10");

    const call = (execFile as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    const args: string[] = call[1];
    const filterIdx = args.indexOf("-Y");
    expect(args[filterIdx + 1]).toBe("skinny and ip.addr == 10.0.0.10");
  });

  it("handles unknown message IDs gracefully", async () => {
    const unknownMsgOutput = "0.000\t10.0.0.1\t10.0.0.2\t65535\t\t\t\t\t\t\t\n";
    mockTsharkOutput(unknownMsgOutput);

    const result = await pcapScppMessages(FAKE_FILE);
    expect(result.messages[0]!.messageName).toBe("Unknown(0xffff)");
  });
});

// ===========================================================================
// pcapRtpStreams
// ===========================================================================

describe("pcapRtpStreams", () => {
  const FAKE_FILE = "/tmp/rtp.cap";

  const rtpOutput = [
    "========================= RTP Streams ========================",
    "    Start: 2024-01-15 10:00:00.000",
    "      End: 2024-01-15 10:01:00.000",
    "  Src Addr  Src Port  Dst Addr  Dst Port  SSRC  Payload  Packets  Lost  Max Delta  Max Jitter  Mean Jitter",
    "  10.0.0.1  20000     10.0.0.2  20002     0xAABBCCDD  0      5000     10    25.3       2.1         0.9",
    "  10.0.0.2  20002     10.0.0.1  20000     0x11223344  8      4990     5     22.1       1.8         0.7",
    "========================= RTP Streams ========================",
  ].join("\n");

  it("parses RTP stream entries", async () => {
    mockTsharkOutput(rtpOutput);

    const result = await pcapRtpStreams(FAKE_FILE);
    expect(result.streams).toHaveLength(2);
  });

  it("extracts src:port and dst:port pairs", async () => {
    mockTsharkOutput(rtpOutput);

    const result = await pcapRtpStreams(FAKE_FILE);
    expect(result.streams[0]!.src).toBe("10.0.0.1:20000");
    expect(result.streams[0]!.dst).toBe("10.0.0.2:20002");
  });

  it("parses SSRC values", async () => {
    mockTsharkOutput(rtpOutput);

    const result = await pcapRtpStreams(FAKE_FILE);
    expect(result.streams[0]!.ssrc).toBe("0xAABBCCDD");
    expect(result.streams[1]!.ssrc).toBe("0x11223344");
  });

  it("resolves codec names from payload types", async () => {
    mockTsharkOutput(rtpOutput);

    const result = await pcapRtpStreams(FAKE_FILE);
    // PT 0 = PCMU (G.711 u-law)
    expect(result.streams[0]!.codec).toBe("PCMU (G.711 u-law)");
    // PT 8 = PCMA (G.711 A-law)
    expect(result.streams[1]!.codec).toBe("PCMA (G.711 A-law)");
  });

  it("parses packet counts, loss, delta, and jitter", async () => {
    mockTsharkOutput(rtpOutput);

    const result = await pcapRtpStreams(FAKE_FILE);
    const s1 = result.streams[0]!;
    expect(s1.packets).toBe(5000);
    expect(s1.lost).toBe(10);
    expect(s1.maxDelta).toBe(25.3);
    expect(s1.maxJitter).toBe(2.1);
    expect(s1.meanJitter).toBe(0.9);
  });

  it("calculates loss percentage correctly", async () => {
    mockTsharkOutput(rtpOutput);

    const result = await pcapRtpStreams(FAKE_FILE);
    // 10 / 5000 = 0.002 = 0.2%
    expect(result.streams[0]!.lossPercent).toBe(0.2);
    // 5 / 4990 ~= 0.10%
    expect(result.streams[1]!.lossPercent).toBeCloseTo(0.1, 1);
  });

  it("computes summary with worst loss and jitter", async () => {
    mockTsharkOutput(rtpOutput);

    const result = await pcapRtpStreams(FAKE_FILE);
    expect(result.summary.totalStreams).toBe(2);
    expect(result.summary.worstLoss).toBe("0.2%");
    expect(result.summary.worstJitter).toBe("2.1ms");
  });

  it("filters by SSRC when ssrcFilter is provided", async () => {
    mockTsharkOutput(rtpOutput);

    const result = await pcapRtpStreams(FAKE_FILE, "0xAABBCCDD");
    expect(result.streams).toHaveLength(1);
    expect(result.streams[0]!.ssrc).toBe("0xAABBCCDD");
  });

  it("returns empty streams when capture has no RTP", async () => {
    const noRtp = [
      "========================= RTP Streams ========================",
      "========================= RTP Streams ========================",
    ].join("\n");
    mockTsharkOutput(noRtp);

    const result = await pcapRtpStreams(FAKE_FILE);
    expect(result.streams).toHaveLength(0);
    expect(result.summary.totalStreams).toBe(0);
    expect(result.summary.worstLoss).toBe("0%");
    expect(result.summary.worstJitter).toBe("0ms");
  });
});

// ===========================================================================
// pcapProtocolFilter
// ===========================================================================

describe("pcapProtocolFilter", () => {
  const FAKE_FILE = "/tmp/filter.cap";

  it("uses custom fields when provided", async () => {
    const tsharkOut = "INVITE\t10.0.0.1\t10.0.0.2\n200\t10.0.0.2\t10.0.0.1\n";
    mockTsharkOutput(tsharkOut);

    const result = await pcapProtocolFilter(FAKE_FILE, "sip", [
      "sip.Method",
      "ip.src",
      "ip.dst",
    ]);

    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({
      "sip.Method": "INVITE",
      "ip.src": "10.0.0.1",
      "ip.dst": "10.0.0.2",
    });
  });

  it("uses default fields when no fields specified", async () => {
    const defaultOut = "1\t0.000\t10.0.0.1\t10.0.0.2\teth:ip:udp:sip\t500\n";
    mockTsharkOutput(defaultOut);

    const result = await pcapProtocolFilter(FAKE_FILE, "sip");

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      "frame.number": "1",
      "frame.time_relative": "0.000",
      "ip.src": "10.0.0.1",
      "ip.dst": "10.0.0.2",
      "frame.protocols": "eth:ip:udp:sip",
      "frame.len": "500",
    });
  });

  it("passes -c flag with maxPackets (capped at 1000)", async () => {
    mockTsharkOutput("");

    await pcapProtocolFilter(FAKE_FILE, "tcp", ["frame.number"], 50);

    const call = (execFile as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    const args: string[] = call[1];
    expect(args).toContain("-c");
    const cIdx = args.indexOf("-c");
    expect(args[cIdx + 1]).toBe("50");
  });

  it("caps maxPackets at 1000 even if higher value given", async () => {
    mockTsharkOutput("");

    await pcapProtocolFilter(FAKE_FILE, "tcp", ["frame.number"], 5000);

    const call = (execFile as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    const args: string[] = call[1];
    const cIdx = args.indexOf("-c");
    expect(args[cIdx + 1]).toBe("1000");
  });

  it("defaults maxPackets to 100 when not specified", async () => {
    mockTsharkOutput("");

    await pcapProtocolFilter(FAKE_FILE, "tcp", ["frame.number"]);

    const call = (execFile as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    const args: string[] = call[1];
    const cIdx = args.indexOf("-c");
    expect(args[cIdx + 1]).toBe("100");
  });

  it("returns empty array for no matching packets", async () => {
    mockTsharkOutput("");

    const result = await pcapProtocolFilter(FAKE_FILE, "nonexistent_protocol");
    expect(result).toEqual([]);
  });
});

// ===========================================================================
// Error cases (file validation)
// ===========================================================================

describe("error cases", () => {
  const FAKE_FILE = "/tmp/bad.cap";

  it("throws when file does not exist (existsSync returns false)", async () => {
    (existsSync as ReturnType<typeof vi.fn>).mockReturnValue(false);

    await expect(pcapCallSummary(FAKE_FILE)).rejects.toThrow(
      "Capture file not found"
    );
    await expect(pcapSipCalls(FAKE_FILE)).rejects.toThrow(
      "Capture file not found"
    );
    await expect(pcapScppMessages(FAKE_FILE)).rejects.toThrow(
      "Capture file not found"
    );
    await expect(pcapRtpStreams(FAKE_FILE)).rejects.toThrow(
      "Capture file not found"
    );
    await expect(pcapProtocolFilter(FAKE_FILE, "sip")).rejects.toThrow(
      "Capture file not found"
    );
  });

  it("throws when file is empty (size === 0)", async () => {
    (existsSync as ReturnType<typeof vi.fn>).mockReturnValue(true);
    (statSync as ReturnType<typeof vi.fn>).mockReturnValue({ size: 0 });

    await expect(pcapCallSummary(FAKE_FILE)).rejects.toThrow(
      "Capture file is empty"
    );
    await expect(pcapSipCalls(FAKE_FILE)).rejects.toThrow(
      "Capture file is empty"
    );
    await expect(pcapScppMessages(FAKE_FILE)).rejects.toThrow(
      "Capture file is empty"
    );
    await expect(pcapRtpStreams(FAKE_FILE)).rejects.toThrow(
      "Capture file is empty"
    );
    await expect(pcapProtocolFilter(FAKE_FILE, "sip")).rejects.toThrow(
      "Capture file is empty"
    );
  });

  it("throws tshark execution error with stderr message", async () => {
    mockTsharkError(new Error("exit code 2"), "tshark error: invalid filter expression");

    await expect(runTshark(["-Y", "bad filter"])).rejects.toThrow(
      "tshark error: tshark error: invalid filter expression"
    );
  });

  it("throws descriptive error when tshark binary not found (ENOENT)", async () => {
    const err = new Error("spawn tshark ENOENT");
    (err as NodeJS.ErrnoException).code = "ENOENT";
    mockTsharkError(err, "not found");

    await expect(runTshark(["-v"])).rejects.toThrow("tshark not found");
  });

  it("includes cap file name in 'File not found' error", async () => {
    mockTsharkError(
      new Error("exit 2"),
      "No such file or directory: /tmp/missing.cap"
    );

    await expect(runTshark(["-r", "/tmp/missing.cap"])).rejects.toThrow(
      /File not found.*missing\.cap/
    );
  });
});
