import { describe, expect, test } from "vitest";
import { layoutSpec, elementBBoxes } from "../src/layout/layout";
import { heuristicMeasure } from "../src/layout/measure";
import { planCommands, type Plan } from "../src/render/plan";
import { planOptionsFor } from "../src/render/index";
import { withMinted } from "../src/render/minted";
import { Player } from "../src/render/player";
import { SpeechManager } from "../src/render/speech";
import { rendererFor } from "../src/render/svg-backend";
import { installMiniDom, leafNodesFor, FakeNode } from "./helpers/mini-dom";

// Round 3 review, C1: `ghost: true` on move/arrange/flip/morph minted the
// ghost, marked it visible, known and mentioned — and pushed NO step, so no
// handle was ever finish()ed and the ghost stayed at reveal progress 0 for the
// whole cast. `mentioned` deliberately keeps it out of the implicit final draw
// and `applyScene` only runs on a scrub, so nothing repaired it. Every
// plan-level ghost test was green with the bug present (they read
// `state.visible`, which said true all along) — only the real backend, mounted
// and played to completion, can see it. Measured on the old code, this file's
// ghost leaf read strokeDashoffset "100" (fully hidden) for all four verbs;
// with the `{kind:"show"}` step it reads "0".

const flush = () => new Promise((r) => setTimeout(r, 10));

const SPEC = {
  elements: [{ id: "tri", type: "polygon", points: [[100, 100], [300, 100], [200, 300]] }],
  commands: [{ draw: ["tri"] }],
};

function planFor(command: unknown): { spec: unknown; layout: ReturnType<typeof layoutSpec>; plan: Plan } {
  const spec = { ...SPEC, commands: [...SPEC.commands, command] };
  const layout = layoutSpec(spec as never, heuristicMeasure);
  const bboxes = elementBBoxes(layout, heuristicMeasure);
  const plan = planCommands(spec.commands as never, layout.order, { bboxOf: (id) => bboxes.get(id) ?? null, ...planOptionsFor(spec as never, layout) });
  return { spec, layout, plan };
}

/** Mount the real backend over the wrapped layout and play the plan to the end. */
async function playToEnd(command: unknown): Promise<{ dashoffset: string; plan: Plan }> {
  const { restore, doc } = installMiniDom();
  try {
    const { spec, layout, plan } = planFor(command);
    // Exactly what render() mounts: the layout with the plan's minted elements appended.
    const mountedLayout = withMinted(layout, plan.minted, () => layout);
    const container = new FakeNode("div", doc as never);
    const mounted = await rendererFor("clean").mount(mountedLayout, spec as never, container as never);
    const ghostLeaf = () => leafNodesFor(container, "tri_ghost")[0];
    expect(ghostLeaf()).toBeDefined();
    // The mini-DOM's getTotalLength is a stable 100, so a full dashoffset is the hidden state.
    expect(ghostLeaf().querySelectorAll("path")[0].style.strokeDashoffset).toBe("100");

    const player = new Player(plan, mounted.elements, new SpeechManager(), null, { mode: "narrated" });
    const frames: ((now: number) => void)[] = [];
    player.raf = (cb) => frames.push(cb);
    const done = player.play();
    for (let guard = 0; player.state === "playing" && guard < 40; guard++) {
      for (const cb of frames.splice(0)) cb(performance.now() + 100_000);
      await flush();
    }
    await done;
    expect(player.state).toBe("done");
    return { dashoffset: ghostLeaf().querySelectorAll("path")[0].style.strokeDashoffset, plan };
  } finally {
    restore();
  }
}

const CASES: { verb: string; command: unknown; motion: string }[] = [
  { verb: "move", command: { move: { target: ["tri"], by: [100, 0], duration: 0, ghost: true } }, motion: "move" },
  { verb: "arrange", command: { arrange: { target: ["tri"], layout: "row", duration: 0, ghost: true } }, motion: "transform" },
  { verb: "flip", command: { flip: { target: ["tri"], axis: "vertical", duration: 0, ghost: true } }, motion: "transform" },
  { verb: "morph", command: { morph: { target: ["tri"], stretch: [2, 1], duration: 0, ghost: true } }, motion: "morph" },
];

describe("ghost: true is actually PAINTED during playback (round 3 review, C1)", () => {
  for (const { verb, command, motion } of CASES) {
    test(`${verb} … ghost: true leaves the ghost inked when the cast ends`, async () => {
      const { dashoffset, plan } = await playToEnd(command);
      expect(plan.warnings).toEqual([]);
      expect(dashoffset).toBe("0"); // "100" before the fix — minted, visible in the plan, never drawn
      // The show step comes BEFORE the motion, so the ghost marks where the
      // figure WAS for the whole beat, not just after it.
      const show = plan.steps.findIndex((s) => s.kind === "show");
      const moved = plan.steps.findIndex((s) => s.kind === motion);
      expect(show).toBeGreaterThan(-1);
      expect(plan.steps[show]).toMatchObject({ kind: "show", ids: ["tri_ghost"] });
      expect(moved).toBeGreaterThan(show);
    });
  }

  test("the ghost's own step carries no narration — the beat's line belongs to the motion step, and is spoken once", () => {
    const { plan } = planFor({ move: { target: ["tri"], by: [100, 0], ghost: true }, speak: "Watch it go." });
    const spoken = plan.steps.filter((s) => "narration" in s && s.narration === "Watch it go.");
    expect(spoken).toHaveLength(1);
    expect(spoken[0].kind).toBe("move");
    expect(plan.steps.find((s) => s.kind === "show")).not.toHaveProperty("narration");
  });
});
