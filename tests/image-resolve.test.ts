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
});

describe("resolveImages", () => {
  test("wikipedia summary hit → file info → credit and embedded photo", async () => {
    const spec = { elements: [{ id: "p", type: "image", of: "Bicycle pump", width: 200, x: 1, y: 1 }], commands: [] };
    const r = await resolveImages(spec as never, deps({
      [wikiSummaryUrl("Bicycle pump")]: { originalimage: { source: "https://upload.wikimedia.org/wikipedia/commons/a/ab/Bicycle_pump.jpg" } },
      [commonsFileInfoUrl("File:Bicycle_pump.jpg")]: info("CC BY-SA 4.0"),
    }));
    expect(r).toEqual([{ id: "p", ok: true }]);
    const el = (spec.elements[0] as { strokes?: string; credit?: string });
    expect(decodePhoto(el.strokes!)?.aspect).toBeCloseTo(0.5);
    expect(el.credit).toBe("Jane Doe · CC BY-SA 4.0");
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
