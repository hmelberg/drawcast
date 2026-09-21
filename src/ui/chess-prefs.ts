// The board's two viewer settings, and their two very different lifetimes.
//
// The legal-move hints are a SETTING: off until the viewer turns them on
// (Hans, 2026-09-21), and remembered across casts in their own key — the
// same discipline as the drill's miss history (chess-openings-store.ts):
// storage can be absent or throw in private mode, and then the board simply
// goes on with the hints off.
//
// Which way the board faces is a PREVIEW: the viewer turns it with a tray
// pill, it rides on previewParams like every other excursion, and it dies
// when they do — on Play, on a scrub, on Continue ▸. It must, because the
// flip decides BOTH how the board is drawn and which square a point lands
// on: a remembered flip outliving the drawing it rode on would mirror every
// click on the board with nothing on screen to explain it.

import type { RenderHandle } from "../render";

export const SHOW_LEGAL_KEY = "drawcast.chess.legal";

/** localStorage when this browser offers one, else null — never a throw. */
function storage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

/** True when a grabbed piece should mark where it may go. Default false. */
export function readShowLegalMoves(): boolean {
  const s = storage();
  if (!s) return false;
  try {
    return s.getItem(SHOW_LEGAL_KEY) === "on";
  } catch {
    return false;
  }
}

export function setShowLegalMoves(on: boolean): void {
  const s = storage();
  if (!s) return;
  try {
    s.setItem(SHOW_LEGAL_KEY, on ? "on" : "off");
  } catch {
    /* a full or refusing store: the hints just do not survive this session */
  }
}

/** The viewer's own flip, per figure — absent until they turn the board. */
const viewerFlip = new WeakMap<object, boolean>();
const listeners = new WeakMap<object, Set<() => void>>();

/** Which way the board faces RIGHT NOW: the viewer's own when they have
 *  turned it, else the cast's `flip` param. Everything that draws on the
 *  board or reads a point off it asks this, never the spec directly. */
export function boardFlip(hd: RenderHandle): boolean {
  const own = viewerFlip.get(hd);
  return own !== undefined ? own : hd.spec.params?.["flip"] === true;
}

/** Turn the board (or turn it back) — the caller repaints. */
export function setViewerFlip(hd: RenderHandle, flip: boolean): void {
  viewerFlip.set(hd, flip);
  for (const fn of listeners.get(hd) ?? []) fn();
}

/**
 * Back to the cast's own view — called from every door that settles honest
 * geometry: Play, Continue ▸, a step or scrub, and opening the tray. It
 * does NOT notify, because each of those doors has just drawn the honest
 * board itself and a repaint fired from here would dirty what it settled.
 *
 * Every such door MUST call this. A viewer flip that outlived the drawing
 * it rode on would leave the board facing one way and every point read off
 * it the other — a mirrored click with nothing on screen to explain it.
 */
export function clearViewerFlip(hd: RenderHandle): void {
  viewerFlip.delete(hd);
}

/** Hear the VIEWER turn the board — the figure's own chess add-on repaints
 *  it (and drops marks placed from the square boxes, which are now in the
 *  mirrored place). Returns the unsubscribe. */
export function onBoardViewChange(hd: RenderHandle, fn: () => void): () => void {
  let set = listeners.get(hd);
  if (!set) listeners.set(hd, (set = new Set()));
  set.add(fn);
  return () => set.delete(fn);
}
