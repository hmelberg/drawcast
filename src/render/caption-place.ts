// Where the subtitles go (Hans, 2026-09-25):
//
//   below    — the stage has room under a 4 : 3 drawing (a phone held
//              upright, a tall window): the words sit there, on the paper;
//   strip    — no room, subtitles ON, and this cast has something to read in
//              the strip the words would cover (a label, an axis caption, a
//              formula): the drawing shrinks just enough for a two-line
//              strip under it — still 4 : 3, so clicks map exactly;
//   overlay  — otherwise: written on the drawing, ink in a paper halo.
//
// Decided from the stage's box (and the CC switch), never from a caption's
// content, and re-made only on resize or when CC is turned on or off — so
// nothing jumps from one line to the next.

/** Canvas aspect: height over width. */
const ASPECT = 3 / 4;
/** Below needs this much more than the strip, to enter; it leaves at the strip itself — hysteresis. */
const HYSTERESIS_PX = 8;

export type CaptionMode = "below" | "strip" | "overlay";

/**
 * Whether the caption belongs below: the stage's spare height under a 4 : 3
 * drawing (at the stage's width) must hold a strip of `stripPx`. Pure, for
 * the tests.
 */
export function captionBelow(stage: { w: number; h: number }, stripPx: number, wasBelow: boolean): boolean {
  if (stage.w <= 0 || stage.h <= 0) return wasBelow;
  const spare = stage.h - stage.w * ASPECT;
  return wasBelow ? spare >= stripPx : spare >= stripPx + HYSTERESIS_PX;
}

/** The mode, and in strip mode the drawing's height (px). Pure, for the tests. */
export function captionMode(
  stage: { w: number; h: number },
  stripPx: number,
  opts: { was: CaptionMode; ccOn: boolean; needsStrip: boolean },
): { mode: CaptionMode; figH?: number } {
  if (captionBelow(stage, stripPx, opts.was === "below")) return { mode: "below" };
  if (opts.ccOn && opts.needsStrip && stage.h > stripPx) {
    return { mode: "strip", figH: Math.min(stage.h - stripPx, stage.w * ASPECT) };
  }
  return { mode: "overlay" };
}

/** The height two caption lines need, from the caption's own computed style. */
function stripHeight(caption: HTMLElement): number {
  const cs = getComputedStyle(caption);
  const font = parseFloat(cs.fontSize) || 18;
  const line = parseFloat(cs.lineHeight) || font * 1.35;
  const pad = (parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.paddingBottom) || 0);
  return 2 * line + pad;
}

export interface CaptionPlacer {
  /** Whether this cast has something to read in the caption's strip (render/caption-dark.ts). */
  setNeedsStrip(v: boolean): void;
  dispose(): void;
}

/**
 * Watch the stage (and the figure's CC switch) and set one of
 * `cs-caption-below` / `cs-caption-strip` on the stage. No ResizeObserver
 * (a test DOM, an old browser): the caption overlays, as it always did.
 */
export function placeCaption(stage: HTMLElement, caption: HTMLElement): CaptionPlacer {
  if (typeof ResizeObserver === "undefined") return { setNeedsStrip: () => {}, dispose: () => {} };
  let mode: CaptionMode = "overlay";
  let needsStrip = false;
  const figure = stage.parentElement;
  const decide = () => {
    const r = stage.getBoundingClientRect();
    const ccOn = !(figure?.classList.contains("cs-cc-off") ?? false);
    const next = captionMode({ w: r.width, h: r.height }, stripHeight(caption), { was: mode, ccOn, needsStrip });
    mode = next.mode;
    stage.classList.toggle("cs-caption-below", mode === "below");
    stage.classList.toggle("cs-caption-strip", mode === "strip");
    if (next.figH !== undefined) stage.style.setProperty("--cs-fig-h", `${next.figH.toFixed(1)}px`);
  };
  const ro = new ResizeObserver(decide);
  ro.observe(stage);
  // CC on/off is a class on the figure (playlist/session.ts).
  const mo = figure ? new MutationObserver(decide) : null;
  if (figure && mo) mo.observe(figure, { attributes: true, attributeFilter: ["class"] });
  decide();
  return {
    setNeedsStrip: (v) => {
      if (v === needsStrip) return;
      needsStrip = v;
      decide();
    },
    dispose: () => {
      ro.disconnect();
      mo?.disconnect();
    },
  };
}
