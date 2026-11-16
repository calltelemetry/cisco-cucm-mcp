import { describe, expect, it } from 'vitest';
// @ts-expect-error plain .mjs gate module without type declarations
import { findInternals, isDocumentationAddress, scanEntries } from '../scripts/scrub-patterns.mjs';

// Planted values are assembled at runtime so this file never carries a
// literal internal address and cannot trip the source scan itself.
const ip = (...octets: number[]) => octets.join('.');
const rfc1918 = [ip(10, 1, 2, 3), ip(172, 16, 0, 9), ip(172, 31, 255, 1), ip(192, 168, 7, 8)];
const cgnat = ip(100, 64, 0, 1);
const linkLocal = ip(169, 254, 10, 20);
const doppler = ['doppler:', '//project/config/SECRET_NAME'].join('');
const clusterDns = ['api', 'svc', 'cluster', 'local'].join('.');
const lanHost = ['cucm-pub', 'lab', 'local'].join('.');
const ula = ['fd12', '3456', '789a', '1'].join(':') + '::1';

describe('scrub gate patterns', () => {
  it.each(rfc1918)('flags private address %s', (addr: string) => {
    const hits = findInternals(`host=${addr} ok`);
    expect(hits.map((h: { match: string }) => h.match)).toContain(addr);
  });

  it('flags CGNAT, link-local, ULA, doppler, cluster DNS and .local hostnames', () => {
    const text = [cgnat, linkLocal, ula, doppler, clusterDns, lanHost].join('\n');
    const patterns = findInternals(text).map((h: { pattern: string }) => h.pattern);
    expect(patterns).toEqual(
      expect.arrayContaining([
        'cgnat-100',
        'link-local-169',
        'ipv6-ula',
        'doppler-path',
        'cluster-dns',
        'internal-hostname',
      ]),
    );
  });

  it('allows RFC 5737 documentation ranges explicitly', () => {
    const docs = ['192.0.2.10', '198.51.100.25', '203.0.113.200'];
    for (const addr of docs) {
      expect(isDocumentationAddress(addr)).toBe(true);
      expect(findInternals(`cucm at ${addr}:8443`)).toEqual([]);
    }
    expect(isDocumentationAddress(rfc1918[0] as string)).toBe(false);
  });

  it('does not flag public addresses, versions, or example.com names', () => {
    const text = 'dns 8.8.8.8, cucm 15.0.1.12900, 12.5.1.100, host cucm.example.com, 255.255.255.0';
    expect(findInternals(text)).toEqual([]);
  });

  it('does not match an address embedded in a longer dotted number', () => {
    expect(findInternals(`v${ip(1, 10, 1, 2, 3)}`)).toEqual([]);
  });

  it('reports the path for each hit', () => {
    const out = scanEntries([
      { path: 'a.txt', text: 'clean 192.0.2.1' },
      { path: 'b.txt', text: `bad ${rfc1918[3]}` },
    ]);
    expect(out).toEqual([{ path: 'b.txt', pattern: 'rfc1918-192', match: rfc1918[3] }]);
  });
});
