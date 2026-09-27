import { beforeAll, describe, expect, test } from "vitest";
import { ensureEnginesForSpecs, enginesForSpec } from "../src/scenes/engines";
import { layoutSpec, elementBBoxes } from "../src/layout/layout";
import { expandSpec } from "../src/spec/expand";
import type { Spec } from "../src/spec/types";

// The prompt's own example (compiler-v1.md, `scratch`): words, then formulas.
const spec = (): Spec => ({
  elements: [
    {
      id: "ev",
      type: "scratch",
      work: ["Expected value = Σ chance × payoff", { tex: "EV = 0.85 \\times 9.2 + 0.15 \\times 5.1" }, { tex: "\\approx 8.6" }],
      x: 660,
      y: 235,
    },
  ],
  commands: [{ draw: ["ev_box", "ev_line_1"] }, { draw: ["ev_line_2"] }, { draw: ["ev_line_3"] }],
});

describe("scratch card with {tex} work lines", () => {
  // Engines are loaded from the spec as written, before expansion: a
  // formula inside `work` must ask for mathjax, or its line never exists.
  beforeAll(async () => { await ensureEnginesForSpecs([spec()]); });

  test("enginesForSpec asks for mathjax when a scratch line is a formula", () => {
    expect(enginesForSpec(spec())).toEqual(["mathjax"]);
    expect(enginesForSpec({ elements: [{ id: "s", type: "scratch", work: ["only words"], x: 1, y: 1 }], commands: [] })).toEqual([]);
  });

  test("expands to one line per entry, formulas as math a size up (to read as the words do), all grouped", () => {
    const els = expandSpec(spec()).elements!;
    const byId = new Map(els.map((e) => [e.id, e]));
    expect(byId.get("ev_line_1")).toMatchObject({ type: "text", font_size: 24 });
    expect(byId.get("ev_line_2")).toMatchObject({ type: "math", tex: "EV = 0.85 \\times 9.2 + 0.15 \\times 5.1", size: 30 });
    expect(byId.get("ev_line_3")).toMatchObject({ type: "math", size: 30 });
    expect(byId.get("ev")).toMatchObject({ type: "group", members: ["ev_box", "ev_line_1", "ev_line_2", "ev_line_3"] });
  });

  // The prompt's card, and one of formulas alone: the box is sized by its
  // widest formula, not only by its words.
  const formulasOnly = (): Spec => ({
    elements: [{ id: "ev", type: "scratch", work: [{ tex: "EV = 0.85 \\times 9.2 + 0.15 \\times 5.1 + 0.25 \\times 3.3" }, { tex: "\\approx 8.6" }], x: 500, y: 400 }],
    commands: [{ draw: ["ev"] }],
  });
  test.each([
    ["words and formulas", spec, 3],
    ["formulas alone", formulasOnly, 2],
  ] as const)("%s: lays out without errors, every line inside the box", (_, make, n) => {
    const r = layoutSpec(expandSpec(make()));
    expect(r.issues.filter((i) => i.severity === "error")).toEqual([]);
    const b = elementBBoxes(r);
    const box = b.get("ev_box")!;
    for (const id of Array.from({ length: n }, (_, i) => `ev_line_${i + 1}`)) {
      const l = b.get(id);
      expect(l, id).toBeDefined();
      expect(l!.w, id).toBeGreaterThan(0);
      expect(l!.x, id).toBeGreaterThanOrEqual(box.x);
      expect(l!.x + l!.w, id).toBeLessThanOrEqual(box.x + box.w);
      expect(l!.y, id).toBeGreaterThanOrEqual(box.y);
      expect(l!.y + l!.h, id).toBeLessThanOrEqual(box.y + box.h);
    }
  });
});
