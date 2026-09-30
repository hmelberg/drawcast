// Picture mapping in the authoring paths (spec 2026-09-30-picture-regions §14):
// a picture URL in a request is mapped before the compiler, which gets the part
// NAMES; the used boxes are filled before validation; a revise of a document
// with regions: auto maps first and fills the reply.
import { beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("../src/llm/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/llm/client")>();
  return {
    ...actual,
    makeClient: vi.fn(() => ({}) as ReturnType<typeof actual.makeClient>),
    callForJson: vi.fn(),
    callForText: vi.fn(),
  };
});

import { callForJson, callForText, type JsonCallMeta } from "../src/llm/client";
import { generateSpec, promptVariants, type GenerateConfig, type PromptVariant } from "../src/llm/compile";
import { makeMapPictures, type PictureMap } from "../src/llm/picture-map";
import { reviseDocument } from "../src/llm/revise";
import { formatPlaylist, itemsOf, singlePlaylist } from "../src/playlist/playlist";
import type { Spec } from "../src/spec/types";

const mockJson = vi.mocked(callForJson);
const mockText = vi.mocked(callForText);
const META: JsonCallMeta = { ms: 1, structuredOutput: true };
const respond = (json: unknown) => ({ json, raw: JSON.stringify(json), meta: META });

const VARIANT: PromptVariant = { name: "test", source: "SCHEMA:{{SCHEMA}}\nCATALOG:{{CATALOG}}\nFEWSHOTS:{{FEWSHOTS}}\nEXEMPLARS:{{EXEMPLARS}}" };
const U = "https://x.org/assets/shot.png";
const REQUEST = `Explain the command line in ${U}`;
const MAP: PictureMap = {
  regions: [
    { name: "command_line", box: [0.2, 0.9, 0.8, 0.1], kind: "text", label: "Command" },
    { name: "results", box: [0, 0, 0.5, 0.5], kind: "area" },
  ],
  notFound: [],
};
const NOTE = "Picture " + U + " — mapped parts (target as <id>:<name>):\n  command_line — text\n  results — area";

const specUsing = (name: string) => ({
  title: "t",
  elements: [{ id: "md", type: "image", url: U, regions: "auto", x: 100, y: 100, width: 400, height: 300 }],
  commands: [{ draw: ["md"] }, { highlight: { target: [`md:${name}`] } }],
});

const cfg = (o: Partial<GenerateConfig> = {}): GenerateConfig => ({ apiKey: "k", model: "claude-opus-5", variant: VARIANT, exemplars: [], executeCode: false, ...o });
const userText = (i: number) => {
  const c = (mockJson.mock.calls[i][3] as { content: unknown }[])[0].content;
  return typeof c === "string" ? c : JSON.stringify(c);
};

beforeEach(() => {
  mockJson.mockReset();
  mockText.mockReset();
});

describe("compile pipeline", () => {
  test("the note rides the compiler's user turn; the used box is filled", async () => {
    mockJson.mockResolvedValue(respond(specUsing("command_line")));
    const mapPictures = vi.fn(async () => ({ maps: new Map([[U, MAP]]), note: NOTE, warnings: [] }));
    const out = await generateSpec(REQUEST, cfg({ mapPictures }));
    expect(mapPictures).toHaveBeenCalledWith(REQUEST, undefined);
    expect(userText(0)).toContain("command_line — text");
    expect(out.error).toBeUndefined();
    expect(out.rounds[0].validationErrors).toEqual([]);
    expect(out.spec!.elements![0].regions).toEqual({ command_line: [0.2, 0.9, 0.8, 0.1] });
  });

  test("a name the map lacks is reported with the real names; the repair's reply is accepted", async () => {
    mockJson.mockResolvedValueOnce(respond(specUsing("nope"))).mockResolvedValueOnce(respond(specUsing("results")));
    const out = await generateSpec(REQUEST, cfg({ mapPictures: async () => ({ maps: new Map([[U, MAP]]), note: NOTE, warnings: [] }) }));
    const errs = out.rounds[0].validationErrors.join("\n");
    expect(errs).toContain("nope");
    expect(errs).toContain("command_line, results");
    expect(out.rounds[1].validationErrors).toEqual([]);
    expect(out.spec!.elements![0].regions).toEqual({ results: [0, 0, 0.5, 0.5] });
  });

  test("a failing mapper costs nothing but a warning", async () => {
    mockJson.mockResolvedValue(respond({ title: "t", elements: [{ id: "a", type: "text", text: "hi", x: 10, y: 10 }], commands: [{ draw: ["a"] }] }));
    const out = await generateSpec(REQUEST, cfg({ mapPictures: async () => Promise.reject(new Error("boom")) }));
    expect(out.spec).not.toBeNull();
    expect(out.warnings?.[0]).toMatch(/Could not map/);
    expect(userText(0)).not.toContain("mapped parts");
  });

  test("makeMapPictures: no picture URL, no call", async () => {
    const hook = makeMapPictures({ client: {} as never, model: "claude-sonnet-5" });
    expect(await hook("Explain supply and demand, see https://x.org/page", undefined)).toBeNull();
    expect(mockJson).not.toHaveBeenCalled();
  });

  test("makeMapPictures: a picture URL is mapped with the default options and noted", async () => {
    mockJson.mockResolvedValue(respond({ regions: [{ name: "command_line", box: [0.2, 0.9, 0.8, 0.1], kind: "text", label: "Command" }], not_found: [] }));
    const hook = makeMapPictures({ client: {} as never, model: "claude-sonnet-5", cacheGet: async () => null, cachePut: async () => {} });
    const r = await hook(REQUEST, undefined);
    expect(r!.maps.get(U)!.regions[0].name).toBe("command_line");
    expect(r!.note).toContain('command_line — text — "Command"');
    expect(r!.warnings).toEqual([]);
  });

  test("makeMapPictures: parallel parts asking for the same picture share one call", async () => {
    mockJson.mockResolvedValue(respond({ regions: [{ name: "results", box: [0, 0, 0.5, 0.5], kind: "area" }], not_found: [] }));
    const hook = makeMapPictures({ client: {} as never, model: "claude-sonnet-5", cacheGet: async () => null, cachePut: async () => {} });
    const [a, b] = await Promise.all([hook(`part 1 of ${U}`), hook(`part 2 of ${U}`)]);
    expect(a!.maps.get(U)).toEqual(b!.maps.get(U));
    expect(mockJson).toHaveBeenCalledTimes(1);
  });
});

describe("revise", () => {
  test("regions: auto → mapped first, the note rides the message, the reply's used boxes are filled", async () => {
    const doc = formatPlaylist(singlePlaylist(specUsing("command_line") as unknown as Spec), "script");
    expect(doc).toContain("auto");
    mockText.mockImplementation(async () => ({ text: doc, ms: 1 }));
    const mapAuto = vi.fn(async () => ({ maps: new Map([[U, MAP]]), warnings: [] }));
    const out = await reviseDocument(doc, "make it slower", { apiKey: "k", model: "claude-opus-5", variant: promptVariants()[0], mapAuto });
    expect(mapAuto).toHaveBeenCalledTimes(1);
    const sent = (mockText.mock.calls[0][3] as { content: string }[])[0].content;
    expect(sent).toContain("These pictures have been mapped");
    expect(sent).toContain("command_line — text");
    expect(out.error).toBeUndefined();
    const spec = itemsOf(out.playlist!)[0].spec;
    expect(spec.elements![0].regions).toEqual({ command_line: [0.2, 0.9, 0.8, 0.1] });
    expect(out.text).toContain("0.9");
  });

  test("no regions: auto → no mapping call", async () => {
    const plain = { ...specUsing("command_line"), elements: [{ id: "md", type: "image", url: U, regions: { command_line: [0, 0, 1, 1] }, x: 100, y: 100, width: 400, height: 300 }] };
    const doc = formatPlaylist(singlePlaylist(plain as unknown as Spec), "script");
    mockText.mockImplementation(async () => ({ text: doc, ms: 1 }));
    const mapAuto = vi.fn();
    await reviseDocument(doc, "x", { apiKey: "k", model: "claude-opus-5", variant: promptVariants()[0], mapAuto });
    expect(mapAuto).not.toHaveBeenCalled();
  });
});

describe("editor write-back", () => {
  test("writeFullMaps writes every part, sorted by name, only on auto images", async () => {
    const { writeFullMaps } = await import("../src/llm/picture-map");
    const spec = {
      elements: [
        { id: "md", type: "image", url: U, regions: "auto" },
        { id: "hand", type: "image", url: U, regions: { a: [0, 0, 1, 1] } },
      ],
      commands: [],
    } as unknown as Spec;
    const out = writeFullMaps(spec, new Map([[U, { ...MAP, regions: [...MAP.regions].reverse(), notFound: ["zoom"] }]]));
    expect(out).toEqual([{ id: "md", count: 2, notFound: ["zoom"] }]);
    expect(Object.keys(spec.elements![0].regions as object)).toEqual(["command_line", "results"]);
    expect(spec.elements![1].regions).toEqual({ a: [0, 0, 1, 1] });
  });
});
