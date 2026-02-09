import crypto from "node:crypto";
import { Client, type ClientChannel } from "ssh2";

import { defaultStateStore, type CaptureStateStore } from "./state.js";

export type SshAuth = { username?: string; password?: string };

export type PacketCaptureStart = {
  host: string;
  sshPort?: number;
  auth?: SshAuth;
  iface?: string;
  fileBase?: string;
  count?: number;
  size?: string;
  hostFilterIp?: string;
  portFilter?: number;
};

export type PacketCaptureSession = {
  id: string;
  host: string;
  startedAt: string;
  stoppedAt?: string;
  iface: string;
  fileBase: string;
  remoteFilePath: string;
  remoteFileCandidates: string[];
  stopTimedOut?: boolean;
  lastStdout?: string;
  lastStderr?: string;
  exitCode?: number | null;
};

function extractCapFilePath(text?: string): string | undefined {
  if (!text) return undefined;
  // CUCM typically writes captures to /var/log/active/platform/cli/<name>.cap
  // Sometimes CLI output includes the final on-disk location.
  const re = /\/var\/log\/active\/platform\/cli\/[A-Za-z0-9._-]+\.cap/g;
  const matches = text.match(re);
  if (!matches || matches.length === 0) return undefined;
  return matches[matches.length - 1];
}

function looksLikeCucmPrompt(text?: string): boolean {
  const t = String(text || "");
  // CUCM CLI commonly ends commands by printing a prompt like:
  //   admin:
  // Some environments might show other usernames.
  // We only look at the tail to avoid false positives.
  const tail = t.slice(-80);
  return /(?:^|\n)[A-Za-z0-9_-]+:\s*$/.test(tail);
}

export function resolveSshAuth(auth?: SshAuth): Required<SshAuth> {
  const username = auth?.username || process.env.CUCM_SSH_USERNAME;
  const password = auth?.password || process.env.CUCM_SSH_PASSWORD;
  if (!username || !password) {
    throw new Error("Missing SSH credentials (provide auth or set CUCM_SSH_USERNAME/CUCM_SSH_PASSWORD)");
  }
  return { username, password };
}

export function sanitizeFileBase(s: string): string {
  // CUCM note: fname should not contain '.'
  // Keep it conservative.
  const cleaned = String(s || "")
    .trim()
    .replaceAll(".", "_")
    .replace(/[^A-Za-z0-9_-]+/g, "_")
    .replace(/^_+/, "")
    .replace(/_+$/, "");
  if (!cleaned) throw new Error("fileBase is required (after sanitization)");
  return cleaned;
}

export function buildCaptureCommand(opts: {
  iface: string;
  fileBase: string;
  count: number;
  size: string;
  hostFilterIp?: string;
  portFilter?: number;
}): string {
  const iface = String(opts.iface || "eth0").trim() || "eth0";
  const fileBase = sanitizeFileBase(opts.fileBase);
  const count = Number.isFinite(opts.count) ? Math.trunc(opts.count) : 100000;
  if (count <= 0) throw new Error("count must be > 0");
  const size = String(opts.size || "all").trim() || "all";

  const args: string[] = [
    "utils",
    "network",
    "capture",
    iface,
    "file",
    fileBase,
    "count",
    String(count),
    "size",
    size,
  ];

  if (opts.portFilter != null) {
    const p = Math.trunc(opts.portFilter);
    if (p < 1 || p > 65535) throw new Error("portFilter must be 1..65535");
    args.push("port", String(p));
  }

  if (opts.hostFilterIp) {
    const ip = String(opts.hostFilterIp).trim();
    if (!ip) throw new Error("hostFilterIp must be non-empty");
    args.push("host", "ip", ip);
  }

  return args.join(" ");
}

export function remoteCapturePath(fileBase: string): string {
  const fb = sanitizeFileBase(fileBase);
  return `/var/log/active/platform/cli/${fb}.cap`;
}

export function remoteCaptureCandidates(fileBase: string, maxParts = 10): string[] {
  const fb = sanitizeFileBase(fileBase);
  const base = `/var/log/active/platform/cli/${fb}.cap`;
  const out: string[] = [base];
  // Some CUCM/VOS versions roll packet capture files as .cap01, .cap02, ...
  for (let i = 1; i <= maxParts; i++) {
    const suffix = String(i).padStart(2, "0");
    out.push(`/var/log/active/platform/cli/${fb}.cap${suffix}`);
  }
  return out;
}

type Active = {
  session: PacketCaptureSession;
  client: Client;
  channel: ClientChannel;
};

export class PacketCaptureManager {
  private active = new Map<string, Active>();
  private state: CaptureStateStore;

  constructor(opts?: { state?: CaptureStateStore }) {
    this.state = opts?.state || defaultStateStore();
  }

  list(): PacketCaptureSession[] {
    return [...this.active.values()].map((a) => a.session);
  }

  async start(opts: PacketCaptureStart): Promise<PacketCaptureSession> {
    const iface = String(opts.iface || "eth0").trim() || "eth0";
    const fileBase = sanitizeFileBase(opts.fileBase || `cap_${Date.now()}`);
    const count = opts.count ?? 100000;
    const size = opts.size ?? "all";
    const cmd = buildCaptureCommand({ iface, fileBase, count, size, hostFilterIp: opts.hostFilterIp, portFilter: opts.portFilter });

    const id = crypto.randomUUID();
    const sshPort = opts.sshPort ?? (process.env.CUCM_SSH_PORT ? Number.parseInt(process.env.CUCM_SSH_PORT, 10) : 22);
    const auth = resolveSshAuth(opts.auth);

    const client = new Client();
    const startedAt = new Date().toISOString();
    const session: PacketCaptureSession = {
      id,
      host: opts.host,
      startedAt,
      iface,
      fileBase,
      remoteFilePath: remoteCapturePath(fileBase),
      remoteFileCandidates: remoteCaptureCandidates(fileBase),
    };

    // Persist early so we can recover/download even if the MCP process restarts.
    this.state.upsert({
      ...session,
      stoppedAt: session.stoppedAt,
    });

    await new Promise<void>((resolve, reject) => {
      client
        .on("ready", () => resolve())
        .on("error", (e: unknown) => reject(e))
        .connect({
          host: opts.host,
          port: sshPort,
          username: auth.username,
          password: auth.password,
          readyTimeout: 15000,
        });
    });

    const channel = await new Promise<ClientChannel>((resolve, reject) => {
      client.exec(cmd, { pty: true }, (err: unknown, ch: ClientChannel) => {
        if (err) return reject(err);
        resolve(ch);
      });
    });

    channel.on("data", (buf: Buffer) => {
      session.lastStdout = buf.toString("utf8").slice(-2000);
      this.state.upsert({ ...session, stoppedAt: session.stoppedAt });
    });
    channel.stderr.on("data", (buf: Buffer) => {
      session.lastStderr = buf.toString("utf8").slice(-2000);
      this.state.upsert({ ...session, stoppedAt: session.stoppedAt });
    });
    channel.on("close", (code: number | null) => {
      session.exitCode = code;
      session.stoppedAt = session.stoppedAt || new Date().toISOString();
      // If the capture stopped unexpectedly, drop it from the active map.
      this.active.delete(id);
      this.state.upsert({ ...session, stoppedAt: session.stoppedAt });
      try {
        client.end();
        client.destroy();
      } catch {
        // ignore
      }
    });

    this.active.set(id, { session, client, channel });
    return session;
  }

  async stop(captureId: string, timeoutMs = 90_000): Promise<PacketCaptureSession> {
    const a = this.active.get(captureId);
    if (!a) throw new Error(`Unknown captureId: ${captureId}`);

    const { channel, client, session } = a;
    const done = new Promise<void>((resolve) => {
      // CUCM CLI can keep the SSH channel open after the command finishes
      // (it returns to a prompt rather than exiting). Treat prompt as "stopped".
      const onData = () => {
        if (looksLikeCucmPrompt(session.lastStdout) || looksLikeCucmPrompt(session.lastStderr)) {
          cleanup();
          resolve();
        }
      };
      const cleanup = () => {
        channel.off("data", onData);
        channel.stderr.off("data", onData);
      };

      const finish = () => {
        cleanup();
        resolve();
      };

      channel.once("exit", finish);
      channel.once("close", finish);
      channel.once("end", finish);
      channel.on("data", onData);
      channel.stderr.on("data", onData);
    });

    const sendInterrupt = () => {
      // Best-effort interrupt.
      try {
        if (typeof (channel as any).signal === "function") (channel as any).signal("INT");
        // Always also write Ctrl-C for PTY sessions.
        channel.write("\x03");
      } catch {
        try {
          channel.write("\x03");
        } catch {
          // ignore
        }
      }
    };

    // CUCM can take a while to flush/close captures (especially big buffers).
    // Also, some CLI flows require a second Ctrl-C or a newline to return to prompt.
    const resolvedTimeoutMs = Math.max(5000, timeoutMs || 0);
    const deadline = Date.now() + resolvedTimeoutMs;
    sendInterrupt();

    // Nudge again a couple times if it doesn't exit quickly.
    void (async () => {
      const delays = [750, 1500, 3000];
      for (const d of delays) {
        await new Promise((r) => setTimeout(r, d));
        if (Date.now() >= deadline) return;
        // If channel already closed, no-op.
        sendInterrupt();
        try {
          channel.write("\n");
        } catch {
          // ignore
        }
      }
    })();

    try {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<void>((_, reject) => {
      timer = setTimeout(() => reject(new Error("Timeout waiting for capture to stop")), resolvedTimeoutMs);
      // Don't keep the process alive just because we're waiting.
      (timer as any).unref?.();
    });

    try {
      await Promise.race([done, timeout]);
    } finally {
      if (timer) clearTimeout(timer);
    }
    } catch (e) {
      // Don't hard-fail: if the CLI doesn't emit a prompt/exit, we still want to:
      // - close SSH resources
      // - let the caller try DIME downloads (.cap, .cap01, etc)
      session.stopTimedOut = true;
      session.stoppedAt = session.stoppedAt || new Date().toISOString();
      this.state.upsert({ ...session, stoppedAt: session.stoppedAt });
      try {
        channel.close();
      } catch {
        // ignore
      }
    }

    session.stoppedAt = new Date().toISOString();
    this.state.upsert({ ...session, stoppedAt: session.stoppedAt });

    // If we're back at a CUCM prompt, try to close the session cleanly.
    if (looksLikeCucmPrompt(session.lastStdout) || looksLikeCucmPrompt(session.lastStderr)) {
      try {
        channel.write("exit\n");
      } catch {
        // ignore
      }
    }

    // Ensure the channel is closed so the SSH client can terminate promptly.
    try {
      channel.end();
    } catch {
      // ignore
    }
    try {
      channel.close();
    } catch {
      // ignore
    }

    // Attempt to learn the actual remote file path from CLI output.
    // This helps when CUCM appends suffixes or reports a different on-disk location.
    const inferred = extractCapFilePath(session.lastStdout) || extractCapFilePath(session.lastStderr);
    if (inferred) {
      session.remoteFilePath = inferred;
      if (!session.remoteFileCandidates.includes(inferred)) {
        session.remoteFileCandidates = [inferred, ...session.remoteFileCandidates];
      }
    }

    this.state.upsert({ ...session, stoppedAt: session.stoppedAt });

    // stop() implies cleanup
    this.active.delete(captureId);
    try {
      client.end();
      client.destroy();
    } catch {
      // ignore
    }
    return session;
  }
}
