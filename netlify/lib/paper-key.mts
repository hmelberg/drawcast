// netlify/lib/paper-key.mts
// A poster's paper made see-through (2026-10-07), so a thumbnail's
// background shows behind the drawing without tinting it: near-white,
// unsaturated pixels become transparent; the pixels just beside them (the
// soft edges of lines and letters, blended with white when drawn) are
// un-blended from white, so they keep their colour without a white halo.
// Everything else — ink, colours, pale fills — stays exactly as drawn.
// RGBA bytes in place; shared by the server (pngjs) and the browser (a canvas).

/** Paper: every channel at least this light, and nearly grey. */
const PAPER_MIN = 238;
const PAPER_SPREAD = 14;
/** How far from paper (pixels) edges are un-blended. */
const EDGE = 2;
/** Only edges lighter than this (in every channel) are un-blended: solid ink stays solid. */
const EDGE_MIN = 110;

export function keyPaper(rgba: Uint8Array | Uint8ClampedArray, w: number, h: number): void {
  const n = w * h;
  // distance (in pixels, up to EDGE + 1) from the nearest paper pixel
  const dist = new Uint8Array(n).fill(EDGE + 1);
  for (let i = 0; i < n; i++) {
    const p = i * 4;
    const lo = Math.min(rgba[p], rgba[p + 1], rgba[p + 2]);
    const hi = Math.max(rgba[p], rgba[p + 1], rgba[p + 2]);
    if (lo >= PAPER_MIN && hi - lo <= PAPER_SPREAD) dist[i] = 0;
  }
  for (let d = 1; d <= EDGE; d++)
    for (let i = 0; i < n; i++) {
      if (dist[i] < d) continue;
      const x = i % w;
      const y = (i / w) | 0;
      let near = false;
      for (let dy = -1; dy <= 1 && !near; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          const yy = y + dy;
          if (xx >= 0 && yy >= 0 && xx < w && yy < h && dist[yy * w + xx] === d - 1) {
            near = true;
            break;
          }
        }
      if (near) dist[i] = d;
    }
  for (let i = 0; i < n; i++) {
    const p = i * 4;
    if (dist[i] === 0) {
      rgba[p + 3] = 0;
    } else if (dist[i] <= EDGE && Math.min(rgba[p], rgba[p + 1], rgba[p + 2]) >= EDGE_MIN) {
      // colour to alpha against white: the least alpha that, over white, gives this pixel
      const a = Math.max(255 - rgba[p], 255 - rgba[p + 1], 255 - rgba[p + 2]) / 255;
      if (a <= 0) {
        rgba[p + 3] = 0;
        continue;
      }
      for (let c = 0; c < 3; c++) rgba[p + c] = Math.round(255 - (255 - rgba[p + c]) / a);
      rgba[p + 3] = Math.round(rgba[p + 3] * a);
    }
  }
}
