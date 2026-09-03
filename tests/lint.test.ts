import { describe, expect, test } from "vitest";
import { lintCommands, lintLayout, lintLayoutDetailed } from "../src/lint/lint";
import { heuristicMeasure } from "../src/layout/measure";
import { defaultStyle, defaultDrawOpts, type Drawable } from "../src/layout/model";
import type { Spec } from "../src/spec/types";

function text(id: string, pos: [number, number], fontSize = 24, str = "Some label"): Drawable {
  return { id, kind: "text", pos, text: str, fontSize, anchor: "middle", z: 2, style: defaultStyle(), drawOpts: defaultDrawOpts("instant") };
}

function stroke(id: string, pts: [number, number][]): Drawable {
  return { id, kind: "stroke", pts, z: 1, style: defaultStyle(), drawOpts: defaultDrawOpts("sketch") };
}

describe("lintLayout", () => {
  test("clean layout has no issues", () => {
    const issues = lintLayout([text("a", [200, 200]), text("b", [700, 600])], heuristicMeasure);
    expect(issues).toEqual([]);
  });

  test("flags overlapping labels", () => {
    const issues = lintLayout([text("a", [500, 400]), text("b", [510, 405])], heuristicMeasure);
    const overlap = issues.find((i) => i.rule === "overlap-label-label");
    expect(overlap).toBeDefined();
    expect(overlap!.ids.sort()).toEqual(["a", "b"]);
  });

  test("flags a label sitting on a stroke", () => {
    const issues = lintLayout(
      [stroke("curve", [[100, 400], [900, 400]]), text("lbl", [500, 400])],
      heuristicMeasure,
    );
    expect(issues.some((i) => i.rule === "overlap-label-stroke")).toBe(true);
  });

  test("flags elements outside the canvas", () => {
    const issues = lintLayout([stroke("s", [[-50, 100], [200, 100]])], heuristicMeasure);
    expect(issues.some((i) => i.rule === "out-of-canvas" && i.ids.includes("s"))).toBe(true);
  });

  test("flags unreadable font sizes", () => {
    const issues = lintLayout([text("tiny", [300, 300], 8)], heuristicMeasure);
    expect(issues.some((i) => i.rule === "font-too-small")).toBe(true);
  });
});

describe("lintLayout — co-visibility (the kameo exemption)", () => {
  const overlapping = [text("a", [500, 400]), text("b", [510, 405])];
  const cmds = (c: object[]) => c as never;

  test("a transient erased before its rival draws is exempt from overlap checks", () => {
    const issues = lintLayout(overlapping, heuristicMeasure, cmds([{ draw: ["a"] }, { erase: ["a"] }, { draw: ["b"] }]));
    expect(issues).toEqual([]);
    // Same for a label core sitting on a stroke it never meets.
    const strokeIssues = lintLayout(
      [stroke("curve", [[100, 400], [900, 400]]), text("lbl", [500, 400])],
      heuristicMeasure,
      cmds([{ draw: ["lbl"] }, { hide: ["lbl"] }, { draw: ["curve"] }]),
    );
    expect(strokeIssues).toEqual([]);
  });

  test("pairs that DO share the screen still warn; no commands means everything coexists", () => {
    expect(lintLayout(overlapping, heuristicMeasure, cmds([{ draw: ["a"] }, { draw: ["b"] }, { erase: ["a"] }]))
      .some((i) => i.rule === "overlap-label-label")).toBe(true);
    expect(lintLayout(overlapping, heuristicMeasure).some((i) => i.rule === "overlap-label-label")).toBe(true);
    expect(lintLayout(overlapping, heuristicMeasure, cmds([]))
      .some((i) => i.rule === "overlap-label-label")).toBe(true);
  });

  test("clear conceals everything but keep; concealed ids stay out of the implicit final draw", () => {
    // a drawn, cleared away, then b drawn: never together — clean.
    expect(lintLayout(overlapping, heuristicMeasure, cmds([{ draw: ["a"] }, { clear: {} }, { draw: ["b"] }]))).toEqual([]);
    // keep: ["a"] holds a on screen through the clear — they DO meet.
    expect(lintLayout(overlapping, heuristicMeasure, cmds([{ draw: ["a"] }, { clear: { keep: ["a"] } }, { draw: ["b"] }]))
      .some((i) => i.rule === "overlap-label-label")).toBe(true);
  });
});

// Hans's race-label ruling, 2026-09-03: a race may let its labels overlap
// ("the point is that they may move around and sometimes be close"), and must
// never drop one to avoid it. `crossing` marks a mover; two DIFFERENT movers
// may overlap. The tests that matter most here are the ones proving what the
// exemption still REFUSES — a rule that excuses everything is not a rule.
describe("lintLayout — the crossing exemption", () => {
  const keyed = (id: string, pos: [number, number], crossing: string, str = "Some label"): Drawable => ({
    ...(text(id, pos, 24, str) as Extract<Drawable, { kind: "text" }>),
    crossing,
  });
  const keyedStroke = (id: string, pts: [number, number][], crossing: string): Drawable => ({
    ...(stroke(id, pts) as Extract<Drawable, { kind: "stroke" }>),
    crossing,
  });
  const rules = (ds: Drawable[]) => lintLayout(ds, heuristicMeasure).map((i) => i.rule);

  test("two DIFFERENT movers' labels may overlap — and the drop is reported as exempt, not lost", () => {
    const ds = [keyed("line_1__t", [500, 400], "line_1"), keyed("line_2__t", [510, 405], "line_2")];
    expect(rules(ds)).toEqual([]);
    const detail = lintLayoutDetailed(ds, heuristicMeasure);
    expect(detail.issues).toEqual([]);
    expect(detail.exempt.map((i) => i.rule)).toEqual(["overlap-label-label"]);
    expect(detail.exempt[0].ids.sort()).toEqual(["line_1__t", "line_2__t"]);
  });

  test("the SAME mover's two labels overlapping is still a defect — an overtake needs two racers", () => {
    expect(rules([keyed("race_3_text", [500, 400], "race_3"), keyed("race_3_value", [510, 405], "race_3")]))
      .toEqual(["overlap-label-label"]);
  });

  test("a mover's label against UNKEYED furniture is still a defect, whichever side carries the key", () => {
    expect(rules([keyed("race_1_value", [500, 400], "race_1"), text("ticker", [510, 405])])).toEqual(["overlap-label-label"]);
    expect(rules([text("title", [500, 400]), keyed("line_2__t", [510, 405], "line_2")])).toEqual(["overlap-label-label"]);
  });

  test("an empty crossing key is not a key", () => {
    expect(rules([keyed("a", [500, 400], ""), keyed("b", [510, 405], "")])).toEqual(["overlap-label-label"]);
    expect(rules([keyed("a", [500, 400], ""), keyed("b", [510, 405], "line_2")])).toEqual(["overlap-label-label"]);
  });

  test("label-on-stroke: another mover's line is accepted; the axis and the mover's own line are not", () => {
    const label = keyed("line_1__t", [500, 400], "line_1");
    expect(rules([keyedStroke("line_2__l", [[100, 400], [900, 400]], "line_2"), label])).toEqual([]);
    expect(rules([keyedStroke("line_1__l", [[100, 400], [900, 400]], "line_1"), label])).toEqual(["overlap-label-stroke"]);
    expect(rules([stroke("axes__x", [[100, 400], [900, 400]]), label])).toEqual(["overlap-label-stroke"]);
  });

  test("the exemption reaches ONLY the two overlap rules — never out-of-canvas or font-too-small", () => {
    expect(rules([keyed("line_1__t", [-400, 400], "line_1"), keyed("line_2__t", [-410, 405], "line_2")]))
      .toEqual(["out-of-canvas", "out-of-canvas"]);
    const tiny = [
      { ...(text("line_1__t", [500, 400], 8) as Extract<Drawable, { kind: "text" }>), crossing: "line_1" },
      { ...(text("line_2__t", [505, 403], 8) as Extract<Drawable, { kind: "text" }>), crossing: "line_2" },
    ];
    expect(rules(tiny)).toEqual(["font-too-small", "font-too-small"]);
  });

  test("co-visibility still applies first: two movers that never share the screen produce no issue at all", () => {
    const ds = [keyed("line_1__t", [500, 400], "line_1"), keyed("line_2__t", [510, 405], "line_2")];
    const detail = lintLayoutDetailed(ds, heuristicMeasure, [{ draw: ["line_1__t"] }, { erase: ["line_1__t"] }, { draw: ["line_2__t"] }] as never);
    expect(detail.issues).toEqual([]);
    expect(detail.exempt).toEqual([]);
  });
});

describe("lintCommands", () => {
  const spec = (commands: object[]): Spec => ({ elements: [{ id: "e1", type: "label", text: "x", attach_to: "e1" }], commands }) as unknown as Spec;

  test("one standalone speak before ink is fine; two warn slow-start", () => {
    expect(lintCommands(spec([{ speak: "Intro." }, { draw: ["e1"] }]))).toEqual([]);
    const issues = lintCommands(spec([{ speak: "One." }, { speak: "Two." }, { draw: ["e1"] }]));
    expect(issues.map((i) => i.rule)).toEqual(["slow-start"]);
    expect(issues[0].severity).toBe("warn");
  });

  test("three consecutive standalone speaks warn talky-stretch once; pauses do not reset the run", () => {
    const issues = lintCommands(
      spec([{ draw: ["e1"] }, { speak: "a" }, { pause: 0.5 }, { speak: "b" }, { speak: "c" }, { speak: "d" }]),
    );
    expect(issues.map((i) => i.rule)).toEqual(["talky-stretch"]);
  });

  test("narrated actions break the run", () => {
    expect(
      lintCommands(spec([{ draw: ["e1"] }, { speak: "a" }, { speak: "b" }, { point: { at: { ref: "e1" } }, speak: "c" }, { speak: "d" }, { speak: "e" }])),
    ).toEqual([]);
  });

  test("speaks with no draw at all count toward slow-start", () => {
    const issues = lintCommands(spec([{ speak: "a" }, { speak: "b" }, { speak: "c" }]));
    expect(issues.map((i) => i.rule).sort()).toEqual(["slow-start", "talky-stretch"]);
  });
});
