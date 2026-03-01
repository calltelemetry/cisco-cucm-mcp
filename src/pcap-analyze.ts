/**
 * PCAP analysis via tshark (Wireshark CLI).
 *
 * Provides structured VoIP call analysis from captured .cap files:
 * SIP call flows, SCCP/Skinny messages, RTP stream quality, and protocol summaries.
 *
 * No npm dependencies — shells out to tshark which has full SIP/SCCP/RTP dissectors.
 */

import { execFile } from "node:child_process";
import { existsSync, statSync } from "node:fs";

// ---------------------------------------------------------------------------
// tshark binary discovery
// ---------------------------------------------------------------------------

const TSHARK_CANDIDATES = [
  process.env.TSHARK_PATH,
  "tshark",
  "/Applications/Wireshark.app/Contents/MacOS/tshark",
  "/usr/local/bin/tshark",
  "/usr/bin/tshark",
  "/opt/homebrew/bin/tshark",
].filter(Boolean) as string[];

let cachedTsharkPath: string | null = null;

function findTshark(): string {
  if (cachedTsharkPath) return cachedTsharkPath;
  for (const candidate of TSHARK_CANDIDATES) {
    try {
      if (existsSync(candidate)) {
        cachedTsharkPath = candidate;
        return candidate;
      }
    } catch {
      // Try next
    }
  }
  // Fall back to bare "tshark" and let execFile find it in PATH
  return "tshark";
}

const TSHARK_TIMEOUT_MS = Number(process.env.CUCM_MCP_TSHARK_TIMEOUT_MS) || 60_000;

// ---------------------------------------------------------------------------
// Core tshark execution
// ---------------------------------------------------------------------------

export function runTshark(args: string[], timeoutMs?: number): Promise<string> {
  const bin = findTshark();
  const timeout = timeoutMs ?? TSHARK_TIMEOUT_MS;
  return new Promise((resolve, reject) => {
    execFile(bin, args, { timeout, maxBuffer: 50 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) {
        const msg = stderr?.trim() || err.message;
        if (msg.includes("No such file") || msg.includes("doesn't exist")) {
          reject(new Error(`File not found: ${args.find((a) => a.endsWith(".cap") || a.endsWith(".pcap")) || "unknown"}`));
        } else if (msg.includes("not found") || msg.includes("ENOENT")) {
          reject(
            new Error(
              `tshark not found. Install Wireshark or set TSHARK_PATH. Tried: ${TSHARK_CANDIDATES.join(", ")}`
            )
          );
        } else {
          reject(new Error(`tshark error: ${msg}`));
        }
        return;
      }
      resolve(stdout);
    });
  });
}

// ---------------------------------------------------------------------------
// File validation
// ---------------------------------------------------------------------------

function validateCapFile(filePath: string): void {
  if (!existsSync(filePath)) {
    throw new Error(`Capture file not found: ${filePath}`);
  }
  const stat = statSync(filePath);
  if (stat.size === 0) {
    throw new Error(`Capture file is empty: ${filePath}`);
  }
}

// ---------------------------------------------------------------------------
// SCCP/Skinny message name lookup
// ---------------------------------------------------------------------------

const SKINNY_MESSAGE_NAMES: Record<number, string> = {
  0x0000: "KeepAliveMessage",
  0x0001: "RegisterMessage",
  0x0002: "IpPortMessage",
  0x0003: "KeypadButtonMessage",
  0x0004: "EnblocCallMessage",
  0x0005: "StimulusMessage",
  0x0006: "OffHookMessage",
  0x0007: "OnHookMessage",
  0x0008: "HookFlashMessage",
  0x0009: "ForwardStatReqMessage",
  0x000a: "SpeedDialStatReqMessage",
  0x000b: "LineStatReqMessage",
  0x000c: "ConfigStatReqMessage",
  0x000d: "TimeDateReqMessage",
  0x000e: "ButtonTemplateReqMessage",
  0x000f: "VersionReqMessage",
  0x0010: "CapabilitiesResMessage",
  0x0020: "AlarmMessage",
  0x0022: "MulticastMediaReceptionAck",
  0x0023: "OpenReceiveChannelAck",
  0x0024: "ConnectionStatisticsRes",
  0x0025: "OffHookWithCgpnMessage",
  0x0026: "SoftKeySetReqMessage",
  0x0027: "SoftKeyEventMessage",
  0x0029: "UnregisterMessage",
  0x002a: "SoftKeyTemplateReqMessage",
  0x002b: "RegisterTokenReq",
  0x002c: "MediaTransmissionFailure",
  0x002d: "HeadsetStatusMessage",
  0x002e: "MediaResourceNotification",
  0x002f: "RegisterAvailableLinesMessage",
  0x0030: "DeviceToUserDataMessage",
  0x0031: "DeviceToUserDataResponseMessage",
  0x0032: "UpdateCapabilitiesMessage",
  0x0034: "ServiceURLStatReqMessage",
  0x0035: "FeatureStatReqMessage",
  0x0048: "DeviceToUserDataVersion1Message",
  0x0049: "DeviceToUserDataResponseVersion1Message",
  // Station → CallManager
  0x0081: "RegisterAckMessage",
  0x0082: "StartToneMessage",
  0x0083: "StopToneMessage",
  0x0085: "SetRingerMessage",
  0x0086: "SetLampMessage",
  0x0087: "SetHkFDetectMessage",
  0x0088: "SetSpeakerModeMessage",
  0x0089: "SetMicroModeMessage",
  0x008a: "StartMediaTransmission",
  0x008b: "StopMediaTransmission",
  0x008f: "CallInfoMessage",
  0x0090: "ForwardStatMessage",
  0x0091: "SpeedDialStatMessage",
  0x0092: "LineStatMessage",
  0x0093: "ConfigStatMessage",
  0x0094: "DefineTimeDate",
  0x0095: "StartSessionTransmission",
  0x0096: "StopSessionTransmission",
  0x0097: "ButtonTemplateMessage",
  0x0098: "VersionMessage",
  0x0099: "DisplayTextMessage",
  0x009a: "ClearDisplay",
  0x009b: "CapabilitiesReqMessage",
  0x009d: "RegisterRejectMessage",
  0x009e: "ServerResMessage",
  0x009f: "Reset",
  0x0100: "KeepAliveAckMessage",
  0x0101: "StartMulticastMediaReception",
  0x0102: "StartMulticastMediaTransmission",
  0x0103: "StopMulticastMediaReception",
  0x0104: "StopMulticastMediaTransmission",
  0x0105: "OpenReceiveChannel",
  0x0106: "CloseReceiveChannel",
  0x0107: "ConnectionStatisticsReq",
  0x0108: "SoftKeyTemplateResMessage",
  0x0109: "SoftKeySetResMessage",
  0x0110: "SelectSoftKeysMessage",
  0x0111: "CallStateMessage",
  0x0112: "DisplayPromptStatusMessage",
  0x0113: "ClearPromptStatusMessage",
  0x0114: "DisplayNotifyMessage",
  0x0115: "ClearNotifyMessage",
  0x0116: "ActivateCallPlaneMessage",
  0x0117: "DeactivateCallPlaneMessage",
  0x0118: "UnregisterAckMessage",
  0x0119: "BackSpaceReqMessage",
  0x011a: "RegisterTokenAck",
  0x011b: "RegisterTokenReject",
  0x011c: "StartMediaFailureDetection",
  0x011d: "DialedNumberMessage",
  0x011e: "UserToDeviceDataMessage",
  0x011f: "FeatureStatMessage",
  0x0120: "DisplayPriNotifyMessage",
  0x0121: "ClearPriNotifyMessage",
  0x0122: "StartAnnouncementMessage",
  0x0123: "StopAnnouncementMessage",
  0x0124: "AnnouncementFinishMessage",
  0x0127: "NotifyDtmfToneMessage",
  0x0128: "SendDtmfToneMessage",
  0x012a: "SubscribeDtmfPayloadReqMessage",
  0x012b: "SubscribeDtmfPayloadResMessage",
  0x012c: "SubscribeDtmfPayloadErrMessage",
  0x012d: "UnSubscribeDtmfPayloadReqMessage",
  0x012e: "UnSubscribeDtmfPayloadResMessage",
  0x012f: "UnSubscribeDtmfPayloadErrMessage",
  0x0130: "ServiceURLStatMessage",
  0x013a: "UserToDeviceDataVersion1Message",
  0x013f: "DialedPhoneBookMessage",
  0x0141: "XMLAlarmMessage",
  0x0143: "SpeedDialStatDynamicMessage",
  0x0152: "CallInfoMessage2",
};

function skinnyMessageName(id: number): string {
  return SKINNY_MESSAGE_NAMES[id] ?? `Unknown(0x${id.toString(16).padStart(4, "0")})`;
}

// ---------------------------------------------------------------------------
// RTP payload type lookup
// ---------------------------------------------------------------------------

const RTP_PAYLOAD_TYPES: Record<number, string> = {
  0: "PCMU (G.711 u-law)",
  3: "GSM",
  4: "G.723",
  8: "PCMA (G.711 A-law)",
  9: "G.722",
  10: "L16 stereo",
  11: "L16 mono",
  13: "CN (comfort noise)",
  18: "G.729",
  31: "H.261",
  32: "MPV (MPEG video)",
  33: "MP2T (MPEG transport)",
  34: "H.263",
  96: "dynamic (96)",
  97: "dynamic (97)",
  98: "dynamic (98)",
  99: "dynamic (99)",
  100: "dynamic (100)",
  101: "telephone-event (DTMF)",
  110: "dynamic (110)",
  111: "dynamic (111)",
  112: "dynamic (112)",
  114: "iLBC",
  116: "dynamic (116)",
  118: "dynamic (118)",
  119: "dynamic (119)",
  120: "dynamic (120)",
  121: "dynamic (121)",
  122: "dynamic (122)",
  123: "dynamic (123)",
  124: "dynamic (124)",
  125: "dynamic (125)",
  126: "dynamic (126)",
  127: "dynamic (127)",
};

function rtpCodecName(pt: number): string {
  return RTP_PAYLOAD_TYPES[pt] ?? `PT ${pt}`;
}

// ---------------------------------------------------------------------------
// Tool: pcap_call_summary
// ---------------------------------------------------------------------------

export async function pcapCallSummary(filePath: string): Promise<object> {
  validateCapFile(filePath);
  const stat = statSync(filePath);

  // Protocol hierarchy
  const phsRaw = await runTshark(["-r", filePath, "-q", "-z", "io,phs"]);

  // Parse protocol hierarchy for VoIP protocols
  const protocols: Record<string, { frames: number; bytes: number }> = {};
  for (const line of phsRaw.split("\n")) {
    const match = line.match(/^\s*([\w:]+)\s+frames:(\d+)\s+bytes:(\d+)/);
    if (match) {
      const proto = match[1]!.split(":").pop()!.toLowerCase();
      if (["sip", "skinny", "rtp", "rtcp", "sdp", "stun", "tcp", "udp", "ip", "eth"].includes(proto)) {
        protocols[proto] = { frames: parseInt(match[2]!), bytes: parseInt(match[3]!) };
      }
    }
  }

  // SIP call count via Call-ID extraction
  let sipCallIds: string[] = [];
  try {
    const sipRaw = await runTshark([
      "-r", filePath, "-Y", "sip", "-T", "fields",
      "-e", "sip.Call-ID", "-E", "header=n",
    ]);
    sipCallIds = [...new Set(sipRaw.split("\n").map((l) => l.trim()).filter(Boolean))];
  } catch { /* no SIP packets */ }

  // RTP stream count
  let rtpStreamCount = 0;
  try {
    const rtpRaw = await runTshark(["-r", filePath, "-q", "-z", "rtp,streams"]);
    const rtpLines = rtpRaw.split("\n").filter((l) => /^\s*\d+\.\d+/.test(l));
    rtpStreamCount = rtpLines.length;
  } catch { /* no RTP */ }

  // IP conversations
  let endpoints: string[] = [];
  try {
    const convRaw = await runTshark(["-r", filePath, "-q", "-z", "conv,ip"]);
    const ips = new Set<string>();
    for (const line of convRaw.split("\n")) {
      const m = line.match(/(\d+\.\d+\.\d+\.\d+)\s+<->\s+(\d+\.\d+\.\d+\.\d+)/);
      if (m) { ips.add(m[1]!); ips.add(m[2]!); }
    }
    endpoints = [...ips].sort();
  } catch { /* no IP convos */ }

  // Capture duration
  let durationSec = 0;
  try {
    const _capRaw = await runTshark([
      "-r", filePath, "-T", "fields", "-e", "frame.time_relative",
      "-E", "header=n", "-c", "1", "-Y", "frame.number == 0",
    ]);
    // Get last packet time instead
    const durRaw = await runTshark([
      "-r", filePath, "-q", "-z", "io,stat,0",
    ]);
    const durMatch = durRaw.match(/Duration:\s+([\d.]+)/);
    if (durMatch) durationSec = parseFloat(durMatch[1]!);
  } catch { /* ignore */ }

  // Total packet count from capinfos-like output
  let totalPackets = 0;
  for (const p of Object.values(protocols)) {
    if (p.frames > totalPackets) totalPackets = p.frames;
  }
  // Use IP frame count as total if available
  totalPackets = protocols["ip"]?.frames ?? protocols["eth"]?.frames ?? totalPackets;

  return {
    file: filePath,
    bytes: stat.size,
    packets: totalPackets,
    duration: `${durationSec.toFixed(1)}s`,
    protocols: {
      sip: protocols["sip"]?.frames ?? 0,
      skinny: protocols["skinny"]?.frames ?? 0,
      rtp: protocols["rtp"]?.frames ?? 0,
      rtcp: protocols["rtcp"]?.frames ?? 0,
      sdp: protocols["sdp"]?.frames ?? 0,
    },
    endpoints,
    sipCalls: sipCallIds.length,
    sipCallIds: sipCallIds.length <= 20 ? sipCallIds : sipCallIds.slice(0, 20),
    rtpStreams: rtpStreamCount,
  };
}

// ---------------------------------------------------------------------------
// Tool: pcap_sip_calls
// ---------------------------------------------------------------------------

export interface SipMessage {
  time: string;
  src: string;
  dst: string;
  method?: string;
  statusCode?: number;
  statusLine?: string;
  callId: string;
  from: string;
  to: string;
  cseq: string;
  requestUri?: string;
  sdpMedia?: string;
  sdpConnectionInfo?: string;
}

export interface SipCallFlow {
  callId: string;
  from: string;
  to: string;
  messages: SipMessage[];
  metrics: {
    firstSeen: string;
    lastSeen: string;
    messageCount: number;
    answered: boolean;
    setupTimeMs?: number;
  };
}

export async function pcapSipCalls(filePath: string, callId?: string): Promise<SipCallFlow[]> {
  validateCapFile(filePath);

  const filter = callId ? `sip and sip.Call-ID == "${callId}"` : "sip";
  const raw = await runTshark([
    "-r", filePath, "-Y", filter,
    "-T", "fields",
    "-e", "frame.time_relative",
    "-e", "ip.src",
    "-e", "ip.dst",
    "-e", "sip.Method",
    "-e", "sip.Status-Code",
    "-e", "sip.Status-Line",
    "-e", "sip.Call-ID",
    "-e", "sip.from.addr",
    "-e", "sip.to.addr",
    "-e", "sip.CSeq",
    "-e", "sip.r-uri",
    "-e", "sdp.media",
    "-e", "sdp.connection_info",
    "-E", "header=n",
    "-E", "separator=\t",
    "-E", "occurrence=f",
  ]);

  const callMap = new Map<string, SipMessage[]>();

  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    const fields = line.split("\t");
    const [time, src, dst, method, statusCodeStr, statusLine, cid, from, to, cseq, ruri, sdpMedia, sdpConn] = fields;
    if (!cid) continue;

    const msg: SipMessage = {
      time: time || "0",
      src: src || "",
      dst: dst || "",
      callId: cid,
      from: from || "",
      to: to || "",
      cseq: cseq || "",
    };
    if (method) msg.method = method;
    if (statusCodeStr) msg.statusCode = parseInt(statusCodeStr);
    if (statusLine) msg.statusLine = statusLine;
    if (ruri) msg.requestUri = ruri;
    if (sdpMedia) msg.sdpMedia = sdpMedia;
    if (sdpConn) msg.sdpConnectionInfo = sdpConn;

    if (!callMap.has(cid)) callMap.set(cid, []);
    callMap.get(cid)!.push(msg);
  }

  const flows: SipCallFlow[] = [];
  for (const [cid, messages] of callMap) {
    const firstMsg = messages[0]!;
    const lastMsg = messages[messages.length - 1]!;
    const answered = messages.some((m) => m.statusCode === 200 && m.cseq?.includes("INVITE"));

    // Setup time: INVITE → first 200 OK for INVITE
    let setupTimeMs: number | undefined;
    const invite = messages.find((m) => m.method === "INVITE");
    const ok200 = messages.find((m) => m.statusCode === 200 && m.cseq?.includes("INVITE"));
    if (invite && ok200) {
      setupTimeMs = Math.round((parseFloat(ok200.time) - parseFloat(invite.time)) * 1000);
    }

    flows.push({
      callId: cid,
      from: firstMsg.from,
      to: firstMsg.to,
      messages,
      metrics: {
        firstSeen: firstMsg.time,
        lastSeen: lastMsg.time,
        messageCount: messages.length,
        answered,
        setupTimeMs,
      },
    });
  }

  return flows;
}

// ---------------------------------------------------------------------------
// Tool: pcap_sccp_messages
// ---------------------------------------------------------------------------

export interface ScppMessage {
  time: string;
  src: string;
  dst: string;
  messageId: number;
  messageName: string;
  callingPartyName?: string;
  callingPartyNumber?: string;
  calledPartyName?: string;
  calledPartyNumber?: string;
  callId?: string;
  lineInstance?: string;
  callState?: string;
}

export interface ScppAnalysis {
  messages: ScppMessage[];
  devices: string[];
  messageTypes: Record<string, number>;
  totalMessages: number;
}

export async function pcapScppMessages(filePath: string, deviceFilter?: string): Promise<ScppAnalysis> {
  validateCapFile(filePath);

  const filter = deviceFilter ? `skinny and ip.addr == ${deviceFilter}` : "skinny";
  const raw = await runTshark([
    "-r", filePath, "-Y", filter,
    "-T", "fields",
    "-e", "frame.time_relative",
    "-e", "ip.src",
    "-e", "ip.dst",
    "-e", "skinny.messageId",
    "-e", "skinny.callingPartyName",
    "-e", "skinny.callingPartyNumber",
    "-e", "skinny.calledPartyName",
    "-e", "skinny.calledParty",
    "-e", "skinny.callReference",
    "-e", "skinny.lineInstance",
    "-e", "skinny.callState",
    "-E", "header=n",
    "-E", "separator=\t",
    "-E", "occurrence=f",
  ]);

  const messages: ScppMessage[] = [];
  const devices = new Set<string>();
  const typeCounts: Record<string, number> = {};

  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    const fields = line.split("\t");
    const [time, src, dst, msgIdStr, callingName, callingNum, calledName, calledNum, callIdStr, lineInst, callSt] = fields;

    const messageId = parseInt(msgIdStr || "0");
    const messageName = skinnyMessageName(messageId);

    devices.add(src || "");
    devices.add(dst || "");
    typeCounts[messageName] = (typeCounts[messageName] || 0) + 1;

    const msg: ScppMessage = {
      time: time || "0",
      src: src || "",
      dst: dst || "",
      messageId,
      messageName,
    };
    if (callingName) msg.callingPartyName = callingName;
    if (callingNum) msg.callingPartyNumber = callingNum;
    if (calledName) msg.calledPartyName = calledName;
    if (calledNum) msg.calledPartyNumber = calledNum;
    if (callIdStr) msg.callId = callIdStr;
    if (lineInst) msg.lineInstance = lineInst;
    if (callSt) msg.callState = callSt;

    messages.push(msg);
  }

  // Remove empty strings from devices
  devices.delete("");

  return {
    messages,
    devices: [...devices].sort(),
    messageTypes: typeCounts,
    totalMessages: messages.length,
  };
}

// ---------------------------------------------------------------------------
// Tool: pcap_rtp_streams
// ---------------------------------------------------------------------------

export interface RtpStream {
  src: string;
  dst: string;
  ssrc: string;
  payloadType: number;
  codec: string;
  packets: number;
  lost: number;
  lossPercent: number;
  maxDelta: number;
  maxJitter: number;
  meanJitter: number;
}

export interface RtpAnalysis {
  streams: RtpStream[];
  summary: {
    totalStreams: number;
    worstLoss: string;
    worstJitter: string;
  };
}

export async function pcapRtpStreams(filePath: string, ssrcFilter?: string): Promise<RtpAnalysis> {
  validateCapFile(filePath);

  const raw = await runTshark(["-r", filePath, "-q", "-z", "rtp,streams"]);

  // Parse the rtp,streams table output
  // Format: src_addr src_port dst_addr dst_port ssrc payload packets lost max_delta max_jitter mean_jitter ...
  const streams: RtpStream[] = [];
  const lines = raw.split("\n");
  let inTable = false;

  for (const line of lines) {
    if (line.includes("========================")) {
      inTable = !inTable;
      continue;
    }
    if (!inTable) continue;
    if (!line.trim() || line.startsWith("  Src") || line.includes("Start:") || line.includes("End:")) continue;

    // Parse whitespace-separated fields
    const parts = line.trim().split(/\s+/);
    if (parts.length < 10) continue;

    // Skip any remaining header-like lines (e.g., non-IP data)
    const srcAddr = parts[0] ?? '';
    if (!/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(srcAddr)) continue;
    const srcPort = parts[1] ?? '';
    const dstAddr = parts[2] ?? '';
    const dstPort = parts[3] ?? '';
    const ssrc = parts[4] ?? '';
    const ptStr = parts[5] ?? '';
    const packets = parseInt(parts[6] ?? '0') || 0;
    const lost = parseInt(parts[7] ?? '0') || 0;
    const maxDelta = parseFloat(parts[8] ?? '0') || 0;
    const maxJitter = parseFloat(parts[9] ?? '0') || 0;
    const meanJitter = parseFloat(parts[10] ?? '0') || 0;

    const pt = parseInt(ptStr) || 0;

    if (ssrcFilter && ssrc !== ssrcFilter) continue;

    streams.push({
      src: `${srcAddr}:${srcPort}`,
      dst: `${dstAddr}:${dstPort}`,
      ssrc: ssrc,
      payloadType: pt,
      codec: rtpCodecName(pt),
      packets,
      lost,
      lossPercent: packets > 0 ? Math.round((lost / packets) * 10000) / 100 : 0,
      maxDelta,
      maxJitter,
      meanJitter,
    });
  }

  const worstLoss = streams.length ? Math.max(...streams.map((s) => s.lossPercent)) : 0;
  const worstJitter = streams.length ? Math.max(...streams.map((s) => s.maxJitter)) : 0;

  return {
    streams,
    summary: {
      totalStreams: streams.length,
      worstLoss: `${worstLoss}%`,
      worstJitter: `${worstJitter}ms`,
    },
  };
}

// ---------------------------------------------------------------------------
// Tool: pcap_protocol_filter
// ---------------------------------------------------------------------------

export async function pcapProtocolFilter(
  filePath: string,
  displayFilter: string,
  fields?: string[],
  maxPackets?: number
): Promise<object[]> {
  validateCapFile(filePath);

  const max = Math.min(maxPackets ?? 100, 1000);
  const args = ["-r", filePath, "-Y", displayFilter, "-c", String(max)];

  if (fields && fields.length > 0) {
    args.push("-T", "fields", "-E", "header=n", "-E", "separator=\t");
    for (const f of fields) {
      args.push("-e", f);
    }
    const raw = await runTshark(args);
    const results: object[] = [];
    for (const line of raw.split("\n")) {
      if (!line.trim()) continue;
      const values = line.split("\t");
      const obj: Record<string, string> = {};
      fields.forEach((f, i) => {
        obj[f] = values[i] || "";
      });
      results.push(obj);
    }
    return results;
  }

  // No specific fields: use ek (Elastic/JSON) output for full packet info
  // Use -T tabs with common fields as fallback (full JSON can be huge)
  args.push(
    "-T", "fields",
    "-E", "header=n",
    "-E", "separator=\t",
    "-e", "frame.number",
    "-e", "frame.time_relative",
    "-e", "ip.src",
    "-e", "ip.dst",
    "-e", "frame.protocols",
    "-e", "frame.len",
  );

  const raw = await runTshark(args);
  const defaultFields = ["frame.number", "frame.time_relative", "ip.src", "ip.dst", "frame.protocols", "frame.len"];
  const results: object[] = [];
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    const values = line.split("\t");
    const obj: Record<string, string> = {};
    defaultFields.forEach((f, i) => {
      obj[f] = values[i] || "";
    });
    results.push(obj);
  }
  return results;
}
