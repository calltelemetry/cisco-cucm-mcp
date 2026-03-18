import test from "node:test";
import assert from "node:assert/strict";

import { PacketCaptureManager } from "../dist/packetCapture.js";
import { getOneFileWithRetry } from "../dist/dime.js";

const sshHost = process.env.CUCM_SSH_HOST;
const sshUser = process.env.CUCM_SSH_USERNAME;
const sshPass = process.env.CUCM_SSH_PASSWORD;

const dimeHost = process.env.CUCM_HOST;
const dimeUser = process.env.CUCM_USERNAME;
const dimePass = process.env.CUCM_PASSWORD;

const hasLiveCreds = Boolean(sshHost && sshUser && sshPass && dimeHost && dimeUser && dimePass);

function looksLikePcap(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 4) return false;
  const magic = buf.readUInt32LE(0);
  // pcap magic numbers (little/big endian + nano variants)
  return magic === 0xa1b2c3d4 || magic === 0xd4c3b2a1 || magic === 0xa1b23c4d || magic === 0x4d3cb2a1;
}

test("live: stop capture and download via DIME (opt-in)", { skip: !hasLiveCreds }, async () => {
  const mgr = new PacketCaptureManager();
  const session = await mgr.start({
    host: sshHost,
    fileBase: `mcp_dl_${Date.now()}`,
    // small-ish capture; we just need a valid pcap file
    count: 5000,
    size: "all",
  });

  // Let it run briefly.
  await new Promise((r) => setTimeout(r, 1500));

  const stopped = await mgr.stop(session.id, 180_000);
  assert.equal(stopped.id, session.id);
  assert.ok(stopped.remoteFilePath.includes("/var/log/active/platform/cli/"));
  assert.ok(stopped.remoteFilePath.endsWith(".cap"));

  const dl = await getOneFileWithRetry(dimeHost, stopped.remoteFilePath, {
    timeoutMs: 180_000,
    pollIntervalMs: 2000,
  });

  assert.ok(dl.data.length > 24, `expected non-trivial cap file, got ${dl.data.length} bytes`);
  assert.ok(looksLikePcap(dl.data), "downloaded file should look like a pcap");
});
