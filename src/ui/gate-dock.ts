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
import { CONTENT_TOP, PAGE_H } from "../layout/page";

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

/** The share of the drawing's height above the content area (page.ts): the
 *  heading strip, where a headline over the drawing may stand without
 *  covering the figure. */
export const HEAD_STRIP = (PAGE_H - CONTENT_TOP) / PAGE_H;
/** The headline's question font (px): its full size, and the least it shrinks to. */
const HEAD_FONT_MAX = 22.4;
const HEAD_FONT_MIN = 13;
/** Under this the how line leaves the headline before the question shrinks further. */
const HEAD_FONT_KEEP = 17;

/**
 * The headline over the drawing must fit the heading strip (`room`, px): the
 * largest question font from `max` down to 17 that does with the how line
 * under it; failing that, down to `min` without the how line (it goes to the dock);
 * failing that too, the least font, no how line. `measure` gives the
 * headline's height at a font and with or without the how line. Pure, for
 * the tests.
 */
export function fitHeadline(room: number, measure: (fontPx: number, how: boolean) => number, max = HEAD_FONT_MAX, min = HEAD_FONT_MIN): { fontPx: number; how: boolean } {
  // The how line stays while the question can keep a good size (≥ HEAD_FONT_KEEP);
  // past that the question's size matters more and the how line goes to the dock.
  for (const [how, least] of [[true, Math.max(min, Math.min(max, HEAD_FONT_KEEP))], [false, min]] as const) {
    for (let f = max; f >= least - 1e-9; f -= 1) if (measure(f, how) <= room) return { fontPx: Math.round(f * 10) / 10, how };
  }
  return { fontPx: min, how: false };
}

export interface GateHeadMount {
  /** Lay the headline again. `over`: it stands over the drawing, fitted to
   *  the heading strip (the default; else it stands above the drawing, on a
   *  phone with room for both); `shift`: how far the drawing stands lowered
   *  for it now (px). Returns whether the how line stays in it, and how far
   *  (px) it overruns the strip even at its least size. */
  relayout(over?: boolean, shift?: number): { how: boolean; overrun: number };
  height(): number;
  dispose(): void;
}

/**
 * Mount the headline on the STAGE (a gate is removed at once when it
 * finishes; the headline fades out after it). Null for no question.
 */
export function mountGateHead(stage: HTMLElement, head: GateHead): GateHeadMount | null {
  // A headline still fading from the last question goes at once.
  stage.querySelector(".cs-gatehead")?.remove();
  if (head.question.trim() === "") return null;
  head.how.classList.remove("cs-waitgate-pill");
  head.how.classList.add("cs-gatehead-how");
  const q = h("div", { class: "cs-gatehead-q", title: head.question }, head.question);
  const el = h("div", { class: "cs-gatehead" }, q, head.how);
  stage.appendChild(el);
  stage.classList.add(HEADLINE);
  let gone = false;
  let keepsHow = true;
  /** The how line in the headline (true) or out of it (the dock takes it). */
  const setHow = (on: boolean): void => {
    if (on && head.how.parentNode !== el) el.appendChild(head.how);
    keepsHow = on;
  };
  const relayout = (over = true, shift = 0): { how: boolean; overrun: number } => {
    if (gone) return { how: keepsHow, overrun: 0 };
    const svg = stage.querySelector<SVGSVGElement>("svg.cs-svg");
    const svgBox = svg?.getBoundingClientRect();
    if (!over) {
      // Above the drawing (a phone with room under it): the stage's top, full size.
      q.style.removeProperty("font-size");
      setHow(true);
      el.style.top = "0px";
      return { how: true, overrun: 0 };
    }
    // Over the drawing, just under its top edge, in the heading strip the
    // page frame leaves free (W25): the question as large as fits there, so
    // it neither covers the figure nor takes height from it.
    const top = svgBox ? svgBox.top - stage.getBoundingClientRect().top - shift : 0;
    el.style.top = `${Math.max(0, top) + 6}px`;
    const room = svgBox && svgBox.height > 0 ? svgBox.height * HEAD_STRIP - 6 + shift : Infinity;
    const fit = fitHeadline(room, (f, how) => {
      q.style.fontSize = `${f}px`;
      if (how && head.how.parentNode !== el) el.appendChild(head.how);
      if (!how && head.how.parentNode === el) head.how.remove();
      return el.offsetHeight;
    });
    q.style.fontSize = `${fit.fontPx}px`;
    if (!fit.how && head.how.parentNode === el) head.how.remove();
    setHow(fit.how);
    return { how: fit.how, overrun: Math.max(0, Math.ceil(el.offsetHeight - room)) };
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
  /** How far the drawing stands lowered under the headline now (px). */
  let headShift = 0;
  /** The how line: in the headline, or (it did not fit there) first in the dock. */
  const placeHow = (inHead: boolean): void => {
    if (!head || !top) return;
    if (!inHead && head.how.parentNode !== el) el.insertBefore(head.how, el.firstChild);
    el.hidden = !inHead ? false : items.length === 0;
  };

  const relayout = (): void => {
    if (disposed) return;
    const svg = stage.querySelector<SVGSVGElement>("svg.cs-svg");
    const caption = stage.querySelector<HTMLElement>(".cs-caption");
    // A narrow stage (a phone): the hint takes its own line over the buttons
    // rather than a sliver beside them.
    const narrow = stage.getBoundingClientRect().width < NARROW_PX;
    el.classList.toggle("cs-gatedock-narrow", narrow);
    if (stage.classList.contains(DOCKED_NARROW) !== narrow) stage.classList.toggle(DOCKED_NARROW, narrow);
    const mode = stage.classList.contains("cs-caption-strip") ? "strip" : stage.classList.contains("cs-caption-below") ? "below" : "overlay";
    // A headline hides the caption (styles.css): it takes no height then.
    const captionH = caption && !top ? caption.getBoundingClientRect().height : 0;
    const stageH = stage.getBoundingClientRect().height;
    const svgH = svg ? svg.getBoundingClientRect().height + shrink : 0;
    // The headline stands ABOVE the drawing only where the stage has the
    // height for it (a phone held upright, a caption below): the drawing
    // keeps its size. Anywhere else it stands OVER the drawing, in the
    // heading strip (W25: above it, the headline cost a 460 px player two
    // thirds of the drawing's width).
    let headH = 0;
    if (top) {
      let over = true;
      if (svg && mode !== "overlay") {
        top.relayout(false, headShift);
        placeHow(true);
        const tall = top.height();
        if (dockShrink({ mode, stageH, svgH, captionH, dockH: el.offsetHeight + 8, headH: tall }) === 0) {
          over = false;
          headH = tall;
        }
      }
      if (over) {
        const fit = top.relayout(true, headShift);
        placeHow(fit.how);
        // Even at its least size it overruns the strip (a phone, a long
        // question): the drawing steps down that much — never more.
        if (mode !== "overlay") headH = fit.overrun;
      }
    }
    headShift = headH;
    stage.style.setProperty("--cs-head-h", `${headH}px`);
    // The dock's own height, plus its gap from the stage's edge.
    const dockH = el.offsetHeight + 8;
    stage.style.setProperty("--cs-dock-h", `${dockH}px`);
    let next = 0;
    if (svg && mode !== "overlay") next = dockShrink({ mode, stageH, svgH, captionH, dockH, headH });
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
