import { describe, expect, test } from "vitest";
import { Player, type CodePatch, type Reprojector } from "../src/render/player";
import { planCommands } from "../src/render/plan";
import { parseControls } from "../src/code/controls";
import { SpeechManager } from "../src/render/speech";
import { precomputeSweeps, sweepRunnerFor } from "../src/render/sweep-run";
import type { Spec } from "../src/spec/types";
import { readFileSync } from "node:fs";

// node has no rAF; drive Player.progress with a timer-based stand-in.
globalThis.requestAnimationFrame ??= ((cb: FrameRequestCallback) => setTimeout(() => cb(performance.now()), 5) as unknown as number) as typeof requestAnimationFrame;

// Copied from tests/explore-command.test.ts — there is no helpers module for it.
class RecordingSpeech extends SpeechManager {
  spoken: string[] = [];
  override get available(): boolean {
    return false;
  }
  override speak(text: string): Promise<void> {
    this.spoken.push(text);
    return Promise.resolve();
  }
  override cancel(): void {}
}

const CODE = 'beta = (0.1, 1.0, 0.05)\nmodel = ["SIR", "SEIR"]';
const controlsOf = (id: string) => (id === "sim" ? parseControls("python", CODE, ["beta", "model"]).controls : null);
const fakeReprojector = () => {
  const patches = new Map<string, CodePatch>();
  const log: string[] = [];
  const rp: Reprojector = {
    frame: () => {
      log.push("frame");
    },
    commit: () => {
      log.push("commit");
      return new Map();
    },
    setCodePatch: (id, p) => {
      log.push(`patch:${id}:${p ? p.values.beta : "null"}`);
      if (p) patches.set(id, p);
      else patches.delete(id);
    },
    patchedElements: () => undefined,
  };
  return { rp, patches, log };
};
const make = (cmds: object[]) => {
  const plan = planCommands(cmds as never, ["sim"], { controlsOf } as never);
  const speech = new RecordingSpeech();
  const player = new Player(plan, new Map(), speech, null, { mode: "narrated" });
  const { rp, patches, log } = fakeReprojector();
  player.reprojector = rp;
  const runs: string[] = [];
  // Frames already painted when each run was asked for — 0 for every one of
  // them is what "precomputed before the first frame" MEANS.
  const framesWhenRun: number[] = [];
  player.sweepRunner = async (id, values) => {
    runs.push(`${id}:${values.beta}`);
    framesWhenRun.push(log.filter((l) => l === "frame").length);
    return { code: `code@${values.beta}`, result: `res@${values.beta}` };
  };
  return { player, speech, patches, log, runs, framesWhenRun };
};

describe("player: run", () => {
  test("precomputes every step before the first frame, then patches step by step, and the last patch persists past the commit", async () => {
    const { player, patches, log, runs, framesWhenRun } = make([{ run: { code: "sim", values: { beta: [0.2, 0.4, 0.6] }, every: 0.01 } }]);
    await player.play();
    expect(runs).toEqual(["sim:0.2", "sim:0.4", "sim:0.6"]);
    expect(framesWhenRun).toEqual([0, 0, 0]); // every map ran before the first frame
    const firstPatch = log.findIndex((l) => l.startsWith("patch:"));
    const firstFrame = log.indexOf("frame");
    expect(firstPatch).toBeGreaterThan(-1);
    expect(firstPatch).toBeLessThan(firstFrame);
    expect(log.filter((l) => l.startsWith("patch:sim:")).map((l) => l.split(":")[2])).toEqual(["0.2", "0.4", "0.6"]);
    expect(patches.get("sim")).toMatchObject({ code: "code@0.6", result: "res@0.6", values: { beta: 0.6 } });
    expect(player.codePatchOf("sim")?.values.beta).toBe(0.6);
    expect(player.state).toBe("done");
  });
  test("a failed step holds the previous result", async () => {
    const { player, patches } = make([{ run: { code: "sim", values: { beta: [0.2, 0.4] }, every: 0.01 } }]);
    player.sweepRunner = async (_id, values) => {
      if (values.beta === 0.4) throw new Error("boom");
      return { code: "c", result: "r" };
    };
    await player.play();
    // HELD WHOLE: the previous step's script AND the values that produced it.
    expect(patches.get("sim")).toMatchObject({ code: "c", result: "r", values: { beta: 0.2 } });
  });
  test("no runner: the step waits its seconds and patches nothing", async () => {
    const { player, patches } = make([{ run: { code: "sim", values: { beta: [0.2] }, every: 0.01 } }]);
    player.sweepRunner = null;
    await player.play();
    expect(patches.size).toBe(0);
    expect(player.state).toBe("done");
  });
  test("a scrub to before the run drops its patch; a scrub after keeps it", async () => {
    const { player, patches } = make([{ draw: ["sim"] }, { run: { code: "sim", values: { beta: [0.2, 0.4] }, every: 0.01 } }, { pause: 0.01 }]);
    await player.play();
    expect(patches.has("sim")).toBe(true);
    player.renderUpTo(3);
    expect(patches.has("sim")).toBe(true);
    player.renderUpTo(1);
    expect(patches.has("sim")).toBe(false);
  });
  test("two runs on one script: a scrub between them puts the FIRST run's result back", async () => {
    // steps: 0 draw, 1 run(0.2), 2 pause, 3 run(0.6), 4 pause.
    const { player, patches } = make([
      { draw: ["sim"] },
      { run: { code: "sim", values: { beta: [0.2] }, every: 0.01 } },
      { pause: 0.01 },
      { run: { code: "sim", values: { beta: [0.6] }, every: 0.01 } },
      { pause: 0.01 },
    ]);
    await player.play();
    expect(patches.get("sim")?.values.beta).toBe(0.6);
    player.renderUpTo(3); // before the second run, after the first
    expect(patches.get("sim")?.values.beta).toBe(0.2);
    expect(player.codePatchOf("sim")?.values.beta).toBe(0.2);
    player.renderUpTo(1); // before both: the author's script again
    expect(patches.has("sim")).toBe(false);
    expect(player.codePatchOf("sim")).toBe(null);
    await player.play(); // replayed from there, both runs happen again
    player.renderUpTo(5);
    expect(patches.get("sim")?.values.beta).toBe(0.6);
  });
  // A forward scrub crosses runs the viewer never played. Patches are RUNTIME
  // state — `plan.states` carries none — so without this the figure at that
  // boundary is the author's script, which the lesson has already swept past.
  describe("a forward scrub over a run that never played", () => {
    const NEVER = [{ draw: ["sim"] }, { run: { code: "sim", values: { beta: [0.2, 0.4] }, every: 0.01 } }, { pause: 0.01 }];
    const tick = () => new Promise((r) => setTimeout(r, 0));

    test("asks the runner for the run's LAST value and applies the answer", async () => {
      const { player, patches, runs } = make(NEVER);
      player.renderUpTo(3);
      expect(patches.has("sim")).toBe(false); // nothing is invented synchronously
      await tick();
      expect(runs).toEqual(["sim:0.4"]); // the last value only — the rest never showed
      expect(patches.get("sim")?.values.beta).toBe(0.4);
    });

    test("with no runner it leaves the authored script alone", async () => {
      const { player, patches } = make(NEVER);
      player.sweepRunner = null;
      player.renderUpTo(3);
      await tick();
      expect(patches.size).toBe(0);
    });

    test("results from an earlier play are re-applied SYNCHRONOUSLY, without running anything", async () => {
      const { player, patches, runs } = make(NEVER);
      await player.play();
      expect(runs).toEqual(["sim:0.2", "sim:0.4"]);
      player.renderUpTo(0);
      expect(patches.has("sim")).toBe(false);
      player.renderUpTo(3);
      expect(patches.get("sim")?.values.beta).toBe(0.4); // no await: the results were remembered
      expect(runs).toEqual(["sim:0.2", "sim:0.4"]); // …and no step was run again
    });

    test("a resolution that arrives after the viewer has scrubbed away is dropped", async () => {
      const { player, patches } = make(NEVER);
      player.renderUpTo(3);
      player.renderUpTo(0); // before the runner resolves
      await tick();
      expect(patches.size).toBe(0);
      expect(player.codePatchOf("sim")).toBe(null);
    });
  });

  // A remediation `goto` goes through jumpTo(n, true). Without the drop, the
  // patches of the steps it jumped back over stay in the history, the replay
  // appends its own out of order, and the next scrub reads the wrong one.
  test("a goto drops the patches of the steps it jumps back over", async () => {
    // steps: 0 draw, 1 run(0.2), 2 pause, 3 run(0.6), 4 pause.
    const { player, patches } = make([
      { draw: ["sim"] },
      { run: { code: "sim", values: { beta: [0.2] }, every: 0.01 } },
      { pause: 0.01 },
      { run: { code: "sim", values: { beta: [0.6] }, every: 0.01 } },
      { pause: 0.01 },
    ]);
    await player.play();
    expect(patches.get("sim")?.values.beta).toBe(0.6);
    player.jumpTo(2, true); // a goto landing between the two runs
    expect(patches.get("sim")?.values.beta).toBe(0.2);
    expect(player.codePatchOf("sim")?.values.beta).toBe(0.2);
    player.renderUpTo(2); // …and a scrub to the same boundary agrees
    expect(player.codePatchOf("sim")?.values.beta).toBe(0.2);
    player.jumpTo(1, true); // back before both: the author's script again
    expect(patches.has("sim")).toBe(false);
    expect(player.codePatchOf("sim")).toBe(null);
  });

  test("the explore demo plays under autoAnswers (movies) with its narration, and the gate step is still skipped", async () => {
    const { player, speech, runs } = make([{ explore: { code: "sim" }, speak: "Try it." }, { speak: "After." }]);
    player.autoAnswers = true;
    let opened = false;
    player.exploreGate = async () => {
      opened = true;
    };
    await player.play();
    expect(runs.length).toBeGreaterThan(1);
    expect(opened).toBe(false);
    expect(speech.spoken).toEqual(["Try it.", "After."]);
  });
});

describe("sweepRunnerFor", () => {
  const SPEC = {
    elements: [{ id: "sim", type: "code", language: "python", code: CODE, controls: ["beta", "model"] }],
    commands: [],
  } as unknown as Spec;
  const envelope = (over: object) => ({ ok: true, stdout: "", stderr: "", figures: [], ...over });

  test("a failed envelope is a REJECTION — runCode never throws, and a sweep must not paint an error panel", async () => {
    const runner = sweepRunnerFor(SPEC, {
      runner: async () => envelope({ ok: false, error: "boom" }),
      cacheGet: async () => null,
      cachePut: async () => undefined,
    });
    await expect(runner("sim", { beta: 0.35, model: "SEIR" })).rejects.toThrow("boom");
  });

  test("a good run rewrites the AUTHORED script at the step's values", async () => {
    let seen = "";
    const runner = sweepRunnerFor(SPEC, {
      runner: async (req) => {
        seen = req.code;
        return envelope({ stdout: "ok" });
      },
      cacheGet: async () => null,
      cachePut: async () => undefined,
    });
    const out = await runner("sim", { beta: 0.35, model: "SEIR" });
    expect(seen).toContain("0.35");
    expect(seen).not.toContain("(0.1");
    expect(out.code).toBe(seen);
    expect(JSON.parse(out.result)).toMatchObject({ ok: true, stdout: "ok" });
  });

  test("an id that is not a code element with controls rejects", async () => {
    await expect(sweepRunnerFor(SPEC)("nope", { beta: 0.2 })).rejects.toThrow(/not a code element with controls/);
  });

  // A spec that has been through a render once carries the authored script in
  // `code_src`, with its control literals still tuples; `code` is the rewritten
  // one, in which parseControls finds nothing to sweep. controlsOfFor reads
  // code_src first, and so must this — or a re-rendered cast sweeps nothing.
  test("code_src wins over code: a re-rendered spec still sweeps", async () => {
    const rendered = {
      elements: [{ id: "sim", type: "code", language: "python", code: "beta = 0.55\nmodel = \"SIR\"", code_src: CODE, controls: ["beta", "model"] }],
      commands: [],
    } as unknown as Spec;
    let seen = "";
    const runner = sweepRunnerFor(rendered, {
      runner: async (req) => {
        seen = req.code;
        return envelope({ stdout: "ok" });
      },
      cacheGet: async () => null,
      cachePut: async () => undefined,
    });
    await runner("sim", { beta: 0.35, model: "SEIR" });
    expect(seen).toContain("0.35");
    expect(seen).toContain("SEIR");
  });
});

describe("precomputeSweeps", () => {
  const plan = planCommands([{ draw: ["sim"] }, { run: { code: "sim", values: { beta: [0.2, 0.4, 0.6] }, every: 0.01 } }] as never, ["sim"], { controlsOf } as never);

  test("warms every value of every run step", async () => {
    const seen: number[] = [];
    await precomputeSweeps(plan, async (_id, v) => {
      seen.push(v.beta as number);
      return { code: "c", result: "r" };
    });
    expect(seen).toEqual([0.2, 0.4, 0.6]);
  });

  // It runs on an idle callback and boots a runtime per step: the figure it
  // was warming may be long gone (a revise round, a playlist item ending).
  test("stops between steps once the figure it was warming is disposed", async () => {
    const seen: number[] = [];
    let disposed = false;
    await precomputeSweeps(
      plan,
      async (_id, v) => {
        seen.push(v.beta as number);
        disposed = true; // destroyed while the first step was booting
        return { code: "c", result: "r" };
      },
      () => disposed,
    );
    expect(seen).toEqual([0.2]);
  });
});

// The flicker (2026-09-15): a repaint rebuilds every node, so the output
// pane's <image> is BRAND NEW on every step and paints nothing until its PNG
// has decoded. The fix is ordering, and ordering is what a source pin can
// hold: every step's figures are decoded after the precompute loop and
// before the first frame the sweep paints.
describe("run: figures are decoded before the sweep paints (source pin)", () => {
  const src = readFileSync("src/render/player.ts", "utf8");
  const runCase = src.slice(src.indexOf('case "run": {'), src.indexOf('case "label":'));

  test("decodeFigures runs after the precompute loop and before progress()", () => {
    const precompute = runCase.indexOf("results.push({ ...(await runner(");
    const decode = runCase.indexOf("decodeFigures(");
    const paint = runCase.indexOf("this.progress(");
    expect(precompute).toBeGreaterThan(-1);
    expect(decode).toBeGreaterThan(precompute);
    expect(paint).toBeGreaterThan(decode);
    // Awaited, and the abort re-checked after it: a scrub during the decode
    // must not paint the run it just left.
    expect(runCase).toMatch(/await Promise\.all\(results\.map\(\(r\) => decodeFigures\(r\.result\)\)\);\s*\n\s*if \(signal\.aborted\) return;/);
  });

  test("a restored run decodes before it shows the figure", () => {
    // The ASYNC branch only — the branch above it re-shows a result the run
    // itself already decoded when it played.
    const restore = src.slice(src.indexOf("private restoreRunPatches"), src.indexOf("private showCodePatch"));
    const async = restore.slice(restore.indexOf("void runner(step.code, values).then("));
    expect(async.indexOf("await decodeFigures(patch.result)")).toBeGreaterThan(-1);
    expect(async.indexOf("await decodeFigures(patch.result)")).toBeLessThan(async.indexOf("this.pushCodePatch("));
  });
});
