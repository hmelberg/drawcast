// Storyboard v2 (2026-09-28): the lecture/multi-part storyboard carrying the
// storyline rules, behind Settings.storyboardVersion — v1 stays the default
// and stays byte-for-byte what it was.

import { beforeAll, describe, expect, test, vi } from "vitest";
import { createHash } from "node:crypto";
import {
  asStoryboardVersion,
  buildStoryboardMessages,
  buildStoryboardMessagesV2,
  DEFAULT_STORYBOARD_VERSION,
  STORYBOARD_SCHEMA_V2,
  STORYBOARD_VERSIONS,
  storyboardSchemaFor,
  storyboardSchemaForVersion,
} from "../src/llm/storyboard";
import { buildPartRequest, normalizeOutline, PART_GAPS_KEY, partStagingNote, type Outline } from "../src/llm/outline";
import { TEMPLATE_GAPS_KEY, takeTemplateGaps } from "../src/llm/treatment";
import { structuredOutputSupported } from "../src/llm/client";
import { ensureEnabledPacks, PACK_DEFS } from "../src/scenes/packs";

vi.mock("../src/llm/compile", async (importOriginal) => {
  const real = await importOriginal<typeof import("../src/llm/compile")>();
  return { ...real, generateOutline: vi.fn(), generateStoryboard: vi.fn(), generateSpec: vi.fn() };
});

const sha = (s: string) => createHash("sha256").update(s).digest("hex");

describe("v1 is unchanged, byte for byte", () => {
  // Hashes taken from main before v2 existed (5c51ffc9). A change here is a
  // change to the DEFAULT prompt — make it on purpose, and re-pin.
  test("the storyboard prompt", () => {
    const pins: [string, number | null, object, string][] = [
      ["Explain compound interest", 3, {}, "e0580cfffb6fb996e4f7187e9a4c796c3a7af526016157c5ad833c34281570ad"],
      ["q", null, { brief: "Open with a question.", styleText: "Dry humour." }, "ec6c2641ec1c05566521e2927e891ba0e65d1f65652f69cdbea4c235b7c44ac1"],
      ["x", 5, {}, "9705b498212cfe73e6e25ae855adffcbdecd1b358c9bb3cef329f32b2f576058"],
      ["x", 6, { chapters: ["Setting up", "The turn"] }, "f499fff2ad68cffe58b8fc6d762ef174e31661384e69992e077e78a9a8c11d25"],
    ];
    for (const [r, p, o, hash] of pins) {
      const m = buildStoryboardMessages(r, p, o as never);
      expect(sha(m.system + "\u0000" + m.user)).toBe(hash);
    }
  });

  test("the per-part request (the staging hand-over), default and explicit v1", () => {
    const outline = normalizeOutline({
      title: "Compound interest",
      parts: [
        { title: "The rule", brief: "what compounding is", figure: "a bar", script: ["a", "b"] },
        { title: "The curve", brief: "why", figure: "curve", script: ["c"] },
        { title: "End", brief: "", script: ["d"] },
      ],
    })!;
    const pins = [
      "111c3f502ce7a0a74de40721e9e94fad459969273bb7b2a9492ab5d31974ae07",
      "d44ee384fd07c9af04d27a6de0e8b12a86e8e2fd0ee08cc4e5089c04ad8e92df",
      "ba6783c9c773bc50640ae2df36e12e257bba98cd2bf69cb9ea442ee7f6aba4c7",
    ];
    pins.forEach((hash, i) => {
      expect(sha(buildPartRequest("Explain compound interest", outline, i, "BRIEF"))).toBe(hash);
      expect(sha(buildPartRequest("Explain compound interest", outline, i, "BRIEF", "v1"))).toBe(hash);
    });
  });

  test("v1's schema is the version switch's v1 schema", () => {
    expect(storyboardSchemaForVersion(3, "v1")).toEqual(storyboardSchemaFor(3));
    expect(storyboardSchemaForVersion(null, "v1")).toBe(storyboardSchemaFor(null));
  });
});

describe("the switch", () => {
  test("v1 is the default; anything unknown reads as v1", () => {
    expect(DEFAULT_STORYBOARD_VERSION).toBe("v1");
    expect(STORYBOARD_VERSIONS.map((v) => v.id)).toEqual(["v1", "v2"]);
    expect(asStoryboardVersion("v2")).toBe("v2");
    for (const v of [undefined, null, "v3", "", 2]) expect(asStoryboardVersion(v)).toBe("v1");
  });
});

describe("the v2 storyboard prompt", () => {
  const { system, user } = buildStoryboardMessagesV2("How do vaccines protect a population?", 3, {
    brief: "#quiz brief",
    styleText: "Dry.",
    templateLines: "- sir_compartments: An epidemic model.\n  Viewer can: scrub R0 or the share vaccinated.",
    index: "- supply_demand: Curves.",
  });

  test("keeps v1's arc rules", () => {
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

  test("the output shape is v1's plus an optional template", () => {
    expect(system).toContain('"template":"<template id, or leave the field out for freehand>"');
    expect(system).toContain('"figure":');
    expect(system).toContain('"script":["<line 1>","<line 2>"]');
    expect(structuredOutputSupported(STORYBOARD_SCHEMA_V2)).toBe(true);
    expect(STORYBOARD_SCHEMA_V2.properties.parts.items.required).toEqual(["title", "brief", "figure", "script"]);
    expect(STORYBOARD_SCHEMA_V2.properties.parts.items.properties.template.type).toBe("string");
    expect((storyboardSchemaForVersion(3, "v2") as { properties: { parts: { minItems: number } } }).properties.parts.minItems).toBe(3);
  });

  test("brief in the user turn, the author's style last, chapters as v1", () => {
    expect(user).toBe("How do vaccines protect a population?\n\n#quiz brief");
    expect(system.endsWith("Dry.")).toBe(true);
    expect(buildStoryboardMessagesV2("x", 6, { chapters: ["A", "B"] }).system).toContain("1. A; 2. B");
    expect(buildStoryboardMessagesV2("x", 5).system).toContain("chapter: OPTIONAL");
    expect(buildStoryboardMessagesV2("x", 3).system).not.toContain("chapter:");
  });

  test("with nothing shortlisted it says so, and no index when none is given", () => {
    const s = buildStoryboardMessagesV2("x", 2).system;
    expect(s).toContain("None fits this request closely");
    expect(s).not.toContain("## The rest of the library");
  });
});

describe("the v2 storyboard's real template blocks", () => {
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

describe("v2 staging of a part", () => {
  const plan: Outline = {
    title: "Herd immunity",
    parts: [
      { title: "One case", brief: "the question", figure: "a contact tree; scratch card: 1 × 3 — temporary, gone after line 4", script: ["How can my shot protect you?", "Say each case infects three."], template: "sir_compartments" },
      { title: "The threshold", brief: "1 − 1/R0", figure: "the same tree, branches blocked", script: ["Now that we have seen the tree, block two branches."] },
      { title: "Plain", brief: "no script" },
    ],
  };

  test("a scripted part gets the storyline staging note after the brief, not scriptBlock or the opening directives", () => {
    const r = buildPartRequest("Q", plan, 0, "BRIEF", "v2");
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

  test("a part with no planned template still may report a gap; no script → v1's request", () => {
    expect(partStagingNote(plan.parts[1])).toContain('"template": "<id>"');
    expect(buildPartRequest("Q", plan, 2, "B", "v2")).toBe(buildPartRequest("Q", plan, 2, "B", "v1"));
  });

  test("the gap field name is the one staging's reply is read by", () => {
    expect(PART_GAPS_KEY).toBe(TEMPLATE_GAPS_KEY);
    const reply = { elements: [], commands: [], [PART_GAPS_KEY]: [{ template: "sir_compartments", missing: "no contact tree" }] };
    expect(takeTemplateGaps(reply)).toEqual([{ template: "sir_compartments", missing: "no contact tree" }]);
  });
});

describe("multi.ts passes the version through", () => {
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

  test("outlineParts: v1 exactly as before; v2 with its version and the template blocks (router picks when there is a router)", async () => {
    const compile = await import("../src/llm/compile");
    const { outlineParts } = await import("../src/llm/multi");
    vi.mocked(compile.generateStoryboard).mockReset().mockResolvedValue(plan);

    await outlineParts({ request: "q", parts: 2, brief: "B" }, { ...base, storyboardVersion: "v1" });
    expect(vi.mocked(compile.generateStoryboard).mock.calls[0][4]).toEqual({ chapters: undefined, brief: "B" });

    const route = vi.fn().mockResolvedValue({ ids: ["sir_compartments"], noneFits: false, subject: "" });
    await outlineParts({ request: "q", parts: 2, brief: "B" }, { ...base, storyboardVersion: "v2", route });
    const opts = vi.mocked(compile.generateStoryboard).mock.calls[1][4] as { version: string; templateLines: string; index?: string; brief: string };
    expect(opts.version).toBe("v2");
    expect(opts.brief).toBe("B");
    expect(opts.templateLines).toMatch(/^- sir_compartments: /);
    expect(opts.templateLines).toContain("Viewer can:");
    expect(opts.index).toBeTruthy();
    expect(route).toHaveBeenCalledWith("q", undefined);

    // "independent" never reaches the storyboard, v2 or not.
    vi.mocked(compile.generateStoryboard).mockClear();
    await outlineParts({ request: "q", parts: 2, brief: "" }, { ...base, approach: "independent", storyboardVersion: "v2", route });
    expect(compile.generateStoryboard).not.toHaveBeenCalled();
  });

  test("generateFromOutline: v2 stages by the storyline note, shortlists a real planned template, and collects gap notes", async () => {
    const compile = await import("../src/llm/compile");
    const { generateFromOutline } = await import("../src/llm/multi");
    vi.mocked(compile.generateSpec)
      .mockReset()
      .mockResolvedValueOnce({ spec: { elements: [], commands: [] } as never, rounds: [], systemPromptChars: 0, seeded: false, templateGaps: [{ template: "sir_compartments", missing: "no contact tree" }] })
      .mockResolvedValueOnce({ spec: { elements: [], commands: [] } as never, rounds: [], systemPromptChars: 0, seeded: false });
    const r = await generateFromOutline({ request: "q", parts: 2, brief: "" }, plan, { ...base, storyboardVersion: "v2" });
    const calls = vi.mocked(compile.generateSpec).mock.calls;
    expect(calls[0][0]).toContain("## The storyboard to stage");
    expect(calls[0][1].priorityIds).toEqual(["sir_compartments"]);
    // An id that is not a ready template is never shortlisted.
    expect(calls[1][1].priorityIds).toBeUndefined();
    expect(r.templateGaps).toEqual([{ part: 1, template: "sir_compartments", missing: "no contact tree" }]);
  });

  test("generateFromOutline: v1 (and no version) hands over scriptBlock and no priority template", async () => {
    const compile = await import("../src/llm/compile");
    const { generateFromOutline } = await import("../src/llm/multi");
    for (const cfg of [base, { ...base, storyboardVersion: "v1" as const }]) {
      vi.mocked(compile.generateSpec).mockReset().mockResolvedValue({ spec: { elements: [], commands: [] } as never, rounds: [], systemPromptChars: 0, seeded: false });
      const r = await generateFromOutline({ request: "q", parts: 2, brief: "" }, plan, cfg);
      const calls = vi.mocked(compile.generateSpec).mock.calls;
      expect(calls[0][0]).toContain("ALREADY WRITTEN");
      expect(calls[0][0]).not.toContain("## The storyboard to stage");
      expect(calls[0][0]).toBe(buildPartRequest("q", plan, 0, ""));
      expect(calls[0][1].priorityIds).toBeUndefined();
      expect(r.templateGaps).toBeUndefined();
    }
  });
});
