import { describe, expect, test } from "vitest";
import { Player } from "../src/render/player";
import { planCommands, INITIAL_STATE, type Plan } from "../src/render/plan";
import { SpeechManager } from "../src/render/speech";
import type { RenderedElement } from "../src/render/backend";
import type { Pt } from "../src/layout/model";
import { layoutSpec } from "../src/layout/layout";
import { heuristicMeasure } from "../src/layout/measure";
import { rendererFor } from "../src/render/svg-backend";
import { installMiniDom, leafNodesFor, FakeNode } from "./helpers/mini-dom";

const flush = () => new Promise((r) => setTimeout(r, 10));

describe("Player frame scheduler injection", () => {
  test("the timeline animates on the injected scheduler, not the global rAF", async () => {
    // node env has no requestAnimationFrame — a pause step can only complete
    // if the Player consults the injected scheduler.
    const player = new Player(planCommands([{ pause: 0.1 }], []), new Map(), new SpeechManager(), null, { mode: "narrated" });
    const frames: ((now: number) => void)[] = [];
    player.raf = (cb) => frames.push(cb);
    const done = player.play();
    await flush();
    expect(player.state).toBe("playing");
    expect(frames.length).toBeGreaterThan(0);
    // Drive the injected clock far past the pause — the step must complete.
    for (let guard = 0; player.state === "playing" && guard < 20; guard++) {
      for (const cb of frames.splice(0)) cb(performance.now() + 100_000);
      await flush();
    }
    await done;
    expect(player.state).toBe("done");
  });
});

describe("Player morph settle vs. a mid-tween scrub", () => {
  test("aborting a morph step (a scrub) must not let its settle overwrite the fresh scrubbed geometry", async () => {
    // Fix round 2, finding 3's regression: the morph case's post-progress
    // settle ran unconditionally, so an abort mid-tween (renderUpTo -> a
    // synchronous applyScene for the NEW boundary) was immediately followed,
    // once the aborted progress() promise resolved, by the ABANDONED step's
    // own settle overwriting that fresh geometry with its own boundary's
    // shapes. A hand-built two-step plan (no layout needed): step 0 a no-op
    // pause, step 1 a morph of "a" — so scrubbing to step 0 (INITIAL_STATE,
    // no shapes entry for "a") differs from step 1's own completion boundary
    // (which does carry one), making the regression observable.
    const setPointsCalls: Record<string, Pt[]>[] = [];
    const el: RenderedElement = {
      id: "a",
      durationMs: 0,
      setProgress: () => {},
      finish: () => {},
      hide: () => {},
      setPoints: (pts) => setPointsCalls.push(pts),
    };
    const plan: Plan = {
      steps: [
        { kind: "pause", seconds: 0 },
        {
          kind: "morph",
          items: [{ id: "a", leaves: [{ leafId: "leafA", from: [[0, 0], [1, 0], [1, 1]], to: [[0, 0], [2, 0], [2, 2]] }] }],
          seconds: 1,
          easing: "linear",
        },
      ],
      states: [
        { ...INITIAL_STATE, visible: ["a"] },
        { ...INITIAL_STATE, visible: ["a"], shapes: { a: { leafA: [[0, 0], [2, 0], [2, 2]] } } },
      ],
      labels: {},
      warnings: [],
      minted: [],
    };
    const player = new Player(plan, new Map([["a", el]]), new SpeechManager(), null, { mode: "narrated" });
    const frames: ((now: number) => void)[] = [];
    player.raf = (cb) => frames.push(cb);
    player.play();
    await flush(); // step 0 (pause) completes; step 1's morph registers its first tick
    expect(frames.length).toBeGreaterThan(0);
    // One tick, comfortably short of the step's 1000ms — the tween is mid-flight.
    frames.splice(0).forEach((cb) => cb(performance.now() + 50));
    await flush();
    expect(frames.length).toBeGreaterThan(0); // progress() re-queued its next tick
    setPointsCalls.length = 0; // only the calls from here on matter
    // The scrub: aborts the in-flight morph and applies INITIAL_STATE (no
    // shapes for "a") synchronously.
    player.renderUpTo(0);
    expect(setPointsCalls).toEqual([{}]);
    // Resolve the aborted progress() promise (its tick sees signal.aborted
    // and resolves without another onTick) — this is where the abandoned
    // step's settle used to fire.
    frames.splice(0).forEach((cb) => cb(performance.now() + 100_000));
    await flush();
    expect(setPointsCalls).toEqual([{}]); // no further call re-applied the old boundary's shapes
  });
});

describe("a measure that has not been drawn yet must not pop into view when its figure moves", () => {
  test("a transform step's extras rebuild a hidden measure's leaves at ITS progress, not at 1", async () => {
    // Task 4 fix round 1, finding 1: setPoints/setText rebuilt a leaf and
    // ended on setProgress(1), so `draw: [sq]` → `move: {target: [sq]}` →
    // `draw: [side]` showed the dimension line and its label DURING the move,
    // a step before their own draw. applyScene only runs on scrubs, so
    // nothing repaired it. Real handles (the mini-DOM), because the bug lives
    // in the SVG backend's rebuild, not in the plan.
    const { restore, doc } = installMiniDom();
    try {
      const spec = {
        elements: [
          { id: "sq", type: "polygon", points: [[200, 200], [300, 200], [300, 300], [200, 300]] },
          { id: "side", type: "measure", from: { ref: "sq", anchor: "vertex_1" }, to: { ref: "sq", anchor: "vertex_2" }, label: "b = {value}" },
        ],
        commands: [{ draw: ["sq"] }],
      };
      const layout = layoutSpec(spec as never, heuristicMeasure);
      const container = new FakeNode("div", doc as never);
      const mounted = await rendererFor("clean").mount(layout, spec as never, container as never);
      // The reveal's own state, read off the DOM: a text leaf hides by
      // g.style.opacity = "0", a stroke leaf by a full stroke-dashoffset
      // (the mini-DOM's getTotalLength is a stable 100).
      const labelG = () => leafNodesFor(container, "label_side")[0];
      const lineDashoffset = () => leafNodesFor(container, "side")[0].querySelectorAll("path")[0].style.strokeDashoffset;
      const labelText = () => labelG().querySelectorAll("text")[0].textContent;
      expect(labelG().style.opacity).toBe("0"); // hidden after mount
      expect(lineDashoffset()).toBe("100");
      expect(labelText()).toBe("b = 100");

      const line: Pt[] = [[200, 176], [400, 176]];
      const plan: Plan = {
        steps: [
          { kind: "pause", seconds: 0 },
          {
            kind: "transform",
            items: [{ id: "sq", from: { offset: [0, 0], turn: { deg: 0, pivot: [0, 0] } }, to: { offset: [0, 0], turn: { deg: 0, pivot: [0, 0], scale: 2 } } }],
            seconds: 0,
            easing: "linear",
            extraMorphs: [{ id: "side", leaves: [{ leafId: "side", from: [[200, 176], [300, 176]], to: line }] }],
            texts: [{ id: "label_side", leafId: "label_side", text: "b = 200" }],
          },
        ],
        states: [
          { ...INITIAL_STATE, visible: ["sq"] },
          { ...INITIAL_STATE, visible: ["sq"], turns: { sq: { deg: 0, pivot: [0, 0], scale: 2 } }, shapes: { side: { side: line } }, texts: { label_side: { label_side: "b = 200" } } },
        ],
        labels: {},
        warnings: [],
        minted: [],
      };
      const player = new Player(plan, mounted.elements, new SpeechManager(), null, { mode: "narrated" });
      const frames: ((now: number) => void)[] = [];
      player.raf = (cb) => frames.push(cb);
      const done = player.play();
      for (let guard = 0; player.state === "playing" && guard < 20; guard++) {
        for (const cb of frames.splice(0)) cb(performance.now() + 100_000);
        await flush();
      }
      await done;
      expect(player.state).toBe("done");

      // The measure was rewritten and re-pointed — and is STILL hidden.
      expect(labelText()).toBe("b = 200");
      expect(labelG().style.opacity).toBe("0");
      expect(lineDashoffset()).toBe("100");

      // Its own draw step, later: the NEW string appears, not the layout's.
      mounted.elements.get("side")!.finish();
      mounted.elements.get("label_side")!.finish();
      expect(labelText()).toBe("b = 200");
      expect(labelG().style.opacity).toBe("1");
      expect(lineDashoffset()).toBe("0");
    } finally {
      restore();
    }
  });
});
