// Drill openings (design 2026-09-20-chess-openings-drill §5, §8, §9): a
// quiz-style session overlay on a chess scene, modelled on mountChessVs
// (src/ui/chessvs.ts) — the viewer is named an opening and a side, plays the
// line from the initial position (never the storyboard's own boundary — the
// drill always starts fresh), is corrected strictly on a wrong-but-legal
// move, and is handed another opening once the line is complete, weighted
// toward whichever ones recent misses keep landing on (chess-openings-store).
//
// Rides the same free-play machinery as chessvs/chessplay: every position is
// a param preview (fen override + revealNew), so ✕ hands the lesson's exact
// position back and play/scrub tear the session down on their own.

import type { RenderHandle } from "../render";
import { chessSquareBox } from "../render/widgets";
import { clientPointFor, h } from "./dom";
import { attachChessDrag } from "./chess-drag";
import { selectionTargets, type ChessCtor, type ChessLike } from "./chessplay-model";
import { readShowLegalMoves } from "./chess-prefs";
import { BUILT_IN_OPENINGS, matchingOpenings, plyList, validateSet, type Opening } from "./chess-openings";
import { pickOpening, readHistory, recordAttempt } from "./chess-openings-store";

const THINK_MS = 650;

interface DrillGame extends ChessLike {
  undo(): unknown;
}

type Plies = ReturnType<typeof plyList>;

export function mountChessDrill(stage: HTMLElement, hd: RenderHandle): void {
  stage.querySelector(".cs-quizgate, .cs-vsgate, .cs-drillgate")?.remove();

  const gate = h("div", { class: "cs-figgate cs-drillgate" });
  const hint = h("span", { class: "cs-waitgate-pill cs-figgate-hint" }, "♟ Loading…");
  const closeBtn = h("button", { class: "cs-cardgate-pill skip cs-figgate-skip", title: "Back to the lesson" }, "✕");
  gate.append(hint, closeBtn);

  let Chess: ChessCtor | null = null;
  let game: DrillGame | null = null;

  // The set this session drills, and the built-in fallback's own dropped-row
  // notice — surfaced once, in the very first round's hint, never again.
  let set: readonly Opening[] = BUILT_IN_OPENINGS;
  let droppedNote = "";

  let opening: Opening = BUILT_IN_OPENINGS[0];
  let plies: Plies = [];
  let drilled: "w" | "b" = "w";
  let flip = false; // the board turns to face the side being drilled (§8)
  let ply = 0; // plies of the line already played, either side
  let misses = 0; // on the CURRENT ply only
  let roundClean = true; // false the moment any ply takes a miss

  let selected: string | null = null;
  let busy = true; // the opponent is "thinking", or nothing has loaded yet
  let over = false; // this round is finished; the Again pill is up
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
    // ✕ hands the lesson's position back; play/scrub already settle it. This
    // also un-does the `flip` override paint() applies below — renderUpTo
    // recommits the boundary's own (unflipped, or however-authored) params.
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

  /** End the current round: record the attempt, name the idea, offer Again. */
  function finishRound(): void {
    over = true;
    busy = true;
    selected = null;
    clearMarks();
    recordAttempt(opening.name, roundClean);
    const verdict = roundClean ? "Nailed it." : "Got there.";
    hint.textContent = `♟ ${opening.name} — ${verdict}${opening.idea ? ` ${opening.idea}` : ""}`;
    const again = h("button", { class: "cs-cardgate-pill cs-quiz-again" }, "Again ↻");
    again.addEventListener("click", (e) => {
      e.stopPropagation();
      again.remove();
      startRound();
    });
    gate.appendChild(again);
  }

  /** Play plies[ply] for the side NOT being drilled, after a thinking beat. */
  function opponentMove(): void {
    busy = true;
    timer = window.setTimeout(() => {
      if (dead || !game || over) return;
      const mv = plies[ply];
      if (!mv) {
        // Defensive only: plies is fixed for the round and ply is clamped to
        // it below every increment, so this should never be reached.
        finishRound();
        return;
      }
      try {
        game.move({ from: mv.from, to: mv.to, promotion: "q" });
      } catch {
        // The line was proved legal end-to-end by plyList; a throw here
        // would mean the board and `plies` have drifted apart. Fail closed
        // rather than let it propagate into the click handler.
        finishRound();
        return;
      }
      ply++;
      paint();
      clearMarks();
      ringAt(mv.from, "from");
      ringAt(mv.to, "");
      if (ply >= plies.length) finishRound();
      else busy = false;
    }, THINK_MS);
  }

  /**
   * A completed from -> to, whether clicked or dragged: the judging core.
   * Illegal (chess.js rejects it outright) is a mis-click, not a miss — the
   * selection is left standing so the viewer can re-aim, exactly as
   * chessvs treats an illegal move.
   */
  function tryMove(from: string, to: string): void {
    if (!game || busy || over) return;
    let played: { san: string } | null = null;
    try {
      played = game.move({ from, to, promotion: "q" }) as { san: string } | null;
    } catch {
      return; // illegal: keep the selection and let them re-aim, as chessvs does
    }
    if (!played) return;

    const want = plies[ply];
    if (from === want.from && to === want.to) {
      ply++;
      selected = null;
      paint();
      clearMarks();
      ringAt(want.from, "from");
      ringAt(want.to, "");
      misses = 0;
      if (ply >= plies.length) finishRound();
      else opponentMove();
      return;
    }

    // A wrong move is taken back. Name it if the line it WOULD make belongs
    // to something else in the set — that is the whole point of carrying a
    // set of mutual confusions (design §6).
    const attempted = [...plies.slice(0, ply).map((p) => p.san), played.san];
    game.undo();
    selected = null;
    paint();
    clearMarks();
    roundClean = false;
    misses++;
    const other = matchingOpenings(set, attempted).find((o) => o.name !== opening.name);
    hint.textContent = other
      ? `♟ That's the ${other.name}. The ${opening.name} plays ${want.san}.`
      : `♟ Not this line — the ${opening.name} plays ${want.san}.`;

    if (misses >= 2) {
      // Nobody is stranded on a line they have never seen. Still a miss.
      try {
        game.move({ from: want.from, to: want.to, promotion: "q" });
      } catch {
        finishRound();
        return;
      }
      ply++;
      paint();
      clearMarks();
      ringAt(want.from, "from");
      ringAt(want.to, "");
      misses = 0;
      // The reveal just put `want` on the board — restate the hint in the
      // past tense so it describes what the viewer is looking at, not a
      // move that is no longer to come.
      hint.textContent = other
        ? `♟ That's the ${other.name}. The ${opening.name} played ${want.san}.`
        : `♟ Not this line — the ${opening.name} played ${want.san}.`;
      if (ply >= plies.length) finishRound();
      else opponentMove();
    }
  }

  /** Pick the next opening, reset the round state, and let the drilled side
   *  make (or receive) the opening move. */
  function startRound(): void {
    if (!Chess || dead) return;
    let freshOpening: Opening;
    let freshPlies: Plies;
    try {
      freshOpening = pickOpening(set, readHistory(), Math.random);
      freshPlies = plyList(Chess, freshOpening);
    } catch {
      // Should never happen: `set` is either BUILT_IN_OPENINGS (legality
      // proved by tests/chess-openings.test.ts) or already survived this
      // exact plyList call once, inside validateSet. pickOpening's own
      // history lookup has its own failure mode — an opening named for an
      // inherited Object.prototype member — and is guarded against it at
      // the source (chess-openings-store.ts); this catch is the fail-closed
      // net for both, rather than throw out of a click handler (Again) or
      // the mount itself.
      hint.textContent = "♟ This opening set could not be replayed.";
      over = true;
      busy = true;
      return;
    }
    opening = freshOpening;
    plies = freshPlies;
    drilled = opening.side === "white" ? "w" : "b";
    flip = drilled === "b";
    ply = 0;
    misses = 0;
    roundClean = true;
    selected = null;
    over = false;
    clearMarks();
    game = new Chess() as unknown as DrillGame;
    paint();
    const intro = `♟ Play the ${opening.name}. You are ${drilled === "w" ? "White" : "Black"}.`;
    hint.textContent = droppedNote + intro;
    droppedNote = "";
    if (drilled === "b") opponentMove();
    else busy = false;
  }

  /** The viewer named a square — by clicking it, or by letting a carried
   *  piece go on it (ui/chess-drag.ts): one handler, two gestures, and one
   *  place where a wrong-but-legal move is still a miss. */
  const onSquare = (sq: string): void => {
    if (busy || over || dead || !game) return;
    if (selected === null) {
      const piece = game.get(sq);
      if (!piece || piece.color !== drilled) return;
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
    if (other && other.color === drilled) {
      selected = sq; // switching pieces
      markSelection(sq);
      return;
    }
    tryMove(selected, sq);
  };

  attachChessDrag(stage, hd, {
    target: gate,
    flip: () => flip, // the board turns to face the side being drilled
    grabbable: (sq) => !busy && !over && !dead && game?.get(sq)?.color === drilled,
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
    const validated = validateSet(Chess, hd.spec.params?.["openings"]);
    set = validated.set.length > 0 ? validated.set : BUILT_IN_OPENINGS;
    if (validated.dropped.length > 0) {
      const n = validated.dropped.length;
      droppedNote = `♟ Dropped ${n} invalid opening row${n === 1 ? "" : "s"} (${validated.dropped.join(", ")}). `;
    }
    startRound();
  });
}
