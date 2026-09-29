import { describe, expect, test } from "vitest";
import { resolveImages } from "../src/render/image";
import { decodePicture } from "../src/spec/trace";
import { unembeddedImages } from "../src/ui/insert";

const raster = (w: number, h: number) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4), naturalWidth: w, naturalHeight: h });
const base = {
  fetch: (async () => ({ ok: false, status: 404, json: async () => ({}) })) as unknown as typeof fetch,
  encode: () => "data:image/jpeg;base64,GREY",
  encodeScreen: () => "data:image/png;base64,COLOUR",
  measure: async () => ({ width: 1920, height: 1041 }),
};

describe("an image from its url", () => {
  test("look screen: full colour at SCREEN_DIM, credit kept", async () => {
    const dims: number[] = [];
    const spec = { elements: [{ id: "md", type: "image", url: "https://example.org/shot.png", look: "screen", credit: "Sikt" }] };
    const deps = { ...base, loadRaster: async (_u: string, d: number) => (dims.push(d), raster(1920, 1041)) };
    const [r] = await resolveImages(spec as never, deps as never);
    expect(r.ok).toBe(true);
    const el = spec.elements[0] as { strokes?: string; credit?: string };
    const pic = decodePicture(el.strokes!)!;
    expect(pic).toMatchObject({ href: "data:image/png;base64,COLOUR", linked: false });
    expect(pic.aspect).toBeCloseTo(1041 / 1920, 2);
    expect(dims).toEqual([2400]);
    expect(el.credit).toBe("Sikt");
  });
  test("without look: the styled small photo, as for Commons", async () => {
    const dims: number[] = [];
    const spec = { elements: [{ id: "p", type: "image", url: "https://example.org/pic.jpg" }] };
    await resolveImages(spec as never, { ...base, loadRaster: async (_u: string, d: number) => (dims.push(d), raster(240, 120)) } as never);
    expect(decodePicture((spec.elements[0] as unknown as { strokes: string }).strokes)!.href).toBe("data:image/jpeg;base64,GREY");
    expect(dims).toEqual([240]);
  });
  test("a host that refuses pixel reads: shown linked, at its natural aspect", async () => {
    const spec = { elements: [{ id: "md", type: "image", url: "https://microdata.no/shot.png", look: "screen" }] };
    const deps = { ...base, loadRaster: async () => { throw new Error("tainted canvas"); } };
    const [r] = await resolveImages(spec as never, deps as never);
    expect(r.ok).toBe(true);
    const pic = decodePicture((spec.elements[0] as unknown as { strokes: string }).strokes)!;
    expect(pic).toMatchObject({ href: "https://microdata.no/shot.png", linked: true });
    expect(pic.aspect).toBeCloseTo(1041 / 1920, 2);
  });
  test("both load and measure failing: an error result, not a throw", async () => {
    const spec = { elements: [{ id: "x", type: "image", url: "https://gone.example/a.png" }] };
    const deps = { ...base, loadRaster: async () => { throw new Error("no"); }, measure: async () => { throw new Error("dead"); } };
    const [r] = await resolveImages(spec as never, deps as never);
    expect(r.ok).toBe(false);
  });
  test("a linked picture counts as not embedded", () => {
    const playlist = { entries: [{ kind: "item", spec: { elements: [{ id: "md", type: "image", url: "https://x.org/a.png", strokes: "lnk1:AA:https://x.org/a.png" }] } }] };
    expect(unembeddedImages(playlist as never)).toBe(1);
  });
});
