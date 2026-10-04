// The dev frame harness's list of frames (src/dev/frame-list.ts): every
// question is drawn twice — before the answer and after the reveal — and the
// "before" boundary must not already hold the answer (the cards in true
// order, the guess at its truth, the reveal stamp). Planned the way render()
// plans (as tests/examples.test.ts does), from a quiz card, a cards rank, a
// scale guess and an on-canvas quiz.

import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { expandSpec } from "../src/spec/expand";
import { domainMapping, elementBBoxes, layoutSpec } from "../src/layout/layout";
import { planCommands, sceneAt, type Plan } from "../src/render/plan";
import { cardsPlanFor, formulaHooksFor, guessPartsFor, planOptionsFor } from "../src/render/index";
import { ANSWER_LABEL, frameLabel, frameList, QUESTION_LABEL } from "../src/dev/frame-list";
import type { Spec } from "../src/spec/types";

/** Plan a spec as render() does: with the layout's boxes, cards, formulas and guess parts. */
function planOf(raw: Spec): Plan {
  const spec = expandSpec(raw);
  const layout = layoutSpec(spec);
  const bboxes = elementBBoxes(layout);
  const formulas = formulaHooksFor(spec, bboxes, (l) => elementBBoxes(l), layout.fit?.settle ?? 0);
  return planCommands(spec.commands ?? [], layout.order, {
    bboxOf: (id) => bboxes.get(id) ?? null,
    windows: layout.windows ?? {},
    ...domainMapping(spec.domain, layout.fit),
    animateBase: spec.template ? spec.params ?? {} : null,
    cardsFor: (id) => cardsPlanFor(formulas.cardsOn(id)),
    formulaFor: (id) => {
      const rt = formulas.formula(id);
      return rt ? { blanks: rt.blanks.length } : null;
    },
    guessParts: guessPartsFor(spec, layout),
    ...planOptionsFor(spec, layout),
  });
}

const library = (slug: string): Spec => {
  const j = JSON.parse(readFileSync(new URL(`../library/quiz/${slug}.json`, import.meta.url), "utf8")) as { spec?: Spec } & Spec;
  return j.spec ?? j;
};

/** The before/after pair of every question in the plan, checked for shape. */
function pairs(plan: Plan): { step: number; before: number; after: number }[] {
  const frames = frameList(plan, true);
  const questions = plan.steps.flatMap((s, i) => (s.kind === "quiz" || s.kind === "ask" ? [i] : []));
  expect(questions.length).toBeGreaterThan(0);
  return questions.map((i) => {
    const mine = frames.filter((f) => f.ask === i + 1);
    expect(mine.map((f) => f.changed)).toEqual([QUESTION_LABEL, ANSWER_LABEL]);
    const [before, after] = mine;
    expect(before.before).toBe(true);
    expect(before.at).toBe(i);
    expect(after.at).toBe(i + 1);
    // Both labelled with the question's own step number.
    expect(frameLabel(before)).toBe(`@${i + 1} ${QUESTION_LABEL}`);
    expect(frameLabel(after)).toBe(`@${i + 1} ${ANSWER_LABEL}`);
    // In playing order: the question right before its answer.
    expect(frames.indexOf(after)).toBe(frames.indexOf(before) + 1);
    return { step: i, before: before.at, after: after.at };
  });
}

const offsetOf = (plan: Plan, n: number, id: string): [number, number] => (sceneAt(plan, n).offsets[id] ?? [0, 0]) as [number, number];

describe("question frames: before the answer and after the reveal", () => {
  test("a quiz card with a reveal stamp: the stamp is not there before the answer", () => {
    const plan = planOf(library("coin-streaks"));
    const [q] = pairs(plan);
    const step = plan.steps[q.step] as { stamp?: string };
    expect(step.stamp).toBeDefined();
    expect(sceneAt(plan, q.before).visible).not.toContain(step.stamp);
    expect(sceneAt(plan, q.after).visible).toContain(step.stamp);
  });

  test("on-canvas quiz buttons: the buttons stand before the answer, the reveal stamp does not", () => {
    const plan = planOf(library("true-or-myth"));
    const qs = pairs(plan);
    expect(qs.length).toBe(5);
    for (const q of qs) {
      const step = plan.steps[q.step] as { quiet?: true; stamp?: string; choose?: { id: string }[] };
      expect(step.quiet).toBe(true);
      for (const o of step.choose ?? []) expect(sceneAt(plan, q.before).visible).toContain(o.id);
      expect(sceneAt(plan, q.before).visible).not.toContain(step.stamp);
      expect(sceneAt(plan, q.after).visible).toContain(step.stamp);
    }
  });

  test("a cards rank: before the answer the cards are not yet in their true places", () => {
    const plan = planOf({
      title: "Rank",
      elements: [{ id: "spend", type: "cards", items: ["USA", "Germany", "Norway", "UK"], ends: ["most", "least"], x: 500, y: 400 }],
      commands: [{ draw: ["spend"], speak: "Four countries." }, { ask: { question: "Put them in order of spending.", on: "spend" } }, { speak: "The USA spends most." }],
    } as never);
    const [q] = pairs(plan);
    expect((plan.steps[q.step] as { cards?: string }).cards).toBe("spend");
    // The answer moves cards to their true slots; before it, every card stands at home.
    const after = sceneAt(plan, q.after).offsets;
    const moved = Object.keys(after).filter((id) => id.startsWith("spend") && offsetOf(plan, q.after, id).some((d) => Math.abs(d) > 0.5));
    expect(moved.length).toBeGreaterThan(0);
    for (const id of moved) expect(offsetOf(plan, q.before, id)).toEqual([0, 0]);
  });

  test("cards placed on a timeline: home before the answer, at their years after", () => {
    const plan = planOf(library("cleopatra-closer"));
    const [q] = pairs(plan);
    const moved = Object.keys(sceneAt(plan, q.after).offsets).filter((id) => id.startsWith("when") && offsetOf(plan, q.after, id).some((d) => Math.abs(d) > 0.5));
    expect(moved.length).toBeGreaterThan(0);
    for (const id of moved) expect(offsetOf(plan, q.before, id)).not.toEqual(offsetOf(plan, q.after, id));
  });

  test("a guess on a scale: the true marker is not drawn before the answer", () => {
    const plan = planOf(library("rubiks-cube"));
    const [q] = pairs(plan);
    const shown = sceneAt(plan, q.after).visible.filter((id) => !sceneAt(plan, q.before).visible.includes(id));
    // The guessed part (its truth) arrives with the answer, not before.
    expect(shown.length).toBeGreaterThan(0);
    expect((plan.steps[q.step] as { on?: string[] }).on?.length).toBeGreaterThan(0);
  });

  test("a question whose boundary is also a beat keeps both: the line's own frame and the question pair", () => {
    const plan = planOf(library("coin-streaks"));
    const frames = frameList(plan, true);
    const [q] = pairs(plan);
    expect(frames.filter((f) => f.at === q.before && !f.before).length).toBe(1);
    // One extra frame per question, not more: the answer frame takes the place of the question's own beat.
    expect(frames.filter((f) => f.at === q.after).length).toBe(1);
  });

  test("no question: no pair", () => {
    const plan = planCommands([{ draw: ["a"] }, { speak: "Hi." }, { draw: ["b"] }], ["a", "b"], {});
    expect(frameList(plan, true).some((f) => f.ask !== undefined)).toBe(false);
  });
});
