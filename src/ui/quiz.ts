// The identify quiz's stage loop (interactivity spec §9 "identify", §13):
// a figgate overlay poses generated "click the ___" drills against the
// paused figure — same widget geometry as the ask gates, same marks, but
// intrinsic: no spec, no plan steps, never mounted by export. Free play
// stands down automatically while it runs (the instruments' blocked()
// checks see the .cs-figgate). A wrong click reveals the target, a right
// piano click sounds its note; five questions, a score, Again ↻.

import type { RenderHandle } from "../render";
import { chessSquareAt, chessSquareBox, pianoKeyAt, pianoKeyBox, pianoOctaves } from "../render/widgets";
import { clientPointFor, h, logicalPoint } from "./dom";
import { chessQuizTargets, pianoQuizTargets, quizPrompt } from "./quiz-model";

const QUIZ_LEN = 5;
const RIGHT_LINGER_MS = 700;
const WRONG_LINGER_MS = 1500;

export function mountQuiz(stage: HTMLElement, hd: RenderHandle, kind: "chess" | "piano"): void {
  stage.querySelector(".cs-quizgate")?.remove();
  const flip = hd.spec.params?.["flip"] === true;
  const octaves = pianoOctaves(hd.spec.params);

  const gate = h("div", { class: "cs-figgate cs-quizgate" });
  const hint = h("span", { class: "cs-waitgate-pill cs-figgate-hint" });
  const closeBtn = h("button", { class: "cs-cardgate-pill skip cs-figgate-skip", title: "Close the quiz" }, "✕");
  gate.append(hint, closeBtn);

  let targets: string[] = [];
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

  /** The steel ring on the square/key the question meant (wrong answers). */
  const revealTarget = (): void => {
    const box = kind === "chess" ? chessSquareBox(flip, targets[i]) : pianoKeyBox(octaves, targets[i]);
    const c = box && clientPointFor(stage, [box.x + box.w / 2, box.y + box.h / 2]);
    if (!c) return;
    const m = h("span", { class: "cs-figgate-mark from" });
    m.style.left = `${c[0]}px`;
    m.style.top = `${c[1]}px`;
    gate.appendChild(m);
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
    hint.textContent = `🎯 ${quizPrompt(kind, targets[i])} · ${i + 1}/${targets.length}`;
  };

  const showFinal = (): void => {
    clearMarks();
    hint.textContent = `🎯 ${score}/${targets.length}${score === targets.length ? " — perfect!" : ""}`;
    const again = h("button", { class: "cs-cardgate-pill cs-quiz-again" }, "Again ↻");
    again.addEventListener("click", (e) => {
      e.stopPropagation();
      again.remove();
      start();
    });
    gate.appendChild(again);
  };

  const start = (): void => {
    targets = kind === "chess" ? chessQuizTargets(QUIZ_LEN) : pianoQuizTargets(QUIZ_LEN, octaves);
    i = 0;
    score = 0;
    ask();
  };

  gate.addEventListener("click", (e) => {
    e.stopPropagation();
    if (e.target instanceof Element && e.target.closest("button")) return;
    if (waiting || dead) return;
    const p = logicalPoint(stage, e);
    const hit = p && (kind === "chess" ? chessSquareAt(flip, p) : pianoKeyAt(octaves, p));
    if (!hit) return; // off the instrument: not an answer
    waiting = true;
    const right = hit === targets[i];
    markAt(e.clientX, e.clientY, right ? "" : "wrong");
    if (right) {
      score++;
      if (kind === "piano") soundNote(targets[i]);
    } else {
      revealTarget();
    }
    timer = window.setTimeout(() => {
      i++;
      if (i >= targets.length) showFinal();
      else ask();
    }, right ? RIGHT_LINGER_MS : WRONG_LINGER_MS);
  });

  closeBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    teardown();
  });

  stage.classList.add("cs-exploring"); // the big ▶ hides under the gate
  stage.appendChild(gate);
  start();
}
