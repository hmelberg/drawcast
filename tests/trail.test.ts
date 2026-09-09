import { describe, expect, test } from "vitest";
import { planCommands, type PlanStep } from "../src/render/plan";
import { cumulativeLengthFractions, lengthFractionAt } from "../src/render/trails";
import { withMinted, type MintedSpec } from "../src/render/minted";
import { layoutSpec } from "../src/layout/layout";
import { heuristicMeasure } from "../src/layout/measure";

const box = (x: number, y: number, w: number, h: number) => ({ x, y, w, h });

/** The trail-kind entries of a Plan's minted array, in order — these tests
 *  never mint a ghost, so this is exactly what `plan.trails` used to be. */
const trailsOf = (minted: MintedSpec[]) => minted.filter((m): m is Extract<MintedSpec, { kind: "trail" }> => m.kind === "trail");

describe("trail helpers", () => {
  test("cumulativeLengthFractions runs 0 → 1 and lengthFractionAt interpolates", () => {
    const t = cumulativeLengthFractions([[0, 0], [10, 0], [10, 10]]);
    expect(t).toEqual([0, 0.5, 1]);
    expect(lengthFractionAt(t, 0.25)).toBeCloseTo(0.25, 6);
    expect(lengthFractionAt(t, 1)).toBe(1);
    expect(cumulativeLengthFractions([[5, 5], [5, 5]])).toEqual([0, 0]);
  });
  test("withMinted appends a trail stroke in the source's colour and keeps the layout otherwise", () => {
    const layout = layoutSpec({ elements: [{ id: "w", type: "shape", shape: "circle", x: 100, y: 100, radius: 20, style: { color: "#b5482e" } }], commands: [] } as never, heuristicMeasure);
    const out = withMinted(layout, [{ kind: "trail", id: "w_trail", pts: [[100, 80], [200, 80]], width: 2.5 }], () => layout);
    expect(out.order).toEqual([...layout.order, "w_trail"]);
    const d = out.drawables.find((x) => x.id === "w_trail") as { style: { color: string; strokeWidth: number } };
    expect(d.style.color).toBe("#b5482e");
    expect(d.style.strokeWidth).toBe(2.5);
    expect(withMinted(layout, [], () => layout)).toBe(layout);
  });
});

describe("trail planning", () => {
  const opts = { bboxOf: (id: string) => (id === "w" ? box(100, 200, 120, 120) : null) };
  test("a rolling wheel's bottom point traces a cycloid: 61 samples, rising to 2r, ending on the floor 2πr along", () => {
    // "w" drawn first so the "not visible" sanity warning (plan.test.ts's own
    // pattern) stays out of the way of the warnings-are-clean assertion below
    // — it shifts every step/state index in this test by one.
    const plan = planCommands([{ draw: ["w"] }, { move: { target: ["w"], by: [377, 0], rotate: -360, trail: { anchor: "bottom" }, duration: 4 } }], ["w"], opts);
    expect(plan.warnings).toEqual([]);
    const trails = trailsOf(plan.minted);
    expect(trails).toHaveLength(1);
    const tr = trails[0];
    expect(tr.id).toBe("w_trail");
    expect(tr.pts).toHaveLength(61);
    expect(tr.pts[0]).toEqual([160, 200]);
    expect(Math.max(...tr.pts.map((p) => p[1]))).toBeCloseTo(320, 3);
    expect(tr.pts[60][0]).toBeCloseTo(537, 3);
    expect(tr.pts[60][1]).toBeCloseTo(200, 3);
    const step = plan.steps[1] as Extract<PlanStep, { kind: "transform" }>;
    expect(step.trails![0].lengthAt[0]).toBe(0);
    expect(step.trails![0].lengthAt[60]).toBe(1);
    expect(plan.states[1].visible).toContain("w_trail");
  });
  test("a plain move traces a straight line; the trail id is known to later commands; a second trail gets _2", () => {
    // Same "drawn first" adjustment as above: every step/state index shifts by one.
    const plan = planCommands(
      [
        { draw: ["w"] },
        { move: { target: ["w"], by: [100, 50], trail: true } },
        { fade: { target: ["w_trail"], to: 0.3 } },
        { move: { target: ["w"], by: [0, 100], trail: true } },
      ],
      ["w"],
      opts,
    );
    expect(plan.warnings).toEqual([]);
    const trails = trailsOf(plan.minted);
    expect(trails.map((t) => t.id)).toEqual(["w_trail", "w_trail_2"]);
    expect(trails[0].pts[60]).toEqual([260, 310]);
    expect((plan.steps[1] as Extract<PlanStep, { kind: "move" }>).trails![0].id).toBe("w_trail");
    expect(plan.states[2].opacities.w_trail).toBe(0.3);
  });
  test("a trail on a SECOND target: the shared pivot is the wheel's centre before the move, so the dot still traces a cycloid", () => {
    const two = { bboxOf: (id: string) => (id === "w" ? box(100, 200, 120, 120) : id === "d" ? box(155, 195, 10, 10) : null) };
    const plan = planCommands(
      [
        { draw: ["w", "d"] },
        { move: { target: ["w", "d"], by: [377, 0], rotate: -360, pivot: { ref: "w" }, trail: { of: "d", anchor: "bottom" }, duration: 4 } },
      ],
      ["w", "d"],
      two,
    );
    expect(plan.warnings).toEqual([]);
    const tr = trailsOf(plan.minted)[0];
    expect(tr.pts[0]).toEqual([160, 195]);
    // pivot (160,260) for BOTH targets, so the dot swings on r = 65 and peaks
    // 2r above its start. Resolved per target, "d" saw the wheel's post-move
    // centre (537,260) and swung on a ~380-unit arc instead.
    expect(Math.max(...tr.pts.map((p) => p[1]))).toBeCloseTo(325, 3);
    expect(Math.min(...tr.pts.map((p) => p[1]))).toBeCloseTo(195, 3);
  });
  test("a minted trail can be arranged: the trail's own box stands in where there is no layout bbox", () => {
    const plan = planCommands(
      [{ draw: ["w"] }, { move: { target: ["w"], by: [100, 50], trail: true } }, { arrange: { target: ["w_trail"], layout: "row" } }],
      ["w"],
      opts,
    );
    expect(plan.warnings).toEqual([]);
    const step = plan.steps[2] as Extract<PlanStep, { kind: "transform" }>;
    expect(step.items.map((i) => i.id)).toEqual(["w_trail"]);
  });
  test("trail.of must be one of the targets", () => {
    const plan = planCommands([{ move: { target: ["w"], by: [10, 0], trail: { of: "nope" } } }], ["w"], opts);
    expect(trailsOf(plan.minted)).toHaveLength(0);
    expect(plan.warnings.join(" ")).toMatch(/nope/);
  });
});
