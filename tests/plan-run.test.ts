import { describe, expect, test } from "vitest";
import { planCommands, type PlanStep } from "../src/render/plan";
import { parseControls } from "../src/code/controls";
import { SpeechManager } from "../src/render/speech";
import { RUN_EVERY_S } from "../src/render/sweep";

const CODE = 'beta = (0.1, 1.0, 0.05)\nmodel = ["SIR", "SEIR"]';
const controlsOf = (id: string) => (id === "sim" ? parseControls("python", CODE, ["beta", "model"]).controls : null);
const plan = (cmds: object[]) => planCommands(cmds as never, ["sim", "sim_out"], { controlsOf } as never);
// The planner appends an implicit final draw of whatever the commands never
// mentioned; these tests are about the sweep steps, so it is filtered out.
const kinds = (p: { steps: PlanStep[] }) => p.steps.filter((s) => !(s.kind === "draw" && s.implicit)).map((s) => s.kind);

describe("planner: run", () => {
  test("a run becomes one step with complete value maps and every × n seconds", () => {
    const p = plan([{ draw: ["sim"] }, { run: { code: "sim", values: { beta: [0.2, 0.4, 0.6] }, every: 0.3 }, speak: "Watch." }]);
    const s = p.steps[1];
    expect(s.kind).toBe("run");
    if (s.kind !== "run") return;
    expect(s.code).toBe("sim");
    expect(s.values.map((v) => v.beta)).toEqual([0.2, 0.4, 0.6]);
    expect(s.values[0].model).toBe("SIR");
    expect(s.seconds).toBeCloseTo(0.9, 6);
    expect(s.demo).toBe(false);
    expect(s.narration).toBe("Watch.");
    expect(p.warnings).toEqual([]);
  });
  test("without every, the paired speak's estimated length (at least 0.5 s per step) sets the seconds", () => {
    const speak = "A long enough sentence to be estimated by the speech manager for its duration.";
    const p = plan([{ run: { code: "sim", values: { beta: [0.2, 0.4] } }, speak }]);
    const s = p.steps[0];
    if (s.kind !== "run") throw new Error("run expected");
    expect(s.seconds).toBeCloseTo(Math.max(1.0, SpeechManager.estimateMs(speak) / 1000), 3);
  });
  test("with neither every nor speak, the floor alone sets the seconds", () => {
    const p = plan([{ run: { code: "sim", values: { beta: [0.2, 0.4, 0.6, 0.8] } } }]);
    const s = p.steps[0];
    if (s.kind !== "run") throw new Error("run expected");
    expect(s.seconds).toBe(RUN_EVERY_S * 4);
    expect(s.narration).toBeUndefined();
  });
  // The planner hands the WHOLE args to the sweep model, so a range's glide
  // (and the author's opt-out) arrives without the planner knowing about it.
  test("a range glides through the planner: at least 10 values, or exactly the authored jumps with smooth: false", () => {
    const glide = plan([{ draw: ["sim"] }, { run: { code: "sim", values: { beta: { from: 0.1, to: 0.9, steps: 4 } } }, speak: "Watch." }]).steps[1];
    if (glide.kind !== "run") throw new Error("run expected");
    expect(glide.values.length).toBeGreaterThanOrEqual(10);
    expect(glide.values[0].beta).toBe(0.1);
    expect(glide.values[glide.values.length - 1].beta).toBe(0.9);
    const jumps = plan([{ draw: ["sim"] }, { run: { code: "sim", values: { beta: { from: 0.1, to: 0.9, steps: 4 } }, smooth: false }, speak: "Watch." }]).steps[1];
    if (jumps.kind !== "run") throw new Error("run expected");
    expect(jumps.values).toHaveLength(4);
  });
  test("a series the model cannot honour is a warning naming the command, and no step", () => {
    const p = plan([{ draw: ["sim"] }, { run: { code: "sim", values: { gamma: [1, 2] } }, speak: "Watch." }]);
    expect(p.steps.filter((s) => s.kind === "run")).toEqual([]);
    expect(p.warnings).toEqual(['commands[1].run: values.gamma: no control named "gamma"']);
  });
  test("a run on an unknown or control-less script is a warning and no step", () => {
    const p = plan([{ run: { code: "nope", values: { beta: 1 } } }]);
    expect(p.steps.filter((s) => s.kind === "run")).toEqual([]);
    expect(p.warnings[0]).toMatch(/nope/);
  });
  // A sweep on a panel nobody has drawn yet walks the values, spends the
  // narration, and shows the viewer nothing. The step still plays (the
  // implicit final draw may yet put the figure on screen); the author is told.
  test("a run before its script is drawn is a warning — and the step is still planned", () => {
    const p = plan([{ run: { code: "sim", values: { beta: [0.2, 0.4] } }, speak: "Watch." }]);
    expect(p.warnings).toEqual(['commands[0].run: "sim" has not been drawn yet']);
    expect(p.steps.filter((s) => s.kind === "run")).toHaveLength(1);
    // Not marked mentioned: complaining is not drawing, so the implicit final
    // draw still has the element on its list.
    expect(p.steps.some((s) => s.kind === "draw" && s.implicit && s.ids.includes("sim"))).toBe(true);
    // Drawn first — including by a `show` — and there is nothing to say.
    expect(plan([{ draw: ["sim"] }, { run: { code: "sim", values: { beta: [0.2] } } }]).warnings).toEqual([]);
    // …and the explore demo, which is the same sweep, is held to the same rule.
    expect(plan([{ explore: { code: "sim" }, speak: "Try it." }]).warnings).toEqual(['commands[0].explore.play: "sim" has not been drawn yet']);
  });
});

describe("planner: the explore demo", () => {
  test("explore on a controls script plans a demo run (with the speak) then the gate (without it)", () => {
    const p = plan([{ explore: { code: "sim" }, speak: "Try it." }]);
    expect(kinds(p)).toEqual(["run", "explore"]);
    const demo = p.steps[0];
    if (demo.kind !== "run") throw new Error();
    expect(demo.demo).toBe(true);
    expect(demo.narration).toBe("Try it.");
    expect(demo.values.length).toBeGreaterThan(1);
    // The parse's defaults: a tuple slider's default is the midpoint of its range.
    const defaults = { beta: 0.55, model: "SIR" };
    expect(demo.values[demo.values.length - 1]).toEqual(defaults);
    expect(p.steps[1].narration).toBeUndefined();
  });
  test("play: false → no demo, the gate keeps the speak; play: {values} → a planned demo", () => {
    const p1 = plan([{ explore: { code: "sim", play: false }, speak: "Try it." }]);
    expect(kinds(p1)).toEqual(["explore"]);
    expect(p1.steps[0].narration).toBe("Try it.");
    const p2 = plan([{ explore: { code: "sim", play: { values: { beta: [0.2, 0.9] }, every: 0.4 } }, speak: "Try it." }]);
    const d = p2.steps[0];
    if (d.kind !== "run") throw new Error();
    expect(d.values.map((v) => v.beta)).toEqual([0.2, 0.9]);
    expect(d.seconds).toBeCloseTo(0.8, 6);
  });
  test("explore without code, or on a script without controls, is unchanged (one explore step with the speak)", () => {
    const p = plan([{ explore: { params: ["n"] }, speak: "Look." }]);
    expect(kinds(p)).toEqual(["explore"]);
    expect(p.steps[0].narration).toBe("Look.");
    // A code element the demo cannot walk (no controls) is still a legitimate
    // app-only beat: the gate keeps its line, and nothing is warned about.
    const q = plan([{ explore: { code: "sim_out" }, speak: "Type in it." }]);
    expect(kinds(q)).toEqual(["explore"]);
    expect(q.steps[0].narration).toBe("Type in it.");
    expect(q.warnings).toEqual([]);
  });
});
