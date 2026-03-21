/**
 * Coordinated dual-perspective call capture.
 *
 * Orchestrates:
 *   1. CUCM SSH packet capture (eth0, filtered to phone IP)
 *   2. Phone Embedded Packet Capture (EPC) via AXL updatePhone
 *
 * Then stops both, downloads both .cap files, runs tshark analysis on each,
 * and cross-correlates the results to pinpoint where packet loss or jitter occurs.
 *
 * Exported functions are called by tool handlers in index.ts.
 */

import crypto from "node:crypto";
import { mkdirSync, existsSync } from "node:fs";
import { join, basename } from "node:path";

import { PacketCaptureManager, sanitizeFileBase, type PacketCaptureStart, type SshAuth } from "./packetCapture.js";
import { getOneFileAnyWithRetry, writeDownloadedFile, type DimeAuth, resolveAuth } from "./dime.js";
import { updatePhonePacketCapture, applyPhone, type AxlAuth } from "./axl.js";
import { selectCmDevice, type RisDevice } from "./risport.js";
import { pcapCallSummary, pcapScppMessages, pcapRtpStreams, type RtpStream } from "./pcap-analyze.js";
import { defaultStateStore, type CaptureStateStore } from "./state.js";
import { formatUnknownError } from "./errors.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type CoordCaptureAuth = {
  sshUser?: string;
  sshPassword?: string;
  axlUser?: string;
  axlPassword?: string;
  dimeUser?: string;
  dimePassword?: string;
};

export type CoordCaptureStartArgs = {
  host: string;
  auth?: CoordCaptureAuth;
  deviceName: string;
  fileBase?: string;
  phoneCaptureDurationSeconds?: number;
  dimePort?: number;
  axlPort?: number;
  risPort?: number;
  sshPort?: number;
  portFilter?: number;
  maxDurationMs?: number;
  startTimeoutMs?: number;
};

export type CoordCaptureSession = {
  coordId: string;
  deviceName: string;
  phoneIp: string;
  cucmCaptureId: string;
  cucmRemoteFilePath: string;
  cucmRemoteFileCandidates: string[];
  phoneCaptureEnabled: boolean;
  phoneCaptureMode: string;
  phoneCaptureDurationSeconds: number;
  phoneCaptureFileCandidates: string[];
  startedAt: string;
  host: string;
};

export type RtpCorrelation = {
  ssrc: string;
  cucmLossPercent: number;
  phoneLossPercent: number;
  lossDelta: number;
  verdict: string;
};

export type CoordCaptureAnalysis = {
  coordId: string;
  deviceName: string;
  phoneIp: string;
  cucm: {
    savedPath: string;
    bytes: number;
    summary: object;
    sccpMessages: object;
    rtpStreams: { streams: RtpStream[]; summary: object };
    error?: string;
  };
  phone: {
    savedPath?: string;
    bytes?: number;
    summary?: object;
    rtpStreams?: { streams: RtpStream[]; summary: object };
    available: boolean;
    triedPaths: string[];
    foundAt?: string;
    error?: string;
  };
  correlation: {
    commonRtpSsrcs: string[];
    rtpLossComparison: RtpCorrelation[];
    rtpCoverage: "both" | "cucm_only" | "phone_only" | "none";
    sipCallsInCucm: number;
    verdict: string;
  };
};

// ---------------------------------------------------------------------------
// Phone EPC candidate paths (CUCM version dependent)
// ---------------------------------------------------------------------------

function phoneCaptureFileCandidates(deviceName: string): string[] {
  const name = deviceName.toUpperCase();
  return [
    `/var/lib/tftp/${name}.cap`,
    `/tftpboot/${name}.cap`,
    `/var/lib/tftp/Phones/${name}.cap`,
    `/var/log/active/tftp/${name}.cap`,
    `/usr/local/cm/tftp/${name}.cap`,
  ];
}

// ---------------------------------------------------------------------------
// Auth helpers
// ---------------------------------------------------------------------------

function sshAuthFromCoord(auth?: CoordCaptureAuth): SshAuth | undefined {
  if (!auth) return undefined;
  const user = auth.sshUser || auth.dimeUser;
  const pass = auth.sshPassword || auth.dimePassword;
  if (!user && !pass) return undefined;
  return { username: user, password: pass };
}

function axlAuthFromCoord(auth?: CoordCaptureAuth): AxlAuth | undefined {
  if (!auth) return undefined;
  const user = auth.axlUser || auth.sshUser || auth.dimeUser;
  const pass = auth.axlPassword || auth.sshPassword || auth.dimePassword;
  if (!user && !pass) return undefined;
  return { username: user, password: pass };
}

function dimeAuthFromCoord(auth?: CoordCaptureAuth): DimeAuth | undefined {
  if (!auth) return undefined;
  const user = auth.dimeUser || auth.sshUser;
  const pass = auth.dimePassword || auth.sshPassword;
  if (!user && !pass) return undefined;
  return { username: user, password: pass };
}

// ---------------------------------------------------------------------------
// RIS: resolve phone IP from device name
// ---------------------------------------------------------------------------

async function resolvePhoneIp(
  host: string,
  deviceName: string,
  auth?: CoordCaptureAuth,
  port?: number
): Promise<string> {
  const dimeAuth = dimeAuthFromCoord(auth);
  const result = await selectCmDevice(
    host,
    { selectItems: [deviceName], maxReturnedDevices: 1 },
    dimeAuth,
    port
  );

  let device: RisDevice | undefined;
  for (const node of result.cmNodes) {
    device = node.devices.find((d) => d.name.toUpperCase() === deviceName.toUpperCase());
    if (device) break;
  }

  if (!device) {
    throw new Error(
      `Device ${deviceName} not found in RIS. Is it registered to CUCM at ${host}? ` +
      `(TotalDevicesFound=${result.totalDevicesFound})`
    );
  }
  if (!device.ipAddress) {
    throw new Error(
      `Device ${deviceName} found in RIS but has no IP address (status=${device.status}). ` +
      `Phone may be unregistered.`
    );
  }
  return device.ipAddress;
}

// ---------------------------------------------------------------------------
// Singleton manager (shared with index.ts via module-level export)
// ---------------------------------------------------------------------------

export const coordCaptures = new PacketCaptureManager();

// ---------------------------------------------------------------------------
// coordinated_capture_start
// ---------------------------------------------------------------------------

export async function coordinatedCaptureStart(
  args: CoordCaptureStartArgs
): Promise<CoordCaptureSession> {
  const {
    host,
    auth,
    deviceName,
    dimePort,
    axlPort,
    risPort,
    sshPort,
    portFilter,
    maxDurationMs,
    startTimeoutMs,
    phoneCaptureDurationSeconds = 60,
  } = args;

  if (!deviceName?.trim()) throw new Error("deviceName is required (e.g. SEP505C885DF37F)");

  // Step 1: RIS lookup → phone IP
  const phoneIp = await resolvePhoneIp(host, deviceName, auth, risPort ?? dimePort);

  // Step 2: Build fileBase from deviceName + timestamp
  const ts = Date.now();
  const fileBase = args.fileBase
    ? sanitizeFileBase(args.fileBase)
    : sanitizeFileBase(`cap_${deviceName.replace(/[^A-Za-z0-9]/g, "_")}_${ts}`);

  // Step 3: Start CUCM SSH capture scoped to phone IP
  const cucmStart: PacketCaptureStart = {
    host,
    auth: sshAuthFromCoord(auth),
    iface: "eth0",
    fileBase,
    hostFilterIp: phoneIp,
    portFilter,
    maxDurationMs,
    startTimeoutMs,
    sshPort,
  };
  const cucmSession = await coordCaptures.start(cucmStart);

  // Step 4: Enable phone EPC via AXL
  let phoneCaptureEnabled = false;
  let phoneCaptureError: string | undefined;
  const axlAuth = axlAuthFromCoord(auth);
  const mode = "Batch Processing Mode";

  try {
    await updatePhonePacketCapture(host, {
      deviceName,
      mode,
      durationSeconds: phoneCaptureDurationSeconds,
      auth: axlAuth,
      port: axlPort,
    });
    // Apply config to phone (push change)
    await applyPhone(host, {
      deviceName,
      auth: axlAuth,
      port: axlPort,
    });
    phoneCaptureEnabled = true;
  } catch (e) {
    phoneCaptureError = formatUnknownError(e);
    // Don't abort the whole capture — CUCM-side capture is running.
    // Log and continue; phone capture may still work or may fail gracefully on stop.
  }

  const coordId = crypto.randomUUID();

  const session: CoordCaptureSession = {
    coordId,
    deviceName,
    phoneIp,
    cucmCaptureId: cucmSession.id,
    cucmRemoteFilePath: cucmSession.remoteFilePath,
    cucmRemoteFileCandidates: cucmSession.remoteFileCandidates,
    phoneCaptureEnabled,
    phoneCaptureMode: mode,
    phoneCaptureDurationSeconds,
    phoneCaptureFileCandidates: phoneCaptureFileCandidates(deviceName),
    startedAt: cucmSession.startedAt,
    host,
  };

  return {
    ...session,
    ...(phoneCaptureError ? { phoneCaptureWarning: phoneCaptureError } : {}),
    note: phoneCaptureEnabled
      ? `Both captures started. Make a call from ${deviceName} (${phoneIp}), then call coordinated_capture_stop_analyze with coordId=${coordId}`
      : `CUCM capture started but phone EPC failed (${phoneCaptureError}). Make a call, then call coordinated_capture_stop_analyze with coordId=${coordId}`,
  } as any;
}

// ---------------------------------------------------------------------------
// Analyse a single capture file (internal helper)
// ---------------------------------------------------------------------------

async function analyseCapture(filePath: string, deviceFilter?: string) {
  const [summary, sccpMessages, rtpStreams] = await Promise.allSettled([
    pcapCallSummary(filePath),
    pcapScppMessages(filePath, deviceFilter),
    pcapRtpStreams(filePath),
  ]);

  return {
    summary: summary.status === "fulfilled" ? summary.value : { error: (summary as PromiseRejectedResult).reason?.message },
    sccpMessages: sccpMessages.status === "fulfilled" ? sccpMessages.value : { error: (sccpMessages as PromiseRejectedResult).reason?.message },
    rtpStreams: rtpStreams.status === "fulfilled" ? rtpStreams.value : { streams: [], summary: { totalStreams: 0, worstLoss: "0%", worstJitter: "0ms" } },
  };
}

// ---------------------------------------------------------------------------
// Correlation logic
// ---------------------------------------------------------------------------

function correlateCaptures(
  cucmRtp: { streams: RtpStream[] },
  phoneRtp: { streams: RtpStream[] }
): CoordCaptureAnalysis["correlation"] & { sipCallsInCucm: number } {
  const cucmSsrcs = new Map(cucmRtp.streams.map((s) => [s.ssrc, s]));
  const phoneSsrcs = new Map(phoneRtp.streams.map((s) => [s.ssrc, s]));
  const commonSsrcs = [...cucmSsrcs.keys()].filter((s) => phoneSsrcs.has(s));

  const rtpLossComparison: RtpCorrelation[] = commonSsrcs.map((ssrc) => {
    const cucmStream = cucmSsrcs.get(ssrc)!;
    const phoneStream = phoneSsrcs.get(ssrc)!;
    const delta = Math.abs(cucmStream.lossPercent - phoneStream.lossPercent);
    let verdict = "consistent — loss seen equally in both captures";
    if (delta > 2) {
      verdict =
        cucmStream.lossPercent < phoneStream.lossPercent
          ? "last-mile loss — CUCM sees less loss than phone, packet loss is between CUCM and phone"
          : "upstream loss — phone sees less loss than CUCM, packet loss is upstream of CUCM";
    }
    return {
      ssrc,
      cucmLossPercent: cucmStream.lossPercent,
      phoneLossPercent: phoneStream.lossPercent,
      lossDelta: Math.round(delta * 100) / 100,
      verdict,
    };
  });

  const rtpCoverage: CoordCaptureAnalysis["correlation"]["rtpCoverage"] =
    commonSsrcs.length > 0
      ? "both"
      : cucmRtp.streams.length > 0 && phoneRtp.streams.length === 0
        ? "cucm_only"
        : cucmRtp.streams.length === 0 && phoneRtp.streams.length > 0
          ? "phone_only"
          : "none";

  // Build overall verdict
  const worstLastMile = rtpLossComparison
    .filter((c) => c.verdict.startsWith("last-mile"))
    .sort((a, b) => b.lossDelta - a.lossDelta)[0];
  const worstUpstream = rtpLossComparison
    .filter((c) => c.verdict.startsWith("upstream"))
    .sort((a, b) => b.lossDelta - a.lossDelta)[0];

  let verdict: string;
  if (rtpLossComparison.length === 0) {
    verdict = rtpCoverage === "cucm_only"
      ? "Phone EPC not available — check CUCM-only capture for quality issues"
      : rtpCoverage === "none"
        ? "No RTP streams found — call may not have been on the wire during capture window"
        : "Correlation complete";
  } else if (worstLastMile) {
    verdict = `Last-mile loss detected on SSRC ${worstLastMile.ssrc}: CUCM=${worstLastMile.cucmLossPercent}% vs phone=${worstLastMile.phoneLossPercent}% (delta ${worstLastMile.lossDelta}%). Check switch port, cable, or PoE between CUCM and phone.`;
  } else if (worstUpstream) {
    verdict = `Upstream loss detected on SSRC ${worstUpstream.ssrc}: CUCM=${worstUpstream.cucmLossPercent}% vs phone=${worstUpstream.phoneLossPercent}% (delta ${worstUpstream.lossDelta}%). Loss is occurring before CUCM — check WAN or upstream network.`;
  } else {
    verdict = `All ${commonSsrcs.length} common RTP stream(s) show consistent loss between CUCM and phone captures — no last-mile issue detected.`;
  }

  return {
    commonRtpSsrcs: commonSsrcs,
    rtpLossComparison,
    rtpCoverage,
    sipCallsInCucm: 0, // filled by caller
    verdict,
  };
}

// ---------------------------------------------------------------------------
// coordinated_capture_stop_analyze
// ---------------------------------------------------------------------------

export type CoordCaptureStopArgs = {
  coordId?: string;
  cucmCaptureId?: string;
  host?: string;
  deviceName?: string;
  phoneIp?: string;
  phoneCaptureFileCandidates?: string[];
  dimePort?: number;
  auth?: CoordCaptureAuth;
  stopTimeoutMs?: number;
  downloadTimeoutMs?: number;
  downloadPollIntervalMs?: number;
};

export async function coordinatedCaptureStopAnalyze(
  args: CoordCaptureStopArgs,
  stateStore: CaptureStateStore
): Promise<CoordCaptureAnalysis> {
  const {
    cucmCaptureId,
    host,
    deviceName = "unknown",
    phoneIp = "",
    phoneCaptureFileCandidates: phoneCandidates,
    dimePort,
    auth,
    stopTimeoutMs = 120_000,
    downloadTimeoutMs = 300_000,
    downloadPollIntervalMs = 3000,
  } = args;

  if (!cucmCaptureId) throw new Error("cucmCaptureId is required");
  if (!host) throw new Error("host is required");

  const dimeAuth = dimeAuthFromCoord(auth);
  const coordId = args.coordId ?? crypto.randomUUID();

  // --- Step 1: Stop CUCM capture ---
  let stopped: any;
  let stopError: string | undefined;
  try {
    stopped = await coordCaptures.stop(cucmCaptureId, stopTimeoutMs);
  } catch (e) {
    stopError = formatUnknownError(e);
    // Fall back to state file
    const pruned = stateStore.pruneExpired(stateStore.load());
    const rec = pruned.captures[cucmCaptureId];
    if (!rec) {
      throw new Error(
        `Failed to stop CUCM capture and no state record found: captureId=${cucmCaptureId} error=${stopError}`
      );
    }
    stopped = rec;
  }

  // --- Step 2: Download CUCM capture ---
  const cucmCandidates: string[] = (stopped.remoteFileCandidates?.length
    ? stopped.remoteFileCandidates
    : [stopped.remoteFilePath]
  ).filter(Boolean);

  const cucmDl = await getOneFileAnyWithRetry(stopped.host ?? host, cucmCandidates, {
    auth: dimeAuth,
    port: dimePort,
    timeoutMs: downloadTimeoutMs,
    pollIntervalMs: downloadPollIntervalMs,
  });
  const cucmSaved = writeDownloadedFile(cucmDl);

  // --- Step 3: Analyse CUCM capture ---
  let cucmAnalysis: Awaited<ReturnType<typeof analyseCapture>>;
  let cucmAnalysisError: string | undefined;
  try {
    cucmAnalysis = await analyseCapture(cucmSaved.filePath, phoneIp || undefined);
  } catch (e) {
    cucmAnalysisError = formatUnknownError(e);
    cucmAnalysis = {
      summary: {},
      sccpMessages: { messages: [], devices: [], messageTypes: {}, totalMessages: 0 },
      rtpStreams: { streams: [], summary: { totalStreams: 0, worstLoss: "0%", worstJitter: "0ms" } },
    };
  }

  // --- Step 4: Download phone EPC capture ---
  const phoneFileCandidates = phoneCandidates?.length
    ? phoneCandidates
    : phoneCaptureFileCandidates(deviceName);

  let phoneSaved: { filePath: string; bytes: number } | undefined;
  let phoneDlError: string | undefined;
  let foundAt: string | undefined;

  try {
    const phoneDl = await getOneFileAnyWithRetry(host, phoneFileCandidates, {
      auth: dimeAuth,
      port: dimePort,
      timeoutMs: Math.min(downloadTimeoutMs, 60_000), // don't wait forever for phone capture
      pollIntervalMs: downloadPollIntervalMs,
    });
    foundAt = phoneDl.filename;
    const outFile = join("/tmp/cucm-mcp", `${deviceName.toUpperCase()}_${Date.now()}.cap`);
    mkdirSync("/tmp/cucm-mcp", { recursive: true });
    const saved = writeDownloadedFile(phoneDl, outFile);
    phoneSaved = saved;
  } catch (e) {
    phoneDlError = formatUnknownError(e);
  }

  // --- Step 5: Analyse phone capture (if available) ---
  let phoneAnalysis: Awaited<ReturnType<typeof analyseCapture>> | undefined;
  if (phoneSaved) {
    try {
      phoneAnalysis = await analyseCapture(phoneSaved.filePath);
    } catch (e) {
      phoneDlError = (phoneDlError ? phoneDlError + "; " : "") + `analysis error: ${formatUnknownError(e)}`;
    }
  }

  // --- Step 6: Correlate ---
  const cucmRtp = cucmAnalysis.rtpStreams as { streams: RtpStream[] };
  const phoneRtp = phoneAnalysis?.rtpStreams as { streams: RtpStream[] } | undefined ?? { streams: [] };
  const correlation = correlateCaptures(cucmRtp, phoneRtp);
  const summaryObj = cucmAnalysis.summary as any;
  correlation.sipCallsInCucm = summaryObj?.sipCalls ?? 0;

  return {
    coordId,
    deviceName,
    phoneIp,
    cucm: {
      savedPath: cucmSaved.filePath,
      bytes: cucmSaved.bytes,
      summary: cucmAnalysis.summary,
      sccpMessages: cucmAnalysis.sccpMessages,
      rtpStreams: cucmAnalysis.rtpStreams as any,
      ...(cucmAnalysisError ? { error: cucmAnalysisError } : {}),
      ...(stopError ? { stopError } : {}),
    },
    phone: {
      savedPath: phoneSaved?.filePath,
      bytes: phoneSaved?.bytes,
      summary: phoneAnalysis?.summary,
      rtpStreams: phoneAnalysis?.rtpStreams as any,
      available: Boolean(phoneSaved),
      triedPaths: phoneFileCandidates,
      foundAt,
      ...(phoneDlError ? { error: phoneDlError } : {}),
    },
    correlation,
  };
}

// ---------------------------------------------------------------------------
// phone_capture_download (standalone)
// ---------------------------------------------------------------------------

export type PhoneCaptureDownloadArgs = {
  host: string;
  deviceName: string;
  dimePort?: number;
  auth?: CoordCaptureAuth;
  outFile?: string;
  downloadTimeoutMs?: number;
};

export async function phoneCaptureDownload(args: PhoneCaptureDownloadArgs): Promise<{
  savedPath: string;
  bytes: number;
  foundAt: string;
  triedPaths: string[];
  dimeAttempts: number;
  dimeWaitedMs: number;
}> {
  const { host, deviceName, dimePort, auth, outFile, downloadTimeoutMs = 60_000 } = args;
  if (!deviceName?.trim()) throw new Error("deviceName is required");

  const dimeAuth = dimeAuthFromCoord(auth);
  const candidates = phoneCaptureFileCandidates(deviceName);

  const dl = await getOneFileAnyWithRetry(host, candidates, {
    auth: dimeAuth,
    port: dimePort,
    timeoutMs: downloadTimeoutMs,
    pollIntervalMs: 2000,
  });

  const defaultOut = join(
    "/tmp/cucm-mcp",
    `${deviceName.toUpperCase()}_epc_${Date.now()}.cap`
  );
  mkdirSync("/tmp/cucm-mcp", { recursive: true });
  const saved = writeDownloadedFile(dl, outFile ?? defaultOut);

  return {
    savedPath: saved.filePath,
    bytes: saved.bytes,
    foundAt: dl.filename,
    triedPaths: candidates,
    dimeAttempts: dl.attempts,
    dimeWaitedMs: dl.waitedMs,
  };
}
