/**
 * Shared error formatting utilities.
 */

export function formatUnknownError(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === "string") return e;
  if (e === null || e === undefined) return String(e);
  try {
    return JSON.stringify(e);
  } catch {
    return String(e);
  }
}
