import assert from "node:assert/strict";

export function withMockFetch(fn) {
  const original = globalThis.fetch;
  const calls = [];

  function setFetch(handler) {
    globalThis.fetch = async (input, init = {}) => {
      const url = typeof input === "string" ? input : input?.url;
      calls.push({ url, init });
      return handler(url, init);
    };
  }

  async function run(handler) {
    setFetch(handler);
    try {
      return await fn({ calls });
    } finally {
      globalThis.fetch = original;
    }
  }

  return { run, calls, assert };
}

export function responseBytes(bytes, { status = 200, headers = {} } = {}) {
  const body = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  return new Response(body, { status, headers });
}

export function buildMultipartRelated(boundary, parts) {
  const chunks = [];
  for (const p of parts) {
    chunks.push(Buffer.from(`--${boundary}\r\n`, "utf8"));
    const hdrs = p.headers || {};
    for (const [k, v] of Object.entries(hdrs)) {
      chunks.push(Buffer.from(`${k}: ${v}\r\n`, "utf8"));
    }
    chunks.push(Buffer.from("\r\n", "utf8"));
    chunks.push(Buffer.isBuffer(p.body) ? p.body : Buffer.from(p.body));
    chunks.push(Buffer.from("\r\n", "utf8"));
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`, "utf8"));
  return Buffer.concat(chunks);
}
