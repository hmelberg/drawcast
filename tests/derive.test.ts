// A derivation as a structure (spec/derive.ts): `steps` on a math element,
// one `step` beat per line — copy, move down, morph — the idiom as sugar.
import { beforeAll, describe, expect, test } from "vitest";
import { expandSpec } from "../src/spec/expand";
import { expandDerivations, stepGap } from "../src/spec/derive";
import { validateSpec } from "../src/spec/schema";
import { layoutSpec, elementBBoxes } from "../src/layout/layout";
import { heuristicMeasure } from "../src/layout/measure";
import { planCommands } from "../src/render/plan";
import { planOptionsFor } from "../src/render/index";
import { ensureEngines } from "../src/scenes/engines";
import type { Spec } from "../src/spec/types";

beforeAll(async () => {
  await ensureEngines(["mathjax"] as never);
});

const spec = (): Spec =>
  ({
    elements: [{ id: "eq", type: "math", tex: "2x + 3 = 11", x: 300, y: 560, size: 34, steps: ["2x = 8", { tex: "x = 4", note: "halve both sides" }] }],
    commands: [
      { draw: ["eq"], speak: "Solve it." },
      { step: "eq", speak: "Take three from both sides." },
      { step: "eq", speak: "Halve them." },
      { highlight: { target: ["eq_3"] }, speak: "Four." },
    ],
  }) as unknown as Spec;

describe("expandDerivations", () => {
  test("each step is copy → move one line down → morph, the speak riding the morph", () => {
    const out = expandDerivations(spec());
    const gap = stepGap(spec().elements![0]);
    expect(gap).toBe(109);
    expect(out.commands!.slice(1, 4)).toEqual([
      { copy: { target: "eq", as: "eq_2" } },
      { move: { target: "eq_2", by: [0, -gap], duration: 0.6 } },
      { speak: "Take three from both sides.", morph: { target: "eq_2", tex: "2x = 8", duration: 1.5 } },
    ]);
    // the second step copies the LAST line, and its note is drawn
    expect(out.commands!.slice(4, 8)).toEqual([
      { copy: { target: "eq_2", as: "eq_3" } },
      { move: { target: "eq_3", by: [0, -gap], duration: 0.6 } },
      { speak: "Halve them.", morph: { target: "eq_3", tex: "x = 4", duration: 1.5 } },
      { draw: ["eq_3_note"] },
    ]);
    const note = out.elements!.find((e) => e.id === "eq_3_note")!;
    expect(note).toMatchObject({ type: "text", text: "halve both sides", y: 560 - 2 * gap });
  });

  test("in_place morphs the current line; a step past the last line is left for the planner to report", () => {
    const s = spec();
    s.commands = [{ draw: ["eq"] }, { step: { target: "eq", in_place: true } }, { step: "eq" }, { step: "eq" }] as never;
    const out = expandDerivations(s);
    expect(out.commands![1]).toEqual({ morph: { target: "eq", tex: "2x = 8", duration: 1.5 } });
    expect(out.commands!.at(-1)).toEqual({ step: "eq" });
  });

  test("validates, lays out and plans clean — the lines stack below the first", () => {
    const s = spec();
    expect(validateSpec(s).errors).toEqual([]);
    const e = expandSpec(s);
    const l = layoutSpec(e, heuristicMeasure);
    expect(l.issues).toEqual([]);
    const bb = elementBBoxes(l, heuristicMeasure);
    const plan = planCommands(e.commands!, l.order, { bboxOf: (id) => bb.get(id) ?? null, ...planOptionsFor(e, l) });
    expect(plan.warnings).toEqual([]);
    const last = plan.states.at(-1)!;
    expect(last.offsets.eq_3).toEqual([0, -218]);
    expect(last.visible).toEqual(expect.arrayContaining(["eq", "eq_2", "eq_3", "eq_3_note"]));
  });
});
