// explore.activity (design 2026-09-24 music §6.3): a cast stops and opens a
// named activity straight on the figure — the tray stays shut — and closing
// it is Continue; `store` keeps its score as {<store>} and {<store>.total}.

import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { ACTIVITY_IDS } from "../src/spec/types";
import { activitiesFor } from "../src/ui/quiz-model";
import { validateSpec } from "../src/spec/schema";
import { planCommands } from "../src/render/plan";

const tray = readFileSync(new URL("../src/ui/tray.ts", import.meta.url), "utf8");
const player = readFileSync(new URL("../src/render/player.ts", import.meta.url), "utf8");

describe("the activity ids", () => {
  test("every activity a figure can offer is one explore.activity may name", () => {
    const offered = new Set(
      [["chess"], ["piano"], ["periodic"], []].flatMap((k) => activitiesFor(k, 99).map((a) => a.id)),
    );
    for (const id of offered) expect(ACTIVITY_IDS as readonly string[]).toContain(id);
    for (const id of ACTIVITY_IDS) expect(offered.has(id)).toBe(true);
  });
});

describe("validation and planning", () => {
  const spec = (activity: string) => ({ template: "piano_keys", commands: [{ explore: { activity, store: "drill" } }] });

  test("a known activity validates; an unknown one is refused with the list", () => {
    expect(validateSpec(spec("note_quiz")).ok).toBe(true);
    const bad = validateSpec(spec("note_quizz"));
    expect(bad.ok).toBe(false);
    expect(bad.errors.join(" ")).toContain("note_quiz");
  });

  test("the plan step carries the activity and the store", () => {
    const plan = planCommands([{ explore: { activity: "note_quiz", store: "drill" } }], []);
    expect(plan.steps.find((s) => s.kind === "explore")).toMatchObject({ kind: "explore", activity: "note_quiz", store: "drill" });
  });
});

describe("the gate (pins)", () => {
  const gate = tray.slice(tray.indexOf("hd.timeline.exploreGate ="), tray.indexOf("hd.timeline.exploreGate =") + 6000);

  test("an activity beat mounts the activity on the figure with the tray shut, and its close continues", () => {
    const branch = gate.slice(gate.indexOf("if (step.activity !== undefined)"), gate.indexOf("// Which surface the beat opens"));
    expect(branch).toMatch(/activitiesFor\(interactions, partsCount\)\.find/);
    expect(branch).toMatch(/mountQuiz\(stage, hd, act, done\)/);
    expect(branch).not.toMatch(/open\(\{/);
    expect(branch).toMatch(/void hd\.timeline\.play\(\)/);
    expect(branch).toMatch(/\[`\$\{step\.store\}\.total`\]/);
  });

  test("the player keeps what the gate hands back as vars", () => {
    expect(player).toMatch(/const kept = await this\.exploreGate\(signal, step\);/);
    expect(player).toMatch(/this\.vars\.set\(k\.toLowerCase\(\), v\)/);
  });
});
