// SVG path data → polylines. Written for the MathJax engine (engines.ts):
// font glyphs arrive as filled outlines, and drawcast draws polylines, so the
// curves have to be flattened. Kept general enough for any path data a font
// emits — MathJax's TeX fonts use M/L/H/V/Q/T/Z (and C/S in a few glyphs),
// never arcs.

type Pt = [number, number];

/** Segments per curve. 8 is invisible at glyph size and keeps rings small. */
const CURVE_SEGMENTS = 8;

const TOKEN = /([MmLlHhVvCcSsQqTtAaZz])|(-?(?:\d*\.\d+|\d+\.?)(?:[eE][+-]?\d+)?)/g;
const EPS = 1e-9;

/**
 * Flatten path data into one closed ring per subpath — kit.polygon's
 * convention: the first point is NOT repeated at the end, the caller closes.
 * Rings with fewer than 3 points enclose no area and are dropped.
 */
export function sampleSvgPath(d: string, segments = CURVE_SEGMENTS): Pt[][] {
  const cmds: (string | number)[] = [];
  for (const m of d.matchAll(TOKEN)) cmds.push(m[1] ?? Number(m[2]));

  const rings: Pt[][] = [];
  let ring: Pt[] = [];
  let cx = 0, cy = 0;          // current point
  let sx = 0, sy = 0;          // start of the current subpath
  let ccx = 0, ccy = 0;        // last cubic control point (for S)
  let qcx = 0, qcy = 0;        // last quadratic control point (for T)
  let prev = "";
  let i = 0;

  const push = (x: number, y: number) => {
    const last = ring[ring.length - 1];
    if (!last || Math.abs(last[0] - x) > EPS || Math.abs(last[1] - y) > EPS) ring.push([x, y]);
    cx = x; cy = y;
  };
  const closeRing = () => {
    // Drop a closing point that lands back on the start — the ring is implicitly closed.
    while (ring.length > 1) {
      const a = ring[0], b = ring[ring.length - 1];
      if (Math.abs(a[0] - b[0]) > EPS || Math.abs(a[1] - b[1]) > EPS) break;
      ring.pop();
    }
    if (ring.length >= 3) rings.push(ring);
    ring = [];
  };
  const num = (): number => {
    const v = cmds[i++];
    if (typeof v !== "number") throw new Error(`malformed SVG path data near "${String(v ?? "end")}"`);
    return v;
  };
  const cubic = (x1: number, y1: number, x2: number, y2: number, x: number, y: number) => {
    const x0 = cx, y0 = cy;
    for (let s = 1; s <= segments; s++) {
      const t = s / segments, u = 1 - t;
      push(
        u * u * u * x0 + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t * x,
        u * u * u * y0 + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * y,
      );
    }
    ccx = x2; ccy = y2;
  };
  const quad = (x1: number, y1: number, x: number, y: number) => {
    const x0 = cx, y0 = cy;
    for (let s = 1; s <= segments; s++) {
      const t = s / segments, u = 1 - t;
      push(u * u * x0 + 2 * u * t * x1 + t * t * x, u * u * y0 + 2 * u * t * y1 + t * t * y);
    }
    qcx = x1; qcy = y1;
  };

  while (i < cmds.length) {
    const tok = cmds[i];
    // A bare number repeats the previous command (implicit lineto after M).
    const cmd = typeof tok === "string" ? (i++, tok) : prev === "M" ? "L" : prev === "m" ? "l" : prev;
    // Numbers trailing a command that takes none (or leading the data) would
    // spin this loop forever — refuse them instead.
    if (typeof tok === "number" && (cmd === "" || cmd.toUpperCase() === "Z")) {
      throw new Error(`malformed SVG path data near "${tok}"`);
    }
    const rel = cmd === cmd.toLowerCase();
    const ox = rel ? cx : 0, oy = rel ? cy : 0;
    switch (cmd.toUpperCase()) {
      case "M": {
        closeRing();
        push(ox + num(), oy + num());
        sx = cx; sy = cy;
        break;
      }
      case "L": push(ox + num(), oy + num()); break;
      case "H": push(ox + num(), cy); break;
      case "V": push(cx, oy + num()); break;
      case "C": cubic(ox + num(), oy + num(), ox + num(), oy + num(), ox + num(), oy + num()); break;
      case "S": {
        const smooth = prev.toUpperCase() === "C" || prev.toUpperCase() === "S";
        cubic(smooth ? 2 * cx - ccx : cx, smooth ? 2 * cy - ccy : cy, ox + num(), oy + num(), ox + num(), oy + num());
        break;
      }
      case "Q": quad(ox + num(), oy + num(), ox + num(), oy + num()); break;
      case "T": {
        const smooth = prev.toUpperCase() === "Q" || prev.toUpperCase() === "T";
        quad(smooth ? 2 * cx - qcx : cx, smooth ? 2 * cy - qcy : cy, ox + num(), oy + num());
        break;
      }
      case "Z": closeRing(); cx = sx; cy = sy; break;
      default: throw new Error(`unsupported SVG path command "${cmd}"`);
    }
    // A trailing number is a repeated coordinate set ("L1 2 3 4") — the top of
    // the loop re-runs `prev` for it.
    prev = cmd;
  }
  closeRing();
  return rings;
}
