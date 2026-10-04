// W25: on-canvas quiz buttons' (and a poll's) icons are icon slots the
// resolver fills, and the expansion carries the data onto each button's node.
import { describe, expect, test } from "vitest";
import { iconSlots } from "../src/spec/icon-data";
import { expandAnswerButtons } from "../src/spec/answer-buttons";
import { validateSpec } from "../src/spec/schema";
import type { Spec } from "../src/spec/types";

const quiz = (buttons: unknown[]): Spec =>
  ({
    title: "Which is closer to Earth?",
    elements: [{ id: "q", type: "text", text: "Closer?", x: 500, y: 500 }],
    commands: [
      { draw: ["q"], speak: "Which is closer?" },
      { quiz: { on_canvas: true, question: "Which is closer to Earth, the Moon or the Sun?", choices: ["Moon", "Sun"], correct: 1, buttons } },
    ],
  }) as unknown as Spec;

describe("answer-button icons", () => {
  test("each button's keyword is an icon slot (the resolver and check see it)", () => {
    const slots = iconSlots(quiz([{ icon: "moon" }, { icon: { of: "sun", set: "twemoji" } }]));
    expect(slots.map((s) => s.ask.of)).toEqual(["moon", "sun"]);
    expect(slots.every((s) => s.data === "icon_strokes")).toBe(true);
  });
  test("a poll's choices too", () => {
    const spec = { elements: [], commands: [{ ask: { question: "Which do you prefer?", poll: { choices: [{ text: "Tea", share: 0.4, icon: "tea" }, { text: "Coffee", share: 0.6, icon: "coffee" }] } } }] } as unknown as Spec;
    expect(iconSlots(spec).map((s) => s.ask.of)).toEqual(["tea", "coffee"]);
  });
  test("resolved data rides onto the button's node, and the spec stays valid", () => {
    const spec = quiz([{ icon: "moon", icon_strokes: "DATA-MOON", credit: "Twemoji" }, { icon: "sun" }]);
    expect(validateSpec(spec).ok).toBe(true);
    const ex = expandAnswerButtons(spec);
    const btn = (ex.elements ?? []).find((e) => e.id === "quiz_1_btn_1") as unknown as Record<string, unknown>;
    expect(btn.icon).toBe("moon");
    expect(btn.icon_strokes).toBe("DATA-MOON");
    expect(btn.credit).toBe("Twemoji");
    const btn2 = (ex.elements ?? []).find((e) => e.id === "quiz_1_btn_2") as unknown as Record<string, unknown>;
    expect(btn2.icon_strokes).toBeUndefined();
  });
});
