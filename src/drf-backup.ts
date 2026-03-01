import { sshExecCommand, type SshAuth } from "./ssh.js";

export type BackupStatus = {
  status: string;
  startTime?: string;
  endTime?: string;
  percentComplete?: string;
  result?: string;
  rawOutput: string;
};

export type BackupHistoryEntry = {
  date: string;
  component: string;
  status: string;
  device?: string;
  rawLine: string;
};

/**
 * Parse the output of `utils disaster_recovery status backup`.
 *
 * Typical CUCM output:
 * ```
 * Backup Status
 * =============
 * Status: COMPLETED
 * Start: 2026-02-27 02:00:00
 * End: 2026-02-27 02:15:30
 * Percentage Complete: 100%
 * Result: SUCCESS
 * ```
 *
 * Or: "No backup currently in progress" / empty output.
 */
export function parseBackupStatusOutput(output: string): BackupStatus {
  const raw = (output || "").trim();
  if (!raw) {
    return { status: "UNKNOWN", rawOutput: raw };
  }

  // Check for "no backup" messages (various forms CUCM may emit)
  const lower = raw.toLowerCase();
  if (
    lower.includes("no backup") ||
    lower.includes("no active backup") ||
    lower.includes("not currently") ||
    lower.includes("not in progress")
  ) {
    return { status: "IDLE", rawOutput: raw };
  }

  const field = (pattern: RegExp): string | undefined => {
    const m = raw.match(pattern);
    return m?.[1]?.trim();
  };

  const status =
    field(/^Status\s*:\s*(.+)/mi) ??
    field(/^Backup\s+Status\s*:\s*(.+)/mi) ??
    "UNKNOWN";

  const startTime =
    field(/^Start\s*:\s*(.+)/mi) ??
    field(/^Start\s+Time\s*:\s*(.+)/mi);

  const endTime =
    field(/^End\s*:\s*(.+)/mi) ??
    field(/^End\s+Time\s*:\s*(.+)/mi);

  const percentComplete =
    field(/^Percentage\s+Complete\s*:\s*(.+)/mi) ??
    field(/^Percent\s*:\s*(.+)/mi) ??
    field(/^Progress\s*:\s*(.+)/mi);

  const result =
    field(/^Result\s*:\s*(.+)/mi) ??
    field(/^Backup\s+Result\s*:\s*(.+)/mi);

  return { status, startTime, endTime, percentComplete, result, rawOutput: raw };
}

/**
 * Parse the output of `utils disaster_recovery history backup`.
 *
 * CUCM typically returns a table or list of backup entries, e.g.:
 * ```
 * Tar Filename         Backup Date          Backup Result     Backup Device
 * 2026-02-27-02-00.tar 02/27/2026 02:00:00  SUCCESS           SFTP_Server
 * 2026-02-26-02-00.tar 02/26/2026 02:00:00  SUCCESS           SFTP_Server
 * ```
 *
 * Or columnar / key-value variants depending on CUCM version.
 */
export function parseBackupHistoryOutput(output: string): BackupHistoryEntry[] {
  const raw = (output || "").trim();
  if (!raw) return [];

  const lines = raw.split("\n").map((l) => l.trim());

  // Skip blank lines, header/separator lines (===, ---), and column header rows.
  // A header row typically contains "Backup Date" or "Tar Filename" etc.
  const isHeaderOrSep = (line: string): boolean => {
    if (!line) return true;
    if (/^[=\-\s]+$/.test(line)) return true;
    const lc = line.toLowerCase();
    if (lc.includes("tar filename") || lc.includes("backup date")) return true;
    if (lc.includes("backup result") && lc.includes("backup device")) return true;
    return false;
  };

  const entries: BackupHistoryEntry[] = [];

  for (const line of lines) {
    if (isHeaderOrSep(line)) continue;

    // Skip "no history" messages
    const lc = line.toLowerCase();
    if (lc.includes("no backup history") || lc.includes("no records")) continue;

    // Attempt to parse as whitespace-delimited columns:
    //   component/filename  date  time  status  device
    // The date+time can be in various formats; try to be flexible.
    const parts = line.split(/\s{2,}/);

    if (parts.length >= 3) {
      const component = parts[0]?.trim() ?? "";
      const token1 = parts[1]?.trim() ?? "";

      // Detect column order: CUCM 15 returns "component | device | date | status | ..."
      // while some versions use "component | date | status | device"
      // Heuristic: if token1 is a device type (NETWORK, SFTP, Local, etc.) or doesn't
      // look like a date, assume the CUCM 15 column order.
      const looksLikeDate = /^\d{2}[/-]\d{2}[/-]\d{2,4}|^\d{4}[/-]\d{2}|^(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)\s/i.test(token1);

      let date: string;
      let status: string;
      let device: string | undefined;

      if (!looksLikeDate && parts.length >= 4) {
        // CUCM 15 format: component | device | date | status [| type | version | ...]
        device = token1;
        date = parts[2]?.trim() ?? "";
        status = parts[3]?.trim() ?? "";
      } else {
        // Standard format: component | date [time] | status | device
        date = token1;
        let statusIdx = 2;
        if (parts[2] && /^\d{2}:\d{2}/.test(parts[2])) {
          date = `${date} ${parts[2].trim()}`;
          statusIdx = 3;
        }
        status = parts[statusIdx]?.trim() ?? "";
        device = parts[statusIdx + 1]?.trim() || undefined;
      }

      entries.push({ date, component, status, device, rawLine: line });
    } else if (parts.length === 2) {
      // Minimal: component + status (or date + status)
      entries.push({
        date: parts[0]?.trim() ?? "",
        component: parts[0]?.trim() ?? "",
        status: parts[1]?.trim() ?? "",
        rawLine: line,
      });
    } else {
      // Single token or unparseable — still capture it
      entries.push({
        date: "",
        component: line,
        status: "",
        rawLine: line,
      });
    }
  }

  return entries;
}

/**
 * Query the current DRF backup status from a CUCM node via SSH.
 *
 * Runs: `utils disaster_recovery status backup`
 */
export async function getBackupStatus(
  host: string,
  opts?: { auth?: SshAuth; sshPort?: number; timeoutMs?: number },
): Promise<BackupStatus> {
  const { stdout } = await sshExecCommand(
    host,
    "utils disaster_recovery status backup",
    {
      auth: opts?.auth,
      sshPort: opts?.sshPort,
      timeoutMs: opts?.timeoutMs,
    },
  );
  return parseBackupStatusOutput(stdout);
}

/**
 * Query the DRF backup history from a CUCM node via SSH.
 *
 * Runs: `utils disaster_recovery history backup`
 */
export async function getBackupHistory(
  host: string,
  opts?: { auth?: SshAuth; sshPort?: number; timeoutMs?: number },
): Promise<BackupHistoryEntry[]> {
  const { stdout } = await sshExecCommand(
    host,
    "utils disaster_recovery history backup",
    {
      auth: opts?.auth,
      sshPort: opts?.sshPort,
      timeoutMs: opts?.timeoutMs,
    },
  );
  return parseBackupHistoryOutput(stdout);
}
