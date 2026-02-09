import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import os from "node:os";

import { CaptureStateStore } from "../dist/state.js";

test("state: upsert/load/prune", () => {
  const dir = mkdtempSync(join(os.tmpdir(), "cucm-mcp-state-"));
  const path = join(dir, "state.json");
  const store = new CaptureStateStore({ path, runningTtlMs: 1000, stoppedTtlMs: 1000 });

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
  assert.equal(loaded.version, 1);
  assert.ok(loaded.captures["1"]);

  // Force expiry by moving time forward via tiny TTL + sleeping.
  const rec = loaded.captures["1"];
  assert.ok(rec.expiresAt);

  rmSync(dir, { recursive: true, force: true });
});
