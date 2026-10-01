// The answer dock (2026-10-03 fix wave): one row at the bottom of the stage
// that carries what a figure gate says and offers — its hint, a running
// total, Answer, Skip — for the guess, cards, tree and formula gates.
//
// One rule for all four, at every width: nothing of the dock lies on the
// title (the top of the figure) or on the caption (the question being read).
//
//   overlay  the caption is written on the drawing: it steps up over the
//            dock (styles.css, bottom: --cs-dock-h);
//   below / strip  the caption sits under the drawing (render/caption-
//            place.ts): the drawing gives up just enough height — still
//            4 : 3, centred — for the dock under the caption
//            (--cs-dock-shrink), and takes it back when the gate closes.
//
// The drawing moving changes where its parts are on the screen, so the gate
// is told (onLayout) to lay its rings, pills and fields again.

import { h } from "./dom";

export interface GateDock {
  /** The row; append buttons to it. */
  el: HTMLElement;
  /** Measure again (the hint's text changed, a button came or went). */
  relayout(): void;
  /** Give the stage back its own layout. */
  dispose(): void;
}

const DOCKED = "cs-docked";
/** Below this stage width (px) the hint sits over the buttons, not beside them. */
const NARROW_PX = 480;

/**
 * How much height (px) the drawing gives up so that drawing + caption + dock
 * fit the stage. Pure, for the tests. Overlay mode never shrinks.
 */
export function dockShrink(m: { mode: "overlay" | "below" | "strip"; stageH: number; svgH: number; captionH: number; dockH: number }): number {
  if (m.mode === "overlay") return 0;
  return Math.max(0, Math.ceil(m.svgH + m.captionH + m.dockH - m.stageH));
}

export function mountGateDock(stage: HTMLElement, gate: HTMLElement, items: HTMLElement[], onLayout: () => void): GateDock {
  const el = h("div", { class: "cs-gatedock" }, ...items);
  gate.appendChild(el);
  stage.classList.add(DOCKED);
  let disposed = false;
  let shrink = 0;

  const relayout = (): void => {
    if (disposed) return;
    const svg = stage.querySelector<SVGSVGElement>("svg.cs-svg");
    const caption = stage.querySelector<HTMLElement>(".cs-caption");
    // A narrow stage (a phone): the hint takes its own line over the buttons
    // rather than a sliver beside them.
    el.classList.toggle("cs-gatedock-narrow", stage.getBoundingClientRect().width < NARROW_PX);
    // The dock's own height, plus its gap from the stage's edge.
    const dockH = el.offsetHeight + 8;
    stage.style.setProperty("--cs-dock-h", `${dockH}px`);
    const mode = stage.classList.contains("cs-caption-strip") ? "strip" : stage.classList.contains("cs-caption-below") ? "below" : "overlay";
    let next = 0;
    if (svg && mode !== "overlay") {
      const svgH = svg.getBoundingClientRect().height + shrink;
      const captionH = caption ? caption.getBoundingClientRect().height : 0;
      next = dockShrink({ mode, stageH: stage.getBoundingClientRect().height, svgH, captionH, dockH });
    }
    if (next !== shrink) {
      shrink = next;
      stage.style.setProperty("--cs-dock-shrink", `${shrink}px`);
    }
    onLayout();
  };

  // The caption's pages, the stage's size and the dock's own wrap all move it.
  const ro = typeof ResizeObserver === "function" ? new ResizeObserver(() => relayout()) : null;
  if (ro) {
    ro.observe(stage);
    ro.observe(el);
    const caption = stage.querySelector(".cs-caption");
    if (caption) ro.observe(caption);
  }
  // Caption mode flips (below ↔ strip ↔ overlay) are classes on the stage.
  const mo = typeof MutationObserver === "function" ? new MutationObserver(() => relayout()) : null;
  mo?.observe(stage, { attributes: true, attributeFilter: ["class"] });

  return {
    el,
    relayout,
    dispose: () => {
      if (disposed) return;
      disposed = true;
      ro?.disconnect();
      mo?.disconnect();
      stage.classList.remove(DOCKED);
      stage.style.removeProperty("--cs-dock-h");
      stage.style.removeProperty("--cs-dock-shrink");
    },
  };
}
