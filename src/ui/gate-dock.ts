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
//
// The question itself stands over the figure as a headline while it is open
// (round 7 §8.1), the gate's hint under it as the how line; the dock keeps
// only buttons. A title card's heading stands aside meanwhile (styles.css,
// .cs-stage.cs-headline) and comes back when the headline fades.

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
/** On the stage while a narrow (phone) dock stands: the Sources chip stands
 *  aside and the value pill shrinks (styles.css). */
const DOCKED_NARROW = "cs-docked-narrow";
/** On the stage while the drawing eases back to its full size (styles.css). */
const UNDOCKING = "cs-undocking";
const UNDOCK_MS = 350;
/** Below this stage width (px) the hint sits over the buttons, not beside them. */
const NARROW_PX = 480;

/** On the stage while a headline stands: a title card's heading stands aside (styles.css). */
const HEADLINE = "cs-headline";
const HEAD_FADE_MS = 300;

/** The question over the figure (round 7 §8.1) and how to answer it. */
export interface GateHead {
  /** The ask's question, its {vars} filled ("" — no headline: test me). */
  question: string;
  /** The gate's hint: small, under the question; the gate keeps it live. */
  how: HTMLElement;
}

/**
 * Mount the headline on the STAGE (a gate is removed at once when it
 * finishes; the headline fades out after it). Null for no question.
 */
export function mountGateHead(stage: HTMLElement, head: GateHead): { relayout(): void; height(): number; dispose(): void } | null {
  // A headline still fading from the last question goes at once.
  stage.querySelector(".cs-gatehead")?.remove();
  if (head.question.trim() === "") return null;
  head.how.classList.remove("cs-waitgate-pill");
  head.how.classList.add("cs-gatehead-how");
  const el = h("div", { class: "cs-gatehead" }, h("div", { class: "cs-gatehead-q", title: head.question }, head.question), head.how);
  stage.appendChild(el);
  stage.classList.add(HEADLINE);
  let gone = false;
  const relayout = (): void => {
    if (gone) return;
    // A caption below or in a strip (a phone): the drawing stands under the
    // headline (the dock gives it room, --cs-head-h), so the headline takes
    // the stage's top. An overlay caption: just under the drawing's own top
    // edge, in the strip the layouts leave free (HEAD_ROOM_Y).
    if (stage.classList.contains("cs-caption-below") || stage.classList.contains("cs-caption-strip")) {
      el.style.top = "0px";
      return;
    }
    const svg = stage.querySelector<SVGSVGElement>("svg.cs-svg");
    const top = svg ? svg.getBoundingClientRect().top - stage.getBoundingClientRect().top : 0;
    el.style.top = `${Math.max(0, top) + 6}px`;
  };
  relayout();
  return {
    relayout,
    height: () => (gone ? 0 : el.offsetHeight + 6),
    dispose: () => {
      if (gone) return;
      gone = true;
      // A newer question's headline may stand already: the stage's class is its.
      const newer = stage.querySelector(".cs-gatehead");
      if (newer === null || newer === el) stage.classList.remove(HEADLINE);
      el.classList.add("cs-gatehead-out");
      setTimeout(() => el.remove(), HEAD_FADE_MS);
    },
  };
}

/**
 * How much height (px) the drawing gives up so that drawing + caption + dock
 * fit the stage. Pure, for the tests. Overlay mode never shrinks.
 */
export function dockShrink(m: { mode: "overlay" | "below" | "strip"; stageH: number; svgH: number; captionH: number; dockH: number; headH?: number }): number {
  if (m.mode === "overlay") return 0;
  return Math.max(0, Math.ceil(m.svgH + m.captionH + m.dockH + (m.headH ?? 0) - m.stageH));
}

export function mountGateDock(stage: HTMLElement, gate: HTMLElement, items: HTMLElement[], onLayout: () => void, head?: GateHead): GateDock {
  const top = head ? mountGateHead(stage, head) : null;
  // No headline (no question): the how line stays in the dock, first.
  const inBar = head && !top ? [head.how, ...items] : items;
  const el = h("div", { class: "cs-gatedock" }, ...inBar);
  // Nothing to press (a required choose): no empty bar.
  el.hidden = inBar.length === 0;
  gate.appendChild(el);
  // A dock opening while the last one's drawing still eases back: instant.
  stage.classList.remove(UNDOCKING);
  stage.classList.add(DOCKED);
  let disposed = false;
  let shrink = 0;
  /** A phone (caption below / strip): the drawing stands under the headline. */
  const setHeadH = (): number => {
    const below = stage.classList.contains("cs-caption-strip") || stage.classList.contains("cs-caption-below");
    const headH = below && top ? top.height() : 0;
    stage.style.setProperty("--cs-head-h", `${headH}px`);
    return headH;
  };
  setHeadH();

  const relayout = (): void => {
    if (disposed) return;
    const svg = stage.querySelector<SVGSVGElement>("svg.cs-svg");
    const caption = stage.querySelector<HTMLElement>(".cs-caption");
    // A narrow stage (a phone): the hint takes its own line over the buttons
    // rather than a sliver beside them.
    const narrow = stage.getBoundingClientRect().width < NARROW_PX;
    el.classList.toggle("cs-gatedock-narrow", narrow);
    if (stage.classList.contains(DOCKED_NARROW) !== narrow) stage.classList.toggle(DOCKED_NARROW, narrow);
    // The dock's own height, plus its gap from the stage's edge.
    const dockH = el.offsetHeight + 8;
    stage.style.setProperty("--cs-dock-h", `${dockH}px`);
    const mode = stage.classList.contains("cs-caption-strip") ? "strip" : stage.classList.contains("cs-caption-below") ? "below" : "overlay";
    const headH = setHeadH();
    let next = 0;
    if (svg && mode !== "overlay") {
      const svgH = svg.getBoundingClientRect().height + shrink;
      const captionH = caption ? caption.getBoundingClientRect().height : 0;
      next = dockShrink({ mode, stageH: stage.getBoundingClientRect().height, svgH, captionH, dockH, headH });
    }
    if (next !== shrink) {
      shrink = next;
      stage.style.setProperty("--cs-dock-shrink", `${shrink}px`);
    }
    top?.relayout();
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
      top?.dispose();
      stage.style.removeProperty("--cs-head-h");
      ro?.disconnect();
      mo?.disconnect();
      // Ease the drawing back (only if it gave anything up).
      if (shrink > 0) {
        stage.classList.add(UNDOCKING);
        setTimeout(() => {
          // A new dock may have opened meanwhile: it is instant again.
          stage.classList.remove(UNDOCKING);
        }, UNDOCK_MS);
      }
      stage.classList.remove(DOCKED);
      stage.classList.remove(DOCKED_NARROW);
      stage.style.removeProperty("--cs-dock-h");
      stage.style.removeProperty("--cs-dock-shrink");
    },
  };
}
