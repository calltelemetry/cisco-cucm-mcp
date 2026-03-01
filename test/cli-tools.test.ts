import { parseShowVersion, parseShowNetworkCluster } from '../src/cli-tools.js';

describe('parseShowVersion', () => {
  it('parses CUCM 15 active version', () => {
    const output = `Active Master Version: 15.0.1.11900-40
Active Version Installed Software Options:
  No Installed Software Options Found.`;

    const r = parseShowVersion(output);
    expect(r.activeVersion).toBe('15.0.1.11900');
    expect(r.activeBuild).toBe('40');
  });

  it('parses active + inactive versions', () => {
    const output = `Active Master Version: 14.0.1.12345-67
Inactive Master Version: 12.5.1.11000-22`;

    const r = parseShowVersion(output);
    expect(r.activeVersion).toBe('14.0.1.12345');
    expect(r.activeBuild).toBe('67');
    expect(r.inactiveVersion).toBe('12.5.1.11000');
    expect(r.inactiveBuild).toBe('22');
  });

  it('parses version without Master keyword', () => {
    const output = `Active Version: 12.5.1.10000-1`;
    const r = parseShowVersion(output);
    expect(r.activeVersion).toBe('12.5.1.10000');
    expect(r.activeBuild).toBe('1');
  });

  it('returns empty strings for unparseable output', () => {
    const r = parseShowVersion('some garbage output');
    expect(r.activeVersion).toBe('');
    expect(r.activeBuild).toBe('');
    expect(r.inactiveVersion).toBe('');
    expect(r.inactiveBuild).toBe('');
  });
});

describe('parseShowNetworkCluster', () => {
  it('parses CUCM 15 cluster output with ID column', () => {
    const output = `ID     Hostname              IPv4               IPv6         Type        Hub/Spoke    TFTP
==     ========              ====               ====         ====        =========    ====
1      cucm-pub              192.168.1.10                    Publisher   Hub          Y
2      cucm-sub1             192.168.1.11                    Subscriber  Hub          N
3      cucm-sub2             192.168.1.12                    Subscriber  Spoke        N`;

    const nodes = parseShowNetworkCluster(output);
    expect(nodes).toHaveLength(3);
    expect(nodes[0]!.id).toBe('1');
    expect(nodes[0]!.hostname).toBe('cucm-pub');
    expect(nodes[0]!.ipAddress).toBe('192.168.1.10');
    expect(nodes[0]!.type).toBe('Publisher');
    expect(nodes[0]!.hubOrSpoke).toBe('Hub');
    expect(nodes[1]!.hostname).toBe('cucm-sub1');
    expect(nodes[1]!.type).toBe('Subscriber');
    expect(nodes[2]!.hubOrSpoke).toBe('Spoke');
  });

  it('parses single-node cluster', () => {
    const output = `ID     Hostname              IPv4               IPv6         Type        Hub/Spoke    TFTP
==     ========              ====               ====         ====        =========    ====
1      cucm15-pub            10.0.0.1                        Publisher   Hub          Y`;

    const nodes = parseShowNetworkCluster(output);
    expect(nodes).toHaveLength(1);
    expect(nodes[0]!.hostname).toBe('cucm15-pub');
    expect(nodes[0]!.ipAddress).toBe('10.0.0.1');
  });

  it('parses CUCM 15 headerless format (IP-first, space-separated)', () => {
    const output = `192.168.125.10 cucm15-cluster1.calltelemetry.local cucm15-cluster1 Publisher callmanager DBPub authenticated

Server Table (processnode) Entries
----------------------------------
cucm15-cluster1`;

    const nodes = parseShowNetworkCluster(output);
    expect(nodes).toHaveLength(1);
    expect(nodes[0]!.ipAddress).toBe('192.168.125.10');
    expect(nodes[0]!.hostname).toBe('cucm15-cluster1');
    expect(nodes[0]!.type).toBe('Publisher');
    expect(nodes[0]!.replicationStatus).toBe('authenticated');
  });

  it('returns empty array for empty output', () => {
    expect(parseShowNetworkCluster('')).toEqual([]);
    expect(parseShowNetworkCluster('   ')).toEqual([]);
  });

  it('handles Server header variant', () => {
    const output = `Server     Address         Type
------     -------         ----
1          192.168.1.10    Publisher
2          192.168.1.11    Subscriber`;

    const nodes = parseShowNetworkCluster(output);
    expect(nodes).toHaveLength(2);
    expect(nodes[0]!.id).toBe('1');
  });
});
