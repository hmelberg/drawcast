import { describe, expect, test } from "vitest";
import { buildOutlineMessages, buildPartRequest, normalizeOutline, type Outline } from "../src/llm/outline";

describe("buildOutlineMessages", () => {
  test("the user message carries the request", () => {
    const { user } = buildOutlineMessages("The economics of vaccination", null);
    expect(user).toContain("The economics of vaccination");
  });

  test("an explicit part count is demanded, otherwise 2–4", () => {
    expect(buildOutlineMessages("x", 3).system).toContain("exactly 3");
    expect(buildOutlineMessages("x", null).system).toMatch(/2[–-]4/);
  });

  test("the JSON shape is spelled out in the prompt itself (plain-JSON fallback must work too)", () => {
    const { system } = buildOutlineMessages("x", null);
    expect(system).toContain('"parts"');
    expect(system).toContain('"brief"');
  });
});

describe("normalizeOutline", () => {
  test("a well-formed outline passes through", () => {
    const o = normalizeOutline({ title: "T", parts: [{ title: "A", brief: "a" }, { title: "B", brief: "b" }] });
    expect(o?.title).toBe("T");
    expect(o?.parts).toHaveLength(2);
  });

  test("fewer than two parts is rejected", () => {
    expect(normalizeOutline({ title: "T", parts: [{ title: "A", brief: "a" }] })).toBeNull();
    expect(normalizeOutline({ title: "T" })).toBeNull();
    expect(normalizeOutline("garbage")).toBeNull();
  });

  test("a missing series title is tolerated (empty — the caller falls back to the request)", () => {
    const o = normalizeOutline({ parts: [{ title: "A", brief: "a" }, { title: "B", brief: "b" }] });
    expect(o?.parts).toHaveLength(2);
    expect(o?.title).toBe("");
  });

  test("a part with a missing brief survives with an empty brief", () => {
    const o = normalizeOutline({ title: "T", parts: [{ title: "A" }, { title: "B", brief: "b" }] });
    expect(o?.parts).toHaveLength(2);
    expect(o?.parts[0]).toEqual({ title: "A", brief: "" });
  });

  test("an overlong outline is trimmed to six parts", () => {
    const parts = Array.from({ length: 9 }, (_, i) => ({ title: `P${i}`, brief: "b" }));
    expect(normalizeOutline({ title: "T", parts })?.parts).toHaveLength(6);
  });

  test("part levels survive when valid and drop when not", () => {
    const o = normalizeOutline({
      title: "T",
      parts: [
        { title: "A", brief: "a", level: "basic" },
        { title: "B", brief: "b", level: "expert" },
      ],
    });
    expect(o?.parts[0].level).toBe("basic");
    expect(o?.parts[1].level).toBeUndefined();
  });
});

describe("buildPartRequest", () => {
  const outline: Outline = {
    title: "Vaccination economics",
    parts: [
      { title: "Externalities", brief: "why one shot protects many" },
      { title: "Herd immunity thresholds", brief: "the math of coverage" },
    ],
  };

  test("names the part, its position, and the series", () => {
    const r = buildPartRequest("Explain vaccination economics", outline, 1, "");
    expect(r).toContain("Herd immunity thresholds");
    expect(r).toContain("part 2 of 2");
    expect(r).toContain("Vaccination economics");
  });

  test("later parts bridge from the previous part; the first announces what the series will explain", () => {
    const first = buildPartRequest("x", outline, 0, "");
    const second = buildPartRequest("x", outline, 1, "");
    expect(first.toLowerCase()).toContain("series will explain");
    expect(first.toLowerCase()).toContain("concrete example");
    expect(second).toContain("Externalities");
    expect(second.toLowerCase()).toContain("bridg");
  });

  test("a directing brief is appended when present", () => {
    const r = buildPartRequest("x", outline, 0, "Directing brief:\n- Audience: beginners.");
    expect(r).toContain("Audience: beginners.");
  });
});

// Chapters used to reach a playlist only from a course, where the author
// declares them — so an ordinary #parts=6 lecture ran without any, and the
// feature was exercised by nobody (which is how the script printer came to
// drop chapters silently for months). From four parts up the planner is now
// OFFERED the field, and below that it is not told chapters exist.
describe("chapters a long series may propose", () => {
  test("the field is offered from four parts up, in the instruction and in the shape", () => {
    for (const n of [4, 5, 6]) {
      const { system } = buildOutlineMessages("x", n);
      expect(system, `${n} parts`).toContain("chapter: OPTIONAL");
      expect(system, `${n} parts`).toContain("or omit the field");
    }
  });

  test("a short series is never told chapters exist", () => {
    for (const parts of [null, 2, 3]) {
      const { system } = buildOutlineMessages("x", parts);
      expect(system, `${parts} parts`).not.toContain("chapter");
    }
  });

  test("a declared list still wins: assign, never invent", () => {
    const { system } = buildOutlineMessages("x", 6, ["Setting up", "The turn"]);
    expect(system).toContain("never invent a chapter that is not on this list");
    expect(system).not.toContain("chapter: OPTIONAL");
  });

  test("proposed chapters come through when they actually group", () => {
    const o = normalizeOutline({
      title: "T",
      parts: [
        { title: "A", brief: "a", chapter: "Setting up" },
        { title: "B", brief: "b", chapter: "Setting up" },
        { title: "C", brief: "c", chapter: "The turn" },
        { title: "D", brief: "d", chapter: "The turn" },
      ],
    });
    expect(o!.parts.map((p) => p.chapter)).toEqual(["Setting up", "Setting up", "The turn", "The turn"]);
  });

  test("one chapter per part is not a grouping, and neither is one over everything", () => {
    const perPart = normalizeOutline({ title: "T", parts: [1, 2, 3, 4].map((i) => ({ title: `P${i}`, brief: "b", chapter: `C${i}` })) });
    expect(perPart!.parts.every((p) => p.chapter === undefined)).toBe(true);
    const oneForAll = normalizeOutline({ title: "T", parts: [1, 2, 3, 4].map((i) => ({ title: `P${i}`, brief: "b", chapter: "All of it" })) });
    expect(oneForAll!.parts.every((p) => p.chapter === undefined)).toBe(true);
    // A partial naming is not degenerate: the unnamed parts read as a preface
    // and the crossing into the first chapter is a real one.
    const halfNamed = normalizeOutline({ title: "T", parts: [{ title: "A", brief: "a" }, { title: "B", brief: "b", chapter: "The turn" }, { title: "C", brief: "c", chapter: "The turn" }, { title: "D", brief: "d", chapter: "The turn" }] });
    expect(halfNamed!.parts.map((p) => p.chapter)).toEqual([undefined, "The turn", "The turn", "The turn"]);
  });

  test("a declared list is the author's business, however they use it", () => {
    const o = normalizeOutline(
      { title: "T", parts: [{ title: "A", brief: "a", chapter: "Only one" }, { title: "B", brief: "b", chapter: "Only one" }] },
      ["Only one"],
    );
    expect(o!.parts.map((p) => p.chapter)).toEqual(["Only one", "Only one"]);
  });
});
