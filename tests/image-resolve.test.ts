import { describe, expect, test } from "vitest";
import { commonsFileInfoUrl, commonsSearchUrl, creditFromInfo, resolveImages } from "../src/render/image";
import { decodePhoto } from "../src/spec/trace";
import { wikiSummaryUrl } from "../src/render/portrait";

const info = (license: string | null, artist = "<a href='x'>Jane Doe</a>") => ({
  query: { pages: { "1": { title: "File:Bicycle pump.jpg", imageinfo: [{ thumburl: "https://upload.wikimedia.org/x.jpg", extmetadata: { ...(license ? { LicenseShortName: { value: license } } : {}), Artist: { value: artist } } }] } } },
});
const raster = async () => ({ width: 4, height: 2, data: new Uint8ClampedArray(4 * 2 * 4) });
const deps = (routes: Record<string, unknown>) => ({
  fetch: (async (url: string) => ({ ok: url in routes, status: url in routes ? 200 : 404, json: async () => routes[url] })) as unknown as typeof fetch,
  loadRaster: raster as never,
  encode: () => "data:image/jpeg;base64,AAAA",
});

describe("resolveImages", () => {
  test("wikipedia summary hit → file info → credit and embedded photo", async () => {
    const spec = { elements: [{ id: "p", type: "image", of: "Bicycle pump", width: 200, x: 1, y: 1 }], commands: [] };
    const r = await resolveImages(spec as never, deps({
      [wikiSummaryUrl("Bicycle pump")]: { originalimage: { source: "https://upload.wikimedia.org/wikipedia/commons/a/ab/Bicycle_pump.jpg" } },
      [commonsFileInfoUrl("File:Bicycle_pump.jpg")]: info("CC BY-SA 4.0"),
    }));
    expect(r).toEqual([{ id: "p", ok: true }]);
    const el = (spec.elements[0] as { strokes?: string; credit?: string; source?: string });
    expect(decodePhoto(el.strokes!)?.aspect).toBeCloseTo(0.5);
    expect(el.credit).toBe("Jane Doe · CC BY-SA 4.0");
    expect(el.source).toBe("https://upload.wikimedia.org/x.jpg");
  });
  test("summary miss falls back to a Commons search", async () => {
    const spec = { elements: [{ id: "p", type: "image", of: "Hand pump", x: 1, y: 1 }], commands: [] };
    const r = await resolveImages(spec as never, deps({ [commonsSearchUrl("Hand pump")]: info("CC0") }));
    expect(r[0].ok).toBe(true);
    expect((spec.elements[0] as { credit?: string }).credit).toBe("Jane Doe · CC0");
  });
  test("no licence → rejected, nothing embedded, error names the reason", async () => {
    const spec = { elements: [{ id: "p", type: "image", of: "Thing", x: 1, y: 1 }], commands: [] };
    const r = await resolveImages(spec as never, deps({ [commonsSearchUrl("Thing")]: info(null) }));
    expect(r[0]).toMatchObject({ id: "p", ok: false, error: expect.stringMatching(/licence/) });
    expect((spec.elements[0] as { strokes?: string }).strokes).toBeUndefined();
  });
  test("creditFromInfo strips HTML from the artist", () => {
    expect(creditFromInfo(info("CC BY 4.0", "<b>A &amp; B</b>"))).toEqual({ credit: "A & B · CC BY 4.0", licence: "CC BY 4.0" });
    expect(creditFromInfo(info(null))).toBeNull();
  });
});

// ---- A4: encoded pixels never visit the model -------------------------------
//
// `image` and `icon` resolve into the same `strokes` field a portrait uses,
// and three bundled examples carry 10–34 KB of base64 there. Until hoist.ts's
// blobField grew the two types, every revise round and every exemplar prompt
// paid for them — and risked the model re-emitting a corrupted photo.

describe("image/icon blobs are hoisted out of every model round-trip (A4)", () => {
  const PHOTO = "img1:0402:data:image/jpeg;base64,AAAABBBBCCCC";
  const GLYPH = "ico1:0402:data:image/svg+xml;base64,DDDDEEEE";

  test("hoisting swaps both for the sentinel and restores them by id", async () => {
    const { hoistPortraitStrokes, restorePortraitStrokes, HOISTED } = await import("../src/llm/hoist");
    const { parsePlaylistText, itemsOf } = await import("../src/playlist/playlist");
    const docText = JSON.stringify({
      elements: [
        { id: "photo", type: "image", of: "Honeycomb", strokes: PHOTO },
        { id: "bee", type: "icon", of: "bee", strokes: GLYPH },
      ],
      commands: [],
    });
    const { text, blobs } = hoistPortraitStrokes(docText);
    expect(blobs.get("photo")).toBe(PHOTO);
    expect(blobs.get("bee")).toBe(GLYPH);
    expect(text).toContain(HOISTED);
    expect(text).not.toContain("data:image");
    const revised = parsePlaylistText(text);
    restorePortraitStrokes(revised, blobs);
    expect(itemsOf(revised)[0].spec.elements![0].strokes).toBe(PHOTO);
    expect(itemsOf(revised)[0].spec.elements![1].strokes).toBe(GLYPH);
  });

  test("stripStrokesForModel drops them — the bundled beehive exemplar carries no base64", async () => {
    const { stripStrokesForModel } = await import("../src/llm/hoist");
    const { formatExemplars } = await import("../src/llm/prompt");
    const examples = (await import("../src/examples.json")).default as { request: string; spec?: unknown }[];
    const stripped = stripStrokesForModel({
      elements: [
        { id: "photo", type: "image", of: "Honeycomb", strokes: PHOTO },
        { id: "bee", type: "icon", of: "bee", strokes: GLYPH },
      ],
      commands: [],
    } as never);
    expect(stripped.elements![0].strokes).toBeUndefined();
    expect(stripped.elements![1].strokes).toBeUndefined();
    expect(stripped.elements![0].of).toBe("Honeycomb");
    const beehive = examples.find((e) => e.request.startsWith("Hvorfor har en bikube"))!;
    expect(JSON.stringify(beehive.spec)).toContain("data:image"); // the example really does carry one
    expect(formatExemplars([{ prompt: beehive.request, spec: beehive.spec as never }])).not.toContain("data:image");
  });
});
