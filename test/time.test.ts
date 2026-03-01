import { formatCucmDateTime, guessTimezoneString } from "../src/time.js";

describe("formatCucmDateTime", () => {
  it("formats a date in CUCM DIME format (MM/DD/YY HH:MM AM)", () => {
    // Use a fixed date — Jan 15, 2026 at 9:30 AM UTC
    const d = new Date("2026-01-15T09:30:00Z");
    const result = formatCucmDateTime(d);
    // Should contain date and time components (exact format depends on locale)
    expect(result).toMatch(/\d{2}\/\d{2}\/\d{2}/); // MM/DD/YY
    expect(result).toMatch(/\d{1,2}:\d{2}\s*(AM|PM)/i); // HH:MM AM/PM
  });

  it("handles midnight correctly", () => {
    const d = new Date("2026-06-01T00:00:00Z");
    const result = formatCucmDateTime(d);
    expect(result).toMatch(/\d{2}\/\d{2}\/\d{2}/);
    expect(result).toMatch(/\d{1,2}:\d{2}\s*(AM|PM)/i);
  });
});

describe("guessTimezoneString", () => {
  it("returns a DIME-compatible timezone string", () => {
    const result = guessTimezoneString();
    // Format: "Client: (GMT+H:M)TimezoneName" or "Client: (GMT-H:M)TimezoneName"
    expect(result).toMatch(/^Client: \(GMT[+-]\d+:\d+\)/);
  });

  it("includes timezone name from Intl", () => {
    const result = guessTimezoneString();
    // Should end with a timezone identifier
    expect(result).toMatch(/\)[\w/]+$/);
  });

  it("uses provided date for offset calculation", () => {
    // Summer and winter dates may produce different offsets in DST-aware zones
    const summer = new Date("2026-07-01T12:00:00Z");
    const winter = new Date("2026-01-01T12:00:00Z");
    const summerResult = guessTimezoneString(summer);
    const winterResult = guessTimezoneString(winter);
    // Both should be valid format regardless
    expect(summerResult).toMatch(/^Client: \(GMT[+-]\d+:\d+\)/);
    expect(winterResult).toMatch(/^Client: \(GMT[+-]\d+:\d+\)/);
  });
});
