// Where the subtitles go (Hans, 2026-09-25): BELOW the drawing when the
// stage has room for them there, OVER it (the translucent band) when it has
// not. A phone held upright leaves a tall stage under a 4 : 3 drawing, so
// the words move out of the picture; the same phone turned sideways, or a
// wide screen in fullscreen, leaves none, and the band overlays as before.
//
// Decided from the stage's own box, which the host sizes (a flex column in
// fullscreen, the viewer's height, a taller card on a narrow upright screen)
// — never from the caption's content, so the choice cannot feed back into
// itself, and it is re-made only when the stage is resized, never per line.

/** Canvas aspect: height over width. */
const ASPECT = 3 / 4;
/** Below needs this much more than the strip, to enter; it leaves at the strip itself — hysteresis. */
const HYSTERESIS_PX = 8;

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

/** The height two caption lines need, from the caption's own computed style. */
function stripHeight(caption: HTMLElement): number {
  const cs = getComputedStyle(caption);
  const font = parseFloat(cs.fontSize) || 18;
  const line = parseFloat(cs.lineHeight) || font * 1.35;
  const pad = (parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.paddingBottom) || 0);
  return 2 * line + pad;
}

/**
 * Watch the stage and toggle `cs-caption-below` on it. Returns the disposer.
 * No ResizeObserver (a test DOM, an old browser): the band overlays, as it
 * always did.
 */
export function placeCaption(stage: HTMLElement, caption: HTMLElement): () => void {
  if (typeof ResizeObserver === "undefined") return () => {};
  let below = false;
  const decide = () => {
    const r = stage.getBoundingClientRect();
    // Measured as an overlay: in the below layout the stage's box is the
    // host's, not the content's, so the reading is the same either way.
    const next = captionBelow({ w: r.width, h: r.height }, stripHeight(caption), below);
    if (next !== below) {
      below = next;
      stage.classList.toggle("cs-caption-below", below);
    }
  };
  const ro = new ResizeObserver(decide);
  ro.observe(stage);
  decide();
  return () => ro.disconnect();
}
