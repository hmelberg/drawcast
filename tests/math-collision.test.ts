// Hans 2026-09-10: "matematiske uttrykk kolliderer mer enn nødvendig" — a
// formula placed with `at:` lay on the y-axis and on the curve it described,
// and nothing said so. Three parts: the math group is a SOLID obstacle for
// label placement, a math element with at.side tries the neighbouring sides
// before lying on ink (least-bad when every side is taken — never a
// refusal), and lint warns about what remains.
import { beforeAll, describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { ensureEngines } from "../src/scenes/engines";
import { layoutSpec, elementBBoxes } from "../src/layout/layout";
import { flattenDrawables } from "../src/layout/model";
import { boxesOverlap, polylineIntersectsBox } from "../src/layout/geometry";
import { heuristicMeasure } from "../src/layout/measure";
import { lintLayout } from "../src/lint/lint";
import { obstacleBoxes } from "../src/layout/labels";
import { pickSide, sideCandidates } from "../src/layout/place";
import type { Obstacle } from "../src/layout/labels";

const strokesThrough = (r: ReturnType<typeof layoutSpec>, id: string): string[] => {
  const box = elementBBoxes(r).get(id)!;
  return flattenDrawables(r.drawables)
    .filter((d) => d.kind === "stroke" && d.pts.length >= 2 && polylineIntersectsBox(d.pts, box))
    .map((d) => d.id);
};

describe("pickSide (pure)", () => {
  const own = { x: 0, y: 0, w: 100, h: 20 };
  const ref = { x: 500, y: 400, w: 10, h: 10 };
  const canvas = { w: 1000, h: 750 };
  const at = (side: string) => ({ ref: "p", side, gap: 10 }) as never;

  test("candidates: the preferred side, then the sides sharing a word with it, then the rest", () => {
    expect(sideCandidates("above-left").slice(0, 5)).toEqual(["above-left", "above", "left", "above-right", "below-left"]);
    expect(sideCandidates("right")[0]).toBe("right");
    expect(new Set(sideCandidates("below")).size).toBe(8);
  });

  test("a clean preferred side wins untouched", () => {
    const pick = pickSide(own, ref, {}, at("above"), undefined, [], canvas);
    expect(pick.side).toBe("above");
    expect(pick.penalty).toBe(0);
  });

  test("a blocked preferred side yields to a clean neighbour", () => {
    // Solid text lying exactly where "above" would put the formula.
    const blocked: Obstacle[] = [{ box: { x: 440, y: 420, w: 120, h: 30 }, solid: true, id: "t" }];
    const pick = pickSide(own, ref, {}, at("above"), undefined, blocked, canvas);
    expect(pick.side).not.toBe("above");
    expect(pick.penalty).toBe(0);
  });

  test("every side taken: the least-bad side is still returned, never nothing", () => {
    const everywhere: Obstacle[] = [{ box: { x: 0, y: 0, w: 1000, h: 750 }, solid: false, id: "sea" }];
    const solidAbove: Obstacle = { box: { x: 440, y: 420, w: 120, h: 30 }, solid: true, id: "t" };
    const pick = pickSide(own, ref, {}, at("above"), undefined, [everywhere[0], solidAbove], canvas);
    expect(pick.penalty).toBeGreaterThan(0);
    // A soft graze everywhere is the same cost on every side; the solid
    // text makes "above" worse, so the pick moves off it.
    expect(pick.side).not.toBe("above");
  });
});

describe("math and the rest of the drawing (real mathjax)", () => {
  beforeAll(async () => {
    await ensureEngines(["mathjax"]);
  });

  test("a formula whose preferred side lies on a line moves to a clean neighbour, and says so", () => {
    const r = layoutSpec({
      elements: [
        { id: "p", type: "point", at: { x: 50, y: 50 } },
        // A horizontal line running through where "above" would put the formula.
        { id: "bar", type: "path", points: [[300, 420], [700, 420]] },
        { id: "m", type: "math", tex: "K = K_0(1+r)^n", size: 32, at: { ref: "p", side: "above", gap: 12 } },
      ],
      commands: [{ draw: ["p", "bar", "m"] }],
    });
    expect(strokesThrough(r, "m")).toEqual([]);
    expect(r.warnings.some((w) => w.includes('math "m"') && w.includes("placed"))).toBe(true);
  });

  test("a clean preferred side is kept exactly where at: put it before", () => {
    const r = layoutSpec({
      elements: [
        { id: "a", type: "shape", shape: "rect", x: 300, y: 300, width: 100, height: 40 },
        { id: "m", type: "math", tex: "F = m a", size: 32, at: { ref: "a", side: "above", gap: 12 } },
      ],
      commands: [{ draw: ["a", "m"] }],
    });
    const b = elementBBoxes(r);
    expect(b.get("m")!.y).toBeCloseTo(b.get("a")!.y + 40 + 12, 0);
    expect(r.warnings.filter((w) => w.includes('math "m"'))).toEqual([]);
  });

  test("a math group is one solid obstacle, so an attached label does not land on it", () => {
    const r = layoutSpec({
      elements: [
        { id: "m", type: "math", tex: "E = mc^2", size: 36, x: 500, y: 400 },
        { id: "p", type: "point", at: { x: 50, y: 53 } },
        { id: "l", type: "label", text: "energy", attach_to: "p", side: "above" },
      ],
      commands: [{ draw: ["m", "p", "l"] }],
    });
    const obstacles = obstacleBoxes(r.drawables, heuristicMeasure);
    const mine = obstacles.filter((o) => o.id === "m");
    expect(mine).toHaveLength(1);
    expect(mine[0].solid).toBe(true);
    const b = elementBBoxes(r);
    expect(boxesOverlap(b.get("m")!, b.get("l")!, 0)).toBe(false);
  });

  test("lint warns about a stroke through a formula and a label on top of it — warn, not error", () => {
    const r = layoutSpec({
      elements: [
        { id: "m", type: "math", tex: "E = mc^2", size: 36, x: 500, y: 400 },
        { id: "bar", type: "path", points: [[300, 400], [700, 400]] },
        { id: "t", type: "text", text: "energy", x: 500, y: 400 },
      ],
      commands: [{ draw: ["m", "bar", "t"] }],
    });
    const issues = lintLayout(r.drawables, heuristicMeasure);
    const stroke = issues.find((i) => i.rule === "overlap-math-stroke");
    const label = issues.find((i) => i.rule === "overlap-math-label");
    expect(stroke?.ids).toEqual(["m", "bar"]);
    expect(label?.ids).toEqual(["m", "t"]);
    expect([stroke!.severity, label!.severity]).toEqual(["warn", "warn"]);
  });

  test("lint is quiet about a formula standing clear", () => {
    const r = layoutSpec({
      elements: [
        { id: "m", type: "math", tex: "E = mc^2", size: 36, x: 500, y: 600 },
        { id: "bar", type: "path", points: [[300, 200], [700, 200]] },
      ],
      commands: [{ draw: ["m", "bar"] }],
    });
    expect(lintLayout(r.drawables, heuristicMeasure).filter((i) => i.rule.startsWith("overlap-math"))).toEqual([]);
  });

  test("the bundled example that started this: no formula lies on the y-axis or a curve", () => {
    const ex = JSON.parse(readFileSync(new URL("../src/examples.json", import.meta.url), "utf8")) as { title: string; spec: never }[];
    const e = ex.find((x) => x.title === "Årene står i eksponenten")!;
    const r = layoutSpec(e.spec);
    expect(strokesThrough(r, "f_samm")).toEqual([]);
    expect(strokesThrough(r, "f_enkel")).toEqual([]);
    expect(r.issues.filter((i) => i.severity === "error")).toEqual([]);
  });
});
