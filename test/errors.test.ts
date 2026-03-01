import { formatUnknownError } from "../src/errors.js";

describe("formatUnknownError", () => {
  it("extracts message from Error instances", () => {
    expect(formatUnknownError(new Error("something broke"))).toBe("something broke");
  });

  it("returns string errors as-is", () => {
    expect(formatUnknownError("raw error string")).toBe("raw error string");
  });

  it("JSON-stringifies objects", () => {
    expect(formatUnknownError({ code: 42, detail: "fail" })).toBe('{"code":42,"detail":"fail"}');
  });

  it("handles null", () => {
    expect(formatUnknownError(null)).toBe("null");
  });

  it("handles undefined", () => {
    expect(formatUnknownError(undefined)).toBe("undefined");
  });

  it("handles numbers", () => {
    expect(formatUnknownError(404)).toBe("404");
  });

  it("handles circular objects gracefully", () => {
    const obj: Record<string, unknown> = {};
    obj.self = obj;
    // JSON.stringify throws on circular — should fall through to String()
    const result = formatUnknownError(obj);
    expect(result).toBe("[object Object]");
  });
});
