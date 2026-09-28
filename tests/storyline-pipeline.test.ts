// Story first for a single drawcast (treatment v3, 2026-09-28): the storyline
// call at medium effort, its template lines with interactions, a template the
// story names fetched before staging, gap notes taken off the staged reply,
// and no teaching pass over a staged storyline. No API: client calls mocked.
import { beforeAll, beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("../src/llm/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/llm/client")>();
  return { ...actual, makeClient: vi.fn(() => ({}) as ReturnType<typeof actual.makeClient>), callForJson: vi.fn(), callForText: vi.fn() };
});

import { callForJson, callForText, type JsonCallMeta } from "../src/llm/client";
import { generateSpec, type GenerateConfig, type PromptVariant } from "../src/llm/compile";
import { ensureEnabledPacks, PACK_DEFS } from "../src/scenes/packs";

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
const STORY = "QUESTION: why?\nNAIVE ANSWER: none\nINSIGHT: this.\nTEMPLATE: none\nFIGURE: a box\nBEATS:\n1. A box. — draw it\nQUIZ: …";

function cfg(over: Partial<GenerateConfig> = {}): GenerateConfig {
  return { apiKey: "k", model: "claude-opus-5-5", variant: VARIANT, exemplars: [], executeCode: false, treatment: "v3", effort: "high", ...over };
}
const systemText = (sys: unknown) => (Array.isArray(sys) ? (sys as { text: string }[]).map((b) => b.text).join("\n") : String(sys));

beforeAll(async () => {
  await ensureEnabledPacks(Object.keys(PACK_DEFS));
});
beforeEach(() => {
  mockJson.mockReset();
  mockText.mockReset();
});

describe("story first, then stage (single drawcast)", () => {
  test("the storyline call runs at medium effort by default; staging keeps the author's effort", async () => {
    mockText.mockResolvedValueOnce({ text: STORY, ms: 5 });
    mockJson.mockResolvedValueOnce(respond(SPEC));
    const out = await generateSpec("Why does a price rise when demand for coffee rises? supply and demand market", cfg());
    expect(mockText).toHaveBeenCalledTimes(1);
    expect(mockText.mock.calls[0][4]?.effort).toBe("medium");
    expect(mockJson.mock.calls[0][5]?.effort).toBe("high");
    expect(out.treatment).toBe(STORY);
    const staged = mockJson.mock.calls[0][3][0].content as string;
    expect(staged).toContain("## The storyline to stage");
    expect(staged).toMatch(/The LINES are sacred/);
  });

  test("treatmentEffort overrides the default", async () => {
    mockText.mockResolvedValueOnce({ text: STORY, ms: 5 });
    mockJson.mockResolvedValueOnce(respond(SPEC));
    await generateSpec("a box", cfg({ treatmentEffort: "low" }));
    expect(mockText.mock.calls[0][4]?.effort).toBe("low");
  });

  test("the storyline sees the shortlist with each template's interaction line, and the library index", async () => {
    mockText.mockResolvedValueOnce({ text: STORY, ms: 5 });
    mockJson.mockResolvedValueOnce(respond(SPEC));
    await generateSpec("Why does a price rise when demand for coffee rises? supply and demand market equilibrium", cfg());
    const sys = systemText(mockText.mock.calls[0][2]);
    expect(sys).toContain("## Templates shortlisted for this request");
    expect(sys).toMatch(/^- supply_demand: /m);
    expect(sys).toMatch(/^ {2}Viewer can: Drag a curve's middle to shift it/m);
    expect(sys).toContain("## The rest of the library");
    // The staging call sees the same shortlist in full.
    expect(systemText(mockJson.mock.calls[0][2])).toContain("### Scene template: supply_demand (READY");
  });

  test("a template the story names but the shortlist missed is fetched in full before staging", async () => {
    mockText.mockResolvedValueOnce({ text: STORY.replace("TEMPLATE: none", "TEMPLATE: decision_tree"), ms: 5 });
    mockJson.mockResolvedValueOnce(respond(SPEC));
    const out = await generateSpec("a box on a page", cfg());
    expect(systemText(mockText.mock.calls[0][2])).not.toContain("### Scene template: decision_tree (READY");
    expect(systemText(mockJson.mock.calls[0][2])).toContain("### Scene template: decision_tree (READY");
    expect(out.treatmentTemplate).toBe("decision_tree");
  });

  test("gap notes are captured on the outcome and never reach the spec", async () => {
    mockText.mockResolvedValueOnce({ text: STORY, ms: 5 });
    mockJson.mockResolvedValueOnce(respond({ ...SPEC, template_gaps: [{ template: "supply_demand", missing: "a second demand curve" }] }));
    const out = await generateSpec("a box", cfg());
    expect(out.templateGaps).toEqual([{ template: "supply_demand", missing: "a second demand curve" }]);
    expect(out.spec).not.toHaveProperty("template_gaps");
    expect(out.rounds[0].validationErrors).toEqual([]);
  });

  test("no teaching pass over a staged storyline; the one-shot call keeps it", async () => {
    mockText.mockResolvedValueOnce({ text: STORY, ms: 5 });
    mockJson.mockResolvedValueOnce(respond(SPEC));
    const staged = await generateSpec("a box", cfg({ pedagogyReview: true }));
    expect(mockJson).toHaveBeenCalledTimes(1);
    expect(staged.rounds.some((r) => r.label === "pedagogy")).toBe(false);

    mockJson.mockReset();
    mockText.mockReset();
    mockJson.mockResolvedValueOnce(respond(SPEC)).mockResolvedValueOnce(respond({ unchanged: true }));
    const oneShot = await generateSpec("a box", cfg({ treatment: undefined, pedagogyReview: true }));
    expect(mockText).not.toHaveBeenCalled();
    expect(oneShot.rounds.some((r) => r.label === "pedagogy")).toBe(true);
  });

  test("a failed storyline call degrades to the one-shot call, and says so", async () => {
    mockText.mockRejectedValueOnce(new Error("overloaded"));
    mockJson.mockResolvedValueOnce(respond(SPEC));
    const out = await generateSpec("a box", cfg());
    expect(out.spec).toBeTruthy();
    expect(out.treatment).toBeUndefined();
    expect(out.treatmentError).toMatch(/overloaded/);
    expect(mockJson.mock.calls[0][3][0].content as string).not.toContain("## The storyline to stage");
  });
});
