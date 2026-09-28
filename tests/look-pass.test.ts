import { beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("../src/llm/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/llm/client")>();
  return { ...actual, makeClient: vi.fn(() => ({}) as ReturnType<typeof actual.makeClient>), callForJson: vi.fn(), callForText: vi.fn() };
});

import { callForJson, callForText, type JsonCallMeta } from "../src/llm/client";
import { generateSpec, type GenerateConfig, type PromptVariant } from "../src/llm/compile";
import { LOOK_PROMPT_SOURCE } from "../src/llm/look";

const mockJson = vi.mocked(callForJson);
const mockText = vi.mocked(callForText);
const META: JsonCallMeta = { ms: 1, structuredOutput: false };
const respond = (json: unknown) => ({ json, raw: JSON.stringify(json), meta: META });
const VARIANT: PromptVariant = { name: "t", source: "SCHEMA:{{SCHEMA}}\nCATALOG:{{CATALOG}}\nFEWSHOTS:{{FEWSHOTS}}\nEXEMPLARS:{{EXEMPLARS}}" };
const SPEC = {
  title: "t",
  elements: [{ id: "a", type: "shape", shape: "rect", x: 300, y: 300, width: 120, height: 80 }],
  commands: [{ draw: ["a"], speak: "A box." }],
};
const IMG = [{ mediaType: "image/jpeg" as const, data: "AAAA" }];

function cfg(over: Partial<GenerateConfig> = {}): GenerateConfig {
  return { apiKey: "k", model: "claude-opus-5-5", variant: VARIANT, exemplars: [], executeCode: false, look: async () => IMG, ...over };
}

beforeEach(() => {
  mockJson.mockReset();
  mockText.mockReset();
});

describe("the look pass", () => {
  test("offers the first version, applies the critic's fix as edits, stops when the critic finds nothing", async () => {
    mockJson.mockResolvedValueOnce(respond(SPEC)).mockResolvedValueOnce(respond({ edits: [{ element: "a", set: { x: 500 } }, { element: "nope", set: { x: 1 } }] }));
    mockText.mockResolvedValueOnce({ text: "1. Beat 1, the box: too far left. Fix: centre it.\nWISH: none", ms: 1 }).mockResolvedValueOnce({ text: "NONE\nWISH: none", ms: 1 });
    const drafts: unknown[] = [];
    const out = await generateSpec("a box", cfg({ onDraft: (s) => drafts.push(structuredClone(s)) }));
    expect(drafts).toHaveLength(1);
    expect((drafts[0] as typeof SPEC).elements[0].x).toBe(300);
    expect(out.spec?.elements?.[0]).toMatchObject({ id: "a", x: 500 });
    const looks = out.rounds.filter((r) => r.label === "look");
    expect(looks.map((r) => r.adopted)).toEqual([true, false]);
    expect(looks[0].note).toMatch(/skipped edits: no element "nope"/);
    expect(looks[1].note).toBe("nothing to fix");
    // the critic sees the frames
    const critic = mockText.mock.calls[0][3][0].content as { type: string }[];
    expect(critic[0].type).toBe("image");
  });

  test("a fix that breaks the spec gets one repair on the same model, not the cheaper one", async () => {
    mockJson
      .mockResolvedValueOnce(respond(SPEC))
      .mockResolvedValueOnce(respond({ edits: [{ element: "a", set: { shape: null, type: "text" } }] })) // text with no text: invalid
      .mockResolvedValueOnce(respond({ ...SPEC, elements: [{ ...SPEC.elements[0], x: 480 }] }));
    mockText.mockResolvedValueOnce({ text: "1. Move the box.", ms: 1 }).mockResolvedValueOnce({ text: "NONE", ms: 1 });
    const out = await generateSpec("a box", cfg());
    expect(mockJson.mock.calls[2][1]).toBe("claude-opus-5-5");
    expect(out.spec?.elements?.[0]).toMatchObject({ x: 480 });
  });

  test("plan first: a plain-text plan, then the spec staged from it (developer mode's Pipeline)", async () => {
    mockText.mockResolvedValueOnce({ text: "QUESTION: why a box?\nBEATS:\n1. A box. — draw it", ms: 7 });
    mockJson.mockResolvedValueOnce(respond(SPEC));
    const out = await generateSpec("a box", cfg({ look: undefined, treatment: "v2" }));
    expect(out.treatment).toMatch(/QUESTION: why a box/);
    expect(out.treatmentMs).toBe(7);
    const staged = mockJson.mock.calls[0][3][0].content as string;
    expect(staged).toContain("## The treatment to stage");
    expect(staged).toContain("QUESTION: why a box?");
  });

  test("the look prompt asks the clutter questions, and stops at NONE", () => {
    expect(LOOK_PROMPT_SOURCE).toMatch(/Clutter — count, do not guess/);
    expect(LOOK_PROMPT_SOURCE).toMatch(/how many separate\s+pieces of text are visible at once/);
    expect(LOOK_PROMPT_SOURCE).toMatch(/What is the smallest text/);
    expect(LOOK_PROMPT_SOURCE).toMatch(/still on the page from earlier beats that no longer serves/);
    expect(LOOK_PROMPT_SOURCE).toMatch(/"Remove X"[\s\S]*is a valid fix/);
    expect(LOOK_PROMPT_SOURCE).toMatch(/Does the main figure fill the\s+page/);
    expect(LOOK_PROMPT_SOURCE).toMatch(/answer exactly `NONE`/);
  });

  test("no look callback, no look rounds and no draft", async () => {
    mockJson.mockResolvedValueOnce(respond(SPEC));
    const drafts: unknown[] = [];
    const out = await generateSpec("a box", cfg({ look: undefined, onDraft: (s) => drafts.push(s) }));
    expect(out.rounds.some((r) => r.label === "look")).toBe(false);
    expect(drafts).toHaveLength(0);
  });
});
