import { describe, expect, test } from "vitest";
import { lintLayoutDetailed } from "../src/lint/lint";
import { heuristicMeasure } from "../src/layout/measure";
import { defaultStyle, defaultDrawOpts, type Drawable } from "../src/layout/model";
import { CONNECT_MAX_EDGES } from "../src/ui/connect-model";

// Copied from tests/lint.test.ts's own idiom, rather than inventing new
// Drawable shapes.
function stroke(id: string, pts: [number, number][]): Drawable {
  return { id, kind: "stroke", pts, z: 1, style: defaultStyle(), drawOpts: defaultDrawOpts("sketch") };
}

// A "kit.ball" star: a single-point stroke, the same shape widgets.ts's
// connectKey expects a star candidate's box to reduce to.
const star = (id: string, at: [number, number]): Drawable => stroke(id, [at]);

const askConnect = (answer: string, extra: Record<string, unknown> = {}) => ({
  ask: { question: "Draw it.", widget: "connect", answer, right: "There it is.", ...extra },
});

describe("connect lint", () => {
  test("says nothing about a figure that can be drawn, asked after it was drawn", () => {
    const drawables = [
      star("a", [0, 0]),
      star("b", [10, 0]),
      star("c", [20, 0]),
      stroke("con_tst__0", [[0, 0], [10, 0]]),
      stroke("con_tst__1", [[10, 0], [20, 0]]),
    ];
    const commands = [{ draw: ["con_tst", "a", "b", "c"] }, askConnect("con_tst")] as never;
    const { issues } = lintLayoutDetailed(drawables, heuristicMeasure, commands);
    expect(issues.filter((i) => i.rule === "connect")).toEqual([]);
  });

  test("a figure with no connect ask at all pays nothing — no connect issues appear", () => {
    const drawables = [star("a", [-500, -500])]; // would fail out-of-canvas but never mind
    const { issues } = lintLayoutDetailed(drawables, heuristicMeasure, [{ draw: ["a"] }] as never);
    expect(issues.some((i) => i.rule === "connect")).toBe(false);
  });

  test("names an answer that is not drawn", () => {
    const drawables = [
      star("a", [0, 0]),
      star("b", [10, 0]),
      stroke("con_uma__0", [[0, 0], [10, 0]]),
    ];
    // con_ori is never drawn anywhere — draw command names con_uma instead.
    const commands = [{ draw: ["con_uma", "a", "b"] }, askConnect("con_ori")] as never;
    const { issues } = lintLayoutDetailed(drawables, heuristicMeasure, commands);
    expect(issues.filter((i) => i.rule === "connect")).toEqual([
      {
        rule: "connect",
        ids: ["con_ori"],
        message: `connect: "con_ori" is not drawn in this figure — a connect question needs focus on that constellation`,
        severity: "warn",
      },
    ]);
  });

  test("a figure drawn but with no lines warns 'has no lines to draw'", () => {
    const drawables = [
      star("a", [0, 0]),
      stroke("con_lone__0", [[0, 0]]), // a single point: no possible edge
    ];
    const commands = [{ draw: ["con_lone", "a"] }, askConnect("con_lone")] as never;
    const { issues } = lintLayoutDetailed(drawables, heuristicMeasure, commands);
    expect(issues.filter((i) => i.rule === "connect")).toEqual([
      { rule: "connect", ids: ["con_lone"], message: `connect: "con_lone" has no lines to draw`, severity: "warn" },
    ]);
  });

  test("counts points with no star under them", () => {
    const drawables = [
      star("a", [0, 0]),
      star("b", [10, 0]),
      star("c", [30, 0]),
      // a-b is a real edge; then a jump to a point nothing sits under, which
      // breaks the chain before c (matches connectKey's own gap behaviour).
      stroke("con_gap__0", [[0, 0], [10, 0], [999, 999], [30, 0]]),
    ];
    const commands = [{ draw: ["con_gap", "a", "b", "c"] }, askConnect("con_gap")] as never;
    const { issues } = lintLayoutDetailed(drawables, heuristicMeasure, commands);
    expect(issues.filter((i) => i.rule === "connect")).toEqual([
      {
        rule: "connect",
        ids: ["con_gap"],
        message: `connect: 1 of "con_gap"'s points have no star to join — the figure cannot be drawn as it stands`,
        severity: "warn",
      },
    ]);
  });

  test("refuses a figure over the cap", () => {
    const n = CONNECT_MAX_EDGES + 2; // one more star than needed to clear the cap
    const stars: Drawable[] = [];
    const pts: [number, number][] = [];
    const ids: string[] = [];
    for (let i = 0; i < n; i++) {
      const id = `s${i}`;
      stars.push(star(id, [i * 10, 0]));
      pts.push([i * 10, 0]);
      ids.push(id);
    }
    const drawables = [...stars, stroke("con_big__0", pts)];
    const commands = [{ draw: ["con_big", ...ids] }, askConnect("con_big")] as never;
    const { issues } = lintLayoutDetailed(drawables, heuristicMeasure, commands);
    const edgeCount = n - 1;
    expect(issues.filter((i) => i.rule === "connect")).toEqual([
      {
        rule: "connect",
        ids: ["con_big"],
        message: `connect: "con_big" has ${edgeCount} lines; the cap is ${CONNECT_MAX_EDGES} (Orion's) — ask which constellation it is instead`,
        severity: "warn",
      },
    ]);
  });

  test("a drawable figure asked for before it was ever drawn is unfair, independently of the first four", () => {
    const drawables = [
      star("a", [0, 0]),
      star("b", [10, 0]),
      star("c", [20, 0]),
      stroke("con_tst__0", [[0, 0], [10, 0]]),
      stroke("con_tst__1", [[10, 0], [20, 0]]),
    ];
    // The ask fires FIRST; the draw (the reveal, after grading) comes after.
    const commands = [askConnect("con_tst"), { draw: ["con_tst", "a", "b", "c"] }] as never;
    const { issues } = lintLayoutDetailed(drawables, heuristicMeasure, commands);
    expect(issues.filter((i) => i.rule === "connect")).toEqual([
      {
        rule: "connect",
        ids: ["con_tst"],
        message: `connect: "con_tst" is asked for before it has been drawn — draw the figure earlier in the cast, so the question is "draw the one you just saw" and not "guess which convention we use"`,
        severity: "warn",
      },
    ]);
  });

  test("an id no command ever manages counts as visible from the start — no framing complaint", () => {
    const drawables = [
      star("a", [0, 0]),
      star("b", [10, 0]),
      stroke("con_free__0", [[0, 0], [10, 0]]),
    ];
    // con_free is never named in any draw/show/erase/hide/clear anywhere.
    const commands = [askConnect("con_free")] as never;
    const { issues } = lintLayoutDetailed(drawables, heuristicMeasure, commands);
    expect(issues.filter((i) => i.rule === "connect")).toEqual([]);
  });

  test("a command can carry at most two connect issues: one structural, one framing", () => {
    const drawables = [star("a", [0, 0]), star("b", [10, 0]), stroke("con_uma__0", [[0, 0], [10, 0]])];
    // con_ori is touched by a LATER draw (so it is "managed", hence not
    // exempt by the unmanaged-from-the-start rule) but is not part of this
    // figure's own drawables at all, and the ask precedes even that draw.
    const commands = [askConnect("con_ori"), { draw: ["con_ori"] }] as never;
    const { issues } = lintLayoutDetailed(drawables, heuristicMeasure, commands);
    const connectIssues = issues.filter((i) => i.rule === "connect");
    expect(connectIssues).toHaveLength(2);
    expect(connectIssues.map((i) => i.message)).toEqual([
      `connect: "con_ori" is not drawn in this figure — a connect question needs focus on that constellation`,
      `connect: "con_ori" is asked for before it has been drawn — draw the figure earlier in the cast, so the question is "draw the one you just saw" and not "guess which convention we use"`,
    ]);
  });
});
