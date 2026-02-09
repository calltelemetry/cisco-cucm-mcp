import test from "node:test";
import assert from "node:assert/strict";

import { withMockFetch, responseBytes } from "./helpers.js";
import { applyPhone, updatePhonePacketCapture } from "../dist/axl.js";

test("axl: updatePhonePacketCapture parses return", async () => {
  const prevUser = process.env.CUCM_AXL_USERNAME;
  const prevPass = process.env.CUCM_AXL_PASSWORD;
  process.env.CUCM_AXL_USERNAME = "u";
  process.env.CUCM_AXL_PASSWORD = "p";

  const xml = `<?xml version="1.0"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/">
  <soapenv:Body>
    <ns:updatePhoneResponse xmlns:ns="http://www.cisco.com/AXL/API/15.0">
      <return>{ABC-123}</return>
    </ns:updatePhoneResponse>
  </soapenv:Body>
</soapenv:Envelope>`;

  try {
    const h = withMockFetch(async () => {
      const r = await updatePhonePacketCapture("192.168.125.10", {
        deviceName: "SEP505C885DF37F",
        mode: "Batch Processing Mode",
        durationSeconds: 60,
      });
      assert.equal(r.returnValue, "{ABC-123}");
    });

    await h.run(async (url, init) => {
      assert.ok(url.includes("/axl/"));
      const soapAction = init.headers.SOAPAction || init.headers.soapaction;
      assert.ok(String(soapAction).includes("updatePhone"));
      return responseBytes(Buffer.from(xml, "utf8"), {
        headers: { "content-type": "text/xml" },
      });
    });
  } finally {
    process.env.CUCM_AXL_USERNAME = prevUser;
    process.env.CUCM_AXL_PASSWORD = prevPass;
  }
});

test("axl: applyPhone parses return", async () => {
  const prevUser = process.env.CUCM_AXL_USERNAME;
  const prevPass = process.env.CUCM_AXL_PASSWORD;
  process.env.CUCM_AXL_USERNAME = "u";
  process.env.CUCM_AXL_PASSWORD = "p";

  const xml = `<?xml version="1.0"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/">
  <soapenv:Body>
    <ns:applyPhoneResponse xmlns:ns="http://www.cisco.com/AXL/API/15.0">
      <return>abc</return>
    </ns:applyPhoneResponse>
  </soapenv:Body>
</soapenv:Envelope>`;

  try {
    const h = withMockFetch(async () => {
      const r = await applyPhone("192.168.125.10", {
        deviceName: "SEP505C885DF37F",
      });
      assert.equal(r.returnValue, "abc");
    });

    await h.run(async () => responseBytes(Buffer.from(xml, "utf8"), { headers: { "content-type": "text/xml" } }));
  } finally {
    process.env.CUCM_AXL_USERNAME = prevUser;
    process.env.CUCM_AXL_PASSWORD = prevPass;
  }
});

test("axl: SOAP fault throws", async () => {
  const prevUser = process.env.CUCM_AXL_USERNAME;
  const prevPass = process.env.CUCM_AXL_PASSWORD;
  process.env.CUCM_AXL_USERNAME = "u";
  process.env.CUCM_AXL_PASSWORD = "p";

  const xml = `<?xml version="1.0"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/">
  <soapenv:Body>
    <soapenv:Fault>
      <faultcode>soapenv:Server</faultcode>
      <faultstring>nope</faultstring>
    </soapenv:Fault>
  </soapenv:Body>
</soapenv:Envelope>`;

  try {
    const h = withMockFetch(async () => {
      await assert.rejects(
        () =>
          updatePhonePacketCapture("192.168.125.10", {
            deviceName: "SEP505C885DF37F",
            mode: "Batch Processing Mode",
            durationSeconds: 60,
          }),
        /fault/i
      );
    });

    await h.run(async () => responseBytes(Buffer.from(xml, "utf8"), { headers: { "content-type": "text/xml" } }));
  } finally {
    process.env.CUCM_AXL_USERNAME = prevUser;
    process.env.CUCM_AXL_PASSWORD = prevPass;
  }
});
