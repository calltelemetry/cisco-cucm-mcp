import test from "node:test";
import assert from "node:assert/strict";

import { listNodeServiceLogs, selectLogsMinutes, getOneFile } from "../dist/dime.js";

const host = process.env.CUCM_HOST;
const user = process.env.CUCM_USERNAME;
const pass = process.env.CUCM_PASSWORD;

function hasCreds() {
  return Boolean(host && user && pass);
}

function pickPreferredServiceLog(serviceLogs) {
  const preferred = ["Cisco CallManager", "CTIManager", "Cisco Tftp", "Cisco Tomcat"];
  for (const p of preferred) {
    const hit = serviceLogs.find((s) => s === p);
    if (hit) return hit;
  }
  return serviceLogs[0];
}

test("live: traces select+download (opt-in)", { skip: !hasCreds() }, async (t) => {
  let nodes;
  try {
    nodes = await listNodeServiceLogs(host);
  } catch (e) {
    t.skip(`CUCM DIME unreachable: ${e?.message || String(e)}`);
    return;
  }

  const serviceLogs = nodes.flatMap((n) => n.serviceLogs || []);
  assert.ok(serviceLogs.length > 0, "expected service logs to be returned");

  const serviceLog = pickPreferredServiceLog(serviceLogs);
  const sel = await selectLogsMinutes(host, 60 * 24, { serviceLogs: [serviceLog] });
  assert.ok(Array.isArray(sel.files));
  assert.ok(sel.files.length > 0, `expected at least one trace for serviceLog=${serviceLog}`);

  const f = sel.files.find((x) => x.absolutePath) || sel.files[0];
  assert.ok(f.absolutePath, "expected trace file to include absolutePath");

  const dl = await getOneFile(host, f.absolutePath);
  assert.ok(dl.data.length > 0, "expected downloaded trace bytes");
});

test("live: syslog select+download (opt-in)", { skip: !hasCreds() }, async (t) => {
  try {
    const sel = await selectLogsMinutes(host, 60 * 24, { systemLogs: ["Syslog"] });
    assert.ok(sel.files.length > 0, "expected syslog files");

    const f = sel.files.find((x) => x.absolutePath) || sel.files[0];
    assert.ok(f.absolutePath, "expected syslog file to include absolutePath");

    const dl = await getOneFile(host, f.absolutePath);
    assert.ok(dl.data.length > 0, "expected downloaded syslog bytes");
  } catch (e) {
    // Different CUCM versions/name mappings might not expose Syslog under this selection.
    t.skip(`syslog not available via DIME selection 'Syslog': ${e?.message || String(e)}`);
  }
});
