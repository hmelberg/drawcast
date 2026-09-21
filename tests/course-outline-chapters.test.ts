import { describe, expect, it } from "vitest";
import { buildOutlineMessages, normalizeOutline } from "../src/llm/outline";

describe("chapters in the outline call", () => {
  it("names the chapters in the system message when given", () => {
    const { system } = buildOutlineMessages("DiD", 4, ["Parallel trends", "When it breaks"]);
    expect(system).toContain("Parallel trends");
    expect(system).toContain("When it breaks");
  });

  // Superseded 2026-09-21: with no declared list, a series of four parts or
  // more is now OFFERED chapters to propose (outline.ts CHAPTERS_FROM_PARTS);
  // a shorter one is still never told they exist.
  it("says nothing about chapters for a series too short to need them", () => {
    expect(buildOutlineMessages("DiD", 3).system).not.toContain("chapter");
    expect(buildOutlineMessages("DiD", 4).system).toContain("chapter: OPTIONAL");
  });

  it("keeps a part's chapter through normalize", () => {
    const outline = normalizeOutline({
      title: "T",
      parts: [
        { title: "A", brief: "b", chapter: "Parallel trends" },
        { title: "B", brief: "b" },
      ],
    });
    expect(outline?.parts[0].chapter).toBe("Parallel trends");
    expect(outline?.parts[1].chapter).toBeUndefined();
  });

  it("drops a chapter that was not declared", () => {
    const outline = normalizeOutline(
      { title: "T", parts: [{ title: "A", brief: "b", chapter: "Invented" }, { title: "B", brief: "b" }] },
      ["Parallel trends"],
    );
    expect(outline?.parts[0].chapter).toBeUndefined();
  });
});
