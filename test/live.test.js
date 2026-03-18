import test from "node:test";
import assert from "node:assert/strict";

import { listNodeServiceLogs } from "../dist/dime.js";

const host = process.env.CUCM_HOST;
const user = process.env.CUCM_USERNAME;
const pass = process.env.CUCM_PASSWORD;

test("live: listNodeServiceLogs (opt-in)", { skip: !(host && user && pass) }, async () => {
  const r = await listNodeServiceLogs(host);
  assert.ok(Array.isArray(r));
});
