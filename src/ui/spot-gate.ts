// The spot gate (spec/spot.ts): "Where is the liver? Tap it." The viewer
// taps a point on the figure; it is judged against the place's outline (an
// organ, a country) or its box (a picture region), with a little tolerance
// (layout/spot-geometry.ts).
//
// The whole figure answers, so the hand cursor stands over all of it (never
// a crosshair). The reveal is drawn into the figure itself, in logical
// coordinates, so it stays put while the dock gives the drawing back its
// height: the place outlined and softly filled — green when found, amber
// when shown after a miss — the tap marked ✓, or ✗ with a dashed line to
// the nearest edge of the right place. A part that is an element also glows
// while `right` is spoken (the player's click reveal).

import type { RenderHandle } from "../render";
import type { BBox } from "../layout/geometry";
import type { Pt } from "../layout/model";
import { CANVAS } from "../layout/canvas";
import { hitElement } from "./hit";
import { h, logicalPoint } from "./dom";
import { chooseGeometryFor, type ChooseGeometry } from "./choose-gate";
import { mountGateDock, type GateDock } from "./gate-dock";
import type { AskGateStep } from "./controls";
import { gateLangOf, gateWords } from "./gate-words";
import { judgeSpot, type SpotShape } from "../layout/spot-geometry";

/** The reveal stands this long (or until the next gate, or a scrub). */
const REVEAL_MS = 6500;
const OK_INK = "#4a7c59";
const SHOWN_INK = "#d08a2c";
const SVG_NS = "http://www.w3.org/2000/svg";

const HINT: Record<"en" | "nb", string> = {
  en: "Tap the place on the figure",
  nb: "Trykk på stedet i figuren",
};

/** The place as it stands now: an element's posed box and outline, else the plan's box (a picture region). */
export function spotShape(spot: { id: string; box: BBox }, geo: ChooseGeometry): SpotShape {
  if (spot.id.includes(":")) return { box: spot.box };
  const box = geo.boxes.get(spot.id) ?? spot.box;
  const rings = geo.rings.get(spot.id);
  return { box, ...(rings && rings.length > 0 ? { rings } : {}) };
}

function svgEl<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>): SVGElementTagNameMap[K] {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  return el;
}

/** Logical y-up → the figure svg's own y-down units. */
const flip = (p: Pt): string => `${p[0].toFixed(1)},${(CANVAS.h - p[1]).toFixed(1)}`;

/** The reveal as an svg group in the figure's own units. */
export function spotRevealGroup(shape: SpotShape, tap: Pt, verdict: { ok: boolean; nearest: Pt }): SVGGElement {
  const ink = verdict.ok ? OK_INK : SHOWN_INK;
  const g = svgEl("g", { class: "cs-spot-reveal", "pointer-events": "none" });
  const outline = { fill: ink, "fill-opacity": 0.16, stroke: ink, "stroke-width": 4, "stroke-linejoin": "round", "fill-rule": "nonzero" };
  if (shape.rings && shape.rings.length > 0) {
    const d = shape.rings.filter((r) => r.length >= 3).map((r) => `M${r.map(flip).join("L")}Z`).join("");
    g.appendChild(svgEl("path", { d, ...outline, class: "cs-spot-outline" }));
  } else {
    const b = shape.box;
    g.appendChild(svgEl("rect", { x: b.x, y: CANVAS.h - b.y - b.h, width: b.w, height: b.h, rx: 10, ...outline, class: "cs-spot-outline" }));
  }
  if (!verdict.ok) {
    const [x1, y1] = flip(tap).split(",");
    const [x2, y2] = flip(verdict.nearest).split(",");
    g.appendChild(svgEl("line", { x1, y1, x2, y2, stroke: SHOWN_INK, "stroke-width": 3, "stroke-dasharray": "8 7", "stroke-linecap": "round" }));
  }
  const [cx, cy] = flip(tap).split(",").map(Number);
  g.appendChild(svgEl("circle", { cx, cy, r: 17, fill: "#fffdf8", stroke: verdict.ok ? OK_INK : "#c96567", "stroke-width": 3.5 }));
  const mark = svgEl("text", { x: cx, y: cy + 1, "text-anchor": "middle", "dominant-baseline": "central", "font-size": 22, "font-weight": 700, fill: verdict.ok ? OK_INK : "#c96567", "font-family": "system-ui, sans-serif" });
  mark.textContent = verdict.ok ? "✓" : "✗";
  g.appendChild(mark);
  return g;
}

export function spotGateFor(
  stage: HTMLElement,
  hd: RenderHandle,
  geometry: () => ChooseGeometry = () => chooseGeometryFor(hd),
): (signal: AbortSignal, step: AskGateStep) => Promise<string | null> {
  return (signal, step) =>
    new Promise<string | null>((resolve) => {
      const spot = step.spot;
      if (!spot) {
        resolve(null);
        return;
      }
      stage.querySelector(".cs-figgate")?.remove();
      stage.querySelector("svg.cs-svg .cs-spot-reveal")?.remove();
      const lang = gateLangOf(hd);
      const words = gateWords(lang);
      const geo = geometry();
      const shape = spotShape(spot, geo);

      const hint = h("span", { class: "cs-waitgate-pill cs-figgate-hint" }, HINT[lang]);
      const gate = h("div", { class: "cs-figgate cs-spotgate" });
      const docked: HTMLElement[] = [];
      let dock: GateDock | null = null;
      let settled = false;
      let reveal: SVGGElement | null = null;
      let timer = 0;

      const clearReveal = (): void => {
        window.clearTimeout(timer);
        reveal?.remove();
        reveal = null;
        signal.removeEventListener("abort", clearReveal);
      };
      const standDown = (): void => {
        signal.removeEventListener("abort", onAbort);
        stage.classList.remove("cs-cardable");
        dock?.dispose();
        gate.remove();
      };
      const onAbort = (): void => {
        standDown();
        if (!settled) {
          settled = true;
          resolve(null);
        }
      };

      // The hand over the whole figure: anywhere is an answer.
      gate.addEventListener("pointermove", (e) => {
        e.stopPropagation();
        if (!settled) stage.classList.add("cs-cardable");
      });
      gate.addEventListener("click", (e) => {
        e.stopPropagation();
        if (settled) return;
        const p = logicalPoint(stage, e);
        if (!p) return;
        settled = true;
        const verdict = judgeSpot(shape, p, step.tolerance);
        // What was tapped instead (the record): the element under it, if any.
        const said = verdict.ok ? (step.answer ?? spot.id) : (hitElement(geo.boxes, p, 0, geo.rings) ?? "");
        standDown();
        const svg = stage.querySelector<SVGSVGElement>("svg.cs-svg");
        if (svg) {
          reveal = spotRevealGroup(shape, p, verdict);
          svg.appendChild(reveal);
          timer = window.setTimeout(clearReveal, REVEAL_MS);
          signal.addEventListener("abort", clearReveal);
        }
        resolve(said);
      });

      if (!step.required) {
        const skip = h("button", { class: "cs-cardgate-pill skip cs-figgate-skip", type: "button" }, words.skip);
        skip.addEventListener("click", (e) => {
          e.stopPropagation();
          if (settled) return;
          settled = true;
          standDown();
          resolve(null);
        });
        docked.push(skip);
      }
      signal.addEventListener("abort", onAbort);
      stage.classList.add("cs-cardable");
      stage.appendChild(gate);
      dock = mountGateDock(stage, gate, docked, () => undefined, { question: step.question, how: hint });
      dock.relayout();
    });
}
