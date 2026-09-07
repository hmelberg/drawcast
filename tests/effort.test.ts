// The effort dial reaches the creative round and nothing else: the initial
// generation and authoring calls carry the setting, repairs stay low.
import { beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("../src/llm/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/llm/client")>();
  return { ...actual, callForJson: vi.fn() };
});

import { callForJson, type JsonCallMeta } from "../src/llm/client";
import { generateSpec, type GenerateConfig, type PromptVariant } from "../src/llm/compile";
import { generateTemplate } from "../src/llm/author";

const mock = vi.mocked(callForJson);
const META: JsonCallMeta = { ms: 1, structuredOutput: true };
const respond = (json: unknown) => ({ json, raw: JSON.stringify(json), meta: META });
const VARIANT: PromptVariant = { name: "test", source: "SCHEMA:{{SCHEMA}}\nCATALOG:{{CATALOG}}\nFEWSHOTS:{{FEWSHOTS}}\nEXEMPLARS:{{EXEMPLARS}}" };
const cfg = (overrides: Partial<GenerateConfig> = {}): GenerateConfig => ({ apiKey: "k", model: "claude-opus-5", variant: VARIANT, exemplars: [], executeCode: false, ...overrides });
const VALID = { title: "t", template: "supply_demand", params: { demand: {}, supply: {}, equilibrium: { show: true, guides: true } }, commands: [] };
const effortOf = (call: number) => (mock.mock.calls[call][5] as { effort?: string } | undefined)?.effort;

beforeEach(() => mock.mockReset());

describe("generateSpec", () => {
  test("the initial round carries the configured effort; a repair round runs low", async () => {
    mock.mockResolvedValueOnce(respond({ nonsense: true })).mockResolvedValueOnce(respond(VALID));
    const out = await generateSpec("Draw supply and demand.", cfg({ effort: "medium" }));
    expect(out.spec?.template).toBe("supply_demand");
    expect(effortOf(0)).toBe("medium");
    expect(effortOf(1)).toBe("low");
  });
  test("no setting means the API default (effort omitted)", async () => {
    mock.mockResolvedValueOnce(respond(VALID));
    await generateSpec("Draw supply and demand.", cfg());
    expect(effortOf(0)).toBeUndefined();
  });
});

describe("generateTemplate", () => {
  test("the creative authoring round carries the configured effort", async () => {
    // An invalid document ends the loop without a repair (errors) — enough to see the first call's options.
    mock.mockResolvedValueOnce(respond({ template: "Bad Id" })).mockResolvedValue(respond({ template: "Bad Id" }));
    await generateTemplate("a ring", null, { apiKey: "k", model: "claude-opus-5", effort: "low", maxRepairs: 0 });
    expect(effortOf(0)).toBe("low");
  });
});
