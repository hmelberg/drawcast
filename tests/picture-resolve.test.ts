import { describe, expect, test } from "vitest";
import { resolveImages, SCREEN_URI_BUDGET } from "../src/render/image";
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
  test("a linked outcome is not cached: a later resolve with a working read embeds", async () => {
    const url = "https://retry.example/shot.png";
    const first = { elements: [{ id: "a", type: "image", url, look: "screen" }] };
    await resolveImages(first as never, { ...base, loadRaster: async () => { throw new Error("blip"); } } as never);
    expect(decodePicture((first.elements[0] as unknown as { strokes: string }).strokes)!.linked).toBe(true);
    const second = { elements: [{ id: "a", type: "image", url, look: "screen" }] };
    await resolveImages(second as never, { ...base, loadRaster: async () => raster(1920, 1041) } as never);
    expect(decodePicture((second.elements[0] as unknown as { strokes: string }).strokes)).toMatchObject({ linked: false, href: "data:image/png;base64,COLOUR" });
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

describe("an embedded screen picture fits the asset budget (final fix C1)", () => {
  const big = "x".repeat(SCREEN_URI_BUDGET + 1);
  test("PNG over budget: JPEG q=0.9 at full size when that fits", async () => {
    const calls: string[] = [];
    const spec = { elements: [{ id: "md", type: "image", url: "https://budget.example/a.png", look: "screen" }] };
    const deps = {
      ...base,
      loadRaster: async (_u: string, d: number) => raster(d, Math.round(d * 0.54)),
      encodeScreen: (r: { width: number }, o?: { type?: string; quality?: number }) => {
        calls.push(`${o?.type ?? "png"}@${r.width}`);
        return o?.type === "jpeg" ? `data:image/jpeg;base64,J${r.width}` : `data:image/png;base64,${big}`;
      },
    };
    await resolveImages(spec as never, deps as never);
    expect(calls).toEqual(["png@2400", "jpeg@2400"]);
    expect(decodePicture((spec.elements[0] as unknown as { strokes: string }).strokes)).toMatchObject({ linked: false, href: "data:image/jpeg;base64,J2400" });
  });
  test("JPEG over budget: the raster shrinks by x0.8 until it fits", async () => {
    const dims: number[] = [];
    const spec = { elements: [{ id: "md", type: "image", url: "https://budget.example/b.png", look: "screen" }] };
    const deps = {
      ...base,
      loadRaster: async (_u: string, d: number) => (dims.push(d), raster(d, Math.round(d * 0.54))),
      encodeScreen: (r: { width: number }, o?: { type?: string; quality?: number }) =>
        o?.type === "jpeg" && o.quality === 0.9 && r.width <= 1536 ? `data:image/jpeg;base64,J${r.width}` : `data:image/png;base64,${big}`,
    };
    await resolveImages(spec as never, deps as never);
    expect(dims).toEqual([2400, 1920, 1536]);
    expect(decodePicture((spec.elements[0] as unknown as { strokes: string }).strokes)).toMatchObject({ linked: false, href: "data:image/jpeg;base64,J1536" });
  });
  test("always over budget: kept linked (lnk1), never below the 1200 px floor", async () => {
    const dims: number[] = [];
    const url = "https://budget.example/c.png";
    const spec = { elements: [{ id: "md", type: "image", url, look: "screen" }] };
    const deps = { ...base, loadRaster: async (_u: string, d: number) => (dims.push(d), raster(d, Math.round(d * 0.54))), encodeScreen: () => `data:image/png;base64,${big}` };
    const [r] = await resolveImages(spec as never, deps as never);
    expect(r.ok).toBe(true);
    expect(Math.min(...dims)).toBeGreaterThanOrEqual(1200);
    const pic = decodePicture((spec.elements[0] as unknown as { strokes: string }).strokes)!;
    expect(pic).toMatchObject({ linked: true, href: url });
    expect(pic.aspect).toBeCloseTo(0.54, 2);
  });
});
