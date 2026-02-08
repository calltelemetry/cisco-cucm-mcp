import fs from "node:fs";

const p = new URL("../dist/index.js", import.meta.url);
const path = p.pathname;

try {
  if (fs.existsSync(path)) {
    fs.chmodSync(path, 0o755);
  }
} catch (e) {
  // Best-effort; publish will still work even if chmod fails on some platforms.
  // eslint-disable-next-line no-console
  console.warn("WARN: failed to chmod dist/index.js", e);
}
