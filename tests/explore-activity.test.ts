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
      [["chess"], ["piano"], ["periodic"], ["staff"], []].flatMap((k) => activitiesFor(k, 99).map((a) => a.id)),
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
    expect(branch).toMatch(/startActivity\(stage, hd, act, done\)/);
    expect(branch).not.toMatch(/open\(\{/);
    expect(branch).toMatch(/void hd\.timeline\.play\(\)/);
    expect(branch).toMatch(/\[`\$\{step\.store\}\.total`\]/);
  });

  test("the player keeps what the gate hands back as vars", () => {
    expect(player).toMatch(/const kept = await this\.exploreGate\(signal, step\);/);
    expect(player).toMatch(/this\.vars\.set\(k\.toLowerCase\(\), v\)/);
  });
});

import { staffQuizTargets, pianoNaturals } from "../src/ui/quiz-model";

describe("the staff and ear drills (design 2026-09-24-music §6.1)", () => {
  test("a staff figure offers find, name and hear; a piano adds hear-the-key", () => {
    expect(activitiesFor(["staff"]).map((a) => a.id)).toEqual(["staff_find", "staff_name", "ear_staff"]);
    expect(activitiesFor(["piano"]).map((a) => a.id)).toEqual(["note_quiz", "ear_key"]);
  });

  test("staff targets are distinct natural notes the staff shows well, each with its staff", () => {
    let seed = 7;
    const rng = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const t = staffQuizTargets(5, [{ id: "staff", ref: 30 }], rng);
    expect(t).toHaveLength(5);
    expect(new Set(t.map((q) => q.pitch)).size).toBe(5);
    for (const q of t) {
      expect(q.pitch).toMatch(/^[A-G][45]$/); // C4–G5 on a treble staff
      expect(q.staffId).toBe("staff");
    }
    // A grand staff asks on both.
    const both = staffQuizTargets(25, [{ id: "staff", ref: 30 }, { id: "bass_staff", ref: 18 }], rng);
    expect(new Set(both.map((q) => q.staffId)).size).toBe(2);
  });

  test("the ear drill on a piano plays only natural notes", () => {
    for (const n of pianoNaturals(2)) expect(n).not.toContain("#");
  });

  test("ask answers on the staff (pin)", () => {
    const controls = readFileSync(new URL("../src/ui/controls.ts", import.meta.url), "utf8");
    expect(controls).toMatch(/step\.widget === "staff"\s*\?\s*staffGate\(signal, step\)/);
    expect(controls).toMatch(/staffPitchAt\(stavesOf\(layout\.drawables/);
  });
});

describe("a movie stands in for the viewer (pin)", () => {
  test("a skipped explore with store keeps full marks for an activity and an empty melody otherwise", () => {
    const player = readFileSync(new URL("../src/render/player.ts", import.meta.url), "utf8");
    const at = player.indexOf('if (step.kind === "explore" && (this.skipQuestions || this.autoAnswers || !this.exploreGate))');
    const branch = player.slice(at, at + 900);
    expect(branch).toMatch(/this\.vars\.set\(k, String\(ACTIVITY_QUESTIONS\)\)/);
    expect(branch).toMatch(/this\.vars\.set\(`\$\{k\}\.total`, String\(ACTIVITY_QUESTIONS\)\)/);
    expect(branch).toMatch(/else this\.vars\.set\(k, ""\)/);
    // The same number the drill loop asks.
    const quiz = readFileSync(new URL("../src/ui/quiz.ts", import.meta.url), "utf8");
    expect(quiz).toMatch(/const QUIZ_LEN = ACTIVITY_QUESTIONS;/);
  });
});
