export type MultipartPart = {
  contentType: string;
  headers: Record<string, string>;
  body: Buffer;
};

export function extractBoundary(contentTypeHeader: string | null | undefined): string {
  if (!contentTypeHeader) return "";
  const m = contentTypeHeader.match(/boundary\s*=\s*"?([^";]+)"?/i);
  return (m?.[1] || "").trim();
}

function parseHeaderLines(lines: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of lines) {
    const idx = line.indexOf(":");
    if (idx <= 0) continue;
    const k = line.slice(0, idx).trim().toLowerCase();
    const v = line.slice(idx + 1).trim();
    out[k] = v;
  }
  return out;
}

export function parseMultipartRelated(body: Buffer, boundary: string): MultipartPart[] {
  if (!boundary) return [];

  const boundaryLine = `--${boundary}`;
  const boundaryBuf = Buffer.from(boundaryLine, "utf8");
  const parts: MultipartPart[] = [];

  const findNextBoundary = (start: number): number => {
    for (let p = start; p <= body.length - boundaryBuf.length; p++) {
      if (body[p] !== boundaryBuf[0]) continue;
      if (body.subarray(p, p + boundaryBuf.length).equals(boundaryBuf)) return p;
    }
    return -1;
  };

  let i = findNextBoundary(0);
  if (i === -1) return [];

  while (i !== -1) {
    const lineEnd = body.indexOf("\n", i);
    if (lineEnd === -1) break;

    const boundaryText = body.subarray(i, lineEnd).toString("utf8").trim();
    if (boundaryText.endsWith("--")) break;

    let cursor = lineEnd + 1;
    const headerLines: string[] = [];
    while (cursor < body.length) {
      const nextNl = body.indexOf("\n", cursor);
      if (nextNl === -1) break;
      const rawLine = body.subarray(cursor, nextNl).toString("utf8");
      const line = rawLine.replace(/\r$/, "");
      cursor = nextNl + 1;
      if (line.trim() === "") break;
      headerLines.push(line);
    }

    const headers = parseHeaderLines(headerLines);
    const contentType = ((headers["content-type"] || "application/octet-stream")
      .split(";")[0] ?? "application/octet-stream")
      .trim();

    const nextBoundary = findNextBoundary(cursor);
    if (nextBoundary === -1) break;

    let end = nextBoundary;
    if (end >= 2 && body[end - 2] === 0x0d && body[end - 1] === 0x0a) end -= 2;
    else if (end >= 1 && body[end - 1] === 0x0a) end -= 1;

    parts.push({ contentType, headers, body: Buffer.from(body.subarray(cursor, end)) });
    i = nextBoundary;
  }

  return parts;
}
