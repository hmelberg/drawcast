import { describe, expect, test } from "vitest";
import { chessSquareAt, chessSquareBox } from "../src/render/widgets";
import { planCommands } from "../src/render/plan";

describe("chess square geometry", () => {
  test("white view: a1 bottom-left, h8 top-right", () => {
    const a1 = chessSquareBox(false, "a1")!;
    expect(chessSquareAt(false, [a1.x + 10, a1.y + 10])).toBe("a1");
    const h8 = chessSquareBox(false, "h8")!;
    expect(chessSquareAt(false, [h8.x + 10, h8.y + 10])).toBe("h8");
  });

  test("flipped view mirrors files and ranks", () => {
    const a1flipped = chessSquareBox(true, "a1")!;
    expect(chessSquareAt(true, [a1flipped.x + 10, a1flipped.y + 10])).toBe("a1");
    // In the flipped view a1's box sits where h8's box sits in the white view.
    expect(chessSquareBox(true, "a1")).toEqual(chessSquareBox(false, "h8"));
  });

  test("off the board is a miss; bad squares are null", () => {
    expect(chessSquareAt(false, [10, 10])).toBe(null);
    expect(chessSquareBox(false, "j9")).toBe(null);
  });
});

describe("chess widget planning", () => {
  test("the demo box is the move's target square", () => {
    const plan = planCommands(
      [{ ask: { question: "Mate!", answer: "h5f7", widget: "chess" } }],
      [],
      { animateBase: {} },
    );
    const s = plan.steps[0];
    if (s.kind !== "ask") throw new Error("no ask step");
    expect(s.answerBox).toEqual(chessSquareBox(false, "f7"));
  });
});
