import test from "node:test";
import assert from "node:assert/strict";

import { sanitizeFileBase, buildCaptureCommand, remoteCapturePath } from "../dist/packetCapture.js";

test("packetCapture: sanitizeFileBase removes dots and unsafe chars", () => {
  assert.equal(sanitizeFileBase("packets.cap"), "packets_cap");
  assert.equal(sanitizeFileBase("  my cap  "), "my_cap");
});

test("packetCapture: buildCaptureCommand includes filters", () => {
  const cmd = buildCaptureCommand({
    iface: "eth0",
    fileBase: "packets",
    count: 1000,
    size: "all",
    hostFilterIp: "10.0.0.1",
    portFilter: 5060,
  });
  assert.ok(cmd.includes("utils network capture eth0"));
  assert.ok(cmd.includes("file packets"));
  assert.ok(cmd.includes("count 1000"));
  assert.ok(cmd.includes("size all"));
  assert.ok(cmd.includes("port 5060"));
  assert.ok(cmd.includes("host ip 10.0.0.1"));
});

test("packetCapture: remoteCapturePath uses platform/cli", () => {
  assert.equal(remoteCapturePath("packets"), "/var/log/active/platform/cli/packets.cap");
});
