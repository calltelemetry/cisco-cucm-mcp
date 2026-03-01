import { parseBackupStatusOutput, parseBackupHistoryOutput } from "../src/drf-backup.js";

describe("parseBackupStatusOutput", () => {
  it("parses a successful completed backup", () => {
    const output = `
Backup Status
=============
Status: COMPLETED
Start: 2026-02-27 02:00:00
End: 2026-02-27 02:15:30
Percentage Complete: 100%
Result: SUCCESS
`;
    const result = parseBackupStatusOutput(output);
    expect(result.status).toBe("COMPLETED");
    expect(result.startTime).toBe("2026-02-27 02:00:00");
    expect(result.endTime).toBe("2026-02-27 02:15:30");
    expect(result.percentComplete).toBe("100%");
    expect(result.result).toBe("SUCCESS");
    expect(result.rawOutput).toBeTruthy();
  });

  it("parses an in-progress backup", () => {
    const output = `
Backup Status
=============
Status: IN_PROGRESS
Start: 2026-02-27 02:00:00
Percentage Complete: 45%
`;
    const result = parseBackupStatusOutput(output);
    expect(result.status).toBe("IN_PROGRESS");
    expect(result.startTime).toBe("2026-02-27 02:00:00");
    expect(result.endTime).toBeUndefined();
    expect(result.percentComplete).toBe("45%");
    expect(result.result).toBeUndefined();
  });

  it('parses "no backup" message as IDLE', () => {
    const output = "No backup currently in progress";
    const result = parseBackupStatusOutput(output);
    expect(result.status).toBe("IDLE");
    expect(result.startTime).toBeUndefined();
    expect(result.endTime).toBeUndefined();
  });

  it('parses "no active backup" variant as IDLE', () => {
    const output = "There is no active backup running at this time.";
    const result = parseBackupStatusOutput(output);
    expect(result.status).toBe("IDLE");
  });

  it("returns UNKNOWN for empty output", () => {
    const result = parseBackupStatusOutput("");
    expect(result.status).toBe("UNKNOWN");
    expect(result.rawOutput).toBe("");
  });

  it("returns UNKNOWN for undefined-like input", () => {
    const result = parseBackupStatusOutput(undefined as unknown as string);
    expect(result.status).toBe("UNKNOWN");
  });

  it("handles alternative field labels", () => {
    const output = `
Backup Status: RUNNING
Start Time: 2026-03-01 10:00:00
Percent: 60%
`;
    const result = parseBackupStatusOutput(output);
    expect(result.status).toBe("RUNNING");
    expect(result.startTime).toBe("2026-03-01 10:00:00");
    expect(result.percentComplete).toBe("60%");
  });

  it("parses failed backup result", () => {
    const output = `
Backup Status
=============
Status: COMPLETED
Start: 2026-02-27 02:00:00
End: 2026-02-27 02:05:12
Percentage Complete: 100%
Result: FAILED
`;
    const result = parseBackupStatusOutput(output);
    expect(result.status).toBe("COMPLETED");
    expect(result.result).toBe("FAILED");
  });

  it("preserves raw output", () => {
    const output = "Status: COMPLETED\nResult: SUCCESS";
    const result = parseBackupStatusOutput(output);
    expect(result.rawOutput).toBe(output);
  });
});

describe("parseBackupHistoryOutput", () => {
  it("parses a table of backup entries", () => {
    const output = `
Tar Filename             Backup Date          Backup Result     Backup Device
2026-02-27-02-00.tar     02/27/2026 02:00:00  SUCCESS           SFTP_Server
2026-02-26-02-00.tar     02/26/2026 02:00:00  SUCCESS           SFTP_Server
`;
    const entries = parseBackupHistoryOutput(output);
    expect(entries).toHaveLength(2);

    expect(entries[0]!.component).toBe("2026-02-27-02-00.tar");
    expect(entries[0]!.date).toContain("02/27/2026");
    expect(entries[0]!.status).toBe("SUCCESS");
    expect(entries[0]!.device).toBe("SFTP_Server");
    expect(entries[0]!.rawLine).toContain("2026-02-27-02-00.tar");

    expect(entries[1]!.component).toBe("2026-02-26-02-00.tar");
    expect(entries[1]!.status).toBe("SUCCESS");
  });

  it("returns empty array for empty output", () => {
    expect(parseBackupHistoryOutput("")).toEqual([]);
  });

  it("returns empty array for undefined-like input", () => {
    expect(parseBackupHistoryOutput(undefined as unknown as string)).toEqual([]);
  });

  it("returns empty array for only headers/separators", () => {
    const output = `
Tar Filename             Backup Date          Backup Result     Backup Device
=================================================================================
`;
    expect(parseBackupHistoryOutput(output)).toEqual([]);
  });

  it("handles malformed lines gracefully", () => {
    const output = `
some-random-unstructured-line
`;
    const entries = parseBackupHistoryOutput(output);
    // Should not throw; captures the line even if unparseable
    expect(entries).toHaveLength(1);
    expect(entries[0]!.rawLine).toContain("some-random-unstructured-line");
  });

  it("skips 'no history' messages", () => {
    const output = "No backup history found";
    const entries = parseBackupHistoryOutput(output);
    expect(entries).toEqual([]);
  });

  it("handles mixed valid and separator lines", () => {
    const output = `
==========
2026-02-27-02-00.tar     02/27/2026 02:00:00  SUCCESS           SFTP_Server
----------
2026-02-25-02-00.tar     02/25/2026 02:00:00  FAILED            Local
`;
    const entries = parseBackupHistoryOutput(output);
    expect(entries).toHaveLength(2);
    expect(entries[0]!.status).toBe("SUCCESS");
    expect(entries[1]!.status).toBe("FAILED");
  });

  // Regression: real CUCM 15 output has different column order (device before date)
  it("parses CUCM 15 backup history format (device before date)", () => {
    const output = `2025-12-12-13-44-12.tar   NETWORK        Fri Dec 12 13:45:19 PST 2025  SUCCESS  MANUAL        15.0.1.12900-234 UCM                        ---`;
    const entries = parseBackupHistoryOutput(output);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.component).toBe("2025-12-12-13-44-12.tar");
    expect(entries[0]!.device).toBe("NETWORK");
    expect(entries[0]!.date).toContain("Dec 12");
    expect(entries[0]!.status).toBe("SUCCESS");
  });

  it("parses entries without device column", () => {
    const output = `
backup_2026-02-27.tar     02/27/2026  SUCCESS
`;
    const entries = parseBackupHistoryOutput(output);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.component).toBe("backup_2026-02-27.tar");
    expect(entries[0]!.status).toBe("SUCCESS");
  });
});
