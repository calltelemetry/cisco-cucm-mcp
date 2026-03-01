import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
export type CaptureState = {
  version: 1;
  captures: Record<string, CaptureStateRecord>;
};

export type CaptureStateRecord = {
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
  updatedAt: string;
  expiresAt: string;
};

export function defaultStatePath(): string {
  // Prefer explicit env var.
  const envPath = process.env.CUCM_MCP_STATE_PATH;
  if (envPath && envPath.trim()) return envPath.trim();

  // Default: a git-ignored file in the working directory.
  // This matches typical MCP dev setup where command runs with --cwd cucm-mcp.
  return `${process.cwd().replace(/\/+$/, "")}/.cucm-mcp-state.json`;
}

export function newEmptyState(): CaptureState {
  return { version: 1, captures: {} };
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function clampText(s: unknown, max = 2000): string | undefined {
  if (s === null || s === undefined) return undefined;
  const t = String(s);
  if (t.length <= max) return t;
  return t.slice(t.length - max);
}

export function computeExpiresAt({
  startedAt,
  stoppedAt,
  runningTtlMs,
  stoppedTtlMs,
}: {
  startedAt: string;
  stoppedAt?: string;
  runningTtlMs: number;
  stoppedTtlMs: number;
}): string {
  const base = stoppedAt ? Date.parse(stoppedAt) : Date.parse(startedAt);
  const ttl = stoppedAt ? stoppedTtlMs : runningTtlMs;
  const ms = Number.isFinite(base) ? base + ttl : Date.now() + ttl;
  return new Date(ms).toISOString();
}

export function isExpired(rec: CaptureStateRecord, atMs = Date.now()): boolean {
  const exp = Date.parse(rec.expiresAt);
  if (!Number.isFinite(exp)) return false;
  return exp <= atMs;
}

export class CaptureStateStore {
  readonly path: string;
  readonly runningTtlMs: number;
  readonly stoppedTtlMs: number;

  constructor(opts?: { path?: string; runningTtlMs?: number; stoppedTtlMs?: number }) {
    this.path = opts?.path || defaultStatePath();
    this.runningTtlMs = Math.max(60_000, opts?.runningTtlMs ?? 6 * 60 * 60_000);
    this.stoppedTtlMs = Math.max(60_000, opts?.stoppedTtlMs ?? 24 * 60 * 60_000);
  }

  load(): CaptureState {
    try {
      const raw = readFileSync(this.path, "utf8");
      const parsed = JSON.parse(raw);
      if (!parsed || parsed.version !== 1 || typeof parsed.captures !== "object") return newEmptyState();
      return parsed as CaptureState;
    } catch {
      return newEmptyState();
    }
  }

  save(state: CaptureState) {
    mkdirSync(dirname(this.path), { recursive: true });
    const tmp = `${this.path}.${process.pid}.tmp`;
    writeFileSync(tmp, `${JSON.stringify(state, null, 2)}\n`, "utf8");
    renameSync(tmp, this.path);
  }

  pruneExpired(state?: CaptureState): CaptureState {
    const s = state || this.load();
    const now = Date.now();
    const captures: Record<string, CaptureStateRecord> = {};
    for (const [k, v] of Object.entries(s.captures || {})) {
      if (!v || typeof v !== "object") continue;
      if (isExpired(v as CaptureStateRecord, now)) continue;
      captures[k] = v as CaptureStateRecord;
    }
    return { version: 1, captures };
  }

  upsert(rec: Omit<CaptureStateRecord, "updatedAt" | "expiresAt">) {
    const state = this.pruneExpired(this.load());
    const updatedAt = nowIso();
    const expiresAt = computeExpiresAt({
      startedAt: rec.startedAt,
      stoppedAt: rec.stoppedAt,
      runningTtlMs: this.runningTtlMs,
      stoppedTtlMs: this.stoppedTtlMs,
    });

    state.captures[rec.id] = {
      ...rec,
      lastStdout: clampText(rec.lastStdout),
      lastStderr: clampText(rec.lastStderr),
      updatedAt,
      expiresAt,
    };
    this.save(state);
  }

  remove(id: string) {
    const state = this.load();
    if (state.captures?.[id]) {
      delete state.captures[id];
      this.save(state);
    }
  }
}

export function defaultStateStore(): CaptureStateStore {
  // Allow env tuning.
  const running = process.env.CUCM_MCP_CAPTURE_RUNNING_TTL_MS
    ? Number.parseInt(process.env.CUCM_MCP_CAPTURE_RUNNING_TTL_MS, 10)
    : undefined;
  const stopped = process.env.CUCM_MCP_CAPTURE_STOPPED_TTL_MS
    ? Number.parseInt(process.env.CUCM_MCP_CAPTURE_STOPPED_TTL_MS, 10)
    : undefined;
  return new CaptureStateStore({
    path: defaultStatePath(),
    runningTtlMs: Number.isFinite(running) ? (running as number) : undefined,
    stoppedTtlMs: Number.isFinite(stopped) ? (stopped as number) : undefined,
  });
}
