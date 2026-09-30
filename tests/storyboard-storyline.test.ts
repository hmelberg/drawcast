// The lecture/multi-part storyboard carrying the storyline rules (the
// default since the blind comparison, 2026-09-28; the only one since the
// earlier prompt was retired, 2026-09-30).

import { beforeAll, describe, expect, test, vi } from "vitest";
import { buildStoryboardMessages, STORYBOARD_SCHEMA, storyboardSchemaFor } from "../src/llm/storyboard";
import { buildPartRequest, normalizeOutline, PART_GAPS_KEY, partStagingNote, type Outline } from "../src/llm/outline";
import { TEMPLATE_GAPS_KEY, takeTemplateGaps } from "../src/llm/treatment";
import { structuredOutputSupported } from "../src/llm/client";
import { ensureEnabledPacks, PACK_DEFS } from "../src/scenes/packs";

vi.mock("../src/llm/compile", async (importOriginal) => {
  const real = await importOriginal<typeof import("../src/llm/compile")>();
  return { ...real, generateOutline: vi.fn(), generateStoryboard: vi.fn(), generateSpec: vi.fn() };
});

describe("the storyboard prompt", () => {
  const { system, user } = buildStoryboardMessages("How do vaccines protect a population?", 3, {
    brief: "#quiz brief",
    styleText: "Dry.",
    templateLines: "- sir_compartments: An epidemic model.\n  Viewer can: scrub R0 or the share vaccinated.",
    index: "- supply_demand: Curves.",
  });

  test("the arc rules", () => {
    expect(system).toContain("exactly 3 parts");
    expect(system).toContain("Situate before you explain, ONCE, in part 1");
    expect(system).toContain('bridging from the previous one in one sentence ("Now that we have seen …")');
    expect(system).toContain("One genuinely interesting thing in the whole series");
    expect(system).toContain("ends with a synthesis");
    expect(system).toContain("A rhetorical question is a line of its own");
    expect(system).toContain("Explain in passing, never by announcement");
    expect(system).toContain("Write the lines in the language of the request.");
  });

  test("adds the storyline rules, per part", () => {
    expect(system).toContain("part 1's FIRST line states the question the whole series answers");
    expect(system).toContain("Hook with the naive answer");
    expect(system).toContain("Each part converges on ONE insight");
    expect(system).toContain("said to be illustrative");
    expect(system).toContain("Change one thing at a time");
    expect(system).toContain("GHOST");
    expect(system).toContain("Key numbers on the canvas too");
    expect(system).toContain("Every line draws, moves or changes something. Prefer transforming");
    expect(system).toContain("Figure budget, per part: ONE main figure");
    expect(system).toContain("marked temporary with when it goes");
    expect(system).toContain("Focus sparingly");
    expect(system).toContain("An honest caveat");
    expect(system).toContain("Never bend the story to fit a template");
    expect(system).toContain("explore beat");
    expect(system).toContain("TRANSFER question");
    expect(system).toContain("wrong hint");
    expect(system).toContain("The LAST part closes with one");
    // Quizzes stay the brief's call (#quiz), as in lectures today.
    expect(system).toContain("Quizzes: only when the brief asks for them");
  });

  test("carries the shortlist with its interactions and the index", () => {
    expect(system).toContain("## Templates shortlisted for this request");
    expect(system).toContain("Viewer can: scrub R0 or the share vaccinated.");
    expect(system).toContain("## The rest of the library (one line each)");
    expect(system).toContain("- supply_demand: Curves.");
  });

  test("the output shape: title, brief, figure, script, and an optional template", () => {
    expect(system).toContain('"template":"<template id, or leave the field out for freehand>"');
    expect(system).toContain('"figure":');
    expect(system).toContain('"script":["<line 1>","<line 2>"]');
    expect(structuredOutputSupported(STORYBOARD_SCHEMA)).toBe(true);
    expect(STORYBOARD_SCHEMA.properties.parts.items.required).toEqual(["title", "brief", "figure", "script"]);
    expect(STORYBOARD_SCHEMA.properties.parts.items.properties.template.type).toBe("string");
    expect((storyboardSchemaFor(3) as { properties: { parts: { minItems: number } } }).properties.parts.minItems).toBe(3);
  });

  test("brief in the user turn, the author's style last, chapters", () => {
    expect(user).toBe("How do vaccines protect a population?\n\n#quiz brief");
    expect(system.endsWith("Dry.")).toBe(true);
    expect(buildStoryboardMessages("x", 6, { chapters: ["A", "B"] }).system).toContain("1. A; 2. B");
    expect(buildStoryboardMessages("x", 5).system).toContain("chapter: OPTIONAL");
    expect(buildStoryboardMessages("x", 3).system).not.toContain("chapter:");
  });

  test("with nothing shortlisted it says so, and no index when none is given", () => {
    const s = buildStoryboardMessages("x", 2).system;
    expect(s).toContain("None fits this request closely");
    expect(s).not.toContain("## The rest of the library");
  });
});

describe("the storyboard's real template blocks", () => {
  beforeAll(async () => {
    await ensureEnabledPacks(Object.keys(PACK_DEFS));
  });

  test("storyboardTemplates gives story lines with 'Viewer can' and the index", async () => {
    const { storyboardTemplates } = await import("../src/llm/multi");
    const t = storyboardTemplates("How do vaccines protect a population? herd immunity epidemic SIR", { ids: ["sir_compartments", "nope"] });
    expect(t.templateLines).toMatch(/^- sir_compartments: /m);
    expect(t.templateLines).toMatch(/^ {2}Viewer can: .*share vaccinated/m);
    expect(t.index).toBeTruthy();
    expect(t.index).toContain("- supply_demand:");
    // Without router ids: the keyword shortlist.
    expect(storyboardTemplates("supply and demand curves price").templateLines).toContain("supply_demand");
  });
});

describe("the plan's template field", () => {
  test("normalizeOutline keeps a template id and drops junk", () => {
    const o = normalizeOutline({
      title: "t",
      parts: [
        { title: "a", brief: "", template: " sir_compartments ", script: ["x"] },
        { title: "b", brief: "", template: "none" },
        { title: "c", brief: "", template: "Not An Id" },
        { title: "d", brief: "" },
      ],
    })!;
    expect(o.parts.map((p) => p.template)).toEqual(["sir_compartments", undefined, undefined, undefined]);
  });
});

describe("staging a part", () => {
  const plan: Outline = {
    title: "Herd immunity",
    parts: [
      { title: "One case", brief: "the question", figure: "a contact tree; scratch card: 1 × 3 — temporary, gone after line 4", script: ["How can my shot protect you?", "Say each case infects three."], template: "sir_compartments" },
      { title: "The threshold", brief: "1 − 1/R0", figure: "the same tree, branches blocked", script: ["Now that we have seen the tree, block two branches."] },
      { title: "Plain", brief: "no script" },
    ],
  };

  test("a scripted part gets the storyline staging note after the brief, not scriptBlock or the opening directives", () => {
    const r = buildPartRequest("Q", plan, 0, "BRIEF");
    expect(r).toContain("## The storyboard to stage");
    expect(r).toContain("The LINES are sacred");
    expect(r).toContain("The INK is not");
    expect(r).toContain("figure budget");
    expect(r).toContain("Honour every `temporary` mark: erase or fade");
    expect(r).toContain("template `sir_compartments`");
    expect(r).toContain(`"${TEMPLATE_GAPS_KEY}"`);
    expect(r).toContain("FIGURE: a contact tree");
    expect(r).toContain("LINES:\n1. How can my shot protect you?\n2. Say each case infects three.");
    expect(r.indexOf("BRIEF")).toBeLessThan(r.indexOf("## The storyboard to stage"));
    expect(r).not.toContain("ALREADY WRITTEN");
    expect(r).not.toContain("Open by saying in one sentence");
    expect(r).toContain('part 1 of 3 in the series "Herd immunity"');
  });

  test("a part with no planned template still may report a gap; no script → the opening, bridge and synthesis directives", () => {
    expect(partStagingNote(plan.parts[1])).toContain('"template": "<id>"');
    const plain = buildPartRequest("Q", plan, 2, "B");
    expect(plain).not.toContain("## The storyboard to stage");
    expect(plain).toContain('The previous part was "The threshold"');
    expect(plain).toContain("End with a synthesis");
    expect(plain.endsWith("\n\nB")).toBe(true);
  });

  test("the gap field name is the one staging's reply is read by", () => {
    expect(PART_GAPS_KEY).toBe(TEMPLATE_GAPS_KEY);
    const reply = { elements: [], commands: [], [PART_GAPS_KEY]: [{ template: "sir_compartments", missing: "no contact tree" }] };
    expect(takeTemplateGaps(reply)).toEqual([{ template: "sir_compartments", missing: "no contact tree" }]);
  });
});

describe("multi.ts: the storyboard's templates and staging", () => {
  beforeAll(async () => {
    await ensureEnabledPacks(Object.keys(PACK_DEFS));
  });
  const base = { apiKey: "k", model: "claude-opus-5-5", effort: "medium" as const, styleText: "Dry.", variant: { name: "v1", source: "" }, exemplars: [] };
  const plan: Outline = {
    title: "t",
    parts: [
      { title: "a", brief: "", script: ["one"], template: "sir_compartments" },
      { title: "b", brief: "", script: ["two"], template: "no_such_template" },
    ],
  };

  test("outlineParts: the storyboard gets the template blocks (router picks when there is a router)", async () => {
    const compile = await import("../src/llm/compile");
    const { outlineParts } = await import("../src/llm/multi");
    vi.mocked(compile.generateStoryboard).mockReset().mockResolvedValue(plan);

    const route = vi.fn().mockResolvedValue({ ids: ["sir_compartments"], noneFits: false, subject: "" });
    await outlineParts({ request: "q", parts: 2, brief: "B" }, { ...base, route });
    const opts = vi.mocked(compile.generateStoryboard).mock.calls[0][4] as { templateLines: string; index?: string; brief: string };
    expect(opts.brief).toBe("B");
    expect(opts.templateLines).toMatch(/^- sir_compartments: /);
    expect(opts.templateLines).toContain("Viewer can:");
    expect(opts.index).toBeTruthy();
    expect(route).toHaveBeenCalledWith("q", undefined);

    // "independent" never reaches the storyboard.
    vi.mocked(compile.generateStoryboard).mockClear();
    await outlineParts({ request: "q", parts: 2, brief: "" }, { ...base, approach: "independent", route });
    expect(compile.generateStoryboard).not.toHaveBeenCalled();
  });

  test("generateFromOutline: stages by the storyline note, shortlists a real planned template, and collects gap notes", async () => {
    const compile = await import("../src/llm/compile");
    const { generateFromOutline } = await import("../src/llm/multi");
    vi.mocked(compile.generateSpec)
      .mockReset()
      .mockResolvedValueOnce({ spec: { elements: [], commands: [] } as never, rounds: [], systemPromptChars: 0, seeded: false, templateGaps: [{ template: "sir_compartments", missing: "no contact tree" }] })
      .mockResolvedValueOnce({ spec: { elements: [], commands: [] } as never, rounds: [], systemPromptChars: 0, seeded: false });
    const r = await generateFromOutline({ request: "q", parts: 2, brief: "" }, plan, base);
    const calls = vi.mocked(compile.generateSpec).mock.calls;
    expect(calls[0][0]).toContain("## The storyboard to stage");
    expect(calls[0][1].priorityIds).toEqual(["sir_compartments"]);
    // An id that is not a ready template is never shortlisted.
    expect(calls[1][1].priorityIds).toBeUndefined();
    expect(r.templateGaps).toEqual([{ part: 1, template: "sir_compartments", missing: "no contact tree" }]);
  });

});
