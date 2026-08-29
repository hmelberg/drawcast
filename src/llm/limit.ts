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

/** Concurrent generations in flight, both levels combined. */
export const GENERATION_LIMIT = 4;
export const generationGate = createGate(GENERATION_LIMIT);
