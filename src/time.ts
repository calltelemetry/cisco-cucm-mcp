export function formatCucmDateTime(d: Date): string {
  // DIME examples use: "MM/DD/YY HH:MM AM" (US locale)
  const date = new Intl.DateTimeFormat("en-US", {
    month: "2-digit",
    day: "2-digit",
    year: "2-digit",
  }).format(d);
  const time = new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(d);
  return `${date} ${time}`;
}

export function guessTimezoneString(now = new Date()): string {
  // Best-effort DIME timezone string:
  // "Client: (GMT-8:0)America/Los_Angeles"
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  const offsetMin = -now.getTimezoneOffset();
  const sign = offsetMin >= 0 ? "+" : "-";
  const abs = Math.abs(offsetMin);
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  return `Client: (GMT${sign}${h}:${m})${tz}`;
}
