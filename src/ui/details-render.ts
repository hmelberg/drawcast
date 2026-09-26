// The formal details on a card: a few sentences of prose with `$…$` inline
// math and `$$…$$` display math, drawn with the SAME MathJax engine and font
// the canvas uses (engines.ts layoutTeX → filled outlines), so a formula on
// the card looks like the formulas on the figure and nothing new is loaded
// but the engine itself — on first use, while the card is already open.

import { ensureEngines, getLoadedEngines, type MathJaxEngine } from "../scenes/engines";
import { h } from "./dom";

const SVG_NS = "http://www.w3.org/2000/svg";

/** Text and math runs of one paragraph, in order. Pure; exported for tests. */
export function detailRuns(text: string): { kind: "text" | "math" | "display"; s: string }[] {
  const out: { kind: "text" | "math" | "display"; s: string }[] = [];
  const re = /\$\$([^$]+)\$\$|\$([^$]+)\$/g;
  let last = 0;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    if (m.index > last) out.push({ kind: "text", s: text.slice(last, m.index) });
    out.push(m[1] !== undefined ? { kind: "display", s: m[1].trim() } : { kind: "math", s: m[2].trim() });
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push({ kind: "text", s: text.slice(last) });
  return out;
}

/** The first sentence — the hover preview. Math is kept whole. */
export function firstSentence(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  let inMath = false;
  for (let i = 0; i < flat.length; i++) {
    if (flat[i] === "$") inMath = !inMath;
    if (!inMath && /[.!?]/.test(flat[i]) && (i === flat.length - 1 || flat[i + 1] === " ")) return flat.slice(0, i + 1);
  }
  return flat;
}

function mathSvg(mj: MathJaxEngine, tex: string, display: boolean): SVGSVGElement {
  const { outlines, w, h: hgt } = mj.layoutTeX(tex, { display });
  // layoutTeX is height-normalised (h ≈ 1 per row) with y UP; the card's
  // text is ~15 px, so one unit is ~1em.
  const em = display ? 0.95 : 0.72;
  const svg = document.createElementNS(SVG_NS, "svg") as SVGSVGElement;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const o of outlines) for (const [, y] of o.pts) (minY = Math.min(minY, y)), (maxY = Math.max(maxY, y));
  if (!Number.isFinite(minY)) (minY = 0), (maxY = hgt);
  const pad = 0.08;
  svg.setAttribute("viewBox", `${-pad} ${-(maxY + pad)} ${w + 2 * pad} ${maxY - minY + 2 * pad}`);
  svg.style.height = `${((maxY - minY + 2 * pad) * em).toFixed(2)}em`;
  svg.style.verticalAlign = `${(minY * em - pad).toFixed(2)}em`;
  svg.setAttribute("class", display ? "cs-details-display" : "cs-details-math");
  const ring = (pts: [number, number][]) => `M${pts.map(([x, y]) => `${x.toFixed(3)} ${(-y).toFixed(3)}`).join("L")}Z`;
  for (const o of outlines) {
    const p = document.createElementNS(SVG_NS, "path");
    p.setAttribute("d", [o.pts, ...(o.holes ?? [])].map(ring).join(""));
    p.setAttribute("fill", "currentColor");
    p.setAttribute("fill-rule", "evenodd");
    svg.appendChild(p);
  }
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", tex);
  return svg;
}

/** Fill `into` with the details: text at once, math as soon as the engine is in. */
export function renderDetails(into: HTMLElement, text: string): void {
  const paragraphs = text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  const pending: { slot: HTMLElement; tex: string; display: boolean }[] = [];
  for (const para of paragraphs) {
    const p = h("p", {});
    for (const r of detailRuns(para)) {
      if (r.kind === "text") p.append(r.s);
      else {
        // The TeX source stands in until the engine arrives (and if it never does).
        const slot = h("span", { class: r.kind === "display" ? "cs-details-display-slot" : "cs-details-math-slot" }, r.s);
        pending.push({ slot, tex: r.s, display: r.kind === "display" });
        p.append(slot);
      }
    }
    into.appendChild(p);
  }
  if (pending.length === 0) return;
  void ensureEngines(["mathjax"])
    .then(() => {
      const mj = getLoadedEngines(["mathjax"]).mathjax as MathJaxEngine;
      for (const { slot, tex, display } of pending) {
        try {
          slot.replaceChildren(mathSvg(mj, tex, display));
        } catch {
          /* the source text stays: a bad formula is still readable */
        }
      }
    })
    .catch(() => undefined);
}
