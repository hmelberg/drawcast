// What a guess shows under the pointer before it is pressed (ui/guess-gate.ts):
//
//  - a number line (scale): a faded copy of the scale's own marker at the
//    value a press there would pick — snapped as the pick is — with that
//    value written above it in the scale's own words ("3 billion",
//    "3000 BC"). On touch it stands under the finger while it drags, and the
//    real marker is placed where the finger lifts.
//  - a bar: a faint grip on the bar's top edge, the part a press takes.
//
// Both are drawn in an overlay of the gate; nothing here touches the figure.

import { CANVAS } from "../layout/canvas";
import { scaleGeometry } from "../spec/scale";
import type { GuessHandle } from "../guess/handles";
import { pointFor } from "../guess/handles";
import { clientPointFor } from "./dom";

const SVG_NS = "http://www.w3.org/2000/svg";
/** The scale's own marker colour (spec/scale.ts ACCENT) when it names none. */
const ACCENT = "#b5482e";

export interface GuessHover {
  /** The faded marker of a scale handle at the value under logical point `p`. */
  ghost(g: GuessHandle, p: [number, number]): void;
  /** The faint grip on a bar's top, at its current value. */
  grip(g: GuessHandle, values: number[]): void;
  hide(): void;
}

export function mountGuessHover(stage: HTMLElement, host: HTMLElement): GuessHover {
  // Made on first use: most guesses never show one of the two.
  let svg: SVGSVGElement | null = null;
  let pin: SVGPathElement | null = null;
  let num: SVGTextElement | null = null;
  let grip: HTMLDivElement | null = null;
  const ghostEl = (): { svg: SVGSVGElement; pin: SVGPathElement; num: SVGTextElement } => {
    if (!svg || !pin || !num) {
      svg = document.createElementNS(SVG_NS, "svg");
      svg.setAttribute("class", "cs-guess-ghost");
      svg.setAttribute("aria-hidden", "true");
      pin = document.createElementNS(SVG_NS, "path");
      num = document.createElementNS(SVG_NS, "text");
      num.setAttribute("text-anchor", "middle");
      num.setAttribute("dominant-baseline", "central");
      svg.append(pin, num);
      host.append(svg);
    }
    return { svg, pin, num };
  };
  const gripEl = (): HTMLDivElement => {
    if (!grip) {
      grip = document.createElement("div");
      grip.className = "cs-guess-grip";
      grip.setAttribute("aria-hidden", "true");
      host.append(grip);
    }
    return grip;
  };
  const hideGhost = (): void => {
    if (svg) svg.style.display = "none";
  };
  const hideGrip = (): void => {
    if (grip) grip.style.display = "none";
  };

  /** The overlay lies exactly over the figure's svg, with its live viewBox (the camera). */
  const fit = (svg: SVGSVGElement): boolean => {
    const fig = stage.querySelector<SVGSVGElement>("svg.cs-svg");
    if (!fig) return false;
    const r = fig.getBoundingClientRect();
    const sr = stage.getBoundingClientRect();
    if (r.width === 0) return false;
    svg.style.left = `${r.left - sr.left}px`;
    svg.style.top = `${r.top - sr.top}px`;
    svg.style.width = `${r.width}px`;
    svg.style.height = `${r.height}px`;
    const vb = fig.getAttribute("viewBox");
    if (vb) svg.setAttribute("viewBox", vb);
    return true;
  };

  return {
    ghost(g, p) {
      hideGrip();
      if (!g.scale) return hideGhost();
      const { svg, pin, num } = ghostEl();
      if (!fit(svg)) return hideGhost();
      const sg = scaleGeometry(g.scale);
      const v = sg.valueAtX(p[0]);
      const x = sg.xAt(v);
      // Logical y-up → the svg's y-down, as the figure draws its marker.
      const y = (ly: number): number => CANVAS.h - ly;
      const color = g.scale.style?.color ?? ACCENT;
      const size = sg.sizes?.answer ?? 28;
      pin.setAttribute("d", `M${x - 10} ${y(sg.y + 30)} L${x + 10} ${y(sg.y + 30)} L${x} ${y(sg.y + 6)} Z`);
      pin.setAttribute("fill", color);
      pin.setAttribute("stroke", color);
      num.setAttribute("x", String(x));
      num.setAttribute("y", String(y(sg.y + 36 + Math.round(size * 0.6))));
      num.setAttribute("font-size", String(size));
      num.setAttribute("fill", color);
      num.textContent = sg.format(v);
      svg.style.display = "";
    },
    grip(g, values) {
      hideGhost();
      const top = pointFor(g, values);
      if (!top || g.cx === undefined || g.halfW === undefined) return hideGrip();
      const l = clientPointFor(stage, [g.cx - g.halfW, top[1]]);
      const r = clientPointFor(stage, [g.cx + g.halfW, top[1]]);
      if (!l || !r) return hideGrip();
      const grip = gripEl();
      grip.style.left = `${l[0]}px`;
      grip.style.top = `${l[1]}px`;
      grip.style.width = `${Math.max(12, r[0] - l[0])}px`;
      grip.style.display = "";
    },
    hide() {
      hideGhost();
      hideGrip();
    },
  };
}
