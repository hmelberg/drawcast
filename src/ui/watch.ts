// How the viewer meets a cast's questions (the player's "⋯" → Questions):
// Interactive — the player stops and waits for them, as it always has;
// Watch — someone else answers on screen, the way a movie does (the quiz
// hovers and settles on the right choice, the typed ask types its answer,
// a guess or a sort is carried to the truth by the laser), and the cast goes
// on by itself; Skip — no questions at all, their stored defaults kept.
//
// Watch is the export's own performance brought to the live player: the
// timeline's `autoAnswers` makes every figure-worked ask (guess, cards, tree,
// formula, widget) demonstrate itself, and the two cards below stand in for
// the quiz and typed-ask cards the exporter paints on its canvas — same
// timings (export/demo.ts), drawn in the DOM.

import type { RenderHandle } from "../render";
import { askDemoAt, askDemoDuration, quizDemoAt, quizDemoDuration } from "../export/demo";
import { h } from "./dom";

export { QUESTION_MODES, isQuestionMode, questionsOption, type QuestionMode } from "../question-mode";
import type { QuestionMode } from "../question-mode";

/** The verdict stands this long when nothing is said after it (as CARD_LINGER_MS). */
const LINGER_MS = 2600;
/** A `wait` (click to continue) holds this long in Watch, then goes on. */
const WAIT_MS = 1200;

type QuizGate = NonNullable<RenderHandle["timeline"]["quizGate"]>;
type AskGate = NonNullable<RenderHandle["timeline"]["askGate"]>;
type InputGate = NonNullable<RenderHandle["timeline"]["inputGate"]>;

/** Runs `frame(elapsed)` every animation frame until it returns true or the signal aborts. */
function animate(signal: AbortSignal, frame: (elapsed: number) => boolean): Promise<void> {
  return new Promise((resolve) => {
    const t0 = performance.now();
    const tick = (): void => {
      if (signal.aborted) return resolve();
      if (frame(performance.now() - t0)) return resolve();
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}

/** The card stays while the explanation plays (the feedback hook removes an
 *  answered card when it ends); the linger is the floor and the backstop. */
function settle(gate: HTMLElement): void {
  gate.classList.add("cs-cardgate-answered");
  window.setTimeout(() => {
    if (!gate.classList.contains("cs-cardgate-explaining")) gate.remove();
  }, LINGER_MS);
}

/** The quiz, answered on screen: the pointer walks the choices and settles on the right one. */
export function watchQuizGate(stage: HTMLElement): QuizGate {
  return async (signal, step) => {
    stage.querySelector(".cs-cardgate")?.remove();
    const pills = step.choices.map((choice, i) => h("button", { class: "cs-cardgate-pill", disabled: "" }, `${i + 1} · ${choice}`) as HTMLButtonElement);
    const card = h("div", { class: "cs-cardgate-card" }, h("div", { class: "cs-cardgate-q" }, step.question), h("div", { class: "cs-cardgate-choices" }, ...pills));
    const gate = h("div", { class: "cs-cardgate cs-cardgate-watch" }, card);
    gate.addEventListener("click", (e) => e.stopPropagation());
    stage.appendChild(gate);
    await animate(signal, (t) => {
      const f = quizDemoAt(t, pills.length, step.correct);
      pills.forEach((p, i) => p.classList.toggle("is-hover", f.hover === i && !f.selected));
      if (f.selected) pills[step.correct]?.classList.add("right");
      return f.done || t >= quizDemoDuration(pills.length);
    });
    if (signal.aborted) gate.remove();
    else settle(gate);
    // As the exporter's: null — an auto answer is right by definition.
    return null;
  };
}

/** The typed ask, answered on screen: its answer (or default) types itself. */
export function watchAskGate(stage: HTMLElement): AskGate {
  return async (signal, step) => {
    stage.querySelector(".cs-cardgate")?.remove();
    const text = step.answer ?? step.fallback ?? "";
    const field = h("div", { class: "cs-cardgate-input cs-cardgate-typed" });
    const card = h("div", { class: "cs-cardgate-card" }, h("div", { class: "cs-cardgate-q" }, step.question), h("div", { class: "cs-cardgate-inputrow" }, field));
    const gate = h("div", { class: "cs-cardgate cs-cardgate-watch" }, card);
    gate.addEventListener("click", (e) => e.stopPropagation());
    stage.appendChild(gate);
    await animate(signal, (t) => {
      const f = askDemoAt(t, text);
      field.textContent = text.slice(0, f.typedChars);
      return f.done || t >= askDemoDuration(text);
    });
    if (signal.aborted) {
      gate.remove();
      return null;
    }
    settle(gate);
    return text;
  };
}

/** Watch goes on by itself: a click-to-continue holds a moment, then continues. */
const watchInputGate: InputGate = (signal) =>
  new Promise<void>((resolve) => {
    const t = window.setTimeout(resolve, WAIT_MS);
    signal.addEventListener("abort", () => { window.clearTimeout(t); resolve(); }, { once: true });
  });

/**
 * Puts one mounted cast in a mode. `live` holds the gates the controls built
 * for a viewer at the figure, so Interactive can be put back mid-cast. A
 * question already open keeps the mode it opened in; the next one follows.
 */
export function applyQuestionMode(
  hd: RenderHandle,
  stage: HTMLElement,
  mode: QuestionMode,
  live: { quiz: QuizGate | null; ask: AskGate | null; input: InputGate | null },
): void {
  const tl = hd.timeline;
  tl.setSkipQuestions(mode === "skip");
  const watch = mode === "watch";
  tl.autoAnswers = watch;
  tl.quizGate = watch ? watchQuizGate(stage) : live.quiz;
  tl.askGate = watch ? watchAskGate(stage) : live.ask;
  tl.inputGate = watch ? watchInputGate : live.input;
}
