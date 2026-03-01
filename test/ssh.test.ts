import { resolveSshAuth, looksLikeCucmPrompt, stripAnsi } from "../src/ssh.js";

describe("resolveSshAuth", () => {
  const origUser = process.env.CUCM_SSH_USERNAME;
  const origPass = process.env.CUCM_SSH_PASSWORD;

  afterEach(() => {
    if (origUser !== undefined) process.env.CUCM_SSH_USERNAME = origUser;
    else delete process.env.CUCM_SSH_USERNAME;
    if (origPass !== undefined) process.env.CUCM_SSH_PASSWORD = origPass;
    else delete process.env.CUCM_SSH_PASSWORD;
  });

  it("uses explicit auth when provided", () => {
    const result = resolveSshAuth({ username: "admin", password: "secret" });
    expect(result).toEqual({ username: "admin", password: "secret" });
  });

  it("falls back to env vars", () => {
    process.env.CUCM_SSH_USERNAME = "envuser";
    process.env.CUCM_SSH_PASSWORD = "envpass";
    const result = resolveSshAuth();
    expect(result).toEqual({ username: "envuser", password: "envpass" });
  });

  it("explicit auth overrides env vars", () => {
    process.env.CUCM_SSH_USERNAME = "envuser";
    process.env.CUCM_SSH_PASSWORD = "envpass";
    const result = resolveSshAuth({ username: "explicit", password: "pw" });
    expect(result).toEqual({ username: "explicit", password: "pw" });
  });

  it("throws when credentials are missing", () => {
    delete process.env.CUCM_SSH_USERNAME;
    delete process.env.CUCM_SSH_PASSWORD;
    expect(() => resolveSshAuth()).toThrow("Missing SSH credentials");
  });

  it("throws when only username is provided", () => {
    delete process.env.CUCM_SSH_PASSWORD;
    expect(() => resolveSshAuth({ username: "admin" })).toThrow("Missing SSH credentials");
  });
});

describe("looksLikeCucmPrompt", () => {
  it("matches typical CUCM admin prompt", () => {
    expect(looksLikeCucmPrompt("some output\nadmin:")).toBe(true);
  });

  it("matches prompt with trailing whitespace", () => {
    expect(looksLikeCucmPrompt("output\nadmin: ")).toBe(true);
  });

  it("matches prompt at start of string", () => {
    expect(looksLikeCucmPrompt("admin:")).toBe(true);
  });

  it("rejects mid-line colons", () => {
    expect(looksLikeCucmPrompt("key: value\nmore text")).toBe(false);
  });

  it("rejects empty/undefined input", () => {
    expect(looksLikeCucmPrompt("")).toBe(false);
    expect(looksLikeCucmPrompt(undefined)).toBe(false);
  });

  // Regression: CUCM sends \r\n (CRLF) and standalone \r in SSH output
  it("matches prompt after CRLF line endings", () => {
    expect(looksLikeCucmPrompt("Welcome to CLI\r\n\r\nadmin:")).toBe(true);
  });

  it("matches prompt after standalone CR", () => {
    expect(looksLikeCucmPrompt("admin:\r\n\radmin:")).toBe(true);
  });

  it("matches real CUCM login banner ending with prompt", () => {
    const banner =
      "Command Line Interface is starting up, please wait ...\r\n" +
      "\r\n" +
      "   Welcome to the Platform Command Line Interface\r\n" +
      "\r\n" +
      "VMware Installation:\r\n" +
      "\t2 vCPU: Intel(R) Core(TM) i9-10900T CPU @ 1.90GHz\r\n" +
      "\r\n" +
      "admin:\r\n" +
      "\radmin:";
    expect(looksLikeCucmPrompt(banner)).toBe(true);
  });

  it("matches prompt with embedded ANSI escape codes", () => {
    expect(looksLikeCucmPrompt("\x1b[0m\x1b[24;1Hadmin:")).toBe(true);
  });
});

describe("stripAnsi", () => {
  it("removes CSI sequences", () => {
    expect(stripAnsi("\x1b[0mhello\x1b[1m world")).toBe("hello world");
  });

  it("removes cursor positioning", () => {
    expect(stripAnsi("\x1b[24;1Hadmin:")).toBe("admin:");
  });

  it("removes SGR color sequences", () => {
    expect(stripAnsi("\x1b[31mred\x1b[0m")).toBe("red");
  });

  it("preserves newlines and tabs", () => {
    expect(stripAnsi("line1\nline2\ttab\x1b[0m")).toBe("line1\nline2\ttab");
  });

  it("handles text without escape codes", () => {
    expect(stripAnsi("plain text")).toBe("plain text");
  });

  it("strips VT100 codes from cert list output", () => {
    const raw = "\x1b[0mUnit: tomcat\x1b[0m\nType: own\nName: tomcat\x1b[24;1H";
    expect(stripAnsi(raw)).toBe("Unit: tomcat\nType: own\nName: tomcat");
  });
});
