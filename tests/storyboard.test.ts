// The storyboard approach (docs/2026-09-19-storyboard-approach.md): one
// call writes the series' narration and each part's figure; every part is
// then drawn to its script. Builders and the hand-over are pure.

import { describe, expect, test, vi } from "vitest";
import { buildStoryboardMessages, STORYBOARD_SCHEMA, APPROACHES, DEFAULT_APPROACH } from "../src/llm/storyboard";
import { buildPartRequest, normalizeOutline, scriptBlock, type Outline } from "../src/llm/outline";
import { structuredOutputSupported } from "../src/llm/client";

const raw = {
  title: "Compound interest",
  parts: [
    { title: "The rule", brief: "what compounding is", figure: "a bar that grows each year", script: ["Money left alone grows on itself.", " Year one adds a slice. "] },
    { title: "The curve", brief: "why it bends", figure: "the same bars traced as a curve", script: ["Now that we have seen the slices, watch the curve.", "It bends."] },
  ],
};

describe("the storyboard reply", () => {
  test("its schema is the outline's shape plus figure and script, closed for structured output", () => {
    expect(structuredOutputSupported(STORYBOARD_SCHEMA)).toBe(true);
    expect(STORYBOARD_SCHEMA.properties.parts.items.required).toEqual(["title", "brief", "figure", "script"]);
  });

  test("normalizes into an outline whose parts carry a trimmed script and figure", () => {
    const outline = normalizeOutline(raw)!;
    expect(outline.parts[0].figure).toBe("a bar that grows each year");
    expect(outline.parts[0].script).toEqual(["Money left alone grows on itself.", "Year one adds a slice."]);
  });

  test("an empty or missing script is no script — the part is then written on its own", () => {
    const outline = normalizeOutline({ title: "t", parts: [{ title: "a", brief: "", script: [] }, { title: "b", brief: "", script: ["", "  "] }, { title: "c", brief: "" }] })!;
    expect(outline.parts.map((p) => p.script)).toEqual([undefined, undefined, undefined]);
  });
});

describe("the storyboard prompt", () => {
  test("asks for the count, the figure paragraph and the lines, and names the shape", () => {
    const { system, user } = buildStoryboardMessages("Explain compound interest", 3);
    expect(system).toContain("exactly 3 parts");
    expect(system).toContain("figure: what is drawn");
    expect(system).toContain("script: the spoken lines in order, 8–14 per part");
    expect(system).toContain('"script":["<line 1>","<line 2>"]');
    expect(user).toBe("Explain compound interest");
  });

  test("carries the tag brief in the user turn and the author's style last", () => {
    const { system, user } = buildStoryboardMessages("Explain compound interest", null, { brief: "Open with a question.", styleText: "Dry humour." });
    expect(user).toBe("Explain compound interest\n\nOpen with a question.");
    expect(system.endsWith("Dry humour.")).toBe(true);
    expect(system).toContain("2–4 parts");
  });

  test("declared chapters are listed and appear in the shape", () => {
    const { system } = buildStoryboardMessages("q", 4, { chapters: ["Setup", "Payoff"] });
    expect(system).toContain("1. Setup; 2. Payoff");
    expect(system).toContain('"chapter":"<one of the declared chapters>"');
  });
});

describe("drawing a part to its script", () => {
  const outline: Outline = normalizeOutline(raw)!;

  test("the part request hands over the figure and the numbered lines, after the brief", () => {
    const req = buildPartRequest("Explain compound interest", outline, 1, "#why brief");
    expect(req).toContain('The previous part was "The rule"');
    expect(req.indexOf("#why brief")).toBeLessThan(req.indexOf("The figure for this part: the same bars traced as a curve"));
    expect(req).toContain("1. Now that we have seen the slices, watch the curve.\n2. It bends.");
    expect(req).toContain("ALREADY WRITTEN");
  });

  test("a part without a script gets the old request, word for word", () => {
    const plain: Outline = { title: "t", parts: [{ title: "a", brief: "b" }, { title: "c", brief: "d" }] };
    expect(buildPartRequest("q", plain, 0, "")).not.toContain("narration");
    expect(scriptBlock(plain.parts[0])).not.toContain("The figure");
  });
});

describe("the approach picker's data", () => {
  test("storyboard is the default and both approaches are offered", () => {
    expect(DEFAULT_APPROACH).toBe("storyboard");
    expect(APPROACHES.map((a) => a.id)).toEqual(["storyboard", "independent"]);
  });
});

describe("outlineParts chooses by approach", () => {
  vi.mock("../src/llm/compile", async (importOriginal) => {
    const real = await importOriginal<typeof import("../src/llm/compile")>();
    return { ...real, generateOutline: vi.fn(), generateStoryboard: vi.fn(), generateSpec: vi.fn() };
  });

  test("storyboard by default, with the brief and the author's effort and style; outline when independent", async () => {
    const compile = await import("../src/llm/compile");
    const { outlineParts, generateFromOutline } = await import("../src/llm/multi");
    const plan: Outline = { title: "t", parts: [{ title: "a", brief: "", script: ["one"] }, { title: "b", brief: "" }] };
    vi.mocked(compile.generateStoryboard).mockResolvedValue(plan);
    vi.mocked(compile.generateOutline).mockResolvedValue(plan);
    const base = { apiKey: "k", model: "claude-opus-5", effort: "medium" as const, styleText: "Dry.", variant: { name: "v1", source: "" }, exemplars: [] };

    await outlineParts({ request: "q", parts: 2, brief: "B", chapters: ["c"] }, base);
    expect(compile.generateStoryboard).toHaveBeenCalledWith("q", { apiKey: "k", model: "claude-opus-5", effort: "medium", styleText: "Dry." }, 2, undefined, { chapters: ["c"], brief: "B" });
    expect(compile.generateOutline).not.toHaveBeenCalled();

    await outlineParts({ request: "q", parts: 2, brief: "B" }, { ...base, approach: "independent" });
    expect(compile.generateOutline).toHaveBeenCalledTimes(1);

    // A part with a script skips the teaching pass; one without keeps it.
    vi.mocked(compile.generateSpec).mockResolvedValue({ spec: { title: "s", elements: [], commands: [] } as never, rounds: [], systemPromptChars: 0, seeded: false });
    await generateFromOutline({ request: "q", parts: 2, brief: "" }, plan, { ...base, pedagogyReview: true });
    const cfgs = vi.mocked(compile.generateSpec).mock.calls.map((c) => c[1].pedagogyReview);
    expect(cfgs).toEqual([false, true]);
  });
});

describe("chapters in the storyboard plan (the default approach)", () => {
  test("a long series is offered the field, a short one is not", () => {
    expect(buildStoryboardMessages("x", 5).system).toContain("chapter: OPTIONAL");
    expect(buildStoryboardMessages("x", 5).system).toContain("or omit the field");
    expect(buildStoryboardMessages("x", 3).system).not.toContain("chapter");
    expect(buildStoryboardMessages("x", null).system).not.toContain("chapter");
  });

  test("a declared list still wins", () => {
    const { system } = buildStoryboardMessages("x", 6, { chapters: ["Setting up", "The turn"] });
    expect(system).toContain("never invent a chapter that is not on this list");
    expect(system).not.toContain("chapter: OPTIONAL");
  });

  test("the script and figure fields are still in the shape either way", () => {
    for (const parts of [3, 5]) {
      expect(buildStoryboardMessages("x", parts).system).toContain('"script"');
      expect(buildStoryboardMessages("x", parts).system).toContain('"figure"');
    }
  });
});
