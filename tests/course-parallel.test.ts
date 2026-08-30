// The two-phase batch shape: outlines first, then every part in one pool —
// and no call at all once the run has been cancelled.

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/llm/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/llm/client")>();
  return {
    ...actual,
    makeClient: vi.fn(() => ({}) as ReturnType<typeof actual.makeClient>),
    callForJson: vi.fn(),
    callForText: vi.fn(),
  };
});

import { callForJson, type JsonCallMeta } from "../src/llm/client";
import { type GenerateConfig, type PromptVariant } from "../src/llm/compile";
import { generateFromOutline, outlineParts } from "../src/llm/multi";
import { createGate, GENERATION_LIMIT } from "../src/llm/limit";
import type { Outline } from "../src/llm/outline";

const mockCallForJson = vi.mocked(callForJson);
const META: JsonCallMeta = { ms: 1, structuredOutput: true };
const respond = (json: unknown) => ({ json, raw: JSON.stringify(json), meta: META });

const VARIANT: PromptVariant = {
  name: "test",
  source: "SCHEMA:{{SCHEMA}}\nCATALOG:{{CATALOG}}\nFEWSHOTS:{{FEWSHOTS}}\nEXEMPLARS:{{EXEMPLARS}}",
};
const cfg = (overrides: Partial<GenerateConfig> = {}): GenerateConfig => ({
  apiKey: "k",
  model: "claude-opus-5",
  variant: VARIANT,
  exemplars: [],
  ...overrides,
});

const PLAN: Outline = {
  title: "Series",
  parts: [
    { title: "One", brief: "a" },
    { title: "Two", brief: "b" },
  ],
};

beforeEach(() => mockCallForJson.mockReset());

describe("outlineParts", () => {
  it("returns the plan from a single call", async () => {
    mockCallForJson.mockResolvedValueOnce(respond({ title: "Series", parts: [{ title: "One", brief: "a" }, { title: "Two", brief: "b" }] }));
    const { outline } = await outlineParts({ request: "r", parts: 2, brief: "" }, cfg());
    expect(outline?.parts).toHaveLength(2);
    expect(mockCallForJson).toHaveBeenCalledTimes(1);
  });

  it("reports the failure instead of throwing", async () => {
    mockCallForJson.mockRejectedValueOnce(new Error("network down"));
    const { outline, error } = await outlineParts({ request: "r", parts: 2, brief: "" }, cfg());
    expect(outline).toBeNull();
    expect(error).toContain("network down");
  });
});

describe("generateFromOutline", () => {
  it("spends no call when the run was already cancelled", async () => {
    const controller = new AbortController();
    controller.abort();
    const result = await generateFromOutline({ request: "r", parts: 2, brief: "" }, PLAN, cfg({ signal: controller.signal }));
    expect(mockCallForJson).not.toHaveBeenCalled();
    expect(result.specs).toEqual([]);
  });

  it("reports progress once per part", async () => {
    mockCallForJson.mockResolvedValue(respond({ title: "t", elements: [], commands: [] }));
    const seen: number[] = [];
    await generateFromOutline({ request: "r", parts: 2, brief: "" }, PLAN, cfg(), {
      onPart: (done) => seen.push(done),
    });
    expect(seen).toEqual([1, 2]);
  });
});

describe("the gate is what sets batch throughput", () => {
  it("is wide enough that one #parts=4 lecture cannot saturate it alone", () => {
    expect(GENERATION_LIMIT).toBeGreaterThan(4);
  });

  it("still holds its limit under a burst the size of a whole course", async () => {
    const gate = createGate(GENERATION_LIMIT);
    let running = 0;
    let peak = 0;
    await Promise.all(
      Array.from({ length: 24 }, () =>
        gate(async () => {
          running++;
          peak = Math.max(peak, running);
          await new Promise((r) => setTimeout(r, 2));
          running--;
        }),
      ),
    );
    expect(peak).toBe(GENERATION_LIMIT);
  });
});

describe("cancelling costs nothing", () => {
  it("spends no call on an outline still queued when the run was cancelled", async () => {
    const controller = new AbortController();
    controller.abort();
    const { outline, error } = await outlineParts({ request: "r", parts: 2, brief: "" }, cfg({ signal: controller.signal }));
    expect(mockCallForJson).not.toHaveBeenCalled();
    expect(outline).toBeNull();
    expect(error).toBeTruthy();
  });
});
