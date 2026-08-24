// Carried loop tests (M3 review debt): drive generateSpec/generateTemplate's
// call → validate → repair loop with a mocked callForJson, asserting the
// round labels and per-call models the real loop actually produces — not a
// paraphrase of them. See src/llm/compile.ts / src/llm/author.ts.

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

// vi.mock hoists above these imports; keep the factory self-contained (a
// fresh vi.fn() per mocked export) and drive behavior per-test through the
// vi.mocked(...) accessor below rather than closing over outer variables.
vi.mock("../src/llm/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/llm/client")>();
  return {
    ...actual,
    makeClient: vi.fn(() => ({}) as ReturnType<typeof actual.makeClient>),
    callForJson: vi.fn(),
  };
});

import { callForJson, type JsonCallMeta } from "../src/llm/client";
import { generateSpec, repairModelFor, type GenerateConfig, type PromptVariant } from "../src/llm/compile";
import { generateTemplate, type AuthorConfig } from "../src/llm/author";
import { registerTemplateDoc, scenes } from "../src/scenes/registry";
import { TEMPLATE_FULL_THRESHOLD } from "../src/scenes/catalog";
import type { TemplateDoc } from "../src/scenes/doc";
import type { Exemplar } from "../src/llm/prompt";
import type { Spec } from "../src/spec/types";

const mockCallForJson = vi.mocked(callForJson);

// Opus tier so repairModelFor(MODEL) actually differs from MODEL — otherwise
// "the repair round used the repair model" would be true by coincidence.
const MODEL = "claude-opus-5";
const REPAIR_MODEL = repairModelFor(MODEL); // "claude-sonnet-5"
const META: JsonCallMeta = { ms: 1, structuredOutput: true };

function respond(json: unknown) {
  return { json, raw: JSON.stringify(json), meta: META };
}

const VARIANT: PromptVariant = {
  name: "test",
  source: "SCHEMA:{{SCHEMA}}\nCATALOG:{{CATALOG}}\nFEWSHOTS:{{FEWSHOTS}}\nEXEMPLARS:{{EXEMPLARS}}",
};

function baseCfg(overrides: Partial<GenerateConfig> = {}): GenerateConfig {
  return { apiKey: "test-key", model: MODEL, variant: VARIANT, exemplars: [], ...overrides };
}

// Minimal genuinely-valid specs (checked against validateSpec's actual rules
// in tests/schema.test.ts: a spec needs template-or-elements + commands;
// commands may be empty — layoutSpec's geometry never reads commands, so an
// empty list can't trip a lint issue). params come straight from each
// template's own manifest example / optional-param defaults, not guessed.
const VALID_SUPPLY_DEMAND = {
  title: "t",
  template: "supply_demand",
  params: { demand: {}, supply: {}, equilibrium: { show: true, guides: true } },
  commands: [],
};

const VALID_FREE_BODY = {
  title: "t",
  template: "free_body",
  params: {}, // free_body's `forces` is `params.forces ?? []` — optional.
  commands: [],
};

beforeEach(() => {
  mockCallForJson.mockReset();
});

describe("generateSpec loop", () => {
  test("happy path: one valid response -> single 'initial' round on cfg.model", async () => {
    mockCallForJson.mockResolvedValueOnce(respond(VALID_SUPPLY_DEMAND));

    const outcome = await generateSpec("draw supply and demand", baseCfg());

    expect(outcome.error).toBeUndefined();
    expect(outcome.spec?.template).toBe("supply_demand");
    expect(outcome.rounds.map((r) => r.label)).toEqual(["initial"]);
    expect(mockCallForJson).toHaveBeenCalledTimes(1);
    expect(mockCallForJson.mock.calls[0][1]).toBe(MODEL);
  });

  test("schema-repair: invalid then valid -> rounds [initial, schema-repair], repair call on repairModelFor(cfg.model)", async () => {
    mockCallForJson
      .mockResolvedValueOnce(respond({ commands: [] })) // neither template nor elements -> semantic error
      .mockResolvedValueOnce(respond(VALID_SUPPLY_DEMAND));

    const outcome = await generateSpec("draw supply and demand", baseCfg());

    expect(outcome.error).toBeUndefined();
    expect(outcome.spec?.template).toBe("supply_demand");
    expect(outcome.rounds.map((r) => r.label)).toEqual(["initial", "schema-repair"]);
    expect(outcome.rounds[0].validationErrors.length).toBeGreaterThan(0);
    expect(mockCallForJson.mock.calls[0][1]).toBe(MODEL);
    expect(mockCallForJson.mock.calls[1][1]).toBe(REPAIR_MODEL);
  });

  test("escalation: need_template marker then a valid spec for it -> marker round is 'template-fetch', the NEXT round is 'initial' on cfg.model (not the repair model); repair budget untouched", async () => {
    mockCallForJson
      .mockResolvedValueOnce(respond({ need_template: "free_body" }))
      .mockResolvedValueOnce(respond(VALID_FREE_BODY));

    // maxRepairs: 0 proves the escalation round doesn't consume repair budget
    // (it `continue`s the loop without touching repairsUsed).
    const outcome = await generateSpec("draw the forces on a block", baseCfg({ maxRepairs: 0 }));

    expect(outcome.error).toBeUndefined();
    expect(outcome.spec?.template).toBe("free_body");
    expect(outcome.rounds.map((r) => r.label)).toEqual(["template-fetch", "initial"]);
    expect(outcome.rounds[0].validationErrors).toEqual([]);
    expect(mockCallForJson.mock.calls[0][1]).toBe(MODEL);
    // Both calls run on cfg.model: the escalation's re-derived label maps
    // back to "initial" (never falls through to the repair model just
    // because it isn't rounds[0]).
    expect(mockCallForJson.mock.calls[1][1]).toBe(MODEL);

    const secondCallSystem = mockCallForJson.mock.calls[1][2] as { text: string }[];
    expect(secondCallSystem[0].text).toContain("### Scene template: free_body");
  });

  // NOTE vs. the brief's sketch, and vs. this file's own first pass: reading
  // compile.ts's actual code, `validation.ok` is computed by validateSpec()
  // BEFORE the forced-template mismatch string is pushed onto
  // validation.errors, so `ok` never flips to false on a mismatch alone —
  // a structurally/semantically valid-but-wrong-template spec still sets
  // `best` (and passes layoutSpec, since it's a real template). Left alone,
  // that meant the FINAL outcome carried a non-null spec and no top-level
  // `error` — a silent wrong-template "success". Fixed in generateSpec's
  // final return (post-loop): when repairs exhaust with best.template !==
  // cfg.forcedTemplate, outcome.error now names the mismatch explicitly,
  // while outcome.spec still carries the best-effort (wrong-template) spec
  // so a caller can choose to use it anyway.
  test("forced mismatch: forcedTemplate set, model never switches -> repairs exhaust; outcome.error names the mismatch, outcome.spec keeps the best-effort (wrong-template) spec", async () => {
    mockCallForJson.mockResolvedValueOnce(respond(VALID_SUPPLY_DEMAND)).mockResolvedValueOnce(respond(VALID_SUPPLY_DEMAND));

    const outcome = await generateSpec("draw the forces on a block", baseCfg({ forcedTemplate: "free_body", maxRepairs: 1 }));

    expect(mockCallForJson).toHaveBeenCalledTimes(2); // model returns the wrong template "twice"
    expect(outcome.rounds.map((r) => r.label)).toEqual(["initial", "schema-repair"]);
    for (const round of outcome.rounds) {
      expect(round.validationErrors.join(" ")).toMatch(/requires template "free_body"/);
    }
    expect(mockCallForJson.mock.calls[0][1]).toBe(MODEL);
    expect(mockCallForJson.mock.calls[1][1]).toBe(REPAIR_MODEL);

    expect(outcome.error).toMatch(/required template "free_body"/);
    expect(outcome.spec?.template).toBe("supply_demand"); // best-effort preserved
  });

  test("escalation is suppressed when forcedTemplate is set: the marker object is treated as a normal invalid spec, no template-fetch round", async () => {
    mockCallForJson.mockResolvedValueOnce(respond({ need_template: "free_body" }));

    const outcome = await generateSpec("draw the forces on a block", baseCfg({ forcedTemplate: "free_body", maxRepairs: 0 }));

    expect(mockCallForJson).toHaveBeenCalledTimes(1);
    expect(outcome.rounds.map((r) => r.label)).toEqual(["initial"]);
    expect(outcome.rounds[0].validationErrors.join(" ")).toMatch(/commands/i);
    expect(outcome.spec).toBeNull();
    expect(outcome.error).toBeDefined();
  });
});

describe("generateSpec cache split (M5 Task 2)", () => {
  // Pushes the ready-template count above TEMPLATE_FULL_THRESHOLD so
  // catalogText degrades to index + hot-set + escalation, with a
  // keyword-matched shortlist relocated to the request-dependent suffix
  // (see src/scenes/catalog.ts's catalogParts / tests/catalog-split.test.ts).
  const added: string[] = [];
  function addFiller(id: string): void {
    const doc: TemplateDoc = {
      template: id, version: 1, kit: 1, status: "ready",
      description: `Filler template ${id} for cache-split testing.`,
      params: {}, element_ids: {},
      examples: [{ request: `Draw a ${id} filler.`, params: {} }],
      layout: `return { drawables: [], labels: [], anchors: {}, order: [] };`,
    };
    registerTemplateDoc(doc);
    added.push(id);
  }
  /** Enough fillers to put the catalog in its two-level regime, whatever the threshold is. */
  function fillPastThreshold(): void {
    const ready = () => Object.values(scenes).filter((s) => s.manifest.status === "ready").length;
    for (let i = 0; ready() <= TEMPLATE_FULL_THRESHOLD; i++) addFiller(`csplit_filler_${i}`);
  }
  // A unique keyword ("qxzzyweeble") that appears in ONLY this template's
  // description/example, so selectTemplates(request, 3) shortlists exactly
  // this one id deterministically (no ties with the filler templates, none
  // of which is in CORE_IDS or cfg.priorityIds either).
  function addTarget(): void {
    const doc: TemplateDoc = {
      template: "csplit_target", version: 1, kit: 1, status: "ready",
      description: "A csplit_target template about qxzzyweeble structures.",
      params: {}, element_ids: {},
      examples: [{ request: "Draw the qxzzyweeble diagram.", params: {} }],
      layout: `return { drawables: [], labels: [], anchors: {}, order: [] };`,
    };
    registerTemplateDoc(doc);
    added.push("csplit_target");
  }
  afterEach(() => {
    for (const id of added.splice(0)) delete scenes[id];
  });

  test("above threshold: the cache_control block excludes the shortlisted entry; the non-cached block includes it", async () => {
    fillPastThreshold();
    addTarget();
    mockCallForJson.mockResolvedValueOnce(respond(VALID_SUPPLY_DEMAND));

    await generateSpec("Draw the qxzzyweeble diagram.", baseCfg());

    const system = mockCallForJson.mock.calls[0][2] as { text: string; cache_control?: unknown }[];
    expect(system[0].cache_control).toBeDefined();
    expect(system[0].text).not.toContain("### Scene template: csplit_target (READY");
    expect(system[1]).toBeDefined();
    expect(system[1].cache_control).toBeUndefined();
    expect(system[1].text).toContain("### Scene template: csplit_target (READY");
  });
});

describe("generateTemplate loop", () => {
  function validDoc(id: string): TemplateDoc {
    return {
      template: id,
      title: "Test ring",
      version: 1,
      kit: 1,
      status: "ready",
      description: "A test ring figure.",
      params: { type: "object", properties: { n: { type: "number" } } },
      element_ids: { ring: "the ring" },
      examples: [{ request: "Draw a ring.", params: { n: 6 } }],
      layout: `return { drawables: [kit.stroke("ring", kit.polygon([500, 400], 120, params.n ?? 6), { closed: true })], labels: [], anchors: { ring_center: [500, 400] }, order: ["ring"] };`,
    };
  }

  function authorCfg(overrides: Partial<AuthorConfig> = {}): AuthorConfig {
    return { apiKey: "test-key", model: MODEL, ...overrides };
  }

  test("happy path: one valid TemplateDoc (no engines) -> yaml + doc, rounds [initial]", async () => {
    const doc = validDoc("genloop_test_ring_a");
    mockCallForJson.mockResolvedValueOnce(respond(doc));

    const outcome = await generateTemplate("draw a ring", null, authorCfg());

    expect(outcome.error).toBeUndefined();
    expect(outcome.doc?.template).toBe("genloop_test_ring_a");
    expect(outcome.yaml).toBeTruthy();
    expect(outcome.rounds.map((r) => r.label)).toEqual(["initial"]);
    expect(mockCallForJson.mock.calls[0][1]).toBe(MODEL);
  });

  test("two-round repair: missing layout -> repair -> valid; repair call on repairModelFor(cfg.model)", async () => {
    const id = "genloop_test_ring_b";
    const bad = validDoc(id) as unknown as Record<string, unknown>;
    delete bad.layout; // status "ready" requires a layout body

    mockCallForJson.mockResolvedValueOnce(respond(bad)).mockResolvedValueOnce(respond(validDoc(id)));

    const outcome = await generateTemplate("draw a ring", null, authorCfg());

    expect(outcome.error).toBeUndefined();
    expect(outcome.doc?.template).toBe(id);
    expect(outcome.yaml).toBeTruthy();
    expect(outcome.rounds.map((r) => r.label)).toEqual(["initial", "repair"]);
    expect(outcome.rounds[0].errors.join(" ")).toMatch(/layout/i);
    expect(mockCallForJson.mock.calls[0][1]).toBe(MODEL);
    expect(mockCallForJson.mock.calls[1][1]).toBe(REPAIR_MODEL);
  });
});

describe("generateSpec exemplar pool", () => {
  // {{EXEMPLARS}} is fed by two pools (src/llm/exemplars.ts): the user's own
  // promoted references and the curated bundled showcases. The user's win.
  const RAMP = "Show the forces on a crate resting on a ramp.";
  const BUNDLED: Exemplar[] = [{ prompt: RAMP, spec: VALID_FREE_BODY as unknown as Spec }];

  function promptTextOfCall(i: number): string {
    return (mockCallForJson.mock.calls[i][2] as { text: string }[]).map((b) => b.text).join("\n");
  }

  test("a bundled showcase fills the exemplar slot when the user library has no match", async () => {
    mockCallForJson.mockResolvedValueOnce(respond(VALID_FREE_BODY));

    await generateSpec("show the forces on a crate", baseCfg({ bundledExemplars: BUNDLED }));

    expect(promptTextOfCall(0)).toContain("### Exemplar 1");
    expect(promptTextOfCall(0)).toContain(RAMP);
  });

  test("the user's own references keep the slots — a bundled showcase never displaces them", async () => {
    const user: Exemplar[] = [1, 2, 3].map((i) => ({
      prompt: `forces on a crate, version ${i}`,
      spec: VALID_FREE_BODY as unknown as Spec,
    }));
    mockCallForJson.mockResolvedValueOnce(respond(VALID_FREE_BODY));

    await generateSpec("show the forces on a crate", baseCfg({ exemplars: user, bundledExemplars: BUNDLED }));

    expect(promptTextOfCall(0)).toContain("forces on a crate, version 1");
    expect(promptTextOfCall(0)).not.toContain(RAMP);
  });
});
