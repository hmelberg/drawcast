import { describe, expect, test } from "vitest";
import { titleIsDrawn } from "../src/render/title";
import type { Drawable } from "../src/layout/model";

// C9 as Hans clarified it (2026-09-02): a title that is PART of the drawcast
// — drawn ink — makes the app's own title text disappear (player and video
// frame both); the chrome title is only the fallback for casts that never
// draw theirs.

const text = (t: string, lines?: string[]): Drawable =>
  ({ id: "t", kind: "text", pos: [500, 700], text: t, fontSize: 40, anchor: "middle", ...(lines ? { lines } : {}) }) as unknown as Drawable;
const group = (children: Drawable[]): Drawable => ({ id: "g", kind: "group", children }) as unknown as Drawable;

describe("titleIsDrawn", () => {
  test("an exact drawn title counts, wherever it nests, however it is cased or spaced", () => {
    expect(titleIsDrawn("Markov models part I", [text("Markov models part I")])).toBe(true);
    expect(titleIsDrawn("Markov models part I", [group([text("markov  MODELS part i")])])).toBe(true);
  });

  test("wrapped titles count via their joined lines", () => {
    expect(titleIsDrawn("Markov models part I", [text("Markov models part I", ["Markov models", "part I"])])).toBe(true);
  });

  test("a near-miss does not count — a looser rule would hide real titles", () => {
    expect(titleIsDrawn("Markov models part I", [text("Markov models")])).toBe(false);
    expect(titleIsDrawn("Markov models part I", [text("Markov models part II")])).toBe(false);
  });

  test("no title, empty title, or no drawn text mean the chrome title stays", () => {
    expect(titleIsDrawn(undefined, [text("anything")])).toBe(false);
    expect(titleIsDrawn("  ", [text("anything")])).toBe(false);
    expect(titleIsDrawn("Markov models part I", [])).toBe(false);
  });
});
