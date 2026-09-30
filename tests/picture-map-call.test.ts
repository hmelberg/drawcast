import { beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("../src/llm/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/llm/client")>();
  return { ...actual, callForJson: vi.fn() };
});

import type Anthropic from "@anthropic-ai/sdk";
import { callForJson } from "../src/llm/client";
import { mapPicture, mapPictures, type MapDeps, type MapOptions } from "../src/llm/picture-map";

const mockJson = vi.mocked(callForJson);
const META = { ms: 1, structuredOutput: true };
const reply = (json: unknown) => ({ json, raw: JSON.stringify(json), meta: META });
const OPTS: MapOptions = { detail: "some", kinds: ["areas", "controls", "text"], find: [] };
const RAW = { regions: [{ name: "Search Field", box: [0.1, 0.1, 0.5, 0.1], kind: "control", label: "Search" }, { name: "x", box: [0, 0, 0, 0], kind: "area" }], not_found: [] };

function deps(): MapDeps & { store: Map<string, string> } {
  const store = new Map<string, string>();
  return { client: {} as Anthropic, model: "m", store, cacheGet: async (k) => store.get(k) ?? null, cachePut: async (k, v) => void store.set(k, v) };
}
const imageOf = () => (mockJson.mock.calls[0][3][0].content as unknown as { type: string; source: Record<string, string> }[])[0];

beforeEach(() => mockJson.mockReset());

describe("mapPicture", () => {
  test("a url picture goes as a url block; the reply is sanitised", async () => {
    mockJson.mockResolvedValueOnce(reply(RAW));
    const m = await mapPicture("https://x/a.png", OPTS, deps());
    expect(imageOf()).toEqual({ type: "image", source: { type: "url", url: "https://x/a.png" } });
    expect(mockJson.mock.calls[0][5]).toMatchObject({ maxTokens: 4000 });
    expect(m!.regions.map((r) => r.name)).toEqual(["search_field"]);
  });
  test("a data URI goes as base64 with its media type; other types → null, no call", async () => {
    mockJson.mockResolvedValueOnce(reply(RAW));
    await mapPicture("data:image/webp;base64,QUJD", OPTS, deps());
    expect(imageOf()).toEqual({ type: "image", source: { type: "base64", media_type: "image/webp", data: "QUJD" } });
    expect(await mapPicture("data:image/svg+xml;base64,QUJD", OPTS, deps())).toBeNull();
    expect(mockJson).toHaveBeenCalledTimes(1);
  });
  test("the second identical call is served from the cache", async () => {
    mockJson.mockResolvedValue(reply(RAW));
    const d = deps();
    const a = await mapPicture("https://x/a.png", OPTS, d);
    const b = await mapPicture("https://x/a.png", OPTS, d);
    expect(mockJson).toHaveBeenCalledTimes(1);
    expect(b).toEqual(a);
  });
  test("a failure degrades to null and caches nothing; an empty map is not cached", async () => {
    const d = deps();
    mockJson.mockRejectedValueOnce(new Error("boom"));
    expect(await mapPicture("https://x/a.png", OPTS, d)).toBeNull();
    mockJson.mockResolvedValueOnce(reply({ regions: [], not_found: [] }));
    await mapPicture("https://x/a.png", OPTS, d);
    expect(d.store.size).toBe(0);
  });
  test("a 400 (a picture the API cannot fetch) → null, sent isolated", async () => {
    const { default: A } = await import("@anthropic-ai/sdk");
    mockJson.mockRejectedValueOnce(new A.BadRequestError(400, { type: "error" }, "Unable to download the file", new Headers()));
    expect(await mapPicture("https://x/a.png", OPTS, deps())).toBeNull();
    expect(mockJson.mock.calls[0][5]).toMatchObject({ isolate: true });
  });
  test("an abort rejects", async () => {
    const ac = new AbortController();
    ac.abort();
    mockJson.mockRejectedValueOnce(Object.assign(new Error("x"), { name: "AbortError" }));
    await expect(mapPicture("https://x/a.png", OPTS, { ...deps(), signal: ac.signal })).rejects.toBeTruthy();
  });
});

describe("mapPictures", () => {
  test("maps for the successes, a warning naming the failed url", async () => {
    mockJson.mockResolvedValueOnce(reply(RAW)).mockRejectedValueOnce(new Error("boom"));
    const r = await mapPictures([{ picture: "https://x/a.png", opts: OPTS }, { picture: "https://x/b.png", opts: OPTS }], deps());
    expect([...r.maps.keys()]).toEqual(["https://x/a.png"]);
    expect(r.warnings).toHaveLength(1);
    expect(r.warnings[0]).toContain("https://x/b.png");
  });
});
