// netlify/lib/thumb-render.mts
// The listing picture as a PNG (thumbnail round, 2026-10-04): thumb.mts's
// SVG, rasterised by resvg with the three faces it names — bundled as files
// beside the site's fonts (netlify.toml included_files), since a function
// has no Google Fonts.
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Resvg } from "@resvg/resvg-js";
import { thumbSvg, THUMB_W, type ThumbPlan } from "./thumb.mts";

const FACES = ["public/fonts/thumb/PermanentMarker-Regular.ttf", "public/fonts/thumb/Bangers-Regular.ttf", "public/fonts/patrickhand/PatrickHand-Regular.ttf"];

/** The faces' paths: the function's bundle keeps them where the repo has them. */
function fontFiles(): string[] {
  // The working directory (the repo locally, /var/task in the function), or up from this file.
  const roots = [process.cwd(), join(process.cwd(), ".."), "/var/task"];
  try {
    let d = dirname(fileURLToPath(import.meta.url));
    for (let i = 0; i < 6; i++, d = dirname(d)) roots.push(d);
  } catch {
    /* no file URL in a bundle: the roots above */
  }
  for (const r of roots) {
    const files = FACES.map((f) => join(r, f));
    if (files.every((f) => existsSync(f))) return files;
  }
  return [];
}

let fonts: string[] | null = null;

/** The PNG for `plan` over `poster` (PNG bytes). Throws when it cannot draw — the caller then serves the poster as it is. */
export function renderThumb(plan: ThumbPlan, poster: Uint8Array): Uint8Array {
  fonts ??= fontFiles();
  if (fonts.length === 0) throw new Error("thumb fonts not found");
  const href = `data:image/png;base64,${Buffer.from(poster).toString("base64")}`;
  const svg = thumbSvg(plan, href);
  const r = new Resvg(svg, {
    fitTo: { mode: "width", value: THUMB_W },
    font: { fontFiles: fonts, loadSystemFonts: false, defaultFontFamily: "Patrick Hand" },
  });
  return r.render().asPng();
}

/** For tests: read a file the way the function reads its fonts. */
export const _faces = (): string[] => fontFiles().map((f) => readFileSync(f).length.toString());
