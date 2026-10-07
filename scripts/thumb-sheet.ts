// scripts/thumb-sheet.ts — a contact sheet of listing pictures (2026-10-07):
// each row a poster from the library, each column a thumb line, rendered
// through the server's own renderer (netlify/lib/thumb-render.mts), so what
// it shows is what /card/<name>.png serves.
//
//   npx tsx scripts/thumb-sheet.ts [out.png] [--lines 'band "x"|person …'] [--casts a,b]
import { writeFileSync } from "node:fs";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { planThumb } from "../netlify/lib/thumb.mts";
import { renderThumb } from "../netlify/lib/thumb-render.mts";

const arg = (n: string): string | undefined => {
  const i = process.argv.indexOf(n);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const out = process.argv[2] && !process.argv[2].startsWith("--") ? process.argv[2] : "dev-casts/thumb-sheet.png";
const LINES = (arg("--lines") ?? ['band "Not what you think"', 'band "Wait, really?" person surprised', "lilac person woman puzzled stamp \"MYTH?\"", 'glow yellow burst "Wow" person man 60', "solid teal person 9 note", 'question person old'].join("|")).split("|");
const CASTS = (arg("--casts") ?? "the-deadliest-animal,why-the-moon-never-lands,who-pays-a-ticket-tax,what-p-0-05-means,the-water-cycle").split(",");
const POSTER = (c: string): string => `https://hmelberg.github.io/drawcast-library/casts/${c.replace(/-by-hmelberg$/, "")}.png`;

const W = 400;
const H = 300;
const sheet = createCanvas(W * LINES.length, (H + 28) * CASTS.length + 28);
const g = sheet.getContext("2d");
g.fillStyle = "#fff";
g.fillRect(0, 0, sheet.width, sheet.height);
g.fillStyle = "#000";
g.font = "13px sans-serif";
LINES.forEach((l, i) => g.fillText(l.slice(0, 60), i * W + 6, 18));
for (const [r, cast] of CASTS.entries()) {
  const res = await fetch(POSTER(cast));
  if (!res.ok) {
    console.error(`${cast}: poster ${res.status}`);
    continue;
  }
  const poster = new Uint8Array(await res.arrayBuffer());
  for (const [c, line] of LINES.entries()) {
    const plan = planThumb(line, { title: cast.replace(/-/g, " ") });
    const png = renderThumb(plan, poster);
    const img = await loadImage(Buffer.from(png));
    const y = 28 + r * (H + 28);
    g.drawImage(img, c * W, y, W, H);
    g.fillStyle = "#000";
    g.fillText(`${cast.slice(0, 30)} · ${plan.bg}${plan.person ? " · " + plan.person : ""}`, c * W + 6, y + H + 18);
  }
}
writeFileSync(out, sheet.toBuffer("image/png"));
console.log(out);
