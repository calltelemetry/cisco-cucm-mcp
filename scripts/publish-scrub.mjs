#!/usr/bin/env node
// Publish gate (ADR 1032): the public npm tarball must not carry internal
// network or secret-store identifiers. Scans exactly the files `npm pack`
// would ship (build output included, so run it after `yarn build`) and exits 1
// on any match.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { findInternals, scanEntries } from './scrub-patterns.mjs';

export { findInternals };

export function packedFiles() {
  const out = execFileSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], {
    encoding: 'utf8',
  });
  return JSON.parse(out)[0].files.map((f) => f.path);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const files = packedFiles();
  if (!files.some((p) => p.startsWith('build/'))) {
    console.error('publish-scrub: packed tarball has no build/ output; run `yarn build` first');
    process.exit(1);
  }
  const hits = scanEntries(files.map((path) => ({ path, text: readFileSync(path, 'utf8') })));
  for (const h of hits) console.error(`publish-scrub: ${h.path}: ${h.pattern}: ${h.match}`);
  if (hits.length) {
    console.error(
      `publish-scrub: ${hits.length} internal identifier(s) in the packed tarball; refusing to publish (ADR 1032)`,
    );
    process.exit(1);
  }
  console.log(`publish-scrub: clean (${files.length} packed files)`);
}
