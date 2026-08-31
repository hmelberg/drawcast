// The caption overlay's interaction rules.
//
// The caption used to be a SIBLING of the stage, and that placement was load-
// bearing: selecting a phrase in it to look up (infocard.ts) could never
// collide with the stage's play/pause toggle, because the drag happened
// outside the stage entirely. As a YouTube-style band ON the drawing it is
// inside the stage's gesture area, so the two rules that used to hold by
// construction now have to be stated.

/** The slice of Element these rules need — node has no DOM to test against. */
interface Hit {
  closest(selector: string): unknown;
}

/** The slice of Selection they need. */
interface Sel {
  isCollapsed: boolean;
}

/**
 * True when the click that just landed is the tail of a text drag.
 *
 * Selecting a phrase to look up ends in a normal click, delivered wherever the
 * pointer was released — often on the drawing, since the band is only the
 * bottom of it. Playback must ignore that click, or looking a word up pauses
 * the drawcast every time. A plain click on the band is NOT a drag and still
 * toggles play, the way clicking anywhere on a video does.
 */
export function isTextDrag(selection: Sel | null): boolean {
  return selection !== null && !selection.isCollapsed;
}

/**
 * True when the pointer is over the subtitle band.
 *
 * What the band covers is not what was clicked: the caption sits across the
 * bottom of the canvas, which for an axes diagram is exactly where the x-axis
 * label lives. Without this, clicking a word in the subtitle opens the info
 * card of whatever the band happens to be hiding.
 */
export function overCaption(target: Hit | null): boolean {
  return target?.closest(".cs-caption") != null;
}

export type CaptionVisibility = "shown" | "empty" | "off";

/**
 * What the band should be doing. "empty" is its own state rather than a blank
 * line: the caption used to reserve a line of height so the figure would not
 * jump between beats, and an overlay that did the same would leave a dark
 * empty box hanging over the drawing for every silent moment.
 */
export function captionVisibility(state: { on: boolean; text: string }): CaptionVisibility {
  if (!state.on) return "off";
  return state.text.trim() === "" ? "empty" : "shown";
}
