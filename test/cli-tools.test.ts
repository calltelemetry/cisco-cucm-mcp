import { parseShowVersion, parseShowNetworkCluster, parseShowStatus, parseShowNetworkEth0 } from '../src/cli-tools.js';

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

describe('parseShowStatus', () => {
  it('parses hostname and platform', () => {
    const output = `Host Name            : cucm15-cluster1
Platform             : VMware Virtual Platform
Uptime              : 45 days, 3:22`;

    const r = parseShowStatus(output);
    expect(r.hostname).toBe('cucm15-cluster1');
    expect(r.platform).toBe('VMware Virtual Platform');
    expect(r.uptime).toBe('45 days, 3:22');
  });

  it('parses CPU and memory usage', () => {
    const output = `CPU Usage            : 23%
Memory Usage (Total) : 6144 MB
Memory Usage (Used)  : 3072 MB`;

    const r = parseShowStatus(output);
    expect(r.cpuPercent).toBe(23);
    expect(r.memoryTotalMb).toBe(6144);
    expect(r.memoryUsedMb).toBe(3072);
  });

  it('parses disk usage entries', () => {
    const output = `Common              : 25000 MB total, 12000 MB used (48%)
Boot                : 1000 MB total, 500 MB used (50%)`;

    const r = parseShowStatus(output);
    expect(r.disks).toHaveLength(2);
    expect(r.disks[0]!.partition).toBe('Common');
    expect(r.disks[0]!.totalMb).toBe(25000);
    expect(r.disks[0]!.usedMb).toBe(12000);
    expect(r.disks[0]!.percent).toBe(48);
    expect(r.disks[1]!.partition).toBe('Boot');
  });

  it('returns defaults for empty output', () => {
    const r = parseShowStatus('');
    expect(r.hostname).toBe('');
    expect(r.platform).toBe('');
    expect(r.cpuPercent).toBe(0);
    expect(r.memoryTotalMb).toBe(0);
    expect(r.memoryUsedMb).toBe(0);
    expect(r.disks).toEqual([]);
    expect(r.uptime).toBe('');
  });
});

describe('parseShowNetworkEth0', () => {
  it('parses basic network info', () => {
    const output = `DHCP        : disabled
IP Address  : 192.168.125.10
IP Mask     : 255.255.255.0
Link Detected: yes
Speed       : 10000Mb/s
Duplex      : Full
Gateway     : 192.168.125.1`;

    const r = parseShowNetworkEth0(output);
    expect(r.dhcp).toBe('disabled');
    expect(r.ipAddress).toBe('192.168.125.10');
    expect(r.ipMask).toBe('255.255.255.0');
    expect(r.linkDetected).toBe('yes');
    expect(r.speed).toBe('10000Mb/s');
    expect(r.duplex).toBe('Full');
    expect(r.gateway).toBe('192.168.125.1');
  });

  it('parses DNS section', () => {
    const output = `DNS
  Primary   : 192.168.125.1
  Secondary : 8.8.8.8`;

    const r = parseShowNetworkEth0(output);
    expect(r.dnsPrimary).toBe('192.168.125.1');
    expect(r.dnsSecondary).toBe('8.8.8.8');
  });

  it('returns empty strings for empty output', () => {
    const r = parseShowNetworkEth0('');
    expect(r.dhcp).toBe('');
    expect(r.ipAddress).toBe('');
    expect(r.ipMask).toBe('');
    expect(r.gateway).toBe('');
    expect(r.dnsPrimary).toBe('');
    expect(r.dnsSecondary).toBe('');
  });

  it('handles missing optional fields', () => {
    const output = `IP Address  : 10.0.0.5
Gateway     : 10.0.0.1`;

    const r = parseShowNetworkEth0(output);
    expect(r.ipAddress).toBe('10.0.0.5');
    expect(r.gateway).toBe('10.0.0.1');
    expect(r.dhcp).toBe('');
    expect(r.speed).toBe('');
  });
});
