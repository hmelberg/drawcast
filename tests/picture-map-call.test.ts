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

describe("a picture the API cannot fetch by URL (spec §14.1)", () => {
  const ROBOTS = "This URL is disallowed by the website's robots.txt file.";
  const bad = async (message: string) => {
    const { default: A } = await import("@anthropic-ai/sdk");
    return new A.BadRequestError(400, { type: "error", error: { type: "invalid_request_error", message } }, message, new Headers());
  };
  const WARN = "microdata.no opts out of AI use in its robots.txt — mapped from the picture you gave; make sure you have the right to use it this way.";
  const URL1 = "https://microdata.no/manual/a.png";
  const imageOfCall = (i: number) => (mockJson.mock.calls[i][3][0].content as unknown as { type: string; source: Record<string, string> }[])[0];

  test("a robots.txt 400 → the bytes are read and sent as base64; the map says the host opted out", async () => {
    mockJson.mockRejectedValueOnce(await bad(ROBOTS)).mockResolvedValueOnce(reply(RAW));
    const pictureBytes = vi.fn(async () => ({ mediaType: "image/jpeg" as const, data: "QUJD" }));
    const m = await mapPicture(URL1, OPTS, { ...deps(), pictureBytes });
    expect(pictureBytes).toHaveBeenCalledWith(URL1);
    expect(mockJson).toHaveBeenCalledTimes(2);
    expect(imageOfCall(1)).toEqual({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: "QUJD" } });
    expect(m!.regions.map((r) => r.name)).toEqual(["search_field"]);
    expect(m!.optedOut).toBe("microdata.no");
  });
  test("mapPictures carries the opt-out warning, word for word", async () => {
    mockJson.mockRejectedValueOnce(await bad(ROBOTS)).mockResolvedValueOnce(reply(RAW));
    const r = await mapPictures([{ picture: URL1, opts: OPTS }], { ...deps(), pictureBytes: async () => ({ mediaType: "image/jpeg", data: "QUJD" }) });
    expect([...r.maps.keys()]).toEqual([URL1]);
    expect(r.warnings).toEqual([WARN]);
  });
  test("any other 400 (or failure) → the bytes too, without the warning", async () => {
    mockJson.mockRejectedValueOnce(await bad("Unable to download the file")).mockResolvedValueOnce(reply(RAW));
    const m = await mapPicture(URL1, OPTS, { ...deps(), pictureBytes: async () => ({ mediaType: "image/png", data: "QUJD" }) });
    expect(imageOfCall(1).source).toMatchObject({ type: "base64", media_type: "image/png" });
    expect(m!.regions).toHaveLength(1);
    expect(m!.optedOut).toBeUndefined();
    mockJson.mockRejectedValueOnce(new Error("network")).mockResolvedValueOnce(reply(RAW));
    const r = await mapPictures([{ picture: "https://x/b.png", opts: OPTS }], { ...deps(), pictureBytes: async () => ({ mediaType: "image/png", data: "QUJD" }) });
    expect(r.maps.size).toBe(1);
    expect(r.warnings).toEqual([]);
  });
  test("bytes unavailable → null, one call only", async () => {
    mockJson.mockRejectedValueOnce(await bad(ROBOTS));
    expect(await mapPicture(URL1, OPTS, { ...deps(), pictureBytes: async () => null })).toBeNull();
    expect(mockJson).toHaveBeenCalledTimes(1);
  });
  test("a cache hit on an opted-out map still warns", async () => {
    const d = { ...deps(), pictureBytes: async () => ({ mediaType: "image/jpeg" as const, data: "QUJD" }) };
    mockJson.mockRejectedValueOnce(await bad(ROBOTS)).mockResolvedValueOnce(reply(RAW));
    await mapPicture(URL1, OPTS, d);
    mockJson.mockReset();
    const again = await mapPicture(URL1, OPTS, d);
    expect(mockJson).not.toHaveBeenCalled();
    expect(again!.optedOut).toBe("microdata.no");
    const r = await mapPictures([{ picture: URL1, opts: OPTS }], d);
    expect(r.warnings).toEqual([WARN]);
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
