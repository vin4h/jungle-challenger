export function exponentialBackoff(attempt: number, baseMs: number, maxMs: number): number {
  const delay = baseMs * 2 ** (attempt - 1);
  return Math.min(delay, maxMs);
}
