// Math in a book's text pane: the engine's own MathJax 4 in the figures' math
// font (Fira Math), drawn as inline SVG on the text's baseline — so a formula
// in the text and one in the figure are the same hand. (A separate MathJax
// from a CDN, tried in the mock, wrote in another font and clashed.)

import { ensureEngines, ensureMathFont, getLoadedEngines, type MathJaxEngine } from "../scenes/engines";

let engine: MathJaxEngine | null = null;
let loading: Promise<void> | null = null;

/** Load the math engine once; texSvg draws plain code until it is in. */
export function loadBookMath(): Promise<void> {
  loading ??= (async () => {
    await ensureEngines(["mathjax"]);
    await ensureMathFont("fira");
    engine = (getLoadedEngines(["mathjax"]) as { mathjax?: MathJaxEngine }).mathjax ?? null;
  })().catch(() => {
    engine = null;
  });
  return loading;
}

/** layoutTeX is height-normalised (1 ≈ the x-height); the handwriting's
 *  x-height is about half an em. */
const EM_PER_UNIT = 0.5;

const escapeText = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");

/** One formula as an inline SVG sized in em, sitting on the baseline. */
export function texSvg(tex: string, display: boolean): string {
  if (!engine) return `<code class="bk-tex-fallback">${escapeText(tex)}</code>`;
  let outlines;
  try {
    outlines = engine.layoutTeX(tex, { display, font: engine.fontFor("fira") }).outlines;
  } catch {
    return `<code class="bk-tex-fallback">${escapeText(tex)}</code>`;
  }
  let x0 = Infinity;
  let x1 = -Infinity;
  let y0 = Infinity;
  let y1 = -Infinity;
  for (const o of outlines) {
    for (const ring of [o.pts, ...(o.holes ?? [])]) {
      for (const [x, y] of ring) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  if (!Number.isFinite(x0)) return "";
  // Outlines are y-up (the canvas convention); SVG is y-down: flip about y1.
  const ring = (pts: [number, number][]): string => "M" + pts.map(([x, y]) => `${(x - x0).toFixed(3)},${(y1 - y).toFixed(3)}`).join("L") + "Z";
  const d = outlines.map((o) => [o.pts, ...(o.holes ?? [])].map(ring).join("")).join("");
  const w = x1 - x0;
  const h = y1 - y0;
  const k = EM_PER_UNIT * (display ? 1.25 : 1);
  return (
    `<svg class="bk-tex" viewBox="0 0 ${w.toFixed(3)} ${h.toFixed(3)}" fill-rule="evenodd" aria-label="${escapeText(tex)}" role="img"` +
    ` style="width:${(w * k).toFixed(3)}em;height:${(h * k).toFixed(3)}em;vertical-align:${(y0 * k).toFixed(3)}em"><path d="${d}"/></svg>`
  );
}
