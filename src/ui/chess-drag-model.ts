// Dragging a piece to its square, the pure half — the gesture four surfaces
// share (the ask gate in ui/controls.ts, the openings drill, the
// play-the-computer session and free play on a paused board).
//
// The rule that makes a drag and a click ONE thing: a press NAMES its square
// straight away, so a press-and-release is the click-click flow exactly as it
// was, and a release on a different square names the second one. Every
// surface keeps its own state machine — whose turn it is, what is legal, what
// counts as a miss — and learns no new verb: it is still handed squares.
//
// The piece follows the pointer through `nudge`, the renderer's per-element
// offset (player.nudge → BackendEffects.setOffset), the same seam
// ui/widget-host.ts drags a widget part through. The DOM half — pointer
// capture, the cursor, who is allowed to press at all — is ui/chess-drag.ts.

type Pt = [number, number];

/** How far a press must travel, in logical units, before the release reads it
 *  as a drag rather than a click. Decided at RELEASE, never before: a press
 *  that wanders and comes back is still a click. (A board square is 77.5
 *  units wide, so this is a wobble, not a move.) Matches widget-host's
 *  DRAG_MIN — one hand, one threshold, wherever it drags something. */
export const DRAG_MIN = 6;

/** The drawn piece standing on a square (games.yaml: `piece_<file><rank>`),
 *  or null when that is not a square — the id the drag ghost offsets. */
export function pieceElementId(square: string): string | null {
  return /^[a-h][1-8]$/.test(square.trim().toLowerCase()) ? `piece_${square.trim().toLowerCase()}` : null;
}

export interface SquareDragDeps {
  /** The square under a logical point, null off the board. */
  squareAt(p: Pt): string | null;
  /** True when a piece the viewer may carry stands here — whose pieces those
   *  are is the surface's business (either side in free play, your own in a
   *  drill). A square that is not grabbable still names itself; it just has
   *  nothing to drag. */
  grabbable(sq: string): boolean;
  /** The drag ghost: the renderer's per-element offset. (0, 0) puts it back. */
  nudge(id: string, dx: number, dy: number): void;
  /** The viewer named this square — the surface's own click handler. */
  deliver(sq: string, p: Pt): void;
}

export interface SquareDrag {
  /** Begin: true when the press landed on a square (the square is named and
   *  the caller then owns the pointer until up() or cancel()). False leaves
   *  everything alone — an off-board press is the surface's own business. */
  down(p: Pt): boolean;
  /** Carry the piece: past DRAG_MIN it ghosts under the pointer. A no-op
   *  with no gesture in flight, so it is free at rest. */
  move(p: Pt): void;
  /** Let go: sends the ghost home FIRST, then names the square it landed on —
   *  unless it barely moved (the press already named it), went back where it
   *  started, or left the board. */
  up(p: Pt): void;
  /** Drop the gesture and its ghost without naming anything (pointercancel). */
  cancel(): void;
  /** True once the live gesture has passed DRAG_MIN — the cursor's one source
   *  of truth, false again the moment the gesture ends. */
  dragging(): boolean;
}

interface Gesture {
  from: string;
  start: Pt;
  /** The piece to carry, or null on a square with nothing grabbable on it. */
  ghost: string | null;
  moved: boolean;
}

export function squareDrag(deps: SquareDragDeps): SquareDrag {
  let gesture: Gesture | null = null;

  /** The ghost goes home before anything else looks at the board. */
  const home = (g: Gesture): void => {
    if (g.moved && g.ghost) deps.nudge(g.ghost, 0, 0);
  };

  return {
    down(p) {
      // One gesture at a time: a second finger landing mid-drag would strand
      // the first piece on an offset nothing owns any more.
      if (gesture) return false;
      const sq = deps.squareAt(p);
      if (sq === null) return false;
      gesture = { from: sq, start: p, ghost: deps.grabbable(sq) ? pieceElementId(sq) : null, moved: false };
      deps.deliver(sq, p);
      return true;
    },
    move(p) {
      if (!gesture || !gesture.ghost) return;
      const dx = p[0] - gesture.start[0];
      const dy = p[1] - gesture.start[1];
      if (!gesture.moved && Math.hypot(dx, dy) < DRAG_MIN) return;
      gesture.moved = true;
      deps.nudge(gesture.ghost, dx, dy);
    },
    up(p) {
      if (!gesture) return;
      const g = gesture;
      gesture = null;
      home(g);
      if (!g.moved) return; // a click: the press already named the square
      const to = deps.squareAt(p);
      if (to === null || to === g.from) return; // off the board, or taken back
      deps.deliver(to, p);
    },
    cancel() {
      if (!gesture) return;
      home(gesture);
      gesture = null;
    },
    dragging: () => gesture?.moved === true,
  };
}
