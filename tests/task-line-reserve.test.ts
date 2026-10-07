// The page's heading stays on top through an ask (house rule, 2026-10-07):
// the ask's task line stands UNDER the heading, never in its place, and the
// figure keeps that line free — a page with a heading that asks on the
// figure lowers its heading floor by TASK_LINE_H, so plots, axis captions
// and what is placed above something start under the line, not on it.
import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { expandSpec } from "../src/spec/expand";
import { layoutSpec } from "../src/layout/layout";
import { headingFloorY } from "../src/layout/canvas";
import { unionBBoxForId } from "../src/layout/boxes";
import { heuristicMeasure } from "../src/layout/measure";
import { TASK_LINE_H, opensFigureGate, reservesTaskLine } from "../src/layout/page";
import type { Spec } from "../src/spec/types";

const quiz = (name: string): Spec => JSON.parse(readFileSync(new URL(`../library/quiz-owid/${name}.json`, import.meta.url), "utf8")).spec as Spec;

describe("opensFigureGate: the asks whose gate stands a task line under the heading", () => {
  test.each([
    ["a guess on a part", { question: "Draw the rest.", on: "line_1" }],
    ["an estimate slider", { question: "How many?", estimate: { min: 0, max: 10, value: 5 } }],
    ["a choose on drawn things", { question: "Tap one.", choose: ["a", "b"] }],
    ["a tree's blanks", { question: "Fill it.", blanks: ["ev_1"] }],
    ["a tree's pick", { question: "Pick one.", pick: "d1" }],
    ["a spot", { question: "Find it.", spot: "x" }],
    ["a drag widget", { question: "Drag them.", widget: "drag", items: ["a"] }],
  ])("%s: yes", (_name, ask) => {
    expect(opensFigureGate(ask)).toBe(true);
  });
  test("a typed answer (no figure gate): no", () => {
    expect(opensFigureGate({ question: "What is 2 + 2?" })).toBe(false);
  });
  test("say_question: false (quiet: on-canvas buttons): no", () => {
    expect(opensFigureGate({ question: "Tap one.", choose: ["a"], say_question: false })).toBe(false);
  });
  test("no question (test me): no", () => {
    expect(opensFigureGate({ question: "", on: "bar_1" })).toBe(false);
  });
});

describe("reservesTaskLine: the layout decision", () => {
  const ask = { ask: { question: "Drag the bar.", on: "bar_2" } };
  test("a heading and an ask on the figure: reserve", () => {
    expect(reservesTaskLine({ heading: true, commands: [ask] })).toBe(true);
  });
  test("no heading (a bare page): the ask may use the top slot — no reserve", () => {
    expect(reservesTaskLine({ heading: false, commands: [ask] })).toBe(false);
  });
  test("a heading but no ask: no reserve", () => {
    expect(reservesTaskLine({ heading: true, commands: [{}] })).toBe(false);
  });

  // Only what stands on screen WITH the ask moves for its line: a chart drawn
  // after a cards question (tb-still-top, cumulative-co2) keeps its place —
  // and its author's notes beside it keep theirs.
  const figure = (id: string) => ["axes", "bar_1", "bar_2"].includes(id);
  const chooseIcons = { ask: { question: "Tap one.", choose: ["ic_a", "ic_b"] } };
  test("the template's figure on screen at the ask: reserve", () => {
    expect(reservesTaskLine({ heading: true, figure, commands: [{ draw: ["axes", "bar_1"] }, ask] })).toBe(true);
  });
  test("the ask draws the template's part itself (a guess on bar_2): reserve", () => {
    expect(reservesTaskLine({ heading: true, figure, commands: [{ draw: ["ic_a"] }, ask] })).toBe(true);
  });
  test("the chart comes only after the ask: no reserve", () => {
    expect(reservesTaskLine({ heading: true, figure, commands: [{ draw: ["ic_a", "ic_b"] }, chooseIcons, { erase: ["ic_a", "ic_b"] }, { draw: ["axes", "bar_1"] }] })).toBe(false);
  });
  test("the chart erased (or cleared) before the ask: no reserve", () => {
    expect(reservesTaskLine({ heading: true, figure, commands: [{ draw: "axes" }, { erase: "axes" }, chooseIcons] })).toBe(false);
    expect(reservesTaskLine({ heading: true, figure, commands: [{ draw: ["axes"] }, { clear: {} }, chooseIcons] })).toBe(false);
  });
});

/** The highest ink of anything but the heading (logical, y-up). */
function inkTop(spec: Spec): { top: number; id: string } {
  const l = layoutSpec(expandSpec(spec));
  let best = { top: -Infinity, id: "" };
  const ids = new Set(l.drawables.map((d) => d.id).filter((id): id is string => typeof id === "string" && !/^card_\d+_/.test(id) && !id.startsWith("heading_")));
  for (const id of ids) {
    const b = unionBBoxForId(l.drawables, id, heuristicMeasure);
    // Ink placed in the data's own coordinates (a point "at: {data}") is
    // mapped onto the plot by the player, not here: off the page — skipped.
    if (!b || b.x > 1000 || b.y > 750) continue;
    if (b.y + b.h > best.top) best = { top: b.y + b.h, id };
  }
  return best;
}

function underline(spec: Spec): number {
  const s = expandSpec(spec);
  layoutSpec(s);
  return headingFloorY()!;
}

describe("the figure under a heading leaves the task line free", () => {
  for (const name of ["measles-deaths", "population-peak", "news-vs-deaths"]) {
    test(`${name}: the heading floor drops by TASK_LINE_H, and no ink reaches into the line`, () => {
      const spec = quiz(name);
      const noAsk: Spec = { ...spec, commands: (spec.commands ?? []).filter((c) => c.ask === undefined) };
      const plain = underline(noAsk);
      const asked = underline(spec);
      expect(plain - asked).toBeCloseTo(TASK_LINE_H, 5);
      const ink = inkTop(spec);
      expect(ink.top, `${ink.id} reaches ${ink.top}`).toBeLessThanOrEqual(asked);
    });
  }

  test("a page without a heading keeps its layout", () => {
    const spec = quiz("measles-deaths");
    const bare: Spec = { ...spec, heading: false, commands: (spec.commands ?? []).filter((c) => c.card === undefined) };
    const s = expandSpec(bare);
    layoutSpec(s);
    expect(headingFloorY()).toBeNull();
  });
});
