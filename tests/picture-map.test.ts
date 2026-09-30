import { describe, expect, test } from "vitest";
import {
  autoImages, autoOptions, fillUsedRegions, mapCacheKey, mapNote, mapSystemPrompt, mapUserText, picturesInRequest, sanitizeMap,
  type MapOptions, type PictureMap,
} from "../src/llm/picture-map";

const all: MapOptions = { detail: "some", kinds: ["areas", "controls", "text"], find: [] };

describe("autoOptions", () => {
  test("forms", () => {
    expect(autoOptions("auto")).toEqual(all);
    expect(autoOptions({ auto: true })).toEqual(all);
    const o = { detail: "few", kinds: ["areas"], find: ["search button"] };
    expect(autoOptions({ auto: o })).toEqual(o);
    expect(autoOptions({ a: [0, 0, 1, 1] })).toBeNull();
    expect(autoOptions(undefined)).toBeNull();
  });
});

describe("picturesInRequest", () => {
  test("finds https pictures, dedupes, caps at 3", () => {
    const a = "https://microdata.no/manual/assets/images/image79-3a6b.png";
    const b = "https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/X.jpg/3840px-X.jpg";
    const t = `Explain ${a}, and also ${b}. See http://x.org/a.png and https://x.org/page. Again ${a} https://y.org/1.gif https://y.org/2.webp`;
    expect(picturesInRequest(t)).toEqual([a, b, "https://y.org/1.gif"]);
    expect(picturesInRequest("http://x.org/a.png https://x.org/page")).toEqual([]);
    expect(picturesInRequest("https://x.org/images/abc")).toEqual(["https://x.org/images/abc"]);
  });
});

describe("sanitizeMap", () => {
  const reg = (name: string, box: number[], kind = "area") => ({ name, box, kind });
  test("names, dedupe, clamp, tiny boxes, kinds, caps", () => {
    const m = sanitizeMap({ regions: [reg("Command Line!", [0, 0, 0.5, 0.5]), reg("command_line", [0, 0, 0.5, 0.5]), reg("wide", [-0.1, 0.5, 1.3, 0.6]), reg("tiny", [0.2, 0.2, 0.001, 0.3]), reg("btn", [0.1, 0.1, 0.1, 0.1], "control")], not_found: [" a ", 3] }, { ...all, kinds: ["areas"] });
    expect(m.regions.map((r) => r.name)).toEqual(["command_line", "command_line_2", "wide"]);
    expect(m.regions[2].box).toEqual([0, 0.5, 1, 0.5]);
    expect(m.notFound).toEqual(["a"]);
    const many = Array.from({ length: 30 }, (_, i) => reg(`p${i}`, [0.1, 0.1, 0.2, 0.2]));
    expect(sanitizeMap({ regions: many }, { ...all, detail: "few" }).regions).toHaveLength(8);
    expect(sanitizeMap({ regions: [] , not_found: Array.from({ length: 20 }, (_, i) => `n${i}`) }, all).notFound).toHaveLength(10);
  });
  test("bad input", () => {
    for (const bad of [null, "x", { regions: 5 }, undefined]) expect(sanitizeMap(bad, all)).toEqual({ regions: [], notFound: [] });
  });
});

describe("mapCacheKey / prompts", () => {
  test("order-independent; data URI fingerprinted", () => {
    const a = mapCacheKey("https://x/a.png", { detail: "some", kinds: ["text", "areas"], find: ["b", "a"] });
    expect(a).toBe(mapCacheKey("https://x/a.png", { detail: "some", kinds: ["areas", "text"], find: ["a", "b"] }));
    expect(a.startsWith("m1|https://x/a.png|some|areas,text|a;b")).toBe(true);
    const data = "data:image/png;base64," + "A".repeat(5000);
    expect(mapCacheKey(data, all).length).toBeLessThan(300);
  });
  test("prompt texts", () => {
    expect(mapSystemPrompt()).toContain("Never invent a part you cannot see.");
    expect(mapUserText(all)).toBe("Detail: some (25 parts at most). Kinds: areas, controls, text.");
    expect(mapUserText({ ...all, find: ["x", "y"] })).toContain("Find exactly these, and nothing else: x; y. Quoted phrases are visible text.");
  });
});

const map: PictureMap = {
  regions: [
    { name: "command_line", box: [0.2, 0.9, 0.8, 0.1], kind: "text", label: "Command" },
    { name: "results", box: [0, 0, 0.5, 0.5], kind: "area" },
  ],
  notFound: ["search button"],
};

describe("mapNote", () => {
  test("lists parts", () => {
    const n = mapNote([{ url: "https://x/a.png", map }]);
    expect(n).toContain("https://x/a.png");
    expect(n).toContain('  command_line — text — "Command"');
    expect(n).toContain("  results — area");
    expect(n).toContain("  not found: search button");
  });
});

describe("fillUsedRegions / autoImages", () => {
  const U = "https://x/a.png";
  const mk = () => ({
    elements: [
      { id: "md", type: "image", url: U, regions: "auto" },
      { id: "h", type: "image", url: U, regions: { extra: [0, 0, 1, 1] } },
      { id: "z", type: "image", url: "https://x/z.png", regions: { auto: { detail: "few" } } },
    ],
    commands: [{ highlight: { target: ["md:command_line", "md:nope", "h:results"] } }],
  }) as never as import("../src/spec/types").Spec;
  test("fills only the used regions", () => {
    const spec = mk();
    const r = fillUsedRegions(spec, new Map([[U, map]]));
    expect(spec.elements![0].regions).toEqual({ command_line: [0.2, 0.9, 0.8, 0.1] });
    expect(spec.elements![1].regions).toEqual({ extra: [0, 0, 1, 1], results: [0, 0, 0.5, 0.5] });
    expect(r.missing).toEqual(["nope"]);
  });
  test("a command naming __proto__ touches no prototype", () => {
    const spec = { elements: [{ id: "md", type: "image", url: U, regions: "auto" }], commands: [{ highlight: { target: ["md:__proto__", "md:command_line"] } }] } as never as import("../src/spec/types").Spec;
    const r = fillUsedRegions(spec, new Map([[U, map]]));
    const regions = spec.elements![0].regions as Record<string, unknown>;
    expect(Object.keys(regions)).toEqual(["command_line"]);
    expect(Object.getPrototypeOf(regions)).toBeNull();
    expect(({} as Record<string, unknown>).command_line).toBeUndefined();
    expect(r.missing).toEqual([]); // the unsafe name is skipped, not reported missing
  });
  test("autoImages", () => {
    expect(autoImages(mk())).toEqual([
      { id: "md", picture: U, opts: all },
      { id: "z", picture: "https://x/z.png", opts: { ...all, detail: "few" } },
    ]);
  });
});
