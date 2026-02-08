import test from "node:test";
import assert from "node:assert/strict";

import { extractBoundary, parseMultipartRelated } from "../dist/multipart.js";
import { buildMultipartRelated } from "./helpers.js";

test("multipart: extractBoundary handles quoted and unquoted", () => {
  assert.equal(
    extractBoundary('multipart/related; type="text/xml"; boundary="----=_Part_1"'),
    "----=_Part_1"
  );
  assert.equal(
    extractBoundary("multipart/related; boundary=MIMEBoundaryurn_uuid_ABC"),
    "MIMEBoundaryurn_uuid_ABC"
  );
});

test("multipart: parseMultipartRelated yields parts", () => {
  const boundary = "MIMEBoundaryurn_uuid_X";
  const body = buildMultipartRelated(boundary, [
    {
      headers: { "Content-Type": "text/xml; charset=UTF-8", "Content-Transfer-Encoding": "binary" },
      body: Buffer.from("<a>ok</a>", "utf8"),
    },
    {
      headers: { "Content-Type": "application/octet-stream", "Content-Transfer-Encoding": "binary" },
      body: Buffer.from([1, 2, 3, 4]),
    },
  ]);

  const parts = parseMultipartRelated(body, boundary);
  assert.equal(parts.length, 2);
  assert.equal(parts[0].contentType, "text/xml");
  assert.equal(parts[1].contentType, "application/octet-stream");
  assert.deepEqual([...parts[1].body], [1, 2, 3, 4]);
});
