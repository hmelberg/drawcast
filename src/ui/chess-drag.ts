// Dragging a chess piece, the DOM half: pointer capture, the grab cursor and
// the borrowed touch-action, wrapped around the gesture in chess-drag-model.
//
// Four surfaces mount it on their own element — the ask gate and the two
// session gates on their overlay, free play straight on the stage — and each
// passes its own `deliver`, which is the click handler it already had. A
// press names its square through that handler exactly as a click used to, so
// click-then-click is untouched; a release on a DIFFERENT square names the
// second one, which is the same two squares in the same order. No surface
// learns a new verb, and the legality, the turn and the miss counting all
// stay where they were.
//
// Modelled on attachWidgetHost's pointer handling (ui/widget-host.ts) —
// every trap it documents is the same trap here: a secondary button arms a
// swallow nothing disarms, a drop on a pill is the pill's gesture, and a
// capture yanked mid-drag leaves a piece hanging on an offset nobody owns.

import type { RenderHandle } from "../render";
import { chessSquareAt } from "../render/widgets";
import { squareDrag, type SquareDrag } from "./chess-drag-model";
import { logicalPoint } from "./dom";

type Pt = [number, number];

export interface ChessDragOpts {
  /** Where the listeners live: a gate overlay, or the stage itself. */
  target: HTMLElement;
  /** Read each press — a session gate flips the board mid-session. */
  flip(): boolean;
  /** True when a piece this viewer may carry stands on the square. */
  grabbable(sq: string): boolean;
  /** The viewer named a square: the surface's own click handler, unchanged.
   *  `p` is the logical point it was named at (clientPointFor turns it into
   *  the place for a mark). */
  deliver(sq: string, p: Pt): void;
  /** True when this press belongs to someone else (playback, a foreign gate,
   *  a button, a busy session). */
  blocked(e: PointerEvent): boolean;
  /** The press missed the board — free play's "drop the selection". */
  offBoard?(e: PointerEvent): void;
}

export interface ChessDragHandle {
  /** True while a piece is actually being carried (past the threshold). */
  dragging(): boolean;
}

export function attachChessDrag(stage: HTMLElement, hd: RenderHandle, opts: ChessDragOpts): ChessDragHandle {
  const drag: SquareDrag = squareDrag({
    squareAt: (p) => chessSquareAt(opts.flip(), p),
    grabbable: opts.grabbable,
    nudge: (id, dx, dy) => hd.timeline.nudge(id, dx, dy),
    deliver: opts.deliver,
  });
  const { target } = opts;
  /** The pointer that owns the gesture; every other one is someone else's. */
  let activeId: number | null = null;
  /** The stage's own inline touch-action — the press only BORROWS it. */
  let priorTouchAction = "";

  const clearGrab = (): void => {
    stage.classList.remove("cs-grabbable", "cs-grabbing");
  };

  target.addEventListener(
    "pointerdown",
    (e) => {
      // A right- or middle-click and a second finger are nobody's gesture.
      if (!e.isPrimary || (e.pointerType === "mouse" && e.button !== 0)) return;
      if (opts.blocked(e)) return;
      const p = logicalPoint(stage, e);
      if (!p) return;
      if (!drag.down(p)) {
        opts.offBoard?.(e);
        return;
      }
      activeId = e.pointerId;
      stage.classList.add("cs-grabbable");
      // A piece being carried is not a page to scroll, and capture keeps a
      // fast drag from escaping the board mid-gesture.
      priorTouchAction = stage.style.touchAction;
      stage.style.touchAction = "none";
      try {
        target.setPointerCapture(e.pointerId);
      } catch {
        /* a synthetic pointer has no capture to take; the drag still follows the moves it receives */
      }
      e.preventDefault();
    },
    true,
  );
  target.addEventListener(
    "pointermove",
    (e) => {
      // Nothing in flight means nothing to measure: logicalPoint reads the
      // svg's box, and every idle move over a paused figure would pay for it.
      if (e.pointerId !== activeId) return;
      const p = logicalPoint(stage, e);
      if (!p) return;
      drag.move(p);
      // The grabbing hand, read off the gesture the moment it flips — swapped,
      // never merely added, so a stage never wears both cursors at once.
      if (drag.dragging()) stage.classList.replace("cs-grabbable", "cs-grabbing");
    },
    true,
  );
  const end = (e: PointerEvent, cancelled: boolean): void => {
    if (e.pointerId !== activeId) return;
    activeId = null;
    clearGrab();
    stage.style.touchAction = priorTouchAction;
    try {
      target.releasePointerCapture(e.pointerId);
    } catch {
      /* not captured */
    }
    if (cancelled) {
      drag.cancel();
      return;
    }
    // A drop on a pill (Skip, ✕, Again) is that pill's gesture: the board
    // gets nothing and the piece goes back. Under pointer capture every
    // event retargets, so the event's own target cannot tell a pill from
    // paper — the release POINT can.
    const dropped = document.elementFromPoint(e.clientX, e.clientY);
    const p = dropped instanceof Element && dropped.closest("button") !== null ? null : logicalPoint(stage, e);
    if (p) drag.up(p);
    else drag.cancel();
  };
  target.addEventListener("pointerup", (e) => end(e, false), true);
  target.addEventListener("pointercancel", (e) => end(e, true), true);
  // Capture yanked mid-gesture (the browser takes the pointer, the gate goes
  // away): no pointerup follows, so the piece would hang on its offset. On the
  // ordinary path end() has already cleared activeId, so this does nothing.
  target.addEventListener("lostpointercapture", (e) => {
    if (e.pointerId !== activeId) return;
    activeId = null;
    clearGrab();
    stage.style.touchAction = priorTouchAction;
    drag.cancel();
  });

  return { dragging: () => drag.dragging() };
}
