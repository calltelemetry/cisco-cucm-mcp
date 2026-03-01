import { resolveSshAuth, looksLikeCucmPrompt } from "../src/ssh.js";

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
});
