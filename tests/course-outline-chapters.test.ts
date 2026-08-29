import { describe, expect, it } from "vitest";
import { buildOutlineMessages, normalizeOutline } from "../src/llm/outline";

describe("chapters in the outline call", () => {
  it("names the chapters in the system message when given", () => {
    const { system } = buildOutlineMessages("DiD", 4, ["Parallel trends", "When it breaks"]);
    expect(system).toContain("Parallel trends");
    expect(system).toContain("When it breaks");
  });

  it("says nothing about chapters when none are given", () => {
    expect(buildOutlineMessages("DiD", 4).system).not.toContain("chapter");
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
