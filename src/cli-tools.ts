import { sshExecCommand, type SshAuth } from "./ssh.js";

// ---------------------------------------------------------------------------
// show version active
// ---------------------------------------------------------------------------

export type CucmVersion = {
  activeVersion: string;
  activeBuild: string;
  inactiveVersion: string;
  inactiveBuild: string;
};

/**
 * Parse `show version active` output from CUCM CLI.
 * Example output:
 *   Active Master Version: 15.0.1.11900-40
 *   Active Version Installed Software Options:
 *   ...
 */
export function parseShowVersion(stdout: string): CucmVersion {
  const lines = stdout.split("\n");
  let activeVersion = "";
  let activeBuild = "";
  let inactiveVersion = "";
  let inactiveBuild = "";

  for (const line of lines) {
    const trimmed = line.trim();
    const activeMatch = trimmed.match(/^Active(?:\s+Master)?\s+Version:\s*(.+)/i);
    if (activeMatch) {
      const full = activeMatch[1]!.trim();
      const dashIdx = full.lastIndexOf("-");
      if (dashIdx > 0) {
        activeVersion = full.slice(0, dashIdx);
        activeBuild = full.slice(dashIdx + 1);
      } else {
        activeVersion = full;
      }
    }
    const inactiveMatch = trimmed.match(/^Inactive(?:\s+Master)?\s+Version:\s*(.+)/i);
    if (inactiveMatch) {
      const full = inactiveMatch[1]!.trim();
      const dashIdx = full.lastIndexOf("-");
      if (dashIdx > 0) {
        inactiveVersion = full.slice(0, dashIdx);
        inactiveBuild = full.slice(dashIdx + 1);
      } else {
        inactiveVersion = full;
      }
    }
  }

  return { activeVersion, activeBuild, inactiveVersion, inactiveBuild };
}

export async function showVersion(
  host: string,
  opts?: { auth?: SshAuth; sshPort?: number; timeoutMs?: number },
): Promise<CucmVersion & { raw: string }> {
  const result = await sshExecCommand(host, "show version active", opts);
  const parsed = parseShowVersion(result.stdout);
  return { ...parsed, raw: result.stdout };
}

// ---------------------------------------------------------------------------
// show network cluster
// ---------------------------------------------------------------------------

export type ClusterNode = {
  id: string;
  hostname: string;
  ipAddress: string;
  ipv6Address: string;
  type: string;
  hubOrSpoke: string;
  replicationStatus: string;
};

/**
 * Parse `show network cluster` output from CUCM CLI.
 * Output is a fixed-width table with headers like:
 *   ID     Hostname              IPv4               IPv6         Type      Hub/Spoke    TFTP  ...
 *   1      cucm-pub              10.0.0.1                        Publisher  Hub          N     ...
 */
export function parseShowNetworkCluster(stdout: string): ClusterNode[] {
  const lines = stdout.split("\n");
  const nodes: ClusterNode[] = [];

  // Find the header line to determine column start positions
  let headerIdx = -1;
  let headerLine = "";
  for (let i = 0; i < lines.length; i++) {
    if (/^\s*(ID\s+|Server\s+(Address|Name|Hostname))/i.test(lines[i]!)) {
      headerIdx = i;
      headerLine = lines[i]!;
      break;
    }
  }
  if (headerIdx < 0) {
    // CUCM 15 headerless format: each node line is space-separated fields:
    //   <IP> <FQDN> <ShortName> <Type> <Role> <DBStatus> <ReplStatus>
    // Also handle lines starting with a numeric ID.
    // Skip lines that look like section headers ("Server Table ...") or separators.
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || /^[-=]+$/.test(trimmed)) continue;
      // Skip section headers like "Server Table (processnode) Entries"
      if (/^Server Table/i.test(trimmed)) continue;
      // Skip short single-word lines (like bare hostname entries under "Server Table")
      const parts = trimmed.split(/\s+/);
      if (parts.length < 3) continue;

      // Check if first field is an IP address (CUCM 15 format)
      if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(parts[0]!)) {
        nodes.push({
          id: "",
          hostname: parts[2] ?? parts[1] ?? "", // short name preferred, fallback FQDN
          ipAddress: parts[0]!,
          ipv6Address: "",
          type: parts[3] ?? "",
          hubOrSpoke: "",
          replicationStatus: parts[parts.length - 1] ?? "",
        });
      } else if (/^\d+$/.test(parts[0]!)) {
        // Numeric ID format
        nodes.push({
          id: parts[0]!,
          hostname: parts[1] ?? "",
          ipAddress: parts[2] ?? "",
          ipv6Address: parts[3] ?? "",
          type: parts[4] ?? "",
          hubOrSpoke: parts[5] ?? "",
          replicationStatus: parts[6] ?? "",
        });
      }
    }
    return nodes;
  }

  // Determine column start positions from the header keywords
  const colHeaders = ["ID", "Hostname", "IPv4", "IPv6", "Type", "Hub/Spoke", "TFTP"];
  const altHeaders = ["Server", "Address", "Type"];
  const colPositions: number[] = [];

  // Try standard headers first
  let _headersUsed = colHeaders;
  for (const hdr of colHeaders) {
    const idx = headerLine.indexOf(hdr);
    if (idx >= 0) colPositions.push(idx);
  }

  // If too few, try alt headers
  if (colPositions.length < 3) {
    colPositions.length = 0;
    _headersUsed = altHeaders;
    for (const hdr of altHeaders) {
      const idx = headerLine.indexOf(hdr);
      if (idx >= 0) colPositions.push(idx);
    }
  }

  // Fallback: split by 2+ spaces
  const useFixedWidth = colPositions.length >= 3;

  // Parse data lines after header (skip separator lines)
  for (let i = headerIdx + 1; i < lines.length; i++) {
    const line = lines[i]!;
    if (/^[\s\-=]*$/.test(line)) continue;
    if (line.trim().length === 0) continue;

    let parts: string[];
    if (useFixedWidth) {
      // Extract fields by column positions
      parts = [];
      for (let c = 0; c < colPositions.length; c++) {
        const start = colPositions[c]!;
        const end = c + 1 < colPositions.length ? colPositions[c + 1]! : line.length;
        parts.push(line.slice(start, end).trim());
      }
    } else {
      parts = line.trim().split(/\s{2,}/);
    }

    if (parts.length < 2) continue;

    if (/^\d+$/.test(parts[0]!)) {
      nodes.push({
        id: parts[0]!,
        hostname: parts[1] ?? "",
        ipAddress: parts[2] ?? "",
        ipv6Address: parts[3] ?? "",
        type: parts[4] ?? "",
        hubOrSpoke: parts[5] ?? "",
        replicationStatus: parts[6] ?? "",
      });
    } else if (parts[0]!.length > 0) {
      nodes.push({
        id: "",
        hostname: parts[0]!,
        ipAddress: parts[1] ?? "",
        ipv6Address: parts[2] ?? "",
        type: parts[3] ?? "",
        hubOrSpoke: parts[4] ?? "",
        replicationStatus: parts[5] ?? "",
      });
    }
  }

  return nodes;
}

export async function showNetworkCluster(
  host: string,
  opts?: { auth?: SshAuth; sshPort?: number; timeoutMs?: number },
): Promise<{ nodes: ClusterNode[]; raw: string }> {
  const result = await sshExecCommand(host, "show network cluster", opts);
  const nodes = parseShowNetworkCluster(result.stdout);
  return { nodes, raw: result.stdout };
}

// ---------------------------------------------------------------------------
// show status
// ---------------------------------------------------------------------------

export type DiskUsage = {
  partition: string;
  totalMb: number;
  usedMb: number;
  percent: number;
};

export type CucmStatus = {
  hostname: string;
  platform: string;
  cpuPercent: number;
  memoryTotalMb: number;
  memoryUsedMb: number;
  disks: DiskUsage[];
  uptime: string;
};

/**
 * Parse `show status` output from CUCM CLI.
 */
export function parseShowStatus(stdout: string): CucmStatus {
  const lines = stdout.split("\n");
  let hostname = "";
  let platform = "";
  let cpuPercent = 0;
  let memoryTotalMb = 0;
  let memoryUsedMb = 0;
  let uptime = "";
  const disks: DiskUsage[] = [];

  for (const line of lines) {
    const trimmed = line.trim();

    // CUCM 15 disk: "Disk/active         19760356K        3527092K       16014336K (82%)"
    // Must be checked before the kv-match guard since disk lines have no ":" separator
    const diskKbMatch = trimmed.match(/^(Disk\/\w+)\s+(\d+)K\s+(\d+)K\s+(\d+)K\s+\((\d+)%/i);
    if (diskKbMatch) {
      disks.push({
        partition: diskKbMatch[1]!,
        totalMb: Math.round(parseInt(diskKbMatch[2]!, 10) / 1024),
        usedMb: Math.round(parseInt(diskKbMatch[4]!, 10) / 1024),
        percent: parseInt(diskKbMatch[5]!, 10),
      });
      continue;
    }

    // CUCM 15 uptime: " 16:22:34 up 10:47, 1 user, ..."
    const uptimeMatch = trimmed.match(/^\d+:\d+:\d+\s+up\s+(.+?)(?:,\s*\d+\s+user|$)/);
    if (uptimeMatch && !uptime) {
      uptime = uptimeMatch[1]!.trim().replace(/,\s*$/, "");
    }

    const kvMatch = trimmed.match(/^(.+?)\s*:\s*(.+)$/);
    if (!kvMatch) continue;

    const key = kvMatch[1]!.trim().toLowerCase();
    const value = kvMatch[2]!.trim();

    if (key === "host name" || key === "hostname") {
      hostname = value;
    } else if (key === "platform" || key === "product ver") {
      platform = value;
    } else if (key.includes("cpu") && key.includes("usage")) {
      cpuPercent = parseFloat(value.replace("%", "")) || 0;
    } else if (key === "cpu idle") {
      // CUCM 15: "CPU Idle: 92.86%" → compute usage as 100 - idle
      const idle = parseFloat(value.replace("%", "")) || 0;
      cpuPercent = Math.round((100 - idle) * 100) / 100;
    } else if (key.includes("memory") && key.includes("total")) {
      // Handles both "Memory Usage (Total): 6144 MB" and "Memory Total: 11998968K"
      const kbMatch = value.match(/^(\d+)\s*K$/i);
      if (kbMatch) memoryTotalMb = Math.round(parseInt(kbMatch[1]!, 10) / 1024);
      else memoryTotalMb = parseFloat(value.replace(/\s*mb$/i, "")) || 0;
    } else if (key.includes("memory") && key.includes("used")) {
      const kbMatch = value.match(/^(\d+)\s*K$/i);
      if (kbMatch) memoryUsedMb = Math.round(parseInt(kbMatch[1]!, 10) / 1024);
      else memoryUsedMb = parseFloat(value.replace(/\s*mb$/i, "")) || 0;
    } else if (key === "used") {
      // CUCM 15: "Used: 7016916K" (under Memory section)
      const kbMatch = value.match(/^(\d+)\s*K$/i);
      if (kbMatch && memoryTotalMb > 0 && memoryUsedMb === 0) {
        memoryUsedMb = Math.round(parseInt(kbMatch[1]!, 10) / 1024);
      }
    } else if (key === "uptime") {
      uptime = value;
    }

    // Disk usage lines: "Common : 25000 MB total, 12000 MB used (48%)"
    const diskMatch = trimmed.match(/^(\w+)\s*:\s*(\d+)\s*MB\s*total\s*,\s*(\d+)\s*MB\s*used\s*\((\d+)%?\)/i);
    if (diskMatch) {
      disks.push({
        partition: diskMatch[1]!,
        totalMb: parseInt(diskMatch[2]!, 10),
        usedMb: parseInt(diskMatch[3]!, 10),
        percent: parseInt(diskMatch[4]!, 10),
      });
    }
  }

  return { hostname, platform, cpuPercent, memoryTotalMb, memoryUsedMb, disks, uptime };
}

export async function showStatus(
  host: string,
  opts?: { auth?: SshAuth; sshPort?: number; timeoutMs?: number },
): Promise<CucmStatus & { raw: string }> {
  const result = await sshExecCommand(host, "show status", opts);
  const parsed = parseShowStatus(result.stdout);
  return { ...parsed, raw: result.stdout };
}

// ---------------------------------------------------------------------------
// show network eth0 detail
// ---------------------------------------------------------------------------

export type NetworkEth0 = {
  dhcp: string;
  ipAddress: string;
  ipMask: string;
  gateway: string;
  dnsPrimary: string;
  dnsSecondary: string;
  linkDetected: string;
  speed: string;
  duplex: string;
};

/**
 * Parse `show network eth0 detail` output from CUCM CLI.
 */
export function parseShowNetworkEth0(stdout: string): NetworkEth0 {
  const lines = stdout.split("\n");
  let dhcp = "";
  let ipAddress = "";
  let ipMask = "";
  let gateway = "";
  let dnsPrimary = "";
  let dnsSecondary = "";
  let linkDetected = "";
  let speed = "";
  let duplex = "";

  let inDns = false;

  for (const line of lines) {
    const trimmed = line.trim();

    // "DNS" section header may appear alone (no colon)
    if (/^dns$/i.test(trimmed)) {
      inDns = true;
      continue;
    }

    const kvMatch = trimmed.match(/^(.+?)\s*:\s*(.*)$/);

    if (kvMatch) {
      const key = kvMatch[1]!.trim().toLowerCase();
      // CUCM 15 two-column format: "DHCP : disabled     Status : up"
      // Take only the first value before any second key-value pair
      const rawValue = kvMatch[2]!.trim();
      const twoColMatch = rawValue.match(/^(.+?)\s{3,}\S/);
      const value = twoColMatch ? twoColMatch[1]!.trim() : rawValue;

      if (key === "dhcp") {
        dhcp = value;
        inDns = false;
      } else if (key === "ip address" || key === "address") {
        ipAddress = value;
        inDns = false;
        // CUCM 15: "IP Address : 192.168.125.10     IP Mask : 255.255.255.000"
        const maskMatch = rawValue.match(/IP\s*Mask\s*:\s*(\S+)/i);
        if (maskMatch && !ipMask) ipMask = maskMatch[1]!;
      } else if (key === "ip mask" || key === "mask") {
        ipMask = value;
        inDns = false;
      } else if (key === "gateway") {
        // "Gateway : 192.168.125.1 on Ethernet 0" → just the IP
        const gwIp = value.match(/^(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})/);
        gateway = gwIp ? gwIp[1]! : value;
        inDns = false;
      } else if (key === "link detected") {
        linkDetected = value;
        inDns = false;
        // CUCM 15: "Link Detected: yes     Mode : Auto disabled, Full, 10000 Mbits/s"
        const modeMatch = rawValue.match(/Mode\s*:\s*.*?(?:Full|Half)?\s*,?\s*(\d+\s*\w+\/s)/i);
        if (modeMatch && !speed) speed = modeMatch[1]!;
        const duplexMatch = rawValue.match(/(Full|Half)/i);
        if (duplexMatch && !duplex) duplex = duplexMatch[1]!;
      } else if (key === "speed") {
        speed = value;
        inDns = false;
      } else if (key === "duplex") {
        duplex = value;
        inDns = false;
      } else if (key === "dns") {
        inDns = true;
      } else if (inDns && key === "primary") {
        // CUCM 15: "Primary : 192.168.68.125     Secondary : Not Configured"
        dnsPrimary = value;
        const secMatch = rawValue.match(/Secondary\s*:\s*(\S+)/i);
        if (secMatch && !dnsSecondary) {
          const secVal = secMatch[1]!;
          if (secVal.toLowerCase() !== "not" && secVal.toLowerCase() !== "configured") {
            dnsSecondary = secVal;
          }
        }
      } else if (inDns && key === "secondary") {
        if (value.toLowerCase() !== "not configured") dnsSecondary = value;
      }
    }
  }

  return { dhcp, ipAddress, ipMask, gateway, dnsPrimary, dnsSecondary, linkDetected, speed, duplex };
}

export async function showNetworkEth0(
  host: string,
  opts?: { auth?: SshAuth; sshPort?: number; timeoutMs?: number },
): Promise<NetworkEth0 & { raw: string }> {
  const result = await sshExecCommand(host, "show network eth0 detail", opts);
  const parsed = parseShowNetworkEth0(result.stdout);
  return { ...parsed, raw: result.stdout };
}
