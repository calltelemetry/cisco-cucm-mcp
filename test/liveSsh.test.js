import test from "node:test";
import assert from "node:assert/strict";

import { PacketCaptureManager } from "../dist/packetCapture.js";

const host = process.env.CUCM_SSH_HOST;
const user = process.env.CUCM_SSH_USERNAME;
const pass = process.env.CUCM_SSH_PASSWORD;

test("live: packet capture start/stop over SSH (opt-in)", { skip: !(host && user && pass) }, async () => {
  const mgr = new PacketCaptureManager();
  const session = await mgr.start({
    host,
    // Intentionally use env auth resolution
    fileBase: `mcp_${Date.now()}`,
    count: 100000,
    size: "all",
  });

  assert.ok(session.id);
  assert.ok(session.remoteFilePath.includes("/var/log/active/platform/cli/"));

  // Give it a moment to run.
  await new Promise((r) => setTimeout(r, 1500));

  const stopped = await mgr.stop(session.id);
  assert.equal(stopped.id, session.id);
});
