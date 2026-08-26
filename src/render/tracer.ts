// Deterministic image → trace for portrait elements. Takes an ImageData-
// shaped raster (RGBA bytes — no DOM canvas needed, so tests run in plain
// node) and produces trace shapes in one of two looks:
//
//   "poster" (default) — the stencil/screen-print portrait: the image is
//   posterized into 2–3 tones, region BOUNDARIES are traced (flood-fill
//   components + Moore boundary walking), simplified and Chaikin-smoothed
//   into flowing closed contours, and emitted as wash (mid-tone), fill
//   (ink) and paper (holes: eyes, highlights) shapes — the chess-piece
//   idiom, few large smooth shapes.
//
//   "line" — the pen sketch: grayscale → Sobel edges → percentile
//   threshold → chain-following → Douglas-Peucker, plus hachure shading of
//   dark regions. Suits line art and engravings more than photographs.
//
// No randomness and no clock anywhere: the same pixels always give the
// same shapes — the sketchy wobble is the renderer's job, not the tracer's.

import type { PortraitTrace, TraceShape } from "../spec/trace";

export interface TraceOpts {
  /** Which look to produce (default "poster"). */
  style?: "poster" | "line";
  /** TOTAL shape budget — most important shapes first (default 110). */
  maxStrokes?: number;
  /** line: edge threshold percentile 0..1 (default 0.82). */
  percentile?: number;
  /** line: hachure shading of dark regions (default true). */
  shading?: boolean;
}

/** ImageData-shaped input: RGBA bytes, so tests need no DOM canvas. */
export interface RasterLike {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

/** [dx, dy] pixel offsets — the fixed 8-neighbor probing order for walks. */
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
  const out: [number, number][] = [];
  for (let i = 0; i < chain.length; i++) if (keep[i] === 1) out.push(chain[i]);
  return out;
}

/** Chaikin corner cutting on a CLOSED polygon — the smoothness of the poster look. */
function chaikinClosed(pts: [number, number][], iterations: number): [number, number][] {
  let cur = pts;
  for (let it = 0; it < iterations; it++) {
    if (cur.length < 3) return cur;
    const next: [number, number][] = [];
    for (let i = 0; i < cur.length; i++) {
      const a = cur[i];
      const b = cur[(i + 1) % cur.length];
      next.push([0.75 * a[0] + 0.25 * b[0], 0.75 * a[1] + 0.25 * b[1]]);
      next.push([0.25 * a[0] + 0.75 * b[0], 0.25 * a[1] + 0.75 * b[1]]);
    }
    cur = next;
  }
  return cur;
}

function grayscale(img: RasterLike): Float64Array {
  const { width: w, height: h, data } = img;
  const lum = new Float64Array(w * h);
  for (let i = 0; i < w * h; i++) {
    lum[i] = 0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2];
  }
  return lum;
}

/** One 3×3 box-blur pass (border pixels keep their value). */
function blur3(lum: Float64Array, w: number, h: number): Float64Array {
  const out = new Float64Array(lum.length);
  out.set(lum);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      let sum = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) sum += lum[(y + dy) * w + (x + dx)];
      out[y * w + x] = sum / 9;
    }
  }
  return out;
}

function percentileOf(values: Float64Array, q: number): number {
  const sorted = Array.from(values).sort((a, b) => a - b);
  return sorted[Math.max(0, Math.min(sorted.length - 1, Math.floor(q * sorted.length)))];
}

interface Component {
  size: number;
  pixels: number[];
  touchesBorder: boolean;
  /** Top-left-most pixel (row-major first). */
  start: number;
}

/** 4-connected components of mask (mask[i] = 1). */
function components(mask: Uint8Array, w: number, h: number): Component[] {
  const seen = new Uint8Array(mask.length);
  const out: Component[] = [];
  for (let i = 0; i < mask.length; i++) {
    if (mask[i] === 0 || seen[i] === 1) continue;
    const stack = [i];
    seen[i] = 1;
    const comp: Component = { size: 0, pixels: [], touchesBorder: false, start: i };
    while (stack.length > 0) {
      const p = stack.pop()!;
      comp.size++;
      comp.pixels.push(p);
      const x = p % w;
      const y = (p / w) | 0;
      if (x === 0 || y === 0 || x === w - 1 || y === h - 1) comp.touchesBorder = true;
      const neighbors = [p - 1, p + 1, p - w, p + w];
      const valid = [x > 0, x < w - 1, y > 0, y < h - 1];
      for (let k = 0; k < 4; k++) {
        const n = neighbors[k];
        if (valid[k] && mask[n] === 1 && seen[n] === 0) {
          seen[n] = 1;
          stack.push(n);
        }
      }
    }
    out.push(comp);
  }
  return out;
}

/** Moore-neighbor boundary trace of one component, clockwise, closed. */
function boundary(mask: Uint8Array, w: number, h: number, start: number): [number, number][] {
  const inside = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < w && y < h && mask[y * w + x] === 1;
  const sx = start % w;
  const sy = (start / w) | 0;
  const contour: [number, number][] = [[sx, sy]];
  let cx = sx;
  let cy = sy;
  let dir = 6; // came from above (start is top-left-most: nothing above)
  const LIMIT = 4 * (w + h) + 4 * contour.length + 8 * mask.length;
  for (let step = 0; step < LIMIT; step++) {
    let found = false;
    for (let k = 0; k < 8; k++) {
      const probe = (dir + 6 + k) % 8; // start looking backwards-left of travel
      const [dx, dy] = OFFSETS[probe];
      if (inside(cx + dx, cy + dy)) {
        cx += dx;
        cy += dy;
        dir = probe;
        found = true;
        break;
      }
    }
    if (!found) break; // isolated pixel
    if (cx === sx && cy === sy) break;
    contour.push([cx, cy]);
  }
  return contour;
}

/** Shared normalization: pixel coords → x in [0,1], y-up in [0, aspect]. */
function normalize(chains: { kind: TraceShape["kind"]; pts: [number, number][] }[], w: number, h: number): TraceShape[] {
  const aspect = h / w;
  const round5 = (v: number): number => Math.round(v * 100000) / 100000;
  return chains.map(({ kind, pts }) => ({
    kind,
    pts: pts.map(([px, py]): [number, number] => [round5(px / (w - 1)), round5((1 - py / (h - 1)) * aspect)]),
  }));
}

// ---- the poster look ------------------------------------------------------

function tracePoster(img: RasterLike, maxShapes: number): PortraitTrace {
  const w = img.width;
  const h = img.height;
  const aspect = h / w;
  let lum = grayscale(img);
  lum = blur3(blur3(lum, w, h), w, h);

  // Percentiles adapt to each photo's tonal range, but CLAMPED to sane
  // absolute luminance — a mostly-white image would otherwise put its 30th
  // percentile at white and declare everything ink.
  const clampT = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));
  const tInk = clampT(percentileOf(lum, 0.3), 40, 130);
  const tMid = clampT(percentileOf(lum, 0.55), tInk + 15, 190);
  const inkMask = new Uint8Array(w * h);
  const midMask = new Uint8Array(w * h);
  const lightMask = new Uint8Array(w * h);
  for (let i = 0; i < lum.length; i++) {
    if (lum[i] <= tInk) inkMask[i] = 1;
    if (lum[i] <= tMid) midMask[i] = 1;
    if (inkMask[i] === 0) lightMask[i] = 1;
  }

  const minArea = Math.max(12, Math.round(w * h * 0.0035));
  const contourOf = (mask: Uint8Array, comp: Component): [number, number][] => {
    const raw = boundary(mask, w, h, comp.start);
    const eps = Math.max(1.2, Math.min(w, h) / 130);
    return chaikinClosed(simplify(raw, eps), 2);
  };

  const chains: { kind: TraceShape["kind"]; pts: [number, number][]; weight: number }[] = [];
  // Mid-tone washes (under everything).
  for (const comp of components(midMask, w, h)) {
    if (comp.size < minArea) continue;
    const pts = contourOf(midMask, comp);
    if (pts.length >= 3) chains.push({ kind: "wash", pts, weight: comp.size });
  }
  // Ink fills.
  for (const comp of components(inkMask, w, h)) {
    if (comp.size < minArea) continue;
    const pts = contourOf(inkMask, comp);
    if (pts.length >= 3) chains.push({ kind: "fill", pts, weight: comp.size });
  }
  // Paper holes: light regions fully ENCLOSED (not touching the border) —
  // eyes, teeth, highlights punched back out of the dark shapes.
  for (const comp of components(lightMask, w, h)) {
    if (comp.touchesBorder || comp.size < Math.max(6, minArea / 3)) continue;
    const pts = contourOf(lightMask, comp);
    if (pts.length >= 3) chains.push({ kind: "paper", pts, weight: comp.size });
  }

  chains.sort((a, b) => b.weight - a.weight);
  return { aspect, shapes: normalize(chains.slice(0, maxShapes), w, h) };
}

// ---- the line look --------------------------------------------------------

function traceLines(img: RasterLike, maxStrokes: number, rawPct: number, shading: boolean): PortraitTrace {
  const w = img.width;
  const h = img.height;
  const aspect = h / w;
  const percentile = rawPct < 0 ? 0 : rawPct > 1 ? 1 : rawPct;
  const lum = grayscale(img);

  const mag = new Float64Array(w * h);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const gx =
        -lum[i - w - 1] + lum[i - w + 1] - 2 * lum[i - 1] + 2 * lum[i + 1] - lum[i + w - 1] + lum[i + w + 1];
      const gy =
        -lum[i - w - 1] - 2 * lum[i - w] - lum[i - w + 1] + lum[i + w - 1] + 2 * lum[i + w] + lum[i + w + 1];
      mag[i] = Math.hypot(gx, gy);
    }
  }
  const nonzero = Array.from(mag).filter((v) => v > 0).sort((a, b) => a - b);
  if (nonzero.length === 0) return { aspect, shapes: [] };
  const threshold = nonzero[Math.min(nonzero.length - 1, Math.floor(percentile * nonzero.length))];

  const edge = new Uint8Array(w * h);
  for (let i = 0; i < mag.length; i++) if (mag[i] >= threshold && mag[i] > 0) edge[i] = 1;

  const visited = new Uint8Array(w * h);
  const walk = (chain: [number, number][]): void => {
    for (;;) {
      const [cx, cy] = chain[chain.length - 1];
      let next: [number, number] | null = null;
      for (const [dx, dy] of OFFSETS) {
        const nx = cx + dx;
        const ny = cy + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const i = ny * w + nx;
        if (edge[i] === 1 && visited[i] === 0) {
          next = [nx, ny];
          visited[i] = 1;
          break;
        }
      }
      if (!next) return;
      chain.push(next);
    }
  };

  const chainsRaw: [number, number][][] = [];
  for (let i = 0; i < edge.length; i++) {
    if (edge[i] === 0 || visited[i] === 1) continue;
    visited[i] = 1;
    const chain: [number, number][] = [[i % w, (i / w) | 0]];
    walk(chain);
    chain.reverse();
    walk(chain);
    if (chain.length >= 5) chainsRaw.push(chain);
  }

  chainsRaw.sort((a, b) => b.length - a.length);
  const kept = chainsRaw.slice(0, Math.max(0, maxStrokes));

  const hatched: [number, number][][] = [];
  if (shading) {
    const budget = Math.min(70, Math.max(0, maxStrokes - kept.length));
    const DARK = 80;
    const SPACING = 5;
    const MIN_RUN = 4;
    for (let c = SPACING; c < w + h - 1 && hatched.length < budget; c += SPACING) {
      let run: [number, number][] = [];
      const flush = (): void => {
        if (run.length >= MIN_RUN && hatched.length < budget) {
          hatched.push([run[0], run[run.length - 1]]);
        }
        run = [];
      };
      for (let x = Math.max(0, c - (h - 1)); x <= Math.min(w - 1, c); x++) {
        const y = c - x;
        if (lum[y * w + x] < DARK) run.push([x, y]);
        else flush();
      }
      flush();
    }
  }

  const epsilon = Math.max(0.8, Math.min(w, h) / 220);
  const all = [...kept.map((chain) => simplify(chain, epsilon)), ...hatched];
  return { aspect, shapes: normalize(all.map((pts) => ({ kind: "line" as const, pts })), w, h) };
}

export function traceImage(img: RasterLike, opts?: TraceOpts): PortraitTrace {
  const maxStrokes = opts?.maxStrokes ?? 110;
  if ((opts?.style ?? "poster") === "poster") return tracePoster(img, maxStrokes);
  return traceLines(img, maxStrokes, opts?.percentile ?? 0.82, opts?.shading !== false);
}
