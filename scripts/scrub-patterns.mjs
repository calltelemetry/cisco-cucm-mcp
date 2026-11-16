// Shared disclosure patterns for the public-package gates (ADR 1032).
// This repo and its npm tarball are public, so internal network and
// secret-store identifiers must never ship. Both gates import from here:
//   scripts/publish-scrub.mjs  scans exactly what `npm pack` would ship
//   scripts/source-scan.mjs    scans every tracked file (`git ls-files`)
//
// RFC 5737 documentation ranges (192.0.2.0/24, 198.51.100.0/24,
// 203.0.113.0/24) are the only addresses examples and tests may use. They are
// explicitly allowed below; nothing here matches them.

const OCTET = '(?:25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]?\\d)';
const ADDR = (prefix) =>
  new RegExp(`(?<![\\d.])${prefix}(?![\\d]|\\.\\d)`, 'g');

export const INTERNAL_PATTERNS = [
  { name: 'rfc1918-10', re: ADDR(`10\\.${OCTET}\\.${OCTET}\\.${OCTET}`) },
  { name: 'rfc1918-172', re: ADDR(`172\\.(?:1[6-9]|2\\d|3[01])\\.${OCTET}\\.${OCTET}`) },
  { name: 'rfc1918-192', re: ADDR(`192\\.168\\.${OCTET}\\.${OCTET}`) },
  { name: 'cgnat-100', re: ADDR(`100\\.(?:6[4-9]|[7-9]\\d|1[01]\\d|12[0-7])\\.${OCTET}\\.${OCTET}`) },
  { name: 'link-local-169', re: ADDR(`169\\.254\\.${OCTET}\\.${OCTET}`) },
  { name: 'ipv6-ula', re: /(?<![0-9a-f:])f[cd][0-9a-f]{2}(?::[0-9a-f]{0,4}){2,7}(?![0-9a-f])/gi },
  { name: 'doppler-path', re: /doppler:\/\/[^\s"'`]+/g },
  { name: 'cluster-dns', re: /[a-z0-9-]+(?:\.[a-z0-9-]+)*\.svc\.cluster\.local/g },
  {
    name: 'internal-hostname',
    re: /(?<![\w-])[a-z0-9][a-z0-9-]*(?:\.[a-z0-9-]+)*\.(?:local|lan|internal|corp|home\.arpa)(?![\w-])/gi,
  },
];

// RFC 5737 TEST-NET-1/2/3. Used by tests and docs to prove the allowlist is
// explicit rather than an accident of the patterns above.
export const DOCUMENTATION_RANGES = [
  /^192\.0\.2\.\d{1,3}$/,
  /^198\.51\.100\.\d{1,3}$/,
  /^203\.0\.113\.\d{1,3}$/,
];

export function isDocumentationAddress(addr) {
  return DOCUMENTATION_RANGES.some((re) => re.test(addr));
}

export function findInternals(text) {
  const hits = [];
  for (const { name, re } of INTERNAL_PATTERNS) {
    for (const m of text.matchAll(re)) {
      if (isDocumentationAddress(m[0])) continue;
      hits.push({ pattern: name, match: m[0] });
    }
  }
  return hits;
}

// Scan [{path, text}] entries; returns [{path, pattern, match}].
export function scanEntries(entries) {
  const out = [];
  for (const { path, text } of entries) {
    for (const hit of findInternals(text)) out.push({ path, ...hit });
  }
  return out;
}
