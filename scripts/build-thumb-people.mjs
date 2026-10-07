// Turn generated people photos (on flat chroma-key green) into the
// transparent cut-outs the thumbnails draw: key out the green, take the
// green fringe off the edges, crop to the person, scale to 640 px tall and
// write a 256-colour PNG (resvg can't decode WebP).
//
//   node scripts/build-thumb-people.mjs <raw-dir> [id …]
//
// Raw files are <raw-dir>/<id>.png; output is public/thumb-people/<id>.png.
// The catalogue (public/thumb-people/people.json) is edited by hand.

import fs from "node:fs";
import path from "node:path";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import UPNG from "upng-js";

const OUT_DIR = "public/thumb-people";
const HEIGHT = 640;
// greenness = g - max(r, b): below SOLID the pixel is the person, above
// CLEAR it is backdrop, in between it is an edge (hair, blur).
const SOLID = 15;
const CLEAR = 45;

function key(img) {
  const { data, width, height } = img;
  let x0 = width, y0 = height, x1 = -1, y1 = -1;
  for (let i = 0; i < width * height; i++) {
    const p = i * 4;
    const r = data[p], g = data[p + 1], b = data[p + 2];
    const green = g - Math.max(r, b);
    const a = green <= SOLID ? 1 : green >= CLEAR ? 0 : 1 - (green - SOLID) / (CLEAR - SOLID);
    // despill: no pixel of the person may be greener than its other channels
    data[p + 1] = Math.min(g, Math.max(r, b));
    data[p + 3] = Math.round(a * 255);
    if (a > 0.06) {
      const x = i % width, y = (i / width) | 0;
      if (x < x0) x0 = x; if (x > x1) x1 = x;
      if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
  }
  return { x0, y0, x1, y1 };
}

async function build(rawDir, id) {
  const src = await loadImage(fs.readFileSync(path.join(rawDir, `${id}.png`)));
  const c = createCanvas(src.width, src.height);
  const g = c.getContext("2d");
  g.drawImage(src, 0, 0);
  const img = g.getImageData(0, 0, src.width, src.height);
  const box = key(img);
  g.putImageData(img, 0, 0);
  const w = box.x1 - box.x0 + 1, h = box.y1 - box.y0 + 1;
  const scale = HEIGHT / h;
  const ow = Math.round(w * scale), oh = HEIGHT;
  const out = createCanvas(ow, oh);
  const og = out.getContext("2d");
  og.imageSmoothingQuality = "high";
  og.drawImage(c, box.x0, box.y0, w, h, 0, 0, ow, oh);
  const rgba = og.getImageData(0, 0, ow, oh).data;
  const png = UPNG.encode([rgba.buffer], ow, oh, 256);
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const file = path.join(OUT_DIR, `${id}.png`);
  fs.writeFileSync(file, Buffer.from(png));
  console.log(`${file}  ${ow}×${oh}  ${(png.byteLength / 1024).toFixed(0)} KB`);
}

const [rawDir, ...ids] = process.argv.slice(2);
if (!rawDir) {
  console.error("usage: node scripts/build-thumb-people.mjs <raw-dir> [id …]");
  process.exit(1);
}
const all = ids.length ? ids : fs.readdirSync(rawDir).filter((f) => f.endsWith(".png")).map((f) => f.slice(0, -4));
for (const id of all) await build(rawDir, id);
