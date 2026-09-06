// Pure geometry for the anatomy atlas build. Points are [x, y] arrays; rings
// are closed polygons whose first point is NOT repeated at the end (the
// convention sampleSvgPath and kit.polygon share). Every function returns
// new arrays and never mutates its input.

/** Douglas–Peucker perpendicular-distance simplification. Keeps both endpoints;
 *  a ring keeps at least three points. */
export function simplify(pts, tol) {
  if (pts.length <= 3) return pts.map((p) => [p[0], p[1]]);
  const sqTol = tol * tol;
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [lo, hi] = stack.pop();
    let worst = 0;
    let idx = -1;
    const [ax, ay] = pts[lo];
    const [bx, by] = pts[hi];
    const dx = bx - ax;
    const dy = by - ay;
    const len = dx * dx + dy * dy;
    for (let i = lo + 1; i < hi; i++) {
      const [px, py] = pts[i];
      let t = len > 0 ? ((px - ax) * dx + (py - ay) * dy) / len : 0;
      t = Math.max(0, Math.min(1, t));
      const qx = ax + t * dx;
      const qy = ay + t * dy;
      const d = (px - qx) * (px - qx) + (py - qy) * (py - qy);
      if (d > worst) {
        worst = d;
        idx = i;
      }
    }
    if (worst > sqTol && idx > 0) {
      keep[idx] = 1;
      stack.push([lo, idx], [idx, hi]);
    }
  }
  const out = pts.filter((_, i) => keep[i]).map((p) => [p[0], p[1]]);
  if (out.length >= 3) return out;
  // Too aggressive for a ring: keep the two endpoints plus the farthest point.
  let far = 1, farD = -1;
  for (let i = 1; i < pts.length - 1; i++) {
    const d = Math.hypot(pts[i][0] - pts[0][0], pts[i][1] - pts[0][1]);
    if (d > farD) { farD = d; far = i; }
  }
  return [pts[0], pts[far], pts[pts.length - 1]].map((p) => [p[0], p[1]]);
}

/** Shoelace area, always positive. */
export function ringArea(pts) {
  let a = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    a += (pts[j][0] + pts[i][0]) * (pts[j][1] - pts[i][1]);
  }
  return Math.abs(a / 2);
}

/** Vertex-average centroid over every ring given. */
export function centroid(rings) {
  let sx = 0, sy = 0, n = 0;
  for (const r of rings) for (const [x, y] of r) { sx += x; sy += y; n++; }
  return n > 0 ? [sx / n, sy / n] : [0, 0];
}

/** Andrew's monotone chain. Returns the hull counter-clockwise (y-down: visually clockwise). */
export function convexHull(points) {
  const pts = points.map((p) => [p[0], p[1]]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (pts.length <= 3) return pts;
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  return lower.slice(0, -1).concat(upper.slice(0, -1));
}

/** An organic ellipse: deterministic low-frequency wobble so organs never read
 *  as geometric ellipses. rot in degrees. */
export function blob({ c, rx, ry, rot = 0, wobble = 0, seed = 0, n = 48 }) {
  const pts = [];
  const a = (rot * Math.PI) / 180;
  for (let i = 0; i < n; i++) {
    const t = (i / n) * 2 * Math.PI;
    const w = wobble ? 1 + wobble * Math.sin(3 * t + seed) * Math.cos(2 * t + seed) : 1;
    const x = Math.cos(t) * rx * w;
    const y = Math.sin(t) * ry * w;
    pts.push([c[0] + x * Math.cos(a) - y * Math.sin(a), c[1] + x * Math.sin(a) + y * Math.cos(a)]);
  }
  return pts;
}

/** Sweep an open centre line into a closed ring `width` wide: the left offset
 *  forward, then the right offset backward, with a flat cap at each end. At an
 *  interior vertex the offset runs along the averaged normal of the two
 *  adjacent segments, lengthened to the miter (1 / cos of half the turn) so the
 *  tube keeps its width through a bend; the lengthening is capped at 2× so a
 *  hairpin cannot spike. */
export function tube(path, width) {
  const h = width / 2;
  const n = path.length;
  const normals = [];
  for (let i = 0; i < n - 1; i++) {
    const dx = path[i + 1][0] - path[i][0];
    const dy = path[i + 1][1] - path[i][1];
    const len = Math.hypot(dx, dy) || 1;
    normals.push([-dy / len, dx / len]);
  }
  const at = (i) => {
    if (i === 0) return normals[0];
    if (i === n - 1) return normals[n - 2];
    const [ax, ay] = normals[i - 1];
    const [bx, by] = normals[i];
    const mx = ax + bx, my = ay + by;
    const len = Math.hypot(mx, my) || 1;
    const ux = mx / len, uy = my / len;
    const miter = Math.min(2, 1 / Math.max(0.5, ux * ax + uy * ay));
    return [ux * miter, uy * miter];
  };
  const left = [], right = [];
  for (let i = 0; i < n; i++) {
    const [nx, ny] = at(i);
    left.push([path[i][0] + nx * h, path[i][1] + ny * h]);
    right.push([path[i][0] - nx * h, path[i][1] - ny * h]);
  }
  return left.concat(right.reverse());
}

/** The nearest pair of vertices between two point sets. */
export function closestPair(a, b) {
  let best = { p: a[0], q: b[0], d: Infinity };
  for (const p of a) for (const q of b) {
    const d = Math.hypot(p[0] - q[0], p[1] - q[1]);
    if (d < best.d) best = { p, q, d };
  }
  return { p: [best.p[0], best.p[1]], q: [best.q[0], best.q[1]], d: best.d };
}

export const round1 = (pts) => pts.map(([x, y]) => [Math.round(x * 10) / 10, Math.round(y * 10) / 10]);
