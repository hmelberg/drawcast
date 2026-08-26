// The focus verb (inverse spotlight) and the semantic-zoom playlist transition.

import { describe, expect, test } from "vitest";
import { validateSpec } from "../src/spec/schema";
import { planCommands } from "../src/render/plan";
import { Player } from "../src/render/player";
import { SpeechManager } from "../src/render/speech";
import type { BackendEffects } from "../src/render/backend";
import type { Spec } from "../src/spec/types";
import { exportSequence, ZOOM_EXIT, type Playlist } from "../src/playlist/playlist";

const flush = () => new Promise((r) => setTimeout(r, 10));

describe("focus", () => {
  const base = (cmds: object[]): Spec =>
    ({ elements: [{ id: "a", type: "point", at: { x: 100, y: 100 } }, { id: "b", type: "point", at: { x: 300, y: 300 } }], commands: cmds }) as unknown as Spec;

  test("validates with target (string or list); duration optional", () => {
    expect(validateSpec(base([{ draw: ["a", "b"] }, { focus: { target: "a" }, speak: "just a" }])).ok).toBe(true);
    expect(validateSpec(base([{ draw: ["a", "b"] }, { focus: { target: ["a"], duration: 3 } }])).ok).toBe(true);
    expect(validateSpec(base([{ focus: {} }])).ok).toBe(false);
  });

  test("plans as a step holding the TARGETS; narrated with no duration holds for the sentence", () => {
    const plan = planCommands(
      [{ draw: ["a", "b", "c"] }, { focus: { target: ["a"] }, speak: "watch a" }, { focus: { target: ["b"], duration: 1 } }, { focus: { target: ["ghost"] } }],
      ["a", "b", "c"],
    );
    const steps = plan.steps.filter((s) => s.kind === "focus") as { ids: string[]; seconds: number; untilNarrationEnd?: boolean }[];
    expect(steps).toHaveLength(2); // the ghost focus is dropped (not visible)
    expect(steps[0].ids).toEqual(["a"]);
    expect(steps[0].untilNarrationEnd).toBe(true);
    expect(steps[1].ids).toEqual(["b"]);
    expect(steps[1].seconds).toBe(1);
    expect(steps[1].untilNarrationEnd).toBeUndefined();
    expect(plan.warnings.some((w) => w.includes("ghost"))).toBe(true);
    // Focus mutates nothing: the scene state after each focus step matches the draw.
    expect(plan.states[1].visible).toEqual(["a", "b", "c"]);
  });

  test("the player dims the NON-targets and always restores", async () => {
    const dimmed: string[][] = [];
    let ended: string[] | null = null;
    const effects: BackendEffects = {
      setHighlight: () => undefined,
      endHighlight: () => undefined,
      setFocus: (ids) => dimmed.push([...ids]),
      endFocus: (ids) => (ended = [...ids]),
      setPointer: () => undefined,
      setCamera: () => undefined,
    };
    const stub = (id: string) => ({ id, durationMs: 10, finish: () => undefined, hide: () => undefined, setProgress: () => undefined }) as never;
    const elements = new Map([["a", stub("a")], ["b", stub("b")], ["c", stub("c")]]);
    const plan = planCommands([{ draw: ["a", "b", "c"] }, { focus: { target: ["a"], duration: 0.5 } }], ["a", "b", "c"]);
    const player = new Player(plan, elements, new SpeechManager(), null, { mode: "narrated", effects });
    const frames: ((now: number) => void)[] = [];
    player.raf = (cb) => frames.push(cb);
    const done = player.play();
    await flush();
    let now = performance.now();
    for (let guard = 0; player.state === "playing" && guard < 60; guard++) {
      now += 120;
      for (const cb of frames.splice(0)) cb(now);
      await flush();
    }
    await done;
    expect(player.state).toBe("done");
    expect(dimmed.length).toBeGreaterThan(0);
    expect(dimmed[0]).toEqual(["b", "c"]); // a stays lit
    expect(ended).toEqual(["b", "c"]); // and the dim is always cleaned up
  });
});

describe("semantic zoom", () => {
  const item = (title: string, extra: object = {}): Spec =>
    ({ title, elements: [{ id: "dot", type: "point", at: { x: 500, y: 375 } }], commands: [{ draw: ["dot"] }], ...extra }) as unknown as Spec;

  test("zoom_from validates on a spec", () => {
    expect(validateSpec(item("b", { zoom_from: "dot" })).ok).toBe(true);
  });

  test("the outgoing item exits through a camera push into the named element, replacing the soft exit", () => {
    const playlist: Playlist = {
      meta: { advance: "auto", gap: 1, transitions: "auto" },
      entries: [
        { kind: "item", spec: item("first") },
        { kind: "item", spec: item("second", { zoom_from: "dot" }) },
      ],
      warnings: [],
    };
    const seq = exportSequence(playlist);
    expect(seq).toHaveLength(2);
    const exit = seq[0].commands ?? [];
    const camera = exit.find((c) => c.camera !== undefined);
    expect(camera?.camera).toMatchObject({ center: { ref: "dot" }, zoom: ZOOM_EXIT.zoom });
    // The zoom happens BEFORE the fade-out clear.
    expect(exit.findIndex((c) => c.camera !== undefined)).toBeLessThan(exit.findIndex((c) => c.clear !== undefined));
  });

  test("a semantic zoom replaces the chapter card at its junction", () => {
    const playlist: Playlist = {
      meta: { advance: "auto", gap: 1, transitions: "auto" },
      entries: [
        { kind: "chapter", title: "One" },
        { kind: "item", spec: item("first") },
        { kind: "chapter", title: "Two" },
        { kind: "item", spec: item("second", { zoom_from: "dot" }) },
      ],
      warnings: [],
    };
    const seq = exportSequence(playlist);
    // title-less playlist: first item, then second item — NO chapter card between.
    expect(seq).toHaveLength(2);
  });
});
