// Intrinsic chess free play (pause is the door — interactivity spec §13):
// while paused, clicks on the drawn board move the pieces. Whichever piece
// the viewer grabs has the turn (chess.js legality, auto-queen promotions),
// and each move previews through the param machinery — a fen override with
// revealNew, so pieces land on squares the storyboard never visited. Free
// play is an excursion: pressing play (or Continue ▸) settles the honest
// boundary and the storyboard's own position returns untouched.
//
// The board region is the instrument: a paused click on ANY square is
// consumed (select, move, or shrug) and never resumes playback — exactly
// the piano's contract, one object over. chess.js loads lazily on the first
// board click; the chess engine that drew the board shares the chunk, so in
// practice it is already cached.

import type { RenderHandle } from "../render";
import { INITIAL_STATE } from "../render/plan";
import { readParam, withOverrides } from "../render/params";
import { chessSquareAt, chessSquareBox } from "../render/widgets";
import { clientPointFor, h, logicalPoint } from "./dom";
import { freeMove, legalTargets, shownFen, type ChessCtor } from "./chessplay-model";

/** The FEN actually shown at the current boundary (fen + moves + the runtime
 *  plies_shown a {var} animate may have committed) — where free play and the
 *  vs-computer session both start from. */
export function boundaryChessFen(hd: RenderHandle, Chess: ChessCtor): string | null {
  const n = hd.timeline.position;
  const boundary = n > 0 ? hd.plan.states[n - 1] : INITIAL_STATE;
  const eff = withOverrides(hd.spec.params, boundary.params);
  const moves = Array.isArray(eff["moves"]) ? (eff["moves"] as string[]) : [];
  const plies = hd.timeline.getParamOverrides()["plies_shown"] ?? readParam(eff, "plies_shown") ?? moves.length;
  const fen = typeof eff["fen"] === "string" ? eff["fen"] : undefined;
  return shownFen(Chess, fen, moves, plies);
}

export function attachChessPlay(stage: HTMLElement, hd: RenderHandle): void {
  const flip = hd.spec.params?.["flip"] === true;
  let Chess: ChessCtor | null = null;
  /** The position on the board right now, evolving with the viewer's moves;
   *  null = re-derive from the current boundary before the next move. */
  let liveFen: string | null = null;
  let selected: string | null = null;
  let ring: HTMLElement | null = null;
  let marks: HTMLElement[] = [];

  const dropMarks = (): void => {
    for (const m of marks) m.remove();
    marks = [];
    ring = null;
  };
  const deselect = (): void => {
    selected = null;
    dropMarks();
  };
  const invalidate = (): void => {
    liveFen = null;
    deselect();
  };

  // Playback, a scrub, or a step lands honest geometry — the free-play
  // position is stale from then on. Chain, never replace (controls and the
  // tray hang their own logic on these callbacks).
  const prevOnState = hd.timeline.callbacks.onState;
  hd.timeline.callbacks.onState = (s) => {
    prevOnState?.(s);
    if (s === "playing") invalidate();
  };
  const prevOnStep = hd.timeline.callbacks.onStep;
  hd.timeline.callbacks.onStep = (completed, total) => {
    prevOnStep?.(completed, total);
    invalidate();
  };

  const blocked = (e: Event): boolean =>
    hd.timeline.state === "playing" ||
    (e.target instanceof Element && e.target.closest("button") !== null) ||
    stage.querySelector(".cs-figgate, .cs-cardgate") !== null;

  const boundaryFen = (): string | null => (Chess ? boundaryChessFen(hd, Chess) : null);

  const place = (sq: string, className: string): HTMLElement | null => {
    const box = chessSquareBox(flip, sq);
    const c = box && clientPointFor(stage, [box.x + box.w / 2, box.y + box.h / 2]);
    if (!c) return null;
    const m = h("span", { class: className });
    m.style.left = `${c[0]}px`;
    m.style.top = `${c[1]}px`;
    stage.appendChild(m);
    marks.push(m);
    return m;
  };

  /** Ring the grabbed piece and dot where it may go (ring = a capture) —
   *  the temporary highlight that doubles as a how-does-it-move lesson. */
  const markSelection = (sq: string): void => {
    dropMarks();
    ring = place(sq, "cs-figgate-mark from cs-chessring");
    if (!Chess || liveFen === null) return;
    const game = new Chess(liveFen, { skipValidation: true });
    for (const t of legalTargets(Chess, liveFen, sq)) {
      place(t, game.get(t) ? "cs-figgate-mark cs-chessring cs-chesstake" : "cs-chessdot");
    }
  };

  const shrug = (): void => {
    if (!ring) return;
    ring.classList.add("wrong");
    const r = ring;
    window.setTimeout(() => r.classList.remove("wrong"), 350);
  };

  const onSquare = (sq: string): void => {
    if (!Chess) return;
    liveFen ??= boundaryFen();
    if (liveFen === null) return;
    if (selected === null) {
      const game = new Chess(liveFen, { skipValidation: true });
      if (!game.get(sq)) return; // empty square, nothing to grab
      selected = sq;
      markSelection(sq);
      return;
    }
    if (sq === selected) {
      deselect();
      return;
    }
    const next = freeMove(Chess, liveFen, selected, sq);
    if (next !== null) {
      liveFen = next;
      deselect();
      hd.timeline.previewParams({ fen: next, moves: [], plies_shown: 0 }, { revealNew: true });
      return;
    }
    // Illegal — grabbing another piece switches the selection; anything
    // else shakes its head and keeps the current one.
    const game = new Chess(liveFen, { skipValidation: true });
    if (game.get(sq)) {
      selected = sq;
      markSelection(sq);
    } else {
      shrug();
    }
  };

  stage.addEventListener(
    "pointerdown",
    (e) => {
      if (blocked(e)) return;
      const p = logicalPoint(stage, e);
      const sq = p && chessSquareAt(flip, p);
      if (!sq) {
        deselect(); // off-board: drop any selection, let the click resume
        return;
      }
      if (Chess) {
        onSquare(sq);
        return;
      }
      void import("chess.js").then((m) => {
        Chess = m.Chess as unknown as ChessCtor;
        onSquare(sq);
      });
    },
    true,
  );
  // A paused click on the board is instrument input, never the play/pause
  // toggle — same capture-phase suppression as the piano's keys.
  stage.addEventListener(
    "click",
    (e) => {
      if (blocked(e)) return;
      const p = logicalPoint(stage, e);
      if (p && chessSquareAt(flip, p) !== null) e.stopPropagation();
    },
    true,
  );
}
