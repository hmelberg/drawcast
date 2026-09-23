// The pill exists, sits with the other chess activities, and is routed.
// A registry entry nothing routes is a button that does nothing.
import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { activitiesFor } from "../src/ui/quiz-model";

describe("the Drill openings pill", () => {
  test("is offered on any chess scene, beside the drills already there", () => {
    const ids = activitiesFor(["chess"]).map((a) => a.id);
    expect(ids).toContain("openings_drill");
    expect(ids).toContain("square_quiz");
    expect(ids).toContain("vs_computer");
  });

  test("is not offered on a scene that declares no chess", () => {
    expect(activitiesFor(["piano"]).map((a) => a.id)).not.toContain("openings_drill");
  });

  test("does not displace the generic identify drill for a figure with parts", () => {
    // activitiesFor's own rule: the generic drill is added only when nothing
    // bespoke was. A chess scene is bespoke; a parts figure must be unaffected.
    expect(activitiesFor([], 8).map((a) => a.id)).toEqual(["parts_quiz"]);
  });

  test("the tray routes it — a pill nothing mounts is a dead button", () => {
    // Every door (tray pill, explore.activity, the right-click card) starts an
    // activity through ui/activities.ts's startActivity (design 2026-09-24-music §6.4).
    const tray = readFileSync(new URL("../src/ui/tray.ts", import.meta.url), "utf8");
    const acts = readFileSync(new URL("../src/ui/activities.ts", import.meta.url), "utf8");
    expect(tray).toContain("startActivity(stage, hd, a)");
    expect(acts).toContain("openings_drill");
    expect(acts).toContain("mountChessDrill");
  });
});
