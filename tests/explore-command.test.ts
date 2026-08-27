import { describe, expect, test } from "vitest";
import { validateSpec } from "../src/spec/schema";
import { planCommands } from "../src/render/plan";
import { Player, type Reprojector } from "../src/render/player";
import { SpeechManager } from "../src/render/speech";
import type { Command } from "../src/spec/types";
import type { RenderedElement } from "../src/render/backend";

// node has no rAF; drive Player.progress with a timer-based stand-in.
globalThis.requestAnimationFrame ??= ((cb: FrameRequestCallback) =>
  setTimeout(() => cb(performance.now()), 5) as unknown as number) as typeof requestAnimationFrame;

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

describe("explore validation and planning", () => {
  const spec = (commands: object[]) => ({
    elements: [{ id: "a", type: "text", text: "hi", x: 500, y: 375 }],
    commands,
  });

  test("explore with and without params passes; junk params fail", () => {
    expect(validateSpec(spec([{ draw: ["a"] }, { explore: {} }])).ok).toBe(true);
    expect(validateSpec(spec([{ draw: ["a"] }, { explore: { params: ["n"] } }])).ok).toBe(true);
    expect(validateSpec(spec([{ explore: { params: "n" } }])).ok).toBe(false);
    expect(validateSpec(spec([{ explore: {}, draw: ["a"] }])).ok).toBe(false); // one verb per command
  });

  test("plans to an explore step carrying the param filter", () => {
    const plan = planCommands([{ explore: { params: ["n"] }, speak: "Try it." }], []);
    const s = plan.steps[0];
    expect(s.kind).toBe("explore");
    if (s.kind !== "explore") return;
    expect(s.params).toEqual(["n"]);
    expect(s.narration).toBe("Try it.");
  });
});

describe("explore at runtime", () => {
  const CMDS: Command[] = [{ explore: { params: ["n"] }, speak: "Try some numbers yourself." }, { speak: "After." }];

  test("no gate wired: the step vanishes ENTIRELY — invitation narration included", async () => {
    const speech = new RecordingSpeech();
    const player = new Player(planCommands(CMDS, []), new Map(), speech, null, { mode: "narrated" });
    await player.play();
    expect(speech.spoken).toEqual(["After."]);
    expect(player.state).toBe("done");
  });

  test("autoAnswers (movies) vanishes it even with a gate wired", async () => {
    const speech = new RecordingSpeech();
    const player = new Player(planCommands(CMDS, []), new Map(), speech, null, { mode: "narrated" });
    player.autoAnswers = true;
    let opened = false;
    player.exploreGate = async () => {
      opened = true;
    };
    await player.play();
    expect(opened).toBe(false);
    expect(speech.spoken).toEqual(["After."]);
  });

  test("a live gate: narration plays, the gate holds until it resolves", async () => {
    const speech = new RecordingSpeech();
    const player = new Player(planCommands(CMDS, []), new Map(), speech, null, { mode: "narrated" });
    let release: (() => void) | null = null;
    player.exploreGate = (_sig, step) =>
      new Promise((r) => {
        expect(step.params).toEqual(["n"]);
        release = r;
      });
    const done = player.play();
    await new Promise((r) => setTimeout(r, 50));
    expect(speech.spoken).toEqual(["Try some numbers yourself."]);
    expect(player.state).toBe("playing");
    release!();
    await done;
    expect(speech.spoken).toEqual(["Try some numbers yourself.", "After."]);
  });
});

describe("settleParams and getParamOverrides", () => {
  function makeReprojector() {
    const commits: Record<string, number>[] = [];
    const rp: Reprojector = {
      frame: () => {},
      commit: (p) => {
        commits.push({ ...p });
        return new Map<string, RenderedElement>();
      },
    };
    return { rp, commits };
  }

  test("settleParams commits the boundary mid-run after a preview", () => {
    const player = new Player(planCommands([{ draw: ["x"] }], ["x"], { animateBase: {} }), new Map(), new RecordingSpeech(), null, {
      mode: "silent",
    });
    const { rp, commits } = makeReprojector();
    player.reprojector = rp;
    player.renderUpTo(1);
    const before = commits.length;
    player.previewParams({ n: 40 });
    player.settleParams();
    expect(commits.length).toBe(before + 1);
    expect(commits.at(-1)).toEqual({});
  });

  test("getParamOverrides exposes the viewer's runtime values", async () => {
    const plan = planCommands(
      [{ ask: { question: "N?", store: "n_choice", default: "20" } }, { animate: { n: "{n_choice}" }, duration: 0.05 }],
      [],
      { animateBase: { n: 4 } },
    );
    const player = new Player(plan, new Map(), new RecordingSpeech(), null, { mode: "silent" });
    const { rp } = makeReprojector();
    player.reprojector = rp;
    player.askGate = async () => "80";
    await player.play();
    expect(player.getParamOverrides()).toEqual({ n: 80 });
  });
});
