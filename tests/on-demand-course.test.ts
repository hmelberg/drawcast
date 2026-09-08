// Template on demand across a run: parallel lectures share ONE cap, ONE lock
// and ONE set of authored documents, so a template authored for lecture A is
// re-routed to (not re-authored for) lecture B, and no run can author more
// than the cap.
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/llm/compile", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/llm/compile")>();
  return { ...actual, generateSpec: vi.fn() };
});
vi.mock("../src/llm/on-demand", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/llm/on-demand")>();
  return { ...actual, authorOnDemand: vi.fn() };
});

import { generateSpec, type GenerateConfig, type GenerationOutcome } from "../src/llm/compile";
import { authorOnDemand } from "../src/llm/on-demand";
import { generateFromOutline } from "../src/llm/multi";
import { createOnDemandRun, type OnDemandRun } from "../src/llm/on-demand-run";
import type { Outline } from "../src/llm/outline";
import type { TemplateDoc } from "../src/scenes/doc";
import type { Spec } from "../src/spec/types";

const mockGenerate = vi.mocked(generateSpec);
const mockAuthor = vi.mocked(authorOnDemand);
const tick = (ms: number) => new Promise((r) => setTimeout(r, ms));

const DOC: TemplateDoc = {
  template: "boat_anatomy", version: 1, kit: 1, status: "ready", description: "A boat.",
  params: {}, element_ids: {}, examples: [], layout: "return { drawables: [], labels: [], anchors: {}, order: [] };",
};

/** A freehand figure that names three parts — what makes a part a template candidate (on-demand.ts templateWorthy). */
const PARTS = ["hull", "mast", "keel"].flatMap((id) => [
  { id, type: "path", points: [[0, 0], [10, 10]] },
  { id: `label_${id}`, type: "label", text: id.toUpperCase(), attach_to: id },
]);
const freehand = (route = { ids: [] as string[], noneFits: true }): GenerationOutcome => ({
  spec: { elements: PARTS, commands: [] } as unknown as Spec,
  rounds: [],
  route: { ...route, ms: 1 },
  systemPromptChars: 0,
});
/** Freehand without named parts: a caption and an arrow — never a template candidate. */
const plain = (): GenerationOutcome => ({
  spec: { elements: [{ id: "cap", type: "text", text: "Just words", x: 1, y: 1 }], commands: [] } as unknown as Spec,
  rounds: [],
  route: { ids: [], noneFits: true, ms: 1 },
  systemPromptChars: 0,
});
const templated = (): GenerationOutcome => ({
  spec: { template: "boat_anatomy", elements: [], commands: [] } as unknown as Spec,
  rounds: [],
  route: { ids: ["boat_anatomy"], noneFits: false, ms: 1 },
  systemPromptChars: 0,
});

/** Authoring takes a moment (so two lectures can collide) and reports the document like the real pipeline. */
function authorLikeReal(): void {
  mockAuthor.mockImplementation(async () => {
    await tick(10);
    return {
      brief: { id: "boat_anatomy", description: "A boat" },
      doc: DOC,
      yaml: "template: boat_anatomy",
      authorRounds: 1,
      outcome: { ...templated(), spec: { ...templated().spec, templates: [DOC] } as Spec },
    } as unknown as Awaited<ReturnType<typeof authorOnDemand>>;
  });
}

const plan = (n: number): Outline => ({ title: "L", parts: Array.from({ length: n }, (_, i) => ({ title: `P${i + 1}`, brief: "" })) });
const req = { request: "r", parts: null, brief: "" };

function cfg(run: OnDemandRun | undefined, extra: Partial<GenerateConfig> = {}): GenerateConfig {
  return {
    apiKey: "k",
    model: "m",
    variant: { name: "t", source: "" },
    exemplars: [],
    templatesOnDemand: true,
    onDemandRun: run,
    // The router sees the live registry: once anything was authored in this
    // run it offers it; before that, nothing fits.
    route: async () => (run && run.authored > 0 ? { ids: ["boat_anatomy"], noneFits: false } : { ids: [], noneFits: true }),
    ...extra,
  };
}

beforeEach(() => {
  mockGenerate.mockReset();
  mockAuthor.mockReset();
});

describe("one template for the whole course", () => {
  it("two parallel lectures needing the same figure author ONCE; the second is re-routed and embeds the shared document", async () => {
    const run = createOnDemandRun(3);
    // The parallel pass draws freehand; a redraw after the template exists uses it.
    mockGenerate.mockImplementation(async () => (run.authored > 0 ? templated() : freehand()));
    authorLikeReal();
    const authored: string[] = [];
    const c = cfg(run, { onTemplateAuthored: (t) => authored.push(t.id) });

    const [a, b] = await Promise.all([generateFromOutline(req, plan(1), c), generateFromOutline(req, plan(1), c)]);

    expect(mockAuthor).toHaveBeenCalledTimes(1);
    expect(authored).toEqual(["boat_anatomy"]);
    expect(run.authored).toBe(1);
    expect(run.skipped).toBe(0);
    expect(a.specs[0].template).toBe("boat_anatomy");
    expect(b.specs[0].template).toBe("boat_anatomy");
    // Both parts carry the document — the re-routed one from the shared docs.
    expect(a.specs[0].templates).toEqual([DOC]);
    expect(b.specs[0].templates).toEqual([DOC]);
    // Two freehand drawings, one redraw.
    expect(mockGenerate).toHaveBeenCalledTimes(3);
  });
});

describe("the trigger is freehand with named parts, not the router's verdict", () => {
  it("a freehand part with parts is handled even though the router OFFERED a template the compiler declined", async () => {
    const run = createOnDemandRun(3);
    mockGenerate.mockImplementation(async () => freehand({ ids: ["violin_anatomy"], noneFits: false }));
    authorLikeReal();
    const r = await generateFromOutline(req, plan(1), cfg(run));
    expect(mockAuthor).toHaveBeenCalledTimes(1);
    expect(r.specs[0].template).toBe("boat_anatomy");
  });
  it("a freehand part WITHOUT named parts is left alone even though the router said none fits", async () => {
    const run = createOnDemandRun(3);
    mockGenerate.mockImplementation(async () => plain());
    authorLikeReal();
    const r = await generateFromOutline(req, plan(2), cfg(run));
    expect(mockAuthor).not.toHaveBeenCalled();
    expect(run.skipped).toBe(0);
    expect(r.specs.every((s) => !s.template)).toBe(true);
  });
});

describe("the cap", () => {
  it("authors at most max templates in a run and leaves the rest freehand, saying so", async () => {
    const run = createOnDemandRun(1);
    mockGenerate.mockImplementation(async () => freehand());
    authorLikeReal();
    const phases: string[] = [];
    // A router that never finds a fit, so nothing is reused and every part wants its own template.
    const r = await generateFromOutline(req, plan(3), cfg(run, { route: async () => ({ ids: [], noneFits: true }) }), { onPhase: (t) => phases.push(t) });

    expect(mockAuthor).toHaveBeenCalledTimes(1);
    expect(run.authored).toBe(1);
    expect(run.skipped).toBe(2);
    expect(r.specs[0].template).toBe("boat_anatomy");
    expect(r.specs[1].template).toBeUndefined();
    expect(r.specs[2].template).toBeUndefined();
    expect(phases.some((p) => /cap/.test(p))).toBe(true);
  });

  it("zero authors nothing — the multi-part switch off while the single-figure one stays as it is", async () => {
    const run = createOnDemandRun(0);
    mockGenerate.mockImplementation(async () => freehand());
    authorLikeReal();
    const r = await generateFromOutline(req, plan(2), cfg(run));
    expect(mockAuthor).not.toHaveBeenCalled();
    expect(run.skipped).toBe(2);
    expect(r.specs.every((s) => !s.template)).toBe(true);
  });

  it("a skipped part still gets the re-route — a template authored just before it may fit", async () => {
    const run = createOnDemandRun(1);
    mockGenerate.mockImplementation(async () => (run.authored > 0 ? templated() : freehand()));
    authorLikeReal();
    const r = await generateFromOutline(req, plan(2), cfg(run));
    expect(mockAuthor).toHaveBeenCalledTimes(1);
    expect(run.skipped).toBe(0);
    expect(r.specs.map((s) => s.template)).toEqual(["boat_anatomy", "boat_anatomy"]);
  });
});

describe("without a shared run", () => {
  it("templatesOnDemandMax alone caps a single multi-part generation", async () => {
    mockGenerate.mockImplementation(async () => freehand());
    authorLikeReal();
    await generateFromOutline(req, plan(3), cfg(undefined, { templatesOnDemandMax: 2, route: async () => ({ ids: [], noneFits: true }) }));
    expect(mockAuthor).toHaveBeenCalledTimes(2);
  });
  it("no cap given means the default of three", async () => {
    mockGenerate.mockImplementation(async () => freehand());
    authorLikeReal();
    await generateFromOutline(req, plan(5), cfg(undefined, { route: async () => ({ ids: [], noneFits: true }) }));
    expect(mockAuthor).toHaveBeenCalledTimes(3);
  });
  it("the switch off authors nothing at all", async () => {
    mockGenerate.mockImplementation(async () => freehand());
    authorLikeReal();
    await generateFromOutline(req, plan(2), cfg(undefined, { templatesOnDemand: false }));
    expect(mockAuthor).not.toHaveBeenCalled();
  });
});
