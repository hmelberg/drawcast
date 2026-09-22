import { describe, expect, test } from "vitest";
import { planningModelFor } from "../src/llm/client";
import { buildOutlineMessages, buildPartRequest, normalizeOutline, type Outline } from "../src/llm/outline";

describe("buildOutlineMessages", () => {
  test("the user message carries the request", () => {
    const { user } = buildOutlineMessages("The economics of vaccination", null);
    expect(user).toContain("The economics of vaccination");
  });

  test("an explicit part count is demanded, otherwise 1–4", () => {
    expect(buildOutlineMessages("x", 3).system).toContain("exactly 3");
    // Bare #parts may answer ONE (Hans 2026-09-22): some questions are a
    // single figure, and a planner forced to split one pads it.
    expect(buildOutlineMessages("x", null).system).toMatch(/1[–-]4/);
    expect(buildOutlineMessages("x", null).system).toContain("ONE is a real answer");
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

  test("one part is a legitimate answer; nothing readable is not", () => {
    // Changed 2026-09-22: a bare #parts may come back as a single part.
    expect(normalizeOutline({ title: "T", parts: [{ title: "A", brief: "a" }] })?.parts).toHaveLength(1);
    expect(normalizeOutline({ title: "T", parts: [] })).toBeNull();
    expect(normalizeOutline({ title: "T" })).toBeNull();
    expect(normalizeOutline("garbage")).toBeNull();
  });

  // The defect this exists for, measured 2026-09-22: a request tagged
  // #parts=3 came back with FIVE parts, two of them near-duplicate
  // syntheses. The prompt said "exactly 3" and nothing checked the reply.
  test("an explicit #parts=N is enforced, not merely requested", () => {
    const five = { title: "T", parts: [1, 2, 3, 4, 5].map((n) => ({ title: `P${n}`, brief: `b${n}` })) };
    expect(normalizeOutline(five, undefined, 3)?.parts.map((p) => p.title)).toEqual(["P1", "P2", "P3"]);
    // Clipped to the FIRST N, never first-N-minus-one plus the planner's
    // last: a synthesis written to follow five parts names what those five
    // showed, so grafting it after part two promises a payoff never seen.
    expect(normalizeOutline(five, undefined, 1)?.parts.map((p) => p.title)).toEqual(["P1"]);
    // Fewer than asked is accepted — parts cannot be invented.
    const two = { title: "T", parts: [{ title: "A", brief: "a" }, { title: "B", brief: "b" }] };
    expect(normalizeOutline(two, undefined, 4)?.parts).toHaveLength(2);
    // No count asked for: the planner's judgement stands, up to the ceiling.
    expect(normalizeOutline(five, undefined, null)?.parts).toHaveLength(5);
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

// The PLANNING call — the one whose single output shapes a whole series —
// carries a model floor. Measured 2026-09-22 on one request
// ("how a tax creates a deadweight loss", #parts=3) at all three tiers:
// Haiku returned five parts with two near-duplicate syntheses and narration
// whose order did not match its own ink; Sonnet and Opus both returned three
// coherent parts. Only the plan is raised — every part is still DRAWN with
// the model the author chose, which is the setting they actually made.
describe("planningModelFor", () => {
  test("Haiku is raised to Sonnet for the plan", () => {
    expect(planningModelFor("claude-haiku-4-5")).toBe("claude-sonnet-5");
  });

  test("anything at or above Sonnet is left exactly as chosen", () => {
    expect(planningModelFor("claude-sonnet-5")).toBe("claude-sonnet-5");
    expect(planningModelFor("claude-opus-5")).toBe("claude-opus-5");
    expect(planningModelFor("claude-fable-5-1")).toBe("claude-fable-5-1");
  });
});
