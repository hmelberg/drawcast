// Which of a cast's thumbnails to show (2026-10-06): Thompson sampling over
// the counts the feed carries ([shown, clicks] per variant) — mostly the one
// that is clicked most, never only it. Each variant's click rate is drawn from
// Beta(clicks + 1, shown − clicks + 1) and the highest draw is shown; with
// little data the draws are wide and every variant gets its turn, as evidence
// builds the better one wins more often. A floor keeps each variant in view
// (FLOOR of the time a variant is picked at random), so the audience can
// change its mind. The draws come from a generator seeded by the viewer, the
// cast and the day: one viewer sees the same thumbnail all day.

/** The share of showings a variant gets regardless of its record. */
export const FLOOR = 0.1;

/** A small seeded generator (mulberry32): the same seed, the same draws. */
export function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A string's 32-bit hash (FNV-1a), for seeding. */
export function hash32(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function normal(rand: () => number): number {
  const u = Math.max(rand(), 1e-12);
  const v = rand();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/** A Gamma(k, 1) draw (Marsaglia–Tsang; k < 1 boosted). */
function gamma(k: number, rand: () => number): number {
  if (k < 1) return gamma(k + 1, rand) * Math.pow(Math.max(rand(), 1e-12), 1 / k);
  const d = k - 1 / 3;
  const c = 1 / Math.sqrt(9 * d);
  for (;;) {
    let x: number;
    let v: number;
    do {
      x = normal(rand);
      v = 1 + c * x;
    } while (v <= 0);
    v = v * v * v;
    const u = rand();
    if (u < 1 - 0.0331 * x ** 4 || Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
  }
}

/** A Beta(a, b) draw. */
export function beta(a: number, b: number, rand: () => number): number {
  const x = gamma(a, rand);
  const y = gamma(b, rand);
  return x / (x + y);
}

/**
 * The variant to show (0 = the cast's first thumbnail): one of `n`, from the
 * counts per variant (missing ones read as nothing shown yet).
 */
export function chooseVariant(n: number, counts: readonly (readonly [number, number])[] | undefined, rand: () => number): number {
  if (n <= 1) return 0;
  if (rand() < FLOOR) return Math.min(n - 1, Math.floor(rand() * n));
  let best = 0;
  let bestDraw = -1;
  for (let i = 0; i < n; i++) {
    const [shown, clicks] = counts?.[i] ?? [0, 0];
    const c = Math.max(0, Math.min(clicks, shown));
    const draw = beta(c + 1, Math.max(0, shown - c) + 1, rand);
    if (draw > bestDraw) {
      bestDraw = draw;
      best = i;
    }
  }
  return best;
}
