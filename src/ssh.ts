import { Client, type ClientChannel } from "ssh2";

/** Strip ANSI/VT100 escape sequences from terminal output. */
export function stripAnsi(text: string): string {
  // Match: CSI sequences (\x1b[...X), OSC sequences (\x1b]...\x07), single-char escapes (\x1bX),
  // and control chars except \n, \r, \t
  return text.replace(/\x1b\[[0-9;]*[A-Za-z]|\x1b\][^\x07]*\x07|\x1b[^[\]]/g, "");
}

export type SshAuth = { username?: string; password?: string };

export function resolveSshAuth(auth?: SshAuth): Required<SshAuth> {
  const username = auth?.username || process.env.CUCM_SSH_USERNAME;
  const password = auth?.password || process.env.CUCM_SSH_PASSWORD;
  if (!username || !password) {
    throw new Error("Missing SSH credentials (provide auth or set CUCM_SSH_USERNAME/CUCM_SSH_PASSWORD)");
  }
  return { username, password };
}

export function looksLikeCucmPrompt(text?: string): boolean {
  const t = String(text || "");
  const tail = t.slice(-80);
  // Strip ANSI escape codes and CRLF → LF before matching
  const normalized = stripAnsi(tail).replace(/\r\n?/g, "\n");
  return /(?:^|\n)[A-Za-z0-9_-]+:\s*$/.test(normalized);
}

export type SshExecResult = {
  stdout: string;
  exitCode: number | null;
};

/**
 * Execute a single CLI command on a CUCM node via SSH shell.
 * CUCM does not support SSH exec(), so we open an interactive shell,
 * wait for the prompt, type the command, wait for the prompt to return,
 * then send "exit" and close.
 */
export async function sshExecCommand(
  host: string,
  command: string,
  opts?: {
    auth?: SshAuth;
    sshPort?: number;
    timeoutMs?: number;
  },
): Promise<SshExecResult> {
  const auth = resolveSshAuth(opts?.auth);
  const sshPort = opts?.sshPort ?? (process.env.CUCM_SSH_PORT ? Number.parseInt(process.env.CUCM_SSH_PORT, 10) : 22);
  const timeoutMs = Math.max(5000, opts?.timeoutMs ?? 60_000);

  const client = new Client();
  let stdout = "";
  let exitCode: number | null = null;

  try {
    // Connect — CUCM requires keyboard-interactive auth (rejects plain password).
    // Use authHandler to skip publickey and password methods entirely,
    // preventing "too many authentication failures" from exhausting attempts.
    await Promise.race([
      new Promise<void>((resolve, reject) => {
        client
          .on("ready", () => resolve())
          .on("error", (e: unknown) => reject(e))
          .on("keyboard-interactive", (_name, _inst, _lang, prompts, finish) => {
            finish(prompts.map(() => auth.password));
          })
          .connect({
            host,
            port: sshPort,
            username: auth.username,
            tryKeyboard: true,
            readyTimeout: 15000,
            authHandler: (_methodsLeft, _partialSuccess, callback) => {
              callback("keyboard-interactive");
            },
          });
      }),
      timeoutPromise(timeoutMs, `SSH connect timed out after ${timeoutMs}ms`),
    ]);

    // Open shell (CUCM doesn't support exec)
    const channel = await new Promise<ClientChannel>((resolve, reject) => {
      client.shell({ term: "vt100", cols: 200, rows: 40 }, (err: unknown, ch: ClientChannel) => {
        if (err) return reject(err);
        resolve(ch);
      });
    });

    let buffer = "";
    channel.on("data", (buf: Buffer) => { buffer += buf.toString("utf8"); });
    channel.stderr.on("data", (buf: Buffer) => { buffer += buf.toString("utf8"); });
    channel.on("close", (code: number | null) => { exitCode = code; });

    // Wait for initial prompt
    channel.write("\n");
    await waitForPrompt(buffer, channel, timeoutMs, "Timeout waiting for CUCM CLI prompt");

    // Clear buffer, send command
    const preCommandLen = buffer.length;
    channel.write(`${command}\n`);

    // Wait for prompt to return after command output
    await waitForPrompt(buffer, channel, timeoutMs, `Timeout waiting for command to complete: ${command}`);

    // Extract command output (between command echo and the final prompt)
    stdout = buffer.slice(preCommandLen);

    // Strip VT100/ANSI escape codes produced by the terminal emulation
    stdout = stripAnsi(stdout);

    // Strip the command echo line and trailing prompt
    const lines = stdout.split("\n");
    // First line(s) may echo the command; last line is the prompt
    if (lines.length > 1) {
      // Remove first line (command echo) and last line (prompt)
      stdout = lines.slice(1, -1).join("\n").trim();
    }

    // Clean exit
    try { channel.write("exit\n"); } catch { /* ignore */ }
    try { channel.end(); } catch { /* ignore */ }
  } finally {
    try { client.end(); client.destroy(); } catch { /* ignore */ }
  }

  return { stdout, exitCode };
}

function timeoutPromise(ms: number, message: string): Promise<never> {
  return new Promise<never>((_, reject) => {
    const t = setTimeout(() => reject(new Error(message)), ms);
    (t as unknown as { unref?: () => void }).unref?.();
  });
}

async function waitForPrompt(
  _buffer: string,
  channel: ClientChannel,
  timeoutMs: number,
  timeoutMessage: string,
): Promise<void> {
  // We need to read the live buffer via closure reference, but the string is immutable.
  // Instead, collect chunks and check periodically.
  let collected = "";
  const onData = (buf: Buffer) => { collected += buf.toString("utf8"); };
  channel.on("data", onData);
  channel.stderr.on("data", onData);

  try {
    const startTime = Date.now();
    const deadline = startTime + timeoutMs;
    // Nudge with newlines if no prompt appears
    const nudgeDelays = [400, 1200, 2500];
    let nudgeIdx = 0;

    while (Date.now() < deadline) {
      if (looksLikeCucmPrompt(collected)) return;
      await new Promise((r) => setTimeout(r, 200));
      const elapsed = Date.now() - startTime;
      if (nudgeIdx < nudgeDelays.length && elapsed >= nudgeDelays[nudgeIdx]!) {
        try { channel.write("\n"); } catch { /* ignore */ }
        nudgeIdx++;
      }
    }
    if (looksLikeCucmPrompt(collected)) return;
    throw new Error(timeoutMessage);
  } finally {
    channel.off("data", onData);
    channel.stderr.off("data", onData);
  }
}
