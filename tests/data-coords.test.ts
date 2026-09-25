// One coordinate rule (2026-09-25): a bare {x, y} is canvas units (a chart
// thing on a page with a domain reads that domain); `{data: [x, y]}` is data
// units — the page's domain, or a template's OWN axes; a move is in the
// units of what it moves.
import { beforeAll, describe, expect, test } from "vitest";
import { layoutSpec, elementBBoxes, domainMapping } from "../src/layout/layout";
import { flattenDrawables } from "../src/layout/model";
import { heuristicMeasure } from "../src/layout/measure";
import { ensureEnabledPacks } from "../src/scenes/packs";
import { planCommands } from "../src/render/plan";
import { planOptionsFor } from "../src/render/index";
import type { Spec } from "../src/spec/types";

beforeAll(async () => {
  await ensureEnabledPacks(["evidence", "economics"] as never);
});

const centre = (spec: object, id: string) => {
  const b = elementBBoxes(layoutSpec(spec as Spec, heuristicMeasure), heuristicMeasure).get(id)!;
  return [b.x + b.w / 2, b.y + b.h / 2];
};
// survival_curve: plot x 120–930 over months 0…(n−1), y 110–630 over 0…1.
const surv = (params: object, elements: object[]) => ({ template: "survival_curve", params: { arms: [{ name: "A", survival: [1, 0.8, 0.6, 0.5, 0.4] }], ...params }, elements, commands: [] });

describe("{data: [x, y]} on a template page lands on the template's axes", () => {
  test("a text at data (2, 0.5)", () => {
    const [x, y] = centre(surv({}, [{ id: "n", type: "text", text: "half", at: { data: [2, 0.5] } }]), "n");
    expect(x).toBeCloseTo(120 + (2 / 4) * 810, 0);
    expect(y).toBeCloseTo(110 + 0.5 * 520, 0);
  });

  test("…and follows params.box, as the template does", () => {
    const spec = surv({ box: { x: 500, y: 150, w: 450, h: 400 } }, [{ id: "n", type: "point", at: { data: [4, 0.4] } }]);
    const l = layoutSpec(spec as Spec, heuristicMeasure);
    // arm A's last sample is (4, 0.4): the point sits on the curve's end.
    const curve = flattenDrawables(l.drawables).find((d) => d.id.startsWith("arm_") && d.kind === "stroke") as { pts: [number, number][] };
    const end = curve.pts[curve.pts.length - 1];
    const b = elementBBoxes(l, heuristicMeasure).get("n")!;
    expect(b.x + b.w / 2).toBeCloseTo(end[0], 0);
    expect(b.y + b.h / 2).toBeCloseTo(end[1], 0);
  });

  test("a path with data: true and an arrow end in data units", () => {
    const spec = surv({}, [
      { id: "p", type: "path", data: true, points: [[0, 1], [4, 1]] },
      { id: "a", type: "arrow", from: { data: [0, 0] }, to: { data: [4, 1] } },
    ]);
    const all = flattenDrawables(layoutSpec(spec as Spec, heuristicMeasure).drawables);
    const p = all.find((d) => d.id === "p") as { pts: [number, number][] };
    expect(p.pts[0][0]).toBeCloseTo(120, 0);
    expect(p.pts[1][0]).toBeCloseTo(930, 0);
    expect(p.pts[0][1]).toBeCloseTo(630, 0);
    const a = all.find((d) => d.id === "a" || d.id.startsWith("a_")) as { pts: [number, number][] };
    expect(a.pts[0][0]).toBeCloseTo(120, 0);
    expect(a.pts[0][1]).toBeCloseTo(110, 0);
  });

  test("the layout reports the page's frame", () => {
    const l = layoutSpec(surv({}, []) as Spec, heuristicMeasure);
    expect(l.frame).toEqual({ x: [0, 4], y: [0, 1], box: { x0: 120, y0: 110, x1: 930, y1: 630 } });
    expect(domainMapping(l.frame, l.fit).toLogical([4, 1])).toEqual([930, 630]);
  });

  test("a bare {x, y} on a template page is still canvas units", () => {
    const [x, y] = centre(surv({}, [{ id: "a", type: "arrow", from: { x: 300, y: 300 }, to: { x: 400, y: 400 } }]), "a");
    expect(x).toBeCloseTo(350, 0);
    expect(y).toBeCloseTo(350, 0);
  });
});

describe("a move is in the units of what it moves", () => {
  const spec = {
    domain: { x: [0, 10], y: [0, 10] },
    elements: [
      { id: "c", type: "curve", expr: "x" },
      { id: "p", type: "point", at: { x: 5, y: 5 } },
      { id: "eq", type: "math", tex: "y = x", x: 700, y: 500 },
    ],
    commands: [{ draw: ["c", "p", "eq"] }, { move: { target: "eq", by: [0, -55] } }, { move: { target: "p", by: [1, 0] } }],
  };
  const plan = () => {
    const l = layoutSpec(spec as never, heuristicMeasure);
    const bb = elementBBoxes(l, heuristicMeasure);
    return planCommands(spec.commands as never, l.order, { bboxOf: (id) => bb.get(id) ?? null, ...domainMapping(spec.domain as never, l.fit), ...planOptionsFor(spec as never, l) });
  };
  test("a formula moves 55 canvas units, not 55 domain units", () => {
    expect(plan().states[1].offsets.eq).toEqual([0, -55]);
  });
  test("a point moves in domain units", () => {
    expect(plan().states[2].offsets.p[0]).toBeCloseTo(81, 0); // 1 of 10 domain units over 810
  });
});

describe("a verb's point in data units", () => {
  test("point.at {data} on a template page", () => {
    const spec = { ...surv({}, []), commands: [{ point: { at: { data: [4, 1] } } }] } as unknown as Spec;
    const l = layoutSpec(spec as Spec, heuristicMeasure);
    const p = planCommands(spec.commands as never, l.order, { ...planOptionsFor(spec as Spec, l) });
    const step = p.steps.find((s) => s.kind === "point") as { x: number; y: number };
    expect([step.x, step.y]).toEqual([930, 630]);
  });
});

describe("a template without data axes", () => {
  test("{data} there is warned about", async () => {
    await ensureEnabledPacks(["biology"] as never);
    const l = layoutSpec({ template: "cell_diagram", params: {}, elements: [{ id: "n", type: "text", text: "x", at: { data: [1, 1] } }], commands: [] } as unknown as Spec, heuristicMeasure);
    expect(l.warnings.some((w) => /has no data axes/.test(w))).toBe(true);
  });
});
