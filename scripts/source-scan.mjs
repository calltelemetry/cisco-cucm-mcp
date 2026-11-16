#!/usr/bin/env node
// Source gate (ADR 1032): this repository is public, so every tracked file is
// a disclosure channel, not just the npm tarball. Scans `git ls-files` for the
// same internal identifiers as the publish scrub. RFC 5737 documentation
// ranges are explicitly allowed (see scrub-patterns.mjs).
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { scanEntries } from './scrub-patterns.mjs';

// Lockfiles carry registry URLs and hashes, never addresses we author.
const SKIP = [/^yarn\.lock$/];

export function trackedFiles() {
  const out = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' });
  return out.split('\0').filter((p) => p && !SKIP.some((re) => re.test(p)));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const files = trackedFiles();
  const entries = [];
  for (const path of files) {
    const buf = readFileSync(path);
    if (buf.includes(0)) continue; // binary
    entries.push({ path, text: buf.toString('utf8') });
  }
  const hits = scanEntries(entries);
  for (const h of hits) console.error(`source-scan: ${h.path}: ${h.pattern}: ${h.match}`);
  if (hits.length) {
    console.error(
      `source-scan: ${hits.length} internal identifier(s) in tracked files; use RFC 5737 addresses (192.0.2.x, 198.51.100.x, 203.0.113.x) and example.com names (ADR 1032)`,
    );
    process.exit(1);
  }
  console.log(`source-scan: clean (${entries.length} tracked files)`);
}
