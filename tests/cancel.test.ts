// Cancellation and progress through the generation loops. Every AI entry
// point takes the caller's AbortSignal and reports what the model is writing
// while it writes it; repair rounds — mechanical by construction — run at low
// effort. See src/llm/compile.ts, revise.ts, author.ts.

import { beforeEach, describe, expect, test, vi } from "vitest";
import Anthropic from "@anthropic-ai/sdk";

vi.mock("../src/llm/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/llm/client")>();
  return {
    ...actual,
    makeClient: vi.fn(() => ({}) as ReturnType<typeof actual.makeClient>),
    callForJson: vi.fn(),
    callForText: vi.fn(),
  };
});

import { callForJson, callForText, type CallOpts, type JsonCallMeta } from "../src/llm/client";
import { generateOutline, generateSpec, promptVariants, type GenerateConfig, type PromptVariant } from "../src/llm/compile";
import { generateTemplate } from "../src/llm/author";
import { reviseDocument } from "../src/llm/revise";

const mockCallForJson = vi.mocked(callForJson);
const mockCallForText = vi.mocked(callForText);

const META: JsonCallMeta = { ms: 1, structuredOutput: true };
const respond = (json: unknown) => ({ json, raw: JSON.stringify(json), meta: META });

const VARIANT: PromptVariant = {
  name: "test",
  source: "SCHEMA:{{SCHEMA}}\nCATALOG:{{CATALOG}}\nFEWSHOTS:{{FEWSHOTS}}\nEXEMPLARS:{{EXEMPLARS}}",
};
const baseCfg = (overrides: Partial<GenerateConfig> = {}): GenerateConfig => ({
  apiKey: "k",
  model: "claude-opus-5",
  variant: VARIANT,
  exemplars: [],
  ...overrides,
});

const VALID_SUPPLY_DEMAND = {
  title: "t",
  template: "supply_demand",
  params: { demand: {}, supply: {}, equilibrium: { show: true, guides: true } },
  commands: [],
};
const INVALID = { commands: [] }; // neither template nor elements

/** The options bag callForJson was handed on call `i`. */
const jsonOpts = (i: number) => mockCallForJson.mock.calls[i][5] as CallOpts | undefined;
const textOpts = (i: number) => mockCallForText.mock.calls[i][4] as CallOpts | undefined;

beforeEach(() => {
  mockCallForJson.mockReset();
  mockCallForText.mockReset();
});

describe("generateSpec cancellation", () => {
  test("the caller's abort signal reaches every round", async () => {
    mockCallForJson.mockResolvedValueOnce(respond(INVALID)).mockResolvedValueOnce(respond(VALID_SUPPLY_DEMAND));
    const controller = new AbortController();

    await generateSpec("draw supply and demand", baseCfg({ signal: controller.signal }));

    expect(jsonOpts(0)?.signal).toBe(controller.signal);
    expect(jsonOpts(1)?.signal).toBe(controller.signal);
  });

  test("an aborted call reports Cancelled and produces no spec", async () => {
    mockCallForJson.mockRejectedValueOnce(new Anthropic.APIUserAbortError());

    const outcome = await generateSpec("draw supply and demand", baseCfg());

    expect(outcome.error).toBe("Cancelled.");
    expect(outcome.spec).toBeNull();
  });
});

describe("generateSpec progress", () => {
  test("reports the round label and the text written so far", async () => {
    mockCallForJson.mockImplementationOnce(async (...args) => {
      const opts = args[5] as CallOpts;
      opts.onDelta?.('{"title"', '{"title"');
      opts.onDelta?.(':"t"}', '{"title":"t"}');
      return respond(VALID_SUPPLY_DEMAND);
    });
    const seen: { label: string; round: number; text: string }[] = [];

    await generateSpec("draw supply and demand", baseCfg({ onProgress: (p) => seen.push({ ...p }) }));

    expect(seen).toEqual([
      { label: "initial", round: 1, text: '{"title"' },
      { label: "initial", round: 1, text: '{"title":"t"}' },
    ]);
  });

  test("a repair round reports its own label and number", async () => {
    mockCallForJson.mockResolvedValueOnce(respond(INVALID)).mockImplementationOnce(async (...args) => {
      (args[5] as CallOpts).onDelta?.("x", "x");
      return respond(VALID_SUPPLY_DEMAND);
    });
    const seen: { label: string; round: number }[] = [];

    await generateSpec("draw supply and demand", baseCfg({ onProgress: (p) => seen.push({ label: p.label, round: p.round }) }));

    expect(seen).toEqual([{ label: "schema-repair", round: 2 }]);
  });
});

describe("effort", () => {
  test("the creative round keeps the model's default effort", async () => {
    mockCallForJson.mockResolvedValueOnce(respond(VALID_SUPPLY_DEMAND));

    await generateSpec("draw supply and demand", baseCfg());

    expect(jsonOpts(0)?.effort).toBeUndefined();
  });

  test("repair rounds run at low effort — they are mechanical", async () => {
    mockCallForJson.mockResolvedValueOnce(respond(INVALID)).mockResolvedValueOnce(respond(VALID_SUPPLY_DEMAND));

    await generateSpec("draw supply and demand", baseCfg());

    expect(jsonOpts(1)?.effort).toBe("low");
  });
});

describe("the other AI entry points take the signal too", () => {
  test("the playlist outline call is cancellable", async () => {
    mockCallForJson.mockResolvedValueOnce(respond({ title: "t", parts: [{ title: "p1", brief: "b" }] }));
    const controller = new AbortController();

    await generateOutline("explain trade", { apiKey: "k", model: "claude-opus-5" }, 2, controller.signal);

    expect(jsonOpts(0)?.signal).toBe(controller.signal);
  });

  test("authoring a template is cancellable, and its repairs run cheap", async () => {
    const doc = {
      template: "cancel_test_ring",
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
    const bad = { ...doc } as Record<string, unknown>;
    delete bad.layout;
    mockCallForJson.mockResolvedValueOnce(respond(bad)).mockResolvedValueOnce(respond(doc));
    const controller = new AbortController();

    await generateTemplate("draw a ring", null, { apiKey: "k", model: "claude-opus-5", signal: controller.signal });

    expect(jsonOpts(0)?.signal).toBe(controller.signal);
    expect(jsonOpts(1)?.effort).toBe("low");
  });
});

describe("reviseDocument cancellation", () => {
  const DOC = `title: A line
domain: { x: [0, 100], y: [0, 100] }
elements:
  - { id: ax, type: axes, x_label: x, y_label: y }
  - { id: c1, type: curve, expr: "50" }
commands:
  - { draw: [ax, c1] }
`;
  const cfg = () => ({ apiKey: "k", model: "claude-opus-5", variant: promptVariants()[0] });

  test("the abort signal reaches the call", async () => {
    mockCallForText.mockResolvedValueOnce({ text: DOC, ms: 1 });
    const controller = new AbortController();

    await reviseDocument(DOC, "make it steeper", { ...cfg(), signal: controller.signal });

    expect(textOpts(0)?.signal).toBe(controller.signal);
  });

  test("progress reports the streamed document text", async () => {
    mockCallForText.mockImplementationOnce(async (...args) => {
      (args[4] as CallOpts).onDelta?.("title:", "title:");
      return { text: DOC, ms: 1 };
    });
    const seen: string[] = [];

    await reviseDocument(DOC, "make it steeper", { ...cfg(), onProgress: (p) => seen.push(p.text) });

    expect(seen).toEqual(["title:"]);
  });

  test("an aborted revision reports Cancelled", async () => {
    mockCallForText.mockRejectedValueOnce(new Anthropic.APIUserAbortError());

    const outcome = await reviseDocument(DOC, "make it steeper", cfg());

    expect(outcome.error).toBe("Cancelled.");
    expect(outcome.playlist).toBeNull();
  });
});
