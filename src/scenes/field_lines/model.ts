// field_lines' physics: point charges in a plane, the field E = Σ q r̂ / r²
// and potential V = Σ q / r (units where k = 1, charges in units of q,
// distances in the figure's own units), field lines traced numerically, and
// equipotentials contoured. Pure and fast — the layout re-runs on every
// animate frame and every drag frame, so a whole figure (≤ 4 charges, ≤ 64
// lines, a contour grid) must trace in a few milliseconds.
//
// Lines start at positive charges, as many per unit of charge as the density
// says, spread evenly round each (half a gap off the line to the nearest
// charge, so none aims straight at a null point). A negative charge that
// more lines end on than positives send is topped up from infinity: lines
// traced BACKWARD from it, kept only when they do not end on a positive
// charge (those are already drawn). Gauss is kept: every charge has lines in
// proportion to |q|.
import type { Pt } from "../../layout/model";

export interface ChargeSpec {
  q: number;
  x: number;
  y: number;
  label?: string;
}

export interface FieldLinesParams {
  charges?: ChargeSpec[];
  density?: number;
  arrows?: boolean;
  equipotentials?: boolean;
  test_charge?: { x: number; y: number; q?: number; label?: string };
  title?: string;
}

/** The figure's own units: x −5.5…5.5, y −3.125…3.125, 80 logical units each. */
export const FRAME = Object.freeze({ x: [-5.5, 5.5] as [number, number], y: [-3.125, 3.125] as [number, number], box: Object.freeze({ x0: 60, y0: 150, x1: 940, y1: 650 }) });
export const PX = 80;
export const MAX_CHARGES = 4;
export const Q_MAX = 5;
export const MAX_LINES = 64;
export const DEFAULT_DENSITY = 8;
/** How close two charges may come (units). */
export const MIN_GAP = 0.6;

export interface Charge {
  q: number;
  x: number;
  y: number;
  label?: string;
  /** Radius of its disc, in units. */
  r: number;
  index: number;
}

const num = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

/** A charge's disc radius in logical units: bigger for more charge. */
export function discPx(q: number): number {
  return 17 + 3 * Math.min(Math.abs(q), Q_MAX);
}

/** Where a charge may stand: inside the frame, its disc clear of the edge. */
export function clampPos(x: number, y: number): Pt {
  return [clamp(x, FRAME.x[0] + 0.4, FRAME.x[1] - 0.4), clamp(y, FRAME.y[0] + 0.4, FRAME.y[1] - 0.4)];
}

export function readCharges(P: FieldLinesParams): Charge[] {
  const list = Array.isArray(P.charges) ? P.charges : [];
  const out: Charge[] = [];
  for (const c of list.slice(0, MAX_CHARGES)) {
    if (!c || typeof c !== "object") continue;
    const q = num(c.q) ? clamp(c.q, -Q_MAX, Q_MAX) : 1;
    const [x, y] = clampPos(num(c.x) ? c.x : 0, num(c.y) ? c.y : 0);
    out.push({ q, x, y, ...(typeof c.label === "string" && c.label.trim() ? { label: c.label.trim() } : {}), r: discPx(q) / PX, index: out.length });
  }
  return out;
}

/** E at (x, y) and the distance to the nearest charge. */
export function fieldAt(cs: readonly Charge[], x: number, y: number): { ex: number; ey: number; dmin: number } {
  let ex = 0,
    ey = 0,
    dmin = Infinity;
  for (const c of cs) {
    const dx = x - c.x,
      dy = y - c.y;
    const r2 = dx * dx + dy * dy;
    const r = Math.sqrt(r2);
    if (r < dmin) dmin = r;
    if (r < 1e-9 || c.q === 0) continue;
    const k = c.q / (r2 * r);
    ex += k * dx;
    ey += k * dy;
  }
  return { ex, ey, dmin };
}

/** V at (x, y). */
export function potentialAt(cs: readonly Charge[], x: number, y: number): number {
  let v = 0;
  for (const c of cs) {
    const r = Math.hypot(x - c.x, y - c.y);
    if (r > 1e-9) v += c.q / r;
  }
  return v;
}

export type LineEnd = { kind: "charge"; index: number } | { kind: "edge" } | { kind: "stall" };

export interface FieldLine {
  /** Units, in the direction of the field. */
  pts: Pt[];
  /** The charge it starts at (the positive one), or where it is seeded from (a negative, traced back). */
  from: number;
  /** Where the line (in the field's direction) ends: a charge, the edge, or a null point. */
  end: LineEnd;
  /** Seeded from a negative charge: the line comes in from the edge. */
  inward: boolean;
}

const MAX_STEPS = 1500;
const MAX_LEN = 30;

/**
 * One line from `start`, along the field (dir +1) or against it (−1), until
 * it reaches a charge that sinks it, leaves the frame, or stalls.
 */
export function traceLine(cs: readonly Charge[], start: Pt, dir: 1 | -1): { pts: Pt[]; end: LineEnd } {
  const pts: Pt[] = [start];
  let x = start[0],
    y = start[1];
  let px = 0,
    py = 0,
    hasPrev = false,
    len = 0;
  for (let step = 0; step < MAX_STEPS && len < MAX_LEN; step++) {
    const f = fieldAt(cs, x, y);
    const m = Math.hypot(f.ex, f.ey);
    if (!(m > 1e-7)) return { pts, end: { kind: "stall" } };
    const h = clamp(0.2 * f.dmin, 0.012, 0.1);
    const mx = x + (dir * f.ex * h) / (2 * m),
      my = y + (dir * f.ey * h) / (2 * m);
    const g = fieldAt(cs, mx, my);
    const gm = Math.hypot(g.ex, g.ey);
    if (!(gm > 1e-7)) return { pts, end: { kind: "stall" } };
    const ux = (dir * g.ex) / gm,
      uy = (dir * g.ey) / gm;
    // Past a null point the direction turns back on itself: stop there.
    if (hasPrev && ux * px + uy * py < -0.3) return { pts, end: { kind: "stall" } };
    x += ux * h;
    y += uy * h;
    len += h;
    px = ux;
    py = uy;
    hasPrev = true;
    // A charge that takes the line in (a negative one going forward, a positive one going back).
    for (const c of cs) {
      if (c.q * dir >= 0) continue;
      const dx = x - c.x,
        dy = y - c.y;
      const d = Math.hypot(dx, dy);
      if (d <= c.r + 0.02) {
        pts.push([c.x + (dx / d) * (c.r + 0.02), c.y + (dy / d) * (c.r + 0.02)]);
        return { pts, end: { kind: "charge", index: c.index } };
      }
    }
    if (x < FRAME.x[0] || x > FRAME.x[1] || y < FRAME.y[0] || y > FRAME.y[1]) {
      // Cut where the step crossed the frame's edge.
      const [ax, ay] = pts[pts.length - 1];
      let t = 1;
      if (x < FRAME.x[0]) t = Math.min(t, (FRAME.x[0] - ax) / (x - ax));
      if (x > FRAME.x[1]) t = Math.min(t, (FRAME.x[1] - ax) / (x - ax));
      if (y < FRAME.y[0]) t = Math.min(t, (FRAME.y[0] - ay) / (y - ay));
      if (y > FRAME.y[1]) t = Math.min(t, (FRAME.y[1] - ay) / (y - ay));
      pts.push([ax + (x - ax) * t, ay + (y - ay) * t]);
      return { pts, end: { kind: "edge" } };
    }
    pts.push([x, y]);
  }
  return { pts, end: { kind: "stall" } };
}

/** Lines per unit of charge, so that the whole figure stays within MAX_LINES. */
export function perUnit(cs: readonly Charge[], density: number): number {
  const total = cs.reduce((a, c) => a + Math.abs(c.q), 0);
  return total > 0 ? Math.min(density, MAX_LINES / total) : density;
}

/** Evenly spaced starting points round charge c, half a gap off its nearest neighbour. */
function seeds(cs: readonly Charge[], c: Charge, n: number): Pt[] {
  let base = 0,
    best = Infinity;
  for (const o of cs) {
    if (o === c) continue;
    const d = Math.hypot(o.x - c.x, o.y - c.y);
    if (d < best) {
      best = d;
      base = Math.atan2(o.y - c.y, o.x - c.x);
    }
  }
  const r = c.r + 0.03;
  const out: Pt[] = [];
  for (let k = 0; k < n; k++) {
    const a = base + ((k + 0.5) * 2 * Math.PI) / n;
    out.push([c.x + r * Math.cos(a), c.y + r * Math.sin(a)]);
  }
  return out;
}

export function traceField(cs: readonly Charge[], density = DEFAULT_DENSITY): FieldLine[] {
  const k = perUnit(cs, clamp(density, 1, 16));
  const lines: FieldLine[] = [];
  const ending = new Map<number, number>();
  for (const c of cs) {
    if (c.q <= 0) continue;
    const n = Math.max(1, Math.round(k * c.q));
    for (const s of seeds(cs, c, n)) {
      const t = traceLine(cs, s, 1);
      if (t.end.kind === "charge") ending.set(t.end.index, (ending.get(t.end.index) ?? 0) + 1);
      lines.push({ pts: t.pts, from: c.index, end: t.end, inward: false });
    }
  }
  for (const c of cs) {
    if (c.q >= 0) continue;
    const n = Math.max(1, Math.round(k * -c.q));
    if ((ending.get(c.index) ?? 0) >= n) continue;
    for (const s of seeds(cs, c, n)) {
      const t = traceLine(cs, s, -1);
      // Only a line that really comes in from the edge: one from a positive
      // charge is drawn already, and one that stalls at a null point is the
      // seam between the two (it belongs to neither).
      if (t.end.kind !== "edge") continue;
      lines.push({ pts: t.pts.slice().reverse(), from: c.index, end: { kind: "charge", index: c.index }, inward: true });
    }
  }
  return lines;
}

/** The equipotential levels drawn: a doubling ladder, and 0 when the charges have both signs. */
export function potentialLevels(cs: readonly Charge[]): number[] {
  const pos = cs.some((c) => c.q > 0);
  const neg = cs.some((c) => c.q < 0);
  const out: number[] = [];
  for (const v of [0.25, 0.5, 1, 2]) {
    if (pos) out.push(v);
    if (neg) out.push(-v);
  }
  if (pos && neg) out.push(0);
  return out.sort((a, b) => a - b);
}

/**
 * The contours V = level over the frame by marching squares on a grid of
 * `step` units, chained into polylines (units). Cells touching a charge's
 * disc are skipped (V is singular there).
 */
export function contours(cs: readonly Charge[], levels: readonly number[], step = 0.1): Pt[][] {
  const [x0, x1] = FRAME.x;
  const [y0, y1] = FRAME.y;
  const nx = Math.ceil((x1 - x0) / step);
  const ny = Math.ceil((y1 - y0) / step);
  const V = new Float64Array((nx + 1) * (ny + 1));
  const near = new Uint8Array((nx + 1) * (ny + 1));
  for (let j = 0; j <= ny; j++)
    for (let i = 0; i <= nx; i++) {
      const x = x0 + i * step,
        y = y0 + j * step;
      V[j * (nx + 1) + i] = potentialAt(cs, x, y);
      for (const c of cs) if (Math.hypot(x - c.x, y - c.y) < c.r + step) near[j * (nx + 1) + i] = 1;
    }
  const out: Pt[][] = [];
  for (const level of levels) {
    const segs: [Pt, Pt][] = [];
    for (let j = 0; j < ny; j++)
      for (let i = 0; i < nx; i++) {
        const idx = [j * (nx + 1) + i, j * (nx + 1) + i + 1, (j + 1) * (nx + 1) + i + 1, (j + 1) * (nx + 1) + i];
        if (idx.some((q) => near[q])) continue;
        const v = idx.map((q) => V[q] - level);
        const corners: Pt[] = [
          [x0 + i * step, y0 + j * step],
          [x0 + (i + 1) * step, y0 + j * step],
          [x0 + (i + 1) * step, y0 + (j + 1) * step],
          [x0 + i * step, y0 + (j + 1) * step],
        ];
        const cross: Pt[] = [];
        for (let e = 0; e < 4; e++) {
          const a = v[e],
            b = v[(e + 1) % 4];
          if ((a < 0) !== (b < 0)) {
            const t = a / (a - b);
            const p = corners[e],
              q = corners[(e + 1) % 4];
            cross.push([p[0] + t * (q[0] - p[0]), p[1] + t * (q[1] - p[1])]);
          }
        }
        if (cross.length === 2) segs.push([cross[0], cross[1]]);
        else if (cross.length === 4) {
          segs.push([cross[0], cross[1]]);
          segs.push([cross[2], cross[3]]);
        }
      }
    out.push(...chain(segs));
  }
  return out;
}

/** Join segments that share endpoints into polylines. */
export function chain(segs: [Pt, Pt][]): Pt[][] {
  const key = (p: Pt): string => `${Math.round(p[0] * 1e5)},${Math.round(p[1] * 1e5)}`;
  const at = new Map<string, number[]>();
  segs.forEach((s, i) => {
    for (const p of s) {
      const k = key(p);
      const l = at.get(k);
      if (l) l.push(i);
      else at.set(k, [i]);
    }
  });
  const used = new Uint8Array(segs.length);
  const out: Pt[][] = [];
  const extend = (line: Pt[]): void => {
    for (;;) {
      const tail = line[line.length - 1];
      const next = (at.get(key(tail)) ?? []).find((i) => !used[i]);
      if (next === undefined) return;
      used[next] = 1;
      const [a, b] = segs[next];
      line.push(key(a) === key(tail) ? b : a);
    }
  };
  for (let i = 0; i < segs.length; i++) {
    if (used[i]) continue;
    used[i] = 1;
    const line: Pt[] = [segs[i][0], segs[i][1]];
    extend(line);
    line.reverse();
    extend(line);
    out.push(line);
  }
  return out;
}

/** The field and potential at a point, as the figure writes them. */
export function probe(cs: readonly Charge[], x: number, y: number): { E: number; angle: number; ex: number; ey: number; V: number } {
  const f = fieldAt(cs, x, y);
  const E = Math.hypot(f.ex, f.ey);
  let angle = (Math.atan2(f.ey, f.ex) * 180) / Math.PI;
  if (angle < 0) angle += 360;
  return { E, angle, ex: f.ex, ey: f.ey, V: potentialAt(cs, x, y) };
}

/** Units → logical. */
export const toPx = ([x, y]: Pt): Pt => [FRAME.box.x0 + (x - FRAME.x[0]) * PX, FRAME.box.y0 + (y - FRAME.y[0]) * PX];
