import { describe, expect, it } from "vitest";
import { makeNextCard } from "../src/playlist/playlist";
import { validateSpec } from "../src/spec/schema";

describe("makeNextCard", () => {
  it("produces a valid spec", () => {
    expect(validateSpec(makeNextCard({ next: "Difference-in-differences", position: 2, total: 8 })).ok).toBe(true);
  });

  it("names the next lecture and its position", () => {
    const spec = makeNextCard({ next: "Difference-in-differences", position: 2, total: 8 });
    const texts = (spec.elements ?? []).map((e) => ("text" in e ? e.text : "")).join(" | ");
    expect(texts).toContain("Difference-in-differences");
    expect(texts).toContain("2 of 8");
  });

  it("speaks the next lecture's title", () => {
    const spec = makeNextCard({ next: "Regression discontinuity", position: 5, total: 9 });
    const spoken = (spec.commands ?? []).map((c) => ("speak" in c ? c.speak : "")).join(" ");
    expect(spoken).toContain("Regression discontinuity");
  });

  it("ends by clearing, so the card fades out like the other cards", () => {
    const spec = makeNextCard({ next: "X", position: 2, total: 3 });
    expect(spec.commands?.at(-1)).toEqual({ clear: {} });
  });
});
