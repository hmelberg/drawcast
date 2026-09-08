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
    // con_ori is never drawn as a real leaf, but IS explicitly named in a
    // draw command before the ask — so this test isolates condition 1
    // (structural: no matching leaf) from condition 5 (temporal: visible
    // before the ask), which would otherwise also fire.
    const commands = [{ draw: ["con_uma", "a", "b", "con_ori"] }, askConnect("con_ori")] as never;
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

  // Round 1 review, finding 1: an id no command ever manages is NOT visible
  // from the start of the cast — src/render/plan.ts:609-612 collects every
  // unmentioned id into ONE implicit draw step pushed AFTER every explicit
  // command, so it is drawn LAST. This is the shape a compiling model is
  // most likely to produce (an omitted draw, mopped up implicitly), and the
  // hand-built cast below is exactly the probe that caught the bug: a
  // focused figure whose ONLY mention anywhere is inside the ask itself.
  test("an id no command ever manages is drawn LAST, after the ask — the framing issue fires", () => {
    const drawables = [
      star("a", [0, 0]),
      star("b", [10, 0]),
      stroke("con_ori__0", [[0, 0], [10, 0]]),
      star("frame", [500, 375]),
    ];
    // con_ori (and its stars) are never named in any draw/show/erase/hide —
    // only "frame" is drawn explicitly. The planner would draw con_ori's
    // leaves in the implicit final step, after this ask.
    const commands = [{ draw: ["frame"] }, askConnect("con_ori")] as never;
    const { issues } = lintLayoutDetailed(drawables, heuristicMeasure, commands);
    expect(issues.filter((i) => i.rule === "connect")).toEqual([
      {
        rule: "connect",
        ids: ["con_ori"],
        message: `connect: "con_ori" is asked for before it has been drawn — draw the figure earlier in the cast, so the question is "draw the one you just saw" and not "guess which convention we use"`,
        severity: "warn",
      },
    ]);
  });

  // The reverse direction of the same rule: a figure drawn and then cleared
  // away BEFORE the ask must still be caught — it is off screen again by
  // the time the question is posed, same as never having been drawn at all.
  test("drawn, then cleared away before the ask — still caught", () => {
    const drawables = [
      star("a", [0, 0]),
      star("b", [10, 0]),
      star("c", [20, 0]),
      stroke("con_tst__0", [[0, 0], [10, 0]]),
      stroke("con_tst__1", [[10, 0], [20, 0]]),
    ];
    const commands = [{ draw: ["con_tst", "a", "b", "c"] }, { clear: {} }, askConnect("con_tst")] as never;
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

  test("a command can carry at most two connect issues: one structural, one framing", () => {
    const drawables = [star("a", [0, 0]), star("b", [10, 0]), stroke("con_uma__0", [[0, 0], [10, 0]])];
    // con_ori is not part of this figure's drawables at all (condition 1),
    // and is also never drawn before the ask fires (condition 5) — the later
    // draw command here only proves that "touched somewhere in the cast"
    // still is not the same thing as "visible before this particular ask".
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
