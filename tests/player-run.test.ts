import { describe, expect, test } from "vitest";
import { Player, type CodePatch, type Reprojector } from "../src/render/player";
import { planCommands } from "../src/render/plan";
import { parseControls } from "../src/code/controls";
import { SpeechManager } from "../src/render/speech";
import { sweepRunnerFor } from "../src/render/sweep-run";
import type { Spec } from "../src/spec/types";

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
});
