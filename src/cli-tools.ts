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
  let headersUsed = colHeaders;
  for (const hdr of colHeaders) {
    const idx = headerLine.indexOf(hdr);
    if (idx >= 0) colPositions.push(idx);
  }

  // If too few, try alt headers
  if (colPositions.length < 3) {
    colPositions.length = 0;
    headersUsed = altHeaders;
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
