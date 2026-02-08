import crypto from "node:crypto";
import { Client, type ClientChannel } from "ssh2";

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
  iface: string;
  fileBase: string;
  remoteFilePath: string;
  lastStdout?: string;
  lastStderr?: string;
  exitCode?: number | null;
};

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

type Active = {
  session: PacketCaptureSession;
  client: Client;
  channel: ClientChannel;
};

export class PacketCaptureManager {
  private active = new Map<string, Active>();

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
    };

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
    });
    channel.stderr.on("data", (buf: Buffer) => {
      session.lastStderr = buf.toString("utf8").slice(-2000);
    });
    channel.on("close", (code: number | null) => {
      session.exitCode = code;
      // If the capture stopped unexpectedly, drop it from the active map.
      this.active.delete(id);
      try {
        client.end();
      } catch {
        // ignore
      }
    });

    this.active.set(id, { session, client, channel });
    return session;
  }

  async stop(captureId: string, timeoutMs = 15000): Promise<PacketCaptureSession> {
    const a = this.active.get(captureId);
    if (!a) throw new Error(`Unknown captureId: ${captureId}`);

    const { channel, client, session } = a;
    const done = new Promise<void>((resolve) => {
      channel.once("close", () => resolve());
    });

    // Best-effort interrupt.
    try {
      if (typeof (channel as any).signal === "function") (channel as any).signal("INT");
      else channel.write("\x03");
    } catch {
      try {
        channel.write("\x03");
      } catch {
        // ignore
      }
    }

    await Promise.race([
      done,
      new Promise<void>((_, reject) => setTimeout(() => reject(new Error("Timeout waiting for capture to stop")), timeoutMs)),
    ]);

    // stop() implies cleanup
    this.active.delete(captureId);
    try {
      client.end();
    } catch {
      // ignore
    }
    return session;
  }
}
