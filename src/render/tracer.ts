// Deterministic image → strokes tracer for portrait elements. Takes an
// ImageData-shaped raster (RGBA bytes — no DOM canvas needed, so tests run
// in plain node) and produces the polyline strokes of a line drawing:
// grayscale → Sobel edges → percentile threshold → chain-following →
// Douglas-Peucker simplification. No randomness and no clock anywhere, so
// the same pixels always give the same strokes — the sketchy wobble is the
// renderer's job, not the tracer's.

import type { PortraitTrace } from "../spec/trace";

export interface TraceOpts {
  /** Max strokes kept, longest first (default 110). */
  maxStrokes?: number;
  /** Edge threshold percentile 0..1 (default 0.82 — keep the top 18% strongest edges). */
  percentile?: number;
}

/** ImageData-shaped input: RGBA bytes, so tests need no DOM canvas. */
export interface RasterLike {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

/** [dx, dy] pixel offsets — the fixed 8-neighbor probing order for the walk. */
const OFFSETS: [number, number][] = [
  [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1],
];

/** Perpendicular distance from p to the segment a-b (point distance when a = b). */
function perpDist(p: [number, number], a: [number, number], b: [number, number]): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return Math.hypot(p[0] - a[0], p[1] - a[1]);
  let t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

/** Douglas-Peucker: drop points closer than epsilon to the local chord. */
function simplify(chain: [number, number][], epsilon: number): [number, number][] {
  if (chain.length <= 2) return chain.slice();
  const keep = new Uint8Array(chain.length);
  keep[0] = 1;
  keep[chain.length - 1] = 1;
  const stack: [number, number][] = [[0, chain.length - 1]];
  while (stack.length > 0) {
    const [a, b] = stack.pop()!;
    if (b - a < 2) continue;
    let maxD = -1;
    let maxI = -1;
    for (let i = a + 1; i < b; i++) {
      const d = perpDist(chain[i], chain[a], chain[b]);
      if (d > maxD) {
        maxD = d;
        maxI = i;
      }
    }
    if (maxD > epsilon) {
      keep[maxI] = 1;
      stack.push([a, maxI], [maxI, b]);
    }
  }
  return chain.filter((_, i) => keep[i] === 1);
}

/** Trace a raster into normalized line-drawing strokes (deterministic). */
export function traceImage(img: RasterLike, opts?: TraceOpts): PortraitTrace {
  const w = img.width;
  const h = img.height;
  const aspect = h / w;
  const maxStrokes = opts?.maxStrokes ?? 110;
  const rawPct = opts?.percentile ?? 0.82;
  const percentile = rawPct < 0 ? 0 : rawPct > 1 ? 1 : rawPct;

  // 1. Grayscale.
  const lum = new Float64Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const o = i * 4;
    lum[i] = 0.299 * img.data[o] + 0.587 * img.data[o + 1] + 0.114 * img.data[o + 2];
  }

  // 2. Sobel gradient magnitude (the 1px border stays 0).
  const mag = new Float64Array(w * h);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const gx =
        -lum[i - w - 1] + lum[i - w + 1]
        - 2 * lum[i - 1] + 2 * lum[i + 1]
        - lum[i + w - 1] + lum[i + w + 1];
      const gy =
        -lum[i - w - 1] - 2 * lum[i - w] - lum[i - w + 1]
        + lum[i + w - 1] + 2 * lum[i + w] + lum[i + w + 1];
      mag[i] = Math.sqrt(gx * gx + gy * gy);
    }
  }

  // 3. Threshold at the given percentile of the nonzero magnitudes.
  const nonzero: number[] = [];
  for (let i = 0; i < mag.length; i++) if (mag[i] > 0) nonzero.push(mag[i]);
  if (nonzero.length === 0) return { aspect, strokes: [] };
  nonzero.sort((a, b) => a - b);
  const threshold = nonzero[Math.floor(percentile * (nonzero.length - 1))];
  const edge = new Uint8Array(w * h);
  for (let i = 0; i < mag.length; i++) if (mag[i] >= threshold) edge[i] = 1;

  // 4. Edge map → pixel chains: walk unvisited 8-neighbors, preferring the
  // continuing direction, with one backwards extension from the start.
  const visited = new Uint8Array(w * h);

  function step(px: number, py: number, dx: number, dy: number): [number, number] | null {
    if (dx !== 0 || dy !== 0) {
      const nx = px + dx;
      const ny = py + dy;
      if (nx >= 0 && ny >= 0 && nx < w && ny < h && edge[ny * w + nx] === 1 && visited[ny * w + nx] === 0) {
        return [nx, ny];
      }
    }
    for (const [ox, oy] of OFFSETS) {
      if (ox === dx && oy === dy) continue;
      const nx = px + ox;
      const ny = py + oy;
      if (nx >= 0 && ny >= 0 && nx < w && ny < h && edge[ny * w + nx] === 1 && visited[ny * w + nx] === 0) {
        return [nx, ny];
      }
    }
    return null;
  }

  function walk(chain: [number, number][]): void {
    for (;;) {
      const n = chain.length;
      let dx = 0;
      let dy = 0;
      if (n >= 2) {
        dx = chain[n - 1][0] - chain[n - 2][0];
        dy = chain[n - 1][1] - chain[n - 2][1];
      }
      const next = step(chain[n - 1][0], chain[n - 1][1], dx, dy);
      if (next === null) return;
      visited[next[1] * w + next[0]] = 1;
      chain.push(next);
    }
  }

  const chains: [number, number][][] = [];
  for (let i = 0; i < w * h; i++) {
    if (edge[i] === 0 || visited[i] === 1) continue;
    visited[i] = 1;
    const chain: [number, number][] = [[i % w, (i / w) | 0]];
    walk(chain);
    chain.reverse();
    walk(chain);
    if (chain.length >= 5) chains.push(chain);
  }

  // 6 (before 5, same result): keep the longest chains by pixel count —
  // the sort key is the pre-simplification length either way.
  chains.sort((a, b) => b.length - a.length);
  const kept = chains.slice(0, Math.max(0, maxStrokes));

  // 5 + 7 + 8. Simplify, then normalize to x in [0,1], y-up in [0, aspect].
  const epsilon = Math.max(0.8, Math.min(w, h) / 220);
  const round5 = (v: number): number => Math.round(v * 100000) / 100000;
  const strokes = kept.map((chain) =>
    simplify(chain, epsilon).map(
      ([px, py]): [number, number] => [round5(px / (w - 1)), round5((1 - py / (h - 1)) * aspect)],
    ),
  );
  return { aspect, strokes };
}
