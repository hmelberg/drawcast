import { describe, expect, test } from "vitest";
import { validateSpec } from "../src/spec/schema";
import { planCommands } from "../src/render/plan";
import { collectSpeakLines } from "../src/export/video";
import { playlistBakeLines } from "../src/playlist/session";
import type { Command, Spec } from "../src/spec/types";

// A dialogue's quiz/ask may be voiced by speaker b: `voice` on the command
// picks who reads the question AND the right/wrong feedback.
const quizB: Command = {
  quiz: { question: "Which way?", choices: ["Up", "Down"], correct: 1, right: "Yes, up.", wrong: "No, it goes up." },
  voice: "b",
  delivery: "brisk",
} as Command;
const askB: Command = {
  ask: { question: "How many?", answer: "3", right: "Three, right.", wrong: "It was three.", say_question: false },
  voice: "b",
} as Command;

describe("voice on quiz/ask without speak", () => {
  test("schema accepts voice/delivery on a quiz or ask with no speak", () => {
    const r = validateSpec({ elements: [{ id: "c1", type: "curve", direction: "decreasing" }], commands: [quizB, askB] } as Spec);
    expect(r.errors).toEqual([]);
  });
  test("schema still rejects voice on a bare draw without speak", () => {
    const r = validateSpec({ elements: [{ id: "c1", type: "curve", direction: "decreasing" }], commands: [{ draw: ["c1"], voice: "b" }] } as Spec);
    expect(r.errors.join(" ")).toContain("voice and delivery only apply");
  });
  test("plan: the quiz step carries speaker b (and delivery) for all its lines", () => {
    const plan = planCommands([quizB], []);
    const step = plan.steps.find((s) => s.kind === "quiz")!;
    expect(step.narrationSpeaker).toBe("b");
    expect(step.narrationDelivery).toBe("brisk");
  });
  test("plan: an ask that does not say its question still carries speaker b for right/wrong", () => {
    const plan = planCommands([askB], []);
    const step = plan.steps.find((s) => s.kind === "ask")!;
    expect(step.narrationSpeaker).toBe("b");
  });
  test("plan: without voice nothing is attached (default a)", () => {
    const plan = planCommands([{ quiz: { question: "Q?", choices: ["x", "y"], correct: 1, right: "R." } } as Command], []);
    const step = plan.steps.find((s) => s.kind === "quiz")!;
    expect(step.narrationSpeaker).toBeUndefined();
  });
  test("bake: the quiz's question and right line are collected with speaker b", () => {
    const lines = collectSpeakLines({ commands: [quizB] } as Spec);
    expect(lines.find((l) => l.text === "Which way?")?.speaker).toBe("b");
    expect(lines.find((l) => l.text === "Yes, up.")).toMatchObject({ speaker: "b", delivery: "brisk" });
    const asked = collectSpeakLines({ commands: [askB] } as Spec);
    expect(asked.find((l) => l.text === "Three, right.")?.speaker).toBe("b");
  });
  test("bake: an opinion ask's wrong line (its only feedback) is collected with speaker b", () => {
    const opinion = { ask: { question: "Your pick?", choose: ["p", "q"], judge: false, wrong: "Noted." }, voice: "b" } as Command;
    const lines = collectSpeakLines({ commands: [opinion] } as Spec);
    expect(lines.find((l) => l.text === "Noted.")?.speaker).toBe("b");
  });
  test("bake: playlist bake lines include the quiz feedback in voice b", () => {
    const lines = playlistBakeLines({ meta: {}, entries: [{ kind: "item", spec: { commands: [quizB] } }], warnings: [] } as never);
    expect(lines.some((l) => l.text === "Yes, up." && l.speaker === "b")).toBe(true);
  });
});
