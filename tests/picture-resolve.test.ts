import { describe, expect, test } from "vitest";
import { resolveImages, SCREEN_URI_BUDGET } from "../src/render/image";
import { decodePicture } from "../src/spec/trace";
import { embedStatus, linkedPictures, unembeddedImages } from "../src/ui/insert";

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

describe("a hoisted linked picture (final fix minors)", () => {
  const lnk = "lnk1:AA:https://hoist.example/a.png";
  test("still counts as unembedded, and as linked", () => {
    const playlist = { entries: [{ kind: "item", spec: { assets: { shot: lnk }, elements: [{ id: "md", type: "image", url: "https://hoist.example/a.png", strokes: "@shot" }] } }] };
    expect(unembeddedImages(playlist as never)).toBe(1);
    expect(linkedPictures(playlist as never)).toBe(1);
  });
  test("still retries: a working read embeds it", async () => {
    const spec = { assets: { shot: lnk }, elements: [{ id: "md", type: "image", url: "https://hoist.example/a.png", look: "screen", strokes: "@shot" }] };
    const [r] = await resolveImages(spec as never, { ...base, loadRaster: async () => raster(1920, 1041) } as never);
    expect(r.ok).toBe(true);
    expect(decodePicture((spec.elements[0] as unknown as { strokes: string }).strokes)).toMatchObject({ linked: false, href: "data:image/png;base64,COLOUR" });
  });
  test("the Embed message says when pictures stay linked", () => {
    expect(embedStatus([], 3, 0)).toEqual({ text: "Embedded — the spec is now fully self-contained.", kind: "ok" });
    expect(embedStatus([], 2, 1)).toEqual({ text: "Embedded 2; 1 picture stays linked — its host refuses pixel reads.", kind: "ok" });
    expect(embedStatus([], 1, 2).text).toBe("Embedded 1; 2 pictures stay linked — their host refuses pixel reads.");
    expect(embedStatus([{ error: "boom" }], 1, 0)).toEqual({ text: "Embedded with 1 failure: boom", kind: "error" });
  });
});

describe("a CORS-refusing picture goes through the picture proxy before it is linked", () => {
  const endpoints = ["/.netlify/functions/picture", "https://www.drawcast.app/.netlify/functions/picture"];
  test("the direct read fails, the proxied one succeeds: embedded, source stays the original url, credit kept", async () => {
    const url = "https://cors-refusing.example/shot.png?x=1&y=2";
    const tried: string[] = [];
    const spec = { elements: [{ id: "md", type: "image", url, look: "screen", credit: "Sikt" }] };
    const deps = {
      ...base,
      pictureEndpoints: endpoints,
      loadRaster: async (u: string) => {
        tried.push(u);
        if (u === url) throw new Error("tainted canvas");
        return raster(1920, 1041);
      },
    };
    const [r] = await resolveImages(spec as never, deps as never);
    expect(r.ok).toBe(true);
    expect(tried).toEqual([url, `/.netlify/functions/picture?url=${encodeURIComponent(url)}`]);
    const el = spec.elements[0] as { strokes?: string; source?: string; credit?: string };
    expect(el.strokes!.startsWith("img1:")).toBe(true);
    expect(decodePicture(el.strokes!)).toMatchObject({ linked: false, href: "data:image/png;base64,COLOUR" });
    expect(el.source).toBe(url);
    expect(el.credit).toBe("Sikt");
  });
  test("the first endpoint failing falls through to the next (a photo look)", async () => {
    const url = "https://cors-refusing.example/p.jpg";
    const tried: string[] = [];
    const spec = { elements: [{ id: "p", type: "image", url }] };
    const deps = {
      ...base,
      pictureEndpoints: endpoints,
      loadRaster: async (u: string) => {
        tried.push(u);
        if (!u.startsWith("https://www.drawcast.app/")) throw new Error("no");
        return raster(240, 120);
      },
    };
    await resolveImages(spec as never, deps as never);
    expect(tried).toEqual([url, `/.netlify/functions/picture?url=${encodeURIComponent(url)}`, `https://www.drawcast.app/.netlify/functions/picture?url=${encodeURIComponent(url)}`]);
    const el = spec.elements[0] as unknown as { strokes: string; source: string };
    expect(decodePicture(el.strokes)).toMatchObject({ linked: false, href: "data:image/jpeg;base64,GREY" });
    expect(el.source).toBe(url);
  });
  test("every endpoint failing: linked (lnk1) as before", async () => {
    const url = "https://cors-refusing.example/gone.png";
    const tried: string[] = [];
    const spec = { elements: [{ id: "md", type: "image", url, look: "screen" }] };
    const deps = { ...base, pictureEndpoints: endpoints, loadRaster: async (u: string) => { tried.push(u); throw new Error("no"); } };
    const [r] = await resolveImages(spec as never, deps as never);
    expect(r.ok).toBe(true);
    expect(tried.length).toBe(3);
    const el = spec.elements[0] as unknown as { strokes: string; source: string };
    expect(el.strokes.startsWith("lnk1:")).toBe(true);
    expect(decodePicture(el.strokes)).toMatchObject({ linked: true, href: url });
    expect(el.source).toBe(url);
  });
  test("an http url that fails the direct read never touches the endpoints: straight to measure and lnk1", async () => {
    const url = "http://plain.example/a.png";
    const tried: string[] = [];
    let measured = 0;
    const spec = { elements: [{ id: "md", type: "image", url, look: "screen" }] };
    const deps = { ...base, pictureEndpoints: endpoints, measure: async () => (measured++, { width: 100, height: 50 }), loadRaster: async (u: string) => { tried.push(u); throw new Error("no"); } };
    await resolveImages(spec as never, deps as never);
    expect(tried).toEqual([url]);
    expect(measured).toBe(1);
    expect((spec.elements[0] as unknown as { strokes: string }).strokes.startsWith("lnk1:")).toBe(true);
  });
  test("a screen picture too big to embed even when read directly is linked, not retried through the proxy", async () => {
    const url = "https://huge.example/a.png";
    const tried = new Set<string>();
    const spec = { elements: [{ id: "md", type: "image", url, look: "screen" }] };
    const big = "x".repeat(SCREEN_URI_BUDGET + 1);
    const deps = { ...base, pictureEndpoints: endpoints, loadRaster: async (u: string, d: number) => (tried.add(u), raster(d, d)), encodeScreen: () => `data:image/png;base64,${big}` };
    await resolveImages(spec as never, deps as never);
    expect([...tried]).toEqual([url]);
    expect((spec.elements[0] as unknown as { strokes: string }).strokes.startsWith("lnk1:")).toBe(true);
  });
});
