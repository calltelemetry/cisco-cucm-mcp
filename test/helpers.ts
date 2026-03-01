/**
 * Test helper utilities for mocking fetch and building SOAP responses.
 */

interface FetchCall {
  url: string;
  init: RequestInit;
}

type FetchHandler = (url: string, init: RequestInit) => Response | Promise<Response>;

export function withMockFetch(fn: (ctx: { calls: FetchCall[] }) => Promise<void>) {
  const original = globalThis.fetch;
  const calls: FetchCall[] = [];

  function setFetch(handler: FetchHandler) {
    globalThis.fetch = async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const url = typeof input === 'string' ? input : (input as Request)?.url ?? String(input);
      calls.push({ url, init });
      return handler(url, init);
    };
  }

  async function run(handler: FetchHandler) {
    setFetch(handler);
    try {
      return await fn({ calls });
    } finally {
      globalThis.fetch = original;
    }
  }

  return { run, calls };
}

export function responseBytes(
  bytes: Uint8Array | Buffer | number[],
  { status = 200, headers = {} }: { status?: number; headers?: Record<string, string> } = {}
): Response {
  const body = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  return new Response(body, { status, headers });
}

interface MultipartPart {
  headers?: Record<string, string>;
  body: Buffer | string;
}

export function buildMultipartRelated(boundary: string, parts: MultipartPart[]): Buffer {
  const chunks: Buffer[] = [];
  for (const p of parts) {
    chunks.push(Buffer.from(`--${boundary}\r\n`, 'utf8'));
    const hdrs = p.headers || {};
    for (const [k, v] of Object.entries(hdrs)) {
      chunks.push(Buffer.from(`${k}: ${v}\r\n`, 'utf8'));
    }
    chunks.push(Buffer.from('\r\n', 'utf8'));
    chunks.push(Buffer.isBuffer(p.body) ? p.body : Buffer.from(p.body));
    chunks.push(Buffer.from('\r\n', 'utf8'));
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`, 'utf8'));
  return Buffer.concat(chunks);
}
