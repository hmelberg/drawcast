// One global gate over every generateSpec call. The course runner generates
// lectures that each generate several parts in parallel; per-level limits
// multiply (3 lectures × 6 parts is 18 concurrent calls and a rate-limit wall),
// so both levels queue here instead.

export function createGate(limit: number): <T>(fn: () => Promise<T>) => Promise<T> {
  let active = 0;
  const waiting: (() => void)[] = [];

  return async <T>(fn: () => Promise<T>): Promise<T> => {
    if (active >= limit) await new Promise<void>((resolve) => waiting.push(resolve));
    active++;
    try {
      return await fn();
    } finally {
      active--;
      waiting.shift()?.();
    }
  };
}

/**
 * Concurrent model calls in flight, all levels combined. This — not the shape
 * of the loop above it — is what sets a batch's throughput: with a limit of 4
 * and a typical `#parts=4` lecture, ONE lecture saturates the gate on its own,
 * so running lectures in parallel buys nothing until this number goes up.
 * Raised with the SDK's retry budget (llm/client.ts), which honours
 * `retry-after` on a 429.
 */
export const GENERATION_LIMIT = 8;
export const generationGate = createGate(GENERATION_LIMIT);
