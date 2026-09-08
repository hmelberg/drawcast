import { describe, expect, test } from "vitest";
import { planCommands } from "../src/render/plan";

// The connect widget: the figure's own lines are the reveal. The plan makes
// the constellation group visible once the question ends (the same contract
// the drag widget's element items have) and gives the movie a box to point
// the laser at. The answer key itself is derived at gate time from the
// layout, not carried here — a second copy could disagree with it.
describe("the connect widget is planned", () => {
  const boxes: Record<string, { x: number; y: number; w: number; h: number }> = {
    con_ori: { x: 10, y: 10, w: 40, h: 60 },
  };
  const plan = (answer: string | undefined) =>
    planCommands(
      [{ draw: ["backdrop"] }, { ask: { question: "Draw Orion.", widget: "connect", answer, right: "R." } } as never],
      ["backdrop", "con_ori"],
      { bboxOf: (id) => boxes[id] ?? null },
    );

  test("the constellation is visible after the step (the reveal), and not drawn again at the end", () => {
    const p = plan("con_ori");
    expect(p.states[0].visible).toEqual(["backdrop"]);
    expect(p.states[1].visible).toEqual(["backdrop", "con_ori"]);
    const drawn = p.steps.flatMap((s) => (s.kind === "draw" ? s.ids : []));
    expect(drawn).not.toContain("con_ori"); // shown by the question, never drawn twice
  });

  test("the step carries widget connect and the group's box as answerBox", () => {
    const p = plan("con_ori");
    const s = p.steps[1];
    if (s.kind !== "ask") throw new Error("not an ask");
    expect(s.widget).toBe("connect");
    expect(s.answer).toBe("con_ori");
    expect(s.answerBox).toEqual(boxes.con_ori);
  });

  test("an answer naming nothing drawn produces no answerBox and does not throw", () => {
    expect(() => plan("con_missing")).not.toThrow();
    const p = plan("con_missing");
    const s = p.steps[1];
    if (s.kind !== "ask") throw new Error("not an ask");
    expect(s.widget).toBe("connect");
    expect(s.answer).toBe("con_missing");
    expect(s.answerBox).toBeUndefined();
  });
});
