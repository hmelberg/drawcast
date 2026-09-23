// Play vs computer (interactivity spec §13): a quiz-style session overlay
// on a chess scene — the viewer plays the side to move in the storyboard's
// position, the built-in opponent (chess-ai) answers after a beat. Rides
// the same machinery as free play: every position is a param preview
// (fen override + revealNew), so ✕ hands back the lesson's exact position
// and play/scrub tears the session down. The overlay is a .cs-figgate, so
// free play and the piano stand down automatically while it runs.

import type { RenderHandle } from "../render";
import type { ActivityClose } from "./quiz";
import { chessSquareBox } from "../render/widgets";
import { clientPointFor, h } from "./dom";
import { attachChessDrag } from "./chess-drag";
import { boundaryChessFen } from "./chessplay";
import { selectionTargets, type ChessCtor, type ChessLike } from "./chessplay-model";
import { boardFlip, readShowLegalMoves } from "./chess-prefs";
import { bestReply, type AiChessCtor } from "./chess-ai";

const THINK_MS = 650;

interface ChessGame extends ChessLike {
  moves(opts: { verbose: true }): unknown[];
  isCheckmate(): boolean;
  isStalemate(): boolean;
  isDraw(): boolean;
  turn(): "w" | "b";
}

export function mountChessVs(stage: HTMLElement, hd: RenderHandle, onClose?: ActivityClose): void {
  stage.querySelector(".cs-quizgate, .cs-vsgate, .cs-drillgate")?.remove();
  // The board the viewer pressed the pill on — turned with ⇅ or not — is the
  // board they play on. Fixed for the session: the tray is shut while it runs.
  const flip = boardFlip(hd);

  const gate = h("div", { class: "cs-figgate cs-vsgate" });
  const hint = h("span", { class: "cs-waitgate-pill cs-figgate-hint" }, "♟ Loading…");
  const closeBtn = h("button", { class: "cs-cardgate-pill skip cs-figgate-skip", title: "Back to the lesson" }, "✕");
  gate.append(hint, closeBtn);

  let game: ChessGame | null = null;
  let Chess: ChessCtor | null = null;
  let startFen = "";
  let viewerColor: "w" | "b" = "w";
  let selected: string | null = null;
  let busy = false; // the computer is thinking, or the session hasn't loaded
  let over = false;
  let timer = 0;
  let dead = false;

  const teardown = (restore: boolean): void => {
    if (dead) return;
    dead = true;
    window.clearTimeout(timer);
    hd.timeline.callbacks.onState = prevOnState;
    hd.timeline.callbacks.onStep = prevOnStep;
    stage.classList.remove("cs-exploring");
    gate.remove();
    onClose?.(null);
    // ✕ hands the lesson's position back; play/scrub already settle it.
    if (restore) hd.timeline.renderUpTo(hd.timeline.position);
  };

  const prevOnState = hd.timeline.callbacks.onState;
  hd.timeline.callbacks.onState = (s) => {
    prevOnState?.(s);
    if (s === "playing") teardown(false);
  };
  const prevOnStep = hd.timeline.callbacks.onStep;
  hd.timeline.callbacks.onStep = (completed, total) => {
    prevOnStep?.(completed, total);
    teardown(false);
  };

  const clearMarks = (): void => {
    for (const m of gate.querySelectorAll(".cs-figgate-mark, .cs-chessdot")) m.remove();
  };
  const place = (sq: string, className: string): void => {
    const box = chessSquareBox(flip, sq);
    const c = box && clientPointFor(stage, [box.x + box.w / 2, box.y + box.h / 2]);
    if (!c) return;
    const m = h("span", { class: className });
    m.style.left = `${c[0]}px`;
    m.style.top = `${c[1]}px`;
    gate.appendChild(m);
  };
  const ringAt = (sq: string, cls: string): void => place(sq, `cs-figgate-mark${cls ? ` ${cls}` : ""}`);

  /** Ring the grabbed piece and dot its legal targets (ring = a capture). */
  const markSelection = (sq: string): void => {
    clearMarks();
    ringAt(sq, "from");
    if (!Chess || !game) return;
    // Where it may go is a SETTING, off by default — the ring above is not
    // part of it: that says what you picked up (chessplay-model).
    for (const m of selectionTargets(Chess, game.fen(), sq, readShowLegalMoves())) {
      place(m.sq, m.capture ? "cs-figgate-mark cs-chesstake" : "cs-chessdot");
    }
  };

  const paint = (): void => {
    if (!game) return;
    hd.timeline.previewParams({ fen: game.fen(), moves: [], plies_shown: 0, flip }, { revealNew: true });
  };

  /** Game-over check; sets the final hint and the Again button. True if over. */
  const maybeFinish = (): boolean => {
    if (!game) return true;
    let line: string | null = null;
    if (game.isCheckmate()) line = game.turn() === viewerColor ? "♟ Checkmate — the computer wins." : "♟ Checkmate — you win! 🎉";
    else if (game.isStalemate()) line = "♟ Stalemate — a draw.";
    else if (game.isDraw()) line = "♟ A draw.";
    if (line === null) return false;
    over = true;
    hint.textContent = line;
    const again = h("button", { class: "cs-cardgate-pill cs-quiz-again" }, "Again ↻");
    again.addEventListener("click", (e) => {
      e.stopPropagation();
      again.remove();
      start();
    });
    gate.appendChild(again);
    return true;
  };

  const yourMove = (): void => {
    busy = false;
    hint.textContent = `♟ Your move (${viewerColor === "w" ? "White" : "Black"}) — drag a piece, or click it and its square`;
  };

  const computerMove = (): void => {
    busy = true;
    hint.textContent = "♟ Thinking…";
    timer = window.setTimeout(() => {
      if (dead || !game || !Chess) return;
      const reply = bestReply(Chess as unknown as AiChessCtor, game.fen());
      if (reply === null) {
        // No legal reply and not a detected end: treat as a draw-ish stop.
        if (!maybeFinish()) {
          over = true;
          hint.textContent = "♟ The computer has no move.";
        }
        return;
      }
      try {
        game.move({ from: reply.from, to: reply.to, promotion: reply.promotion ?? "q" });
      } catch {
        over = true;
        return;
      }
      paint();
      clearMarks();
      ringAt(reply.from, "from");
      ringAt(reply.to, "");
      if (!maybeFinish()) yourMove();
    }, THINK_MS);
  };

  const start = (): void => {
    if (!Chess) return;
    over = false;
    clearMarks();
    game = new Chess(startFen, { skipValidation: true }) as unknown as ChessGame;
    paint();
    yourMove();
  };

  /** The viewer named a square — by clicking it, or by letting a carried
   *  piece go on it (ui/chess-drag.ts): one handler, two gestures. */
  const onSquare = (sq: string): void => {
    if (busy || over || dead || !game) return;
    if (selected === null) {
      const piece = game.get(sq);
      if (!piece || piece.color !== viewerColor) return;
      selected = sq;
      markSelection(sq);
      return;
    }
    if (sq === selected) {
      selected = null;
      clearMarks();
      return;
    }
    const other = game.get(sq);
    if (other && other.color === viewerColor) {
      selected = sq; // switching pieces
      markSelection(sq);
      return;
    }
    try {
      game.move({ from: selected, to: sq, promotion: "q" });
    } catch {
      return; // illegal: keep the selection, let them re-aim
    }
    selected = null;
    clearMarks();
    paint();
    if (!maybeFinish()) computerMove();
  };

  attachChessDrag(stage, hd, {
    target: gate,
    flip: () => flip,
    grabbable: (sq) => !busy && !over && !dead && game?.get(sq)?.color === viewerColor,
    deliver: onSquare,
    blocked: (e) => e.target instanceof Element && e.target.closest("button") !== null,
  });
  // The press has already been read; this only keeps the click off the
  // stage's play/pause toggle underneath.
  gate.addEventListener("click", (e) => e.stopPropagation());

  closeBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    teardown(true);
  });

  stage.classList.add("cs-exploring");
  stage.appendChild(gate);

  void import("chess.js").then((m) => {
    if (dead) return;
    Chess = m.Chess as unknown as ChessCtor;
    const fen = boundaryChessFen(hd, Chess);
    const board = fen?.split(" ")[0] ?? "";
    if (!fen || !board.includes("K") || !board.includes("k")) {
      over = true;
      hint.textContent = "♟ This position has no kings to play for.";
      return;
    }
    startFen = fen;
    viewerColor = (fen.split(" ")[1] as "w" | "b") ?? "w";
    start();
  });
}
