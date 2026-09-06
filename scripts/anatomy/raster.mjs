// A coverage mask over a rectangle of the atlas space. Projected triangles are
// scan-filled into it; d3-contour then traces the 0.5 isoline, which gives the
// union of everything filled as polygons WITH holes — the orbits of a skull,
// the gap between an arm and the torso — for free, at whatever resolution the
// cell size sets. This replaces polygon union: 79 MB of skin and 117 gyri are
// no trouble for a bitmap.

import { contours } from "d3-contour";

export class Mask {
  /** width/height in cells; cell = atlas units per cell; origin = atlas coords of cell (0,0). */
  constructor(width, height, cell, origin = [0, 0]) {
    this.width = width;
    this.height = height;
    this.cell = cell;
    this.origin = origin;
    this.data = new Uint8Array(width * height);
  }

  toCell(p) {
    return [(p[0] - this.origin[0]) / this.cell, (p[1] - this.origin[1]) / this.cell];
  }

  /** Scan-fill one triangle given in atlas units. Cells whose centre is inside are set. */
  fillTriangle(a, b, c) {
    const [ax, ay] = this.toCell(a), [bx, by] = this.toCell(b), [cx, cy] = this.toCell(c);
    const y0 = Math.max(0, Math.floor(Math.min(ay, by, cy)));
    const y1 = Math.min(this.height - 1, Math.ceil(Math.max(ay, by, cy)));
    const area = (bx - ax) * (cy - ay) - (cx - ax) * (by - ay);
    if (Math.abs(area) < 1e-12) return; // degenerate
    for (let row = y0; row <= y1; row++) {
      const py = row + 0.5;
      // x-extent of the triangle on this scanline, via edge intersections
      let xl = Infinity, xr = -Infinity;
      const edge = (px0, py0, px1, py1) => {
        if ((py0 <= py && py1 > py) || (py1 <= py && py0 > py)) {
          const t = (py - py0) / (py1 - py0);
          const x = px0 + t * (px1 - px0);
          if (x < xl) xl = x;
          if (x > xr) xr = x;
        }
      };
      edge(ax, ay, bx, by); edge(bx, by, cx, cy); edge(cx, cy, ax, ay);
      if (xl > xr) continue;
      const c0 = Math.max(0, Math.ceil(xl - 0.5));
      const c1 = Math.min(this.width - 1, Math.floor(xr - 0.5));
      for (let col = c0; col <= c1; col++) this.data[row * this.width + col] = 1;
    }
  }

  /** Clear every cell set in `other` (same geometry required). */
  subtract(other) {
    for (let i = 0; i < this.data.length; i++) if (other.data[i]) this.data[i] = 0;
  }

  /** Number of set cells. */
  covered() {
    let n = 0;
    for (let i = 0; i < this.data.length; i++) n += this.data[i];
    return n;
  }

  /** Polygons of the covered region, in atlas units: [{ outer, holes }]. */
  rings() {
    const gen = contours().size([this.width, this.height]).thresholds([0.5]).smooth(true);
    const [multi] = gen(this.data);
    const toAtlas = (ring) => ring.slice(0, -1).map(([cx, cy]) => [this.origin[0] + cx * this.cell, this.origin[1] + cy * this.cell]);
    const out = [];
    for (const poly of multi.coordinates) {
      const outer = toAtlas(poly[0]);
      if (outer.length < 3) continue;
      out.push({ outer, holes: poly.slice(1).map(toAtlas).filter((h) => h.length >= 3) });
    }
    return out;
  }
}
