// The identify quiz's stage loop (interactivity spec §9 "identify", §13):
// a figgate overlay poses generated "click the ___" drills against the
// paused figure — same widget geometry as the ask gates, same marks, but
// intrinsic: no spec, no plan steps, never mounted by export. Free play
// stands down automatically while it runs (the instruments' blocked()
// checks see the .cs-figgate). A wrong click reveals the target, a right
// piano click sounds its note; five questions, a score, Again ↻.
//
// Three data spaces, one loop. A question is a prompt plus the set of
// answers that count plus the cells to ring on a miss — the set is what lets
// the periodic table ask "click a halogen", where five different clicks are
// all correct, without the loop knowing anything about chemistry.

import type { RenderHandle } from "../render";
import {
  chessSquareAt,
  chessSquareBox,
  periodicCellAt,
  periodicCellBox,
  periodicSymbols,
  pianoKeyAt,
  pianoKeyBox,
  pianoOctaves,
} from "../render/widgets";
import { elementBBoxes } from "../layout/layout";
import type { BBox } from "../layout/geometry";
import { makeBrowserMeasure } from "../render/svg-backend";
import { getLoadedEngines } from "../scenes/engines";
import type { ElementsEngine } from "../scenes/elements/types";
import { clientPointFor, h, logicalPoint } from "./dom";
import { chessQuizTargets, periodicQuizTargets, pianoQuizTargets, quizPrompt, type Activity } from "./quiz-model";

const QUIZ_LEN = 5;
const RIGHT_LINGER_MS = 700;
const WRONG_LINGER_MS = 1500;

/** One question: what to ask, what counts, and what a miss should reveal. */
interface Question {
  prompt: string;
  accepts: string[];
  reveal: string[];
}

export function mountQuiz(stage: HTMLElement, hd: RenderHandle, activity: Activity): void {
  stage.querySelector(".cs-quizgate, .cs-vsgate")?.remove();
  const kind = activity.kind;
  const flip = hd.spec.params?.["flip"] === true;
  const octaves = pianoOctaves(hd.spec.params);

  // The periodic table's geometry is the layout's own cell ids, so the boxes
  // are measured once here rather than recomputed per click (the info card
  // caches the same map for the same reason).
  let cellBoxes: ReadonlyMap<string, BBox> | null = null;
  const boxes = (): ReadonlyMap<string, BBox> => (cellBoxes ??= elementBBoxes(hd.layout, makeBrowserMeasure()));

  const gate = h("div", { class: "cs-figgate cs-quizgate" });
  const hint = h("span", { class: "cs-waitgate-pill cs-figgate-hint" });
  const closeBtn = h("button", { class: "cs-cardgate-pill skip cs-figgate-skip", title: "Close the quiz" }, "✕");
  gate.append(hint, closeBtn);

  let questions: Question[] = [];
  let i = 0;
  let score = 0;
  let waiting = false; // the linger between questions ignores clicks
  let timer = 0;
  let dead = false;

  const teardown = (): void => {
    if (dead) return;
    dead = true;
    window.clearTimeout(timer);
    hd.timeline.callbacks.onState = prevOnState;
    hd.timeline.callbacks.onStep = prevOnStep;
    stage.classList.remove("cs-exploring");
    gate.remove();
  };

  // Any honest timeline movement ends the drill — play resumes the movie,
  // a scrub/step lands a different scene under the questions. Chained, and
  // restored on teardown (nothing else chains during the quiz's lifetime).
  const prevOnState = hd.timeline.callbacks.onState;
  hd.timeline.callbacks.onState = (s) => {
    prevOnState?.(s);
    if (s === "playing") teardown();
  };
  const prevOnStep = hd.timeline.callbacks.onStep;
  hd.timeline.callbacks.onStep = (completed, total) => {
    prevOnStep?.(completed, total);
    teardown();
  };

  const clearMarks = (): void => {
    for (const m of gate.querySelectorAll(".cs-figgate-mark")) m.remove();
  };

  const markAt = (clientX: number, clientY: number, cls: string): void => {
    const gr = gate.getBoundingClientRect();
    const m = h("span", { class: `cs-figgate-mark${cls ? ` ${cls}` : ""}` });
    m.style.left = `${clientX - gr.left}px`;
    m.style.top = `${clientY - gr.top}px`;
    gate.appendChild(m);
  };

  /** Where one answer lives on the figure, in logical units. */
  const boxFor = (answer: string): BBox | null =>
    kind === "chess" ? chessSquareBox(flip, answer) : kind === "piano" ? pianoKeyBox(octaves, answer) : periodicCellBox(boxes(), answer);

  /** The answer under a click, or null off the instrument. */
  const hitAt = (p: [number, number]): string | null =>
    kind === "chess" ? chessSquareAt(flip, p) : kind === "piano" ? pianoKeyAt(octaves, p) : periodicCellAt(boxes(), p);

  /** The steel ring on every cell the question would have accepted. */
  const revealTarget = (): void => {
    for (const answer of questions[i].reveal) {
      const box = boxFor(answer);
      const c = box && clientPointFor(stage, [box.x + box.w / 2, box.y + box.h / 2]);
      if (!c) continue;
      const m = h("span", { class: "cs-figgate-mark from" });
      m.style.left = `${c[0]}px`;
      m.style.top = `${c[1]}px`;
      gate.appendChild(m);
    }
  };

  const soundNote = (note: string): void => {
    try {
      hd.timeline.tones?.play([{ notes: `${note}:q` }], 160);
    } catch {
      /* silent */
    }
  };

  const ask = (): void => {
    clearMarks();
    waiting = false;
    // The drill's own icon, from the pill the viewer pressed — slicing code
    // units off an emoji is a trap waiting for a two-glyph label.
    const icon = activity.label.split(" ")[0];
    hint.textContent = `${icon} ${questions[i].prompt} · ${i + 1}/${questions.length}`;
  };

  const showFinal = (): void => {
    clearMarks();
    hint.textContent = `🎯 ${score}/${questions.length}${score === questions.length ? " — perfect!" : ""}`;
    const again = h("button", { class: "cs-cardgate-pill cs-quiz-again" }, "Again ↻");
    again.addEventListener("click", (e) => {
      e.stopPropagation();
      again.remove();
      start();
    });
    gate.appendChild(again);
  };

  /** The drawn elements this figure can be asked about — the drill's whole
   *  data space, exactly as the piano's is the keys it drew. */
  const drawnElements = () => {
    let eng: ElementsEngine;
    try {
      eng = getLoadedEngines(["elements"]).elements as ElementsEngine;
    } catch {
      return []; // a periodic figure cannot be on screen without its engine, but never throw at a viewer
    }
    return periodicSymbols(boxes().keys())
      .map((s) => eng.bySymbol(s))
      .filter((e): e is NonNullable<typeof e> => e !== null);
  };

  const start = (): void => {
    questions =
      kind === "chess"
        ? chessQuizTargets(QUIZ_LEN).map((sq) => ({ prompt: quizPrompt("chess", sq), accepts: [sq], reveal: [sq] }))
        : kind === "piano"
          ? pianoQuizTargets(QUIZ_LEN, octaves).map((n) => ({ prompt: quizPrompt("piano", n), accepts: [n], reveal: [n] }))
          : periodicQuizTargets(activity.id, QUIZ_LEN, drawnElements());
    i = 0;
    score = 0;
    if (questions.length === 0) {
      // Nothing this figure can be asked (a table showing one element, a
      // family drill with no family of two). Say so rather than showing an
      // empty gate the viewer has to work out for themselves.
      hint.textContent = "Not enough drawn here to quiz — try the whole table.";
      return;
    }
    ask();
  };

  gate.addEventListener("click", (e) => {
    e.stopPropagation();
    if (e.target instanceof Element && e.target.closest("button")) return;
    if (waiting || dead || questions.length === 0) return;
    const p = logicalPoint(stage, e);
    const hit = p && hitAt(p);
    if (!hit) return; // off the instrument: not an answer
    waiting = true;
    const right = questions[i].accepts.includes(hit);
    markAt(e.clientX, e.clientY, right ? "" : "wrong");
    if (right) {
      score++;
      if (kind === "piano") soundNote(questions[i].accepts[0]);
    } else {
      revealTarget();
    }
    timer = window.setTimeout(
      () => {
        i++;
        if (i >= questions.length) showFinal();
        else ask();
      },
      right ? RIGHT_LINGER_MS : WRONG_LINGER_MS,
    );
  });

  closeBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    teardown();
  });

  stage.classList.add("cs-exploring"); // the big ▶ hides under the gate
  stage.appendChild(gate);
  start();
}
