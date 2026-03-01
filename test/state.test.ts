import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import os from "node:os";
import {
  CaptureStateStore,
  clampText,
  computeExpiresAt,
  isExpired,
  newEmptyState,
  nowIso,
  type CaptureStateRecord,
} from "../src/state.js";

function makeRecord(overrides: Partial<CaptureStateRecord> = {}): CaptureStateRecord {
  return {
    id: "test-1",
    host: "10.0.0.1",
    startedAt: new Date().toISOString(),
    iface: "eth0",
    fileBase: "cap",
    remoteFilePath: "/var/log/active/platform/cli/cap.cap",
    remoteFileCandidates: ["/var/log/active/platform/cli/cap.cap"],
    updatedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    ...overrides,
  };
}

describe("CaptureStateStore", () => {
  let dir: string;
  let store: CaptureStateStore;

  beforeEach(() => {
    dir = mkdtempSync(join(os.tmpdir(), "cucm-mcp-state-"));
    store = new CaptureStateStore({
      path: join(dir, "state.json"),
      runningTtlMs: 1000,
      stoppedTtlMs: 1000,
    });
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("should upsert, load, and set expiry", () => {
    const startedAt = new Date().toISOString();
    store.upsert({
      id: "1",
      host: "x",
      startedAt,
      iface: "eth0",
      fileBase: "cap",
      remoteFilePath: "/var/log/active/platform/cli/cap.cap",
      remoteFileCandidates: ["/var/log/active/platform/cli/cap.cap"],
    });

    const loaded = store.load();
    expect(loaded.version).toBe(1);
    expect(loaded.captures["1"]).toBeDefined();
    expect(loaded.captures["1"]?.expiresAt).toBeDefined();
  });

  it("returns empty state when file does not exist", () => {
    const loaded = store.load();
    expect(loaded).toEqual({ version: 1, captures: {} });
  });

  it("returns empty state for malformed JSON", () => {
    writeFileSync(store.path, "not json at all", "utf8");
    const loaded = store.load();
    expect(loaded).toEqual({ version: 1, captures: {} });
  });

  it("returns empty state for wrong version", () => {
    writeFileSync(store.path, JSON.stringify({ version: 99, captures: {} }), "utf8");
    const loaded = store.load();
    expect(loaded).toEqual({ version: 1, captures: {} });
  });

  it("removes a capture record", () => {
    store.upsert({
      id: "del-me",
      host: "x",
      startedAt: new Date().toISOString(),
      iface: "eth0",
      fileBase: "cap",
      remoteFilePath: "/a/b",
      remoteFileCandidates: ["/a/b"],
    });
    expect(store.load().captures["del-me"]).toBeDefined();

    store.remove("del-me");
    expect(store.load().captures["del-me"]).toBeUndefined();
  });

  it("remove is a no-op for missing id", () => {
    // Should not throw
    store.remove("nonexistent-id");
  });

  it("pruneExpired removes expired records", () => {
    const past = new Date(Date.now() - 100_000).toISOString();
    store.upsert({
      id: "old",
      host: "x",
      startedAt: past,
      iface: "eth0",
      fileBase: "cap",
      remoteFilePath: "/a/b",
      remoteFileCandidates: ["/a/b"],
    });

    const pruned = store.pruneExpired();
    expect(pruned.captures["old"]).toBeUndefined();
  });

  it("pruneExpired keeps non-expired records", () => {
    store.upsert({
      id: "fresh",
      host: "x",
      startedAt: new Date().toISOString(),
      iface: "eth0",
      fileBase: "cap",
      remoteFilePath: "/a/b",
      remoteFileCandidates: ["/a/b"],
    });

    const pruned = store.pruneExpired();
    expect(pruned.captures["fresh"]).toBeDefined();
  });

  it("upsert clamps long stdout/stderr", () => {
    const longText = "x".repeat(5000);
    store.upsert({
      id: "long",
      host: "x",
      startedAt: new Date().toISOString(),
      iface: "eth0",
      fileBase: "cap",
      remoteFilePath: "/a/b",
      remoteFileCandidates: ["/a/b"],
      lastStdout: longText,
      lastStderr: longText,
    });

    const rec = store.load().captures["long"];
    expect(rec?.lastStdout?.length).toBeLessThanOrEqual(2000);
    expect(rec?.lastStderr?.length).toBeLessThanOrEqual(2000);
  });
});

describe("clampText", () => {
  it("returns undefined for null/undefined", () => {
    expect(clampText(null)).toBeUndefined();
    expect(clampText(undefined)).toBeUndefined();
  });

  it("returns short strings unchanged", () => {
    expect(clampText("hello")).toBe("hello");
  });

  it("truncates long strings from the end (keeps tail)", () => {
    const long = "A".repeat(100) + "B".repeat(100);
    const result = clampText(long, 100);
    expect(result?.length).toBe(100);
    expect(result).toBe("B".repeat(100));
  });
});

describe("computeExpiresAt", () => {
  it("uses running TTL when not stopped", () => {
    const startedAt = new Date().toISOString();
    const result = computeExpiresAt({ startedAt, runningTtlMs: 60_000, stoppedTtlMs: 120_000 });
    const expiry = Date.parse(result);
    const expected = Date.parse(startedAt) + 60_000;
    expect(Math.abs(expiry - expected)).toBeLessThan(100);
  });

  it("uses stopped TTL when stopped", () => {
    const startedAt = new Date().toISOString();
    const stoppedAt = new Date().toISOString();
    const result = computeExpiresAt({ startedAt, stoppedAt, runningTtlMs: 60_000, stoppedTtlMs: 120_000 });
    const expiry = Date.parse(result);
    const expected = Date.parse(stoppedAt) + 120_000;
    expect(Math.abs(expiry - expected)).toBeLessThan(100);
  });
});

describe("isExpired", () => {
  it("returns true for past expiry", () => {
    const rec = makeRecord({ expiresAt: new Date(Date.now() - 1000).toISOString() });
    expect(isExpired(rec)).toBe(true);
  });

  it("returns false for future expiry", () => {
    const rec = makeRecord({ expiresAt: new Date(Date.now() + 60_000).toISOString() });
    expect(isExpired(rec)).toBe(false);
  });

  it("returns false for invalid date string", () => {
    const rec = makeRecord({ expiresAt: "not-a-date" });
    expect(isExpired(rec)).toBe(false);
  });
});

describe("newEmptyState", () => {
  it("returns version 1 with empty captures", () => {
    expect(newEmptyState()).toEqual({ version: 1, captures: {} });
  });
});

describe("nowIso", () => {
  it("returns a valid ISO string", () => {
    const result = nowIso();
    expect(new Date(result).toISOString()).toBe(result);
  });
});
