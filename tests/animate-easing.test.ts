// The animate verb's pacing. Two things are pinned: an explicit easing
// reaches the plan (and absent stays today's smoothstep), and a narrated
// animate tweens UNDER its narration rather than after it — the property a
// thirty-second race depends on, which nothing pinned before.

import { describe, expect, test } from "vitest";
import { planCommands } from "../src/render/plan";
import { EASINGS } from "../src/render/effects";
import type { Command } from "../src/spec/types";

const plan = (cmd: Command) => planCommands([cmd], ["fig"], { bboxOf: () => null, animateBase: { stage: 0 } });

describe("animate easing", () => {
  test("an explicit easing reaches the step", () => {
    const step = plan({ animate: { stage: 3 }, duration: 10, easing: "linear" }).steps[0];
    expect(step).toMatchObject({ kind: "animate", easing: "linear" });
  });

  test("no easing leaves the step's easing undefined (the smoothstep default)", () => {
    const step = plan({ animate: { stage: 3 }, duration: 10 }).steps[0];
    expect((step as { easing?: string }).easing).toBeUndefined();
  });

  test("linear is the identity, so a race runs at constant speed", () => {
    expect(EASINGS.linear(0.25)).toBeCloseTo(0.25, 6);
    expect(EASINGS.linear(0.75)).toBeCloseTo(0.75, 6);
  });
});

describe("narrated animate", () => {
  test("the narration rides on the animate step, so the prelude runs them together", () => {
    const step = plan({ animate: { stage: 3 }, duration: 10, speak: "Watch the 80s." }).steps[0];
    // The player's narrated-action prelude (player.ts:494) runs
    // Promise.all([action, voice]) for any step carrying `narration`. If a
    // future edit moved the speech into its own blocking step, the race
    // would go silent-then-move and this assertion would catch it.
    expect(step).toMatchObject({ kind: "animate", narration: "Watch the 80s." });
    expect(plan({ animate: { stage: 3 }, speak: "x" }).steps.filter((s) => s.kind === "speak")).toEqual([]);
  });
});
