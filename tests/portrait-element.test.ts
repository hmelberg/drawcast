// The portrait ELEMENT: schema validation, tier-2 rendering (traced strokes
// vs the sketched placeholder), and the resolver's pure helpers. The codec
// and tracer have their own suite (tests/portrait-trace.test.ts).

import { describe, expect, test } from "vitest";
import { validateSpec } from "../src/spec/schema";
import { layoutSpec } from "../src/layout/layout";
import { flattenDrawables } from "../src/layout/model";
import { encodeTrace } from "../src/spec/trace";
import { portraitCacheKey, thumbFromSummary, wikiSummaryUrl, TRACE_VERSION } from "../src/render/portrait";
import type { Spec } from "../src/spec/types";

const TRACE = encodeTrace({
  aspect: 1.25,
  shapes: [
    { kind: "fill", pts: [[0.2, 0.2], [0.8, 0.2], [0.8, 1.0], [0.2, 1.0]] },
    { kind: "line", pts: [[0.35, 0.7], [0.4, 0.75], [0.45, 0.7]] },
    { kind: "paper", pts: [[0.55, 0.7], [0.6, 0.75], [0.65, 0.7]] },
  ],
});

const spec = (el: object): Spec =>
  ({ elements: [{ id: "p1", type: "portrait", x: 200, y: 500, width: 160, ...el }], commands: [] }) as unknown as Spec;

describe("portrait element", () => {
  test("validates with a name, a url, or embedded strokes — but not empty", () => {
    expect(validateSpec(spec({ of: "A. W. Phillips" })).ok).toBe(true);
    expect(validateSpec(spec({ url: "https://example.org/x.jpg" })).ok).toBe(true);
    expect(validateSpec(spec({ strokes: TRACE })).ok).toBe(true);
    expect(validateSpec(spec({})).ok).toBe(false);
  });

  test("embedded shapes render scaled at the position: fill+outline, line stroke, paper hole — in paint order", () => {
    const res = layoutSpec(spec({ strokes: TRACE }));
    const flat = flattenDrawables(res.drawables);
    const ids = flat.map((d) => d.id);
    expect(ids.some((id) => id.startsWith("p1__f"))).toBe(true); // the ink fill (and the paper hole)
    expect(ids.some((id) => id.startsWith("p1__o"))).toBe(true); // its outline
    expect(ids.some((id) => id.startsWith("p1__s"))).toBe(true); // the line stroke
    // The paper hole paints AFTER the ink fill.
    const fills = flat.filter((d) => d.id.startsWith("p1__f")) as { style: { fill?: string } }[];
    expect(fills.length).toBe(2);
    expect(fills[0].style.fill).not.toBe(fills[1].style.fill);
    // Width 160, aspect 1.25 → everything inside the 160×200 box around (200, 500).
    for (const d of flat.filter((x) => x.id.startsWith("p1__"))) {
      if (!("pts" in d)) continue;
      for (const [x, y] of (d as { pts: [number, number][] }).pts) {
        expect(x).toBeGreaterThanOrEqual(200 - 80 - 1);
        expect(x).toBeLessThanOrEqual(200 + 80 + 1);
        expect(y).toBeGreaterThanOrEqual(500 - 100 - 1);
        expect(y).toBeLessThanOrEqual(500 + 100 + 1);
      }
    }
    expect(res.order).toContain("p1");
  });

  test("without strokes it degrades to a placeholder frame with initials", () => {
    const res = layoutSpec(spec({ of: "John Maynard Keynes" }));
    const flat = flattenDrawables(res.drawables);
    expect(flat.some((d) => d.id === "p1__frame")).toBe(true);
    const initials = flat.find((d) => d.id === "p1__initials") as { text: string };
    expect(initials.text).toBe("JMK");
  });

  test("corrupted strokes degrade to the placeholder instead of throwing", () => {
    const res = layoutSpec(spec({ of: "Ada Lovelace", strokes: "t1:garbage!!" }));
    const flat = flattenDrawables(res.drawables);
    expect(flat.some((d) => d.id === "p1__frame")).toBe(true);
    expect(res.warnings).toEqual([]);
  });
});

describe("portrait element — halftone dots", () => {
  test("dot shapes render as filled circles scaled with the element width", () => {
    const dotted = encodeTrace({
      aspect: 1,
      shapes: [
        { kind: "dot", pts: [[0.5, 0.5], [0.55, 0.5]] },
        { kind: "dot", pts: [[0.25, 0.25], [0.27, 0.25]] },
      ],
    });
    const res = layoutSpec(spec({ strokes: dotted }));
    const flat = flattenDrawables(res.drawables);
    const dots = flat.filter((d) => d.id.startsWith("p1__d")) as { shapeHint?: { type: string; r: number } }[];
    expect(dots.length).toBe(2);
    expect(dots[0].shapeHint?.type).toBe("circle");
    // r = 0.05 normalized × width 160 = 8 logical units.
    expect(dots[0].shapeHint?.r).toBeCloseTo(8, 0);
    expect(dots[1].shapeHint?.r).toBeCloseTo(3.2, 0);
  });
});

describe("portrait element — photo look", () => {
  test("an img1 string renders as a framed image drawable; junk degrades to the placeholder", async () => {
    const { encodePhoto } = await import("../src/spec/trace");
    const res = layoutSpec(spec({ strokes: encodePhoto(1.25, "data:image/jpeg;base64,AAAA") }));
    const flat = flattenDrawables(res.drawables);
    const img = flat.find((d) => d.id === "p1__img") as { kind: string; w: number; h: number; pos: [number, number] };
    expect(img?.kind).toBe("image");
    expect(img.w).toBe(160);
    expect(img.h).toBeCloseTo(200, 0);
    expect(img.pos).toEqual([200, 500]);
    expect(flat.some((d) => d.id === "p1__frame")).toBe(true);
    const junk = layoutSpec(spec({ of: "X Y", strokes: "img1:AA:not-a-data-uri" }));
    expect(flattenDrawables(junk.drawables).some((d) => d.id === "p1__initials")).toBe(true);
  });
});

describe("portrait resolver helpers", () => {
  test("wikiSummaryUrl encodes names the REST API way", () => {
    expect(wikiSummaryUrl("A. W. Phillips")).toBe("https://en.wikipedia.org/api/rest_v1/page/summary/A._W._Phillips");
  });

  test("cache keys: strokes need none; url and name key separately; version bumps invalidate", () => {
    expect(portraitCacheKey({ type: "portrait", strokes: TRACE })).toBeNull();
    expect(portraitCacheKey({ type: "portrait", of: "Keynes" })).toBe(`p${TRACE_VERSION}|photo|name|keynes`);
    expect(portraitCacheKey({ type: "portrait", url: "https://x/y.jpg" })).toBe(`p${TRACE_VERSION}|photo|url|https://x/y.jpg`);
    expect(portraitCacheKey({ type: "portrait", of: "Keynes", look: "line" })).toBe(`p${TRACE_VERSION}|line|name|keynes`);
    expect(portraitCacheKey({ type: "portrait", of: "Keynes", look: "halftone" })).toBe(`p${TRACE_VERSION}|halftone|name|keynes`);
    expect(portraitCacheKey({ type: "portrait" })).toBeNull();
  });

  test("thumbFromSummary prefers the thumbnail, falls back to the original, else null", () => {
    expect(thumbFromSummary({ thumbnail: { source: "t.jpg" }, originalimage: { source: "o.jpg" } })).toBe("t.jpg");
    expect(thumbFromSummary({ originalimage: { source: "o.jpg" } })).toBe("o.jpg");
    expect(thumbFromSummary({ extract: "no image" })).toBeNull();
    expect(thumbFromSummary(null)).toBeNull();
  });
});

describe("blob hoisting — strokes never visit the model", () => {
  test("hoist swaps strokes for the sentinel; restore puts them back by id", async () => {
    const { hoistPortraitStrokes, restorePortraitStrokes, HOISTED } = await import("../src/llm/hoist");
    const { parsePlaylistText, itemsOf } = await import("../src/playlist/playlist");
    const docText = JSON.stringify({
      elements: [
        { id: "p1", type: "portrait", of: "Darwin", strokes: TRACE },
        { id: "dot", type: "point", at: { x: 1, y: 1 } },
      ],
      commands: [],
    });
    const { text, blobs } = hoistPortraitStrokes(docText);
    expect(blobs.get("p1")).toBe(TRACE);
    expect(text).toContain(HOISTED);
    expect(text).not.toContain(TRACE);
    const revised = parsePlaylistText(text);
    restorePortraitStrokes(revised, blobs);
    const el = itemsOf(revised)[0].spec.elements!.find((e) => e.id === "p1")!;
    expect(el.strokes).toBe(TRACE);
  });

  test("a hoisted portrait the model dropped loses only its strokes; specs without portraits pass through untouched", async () => {
    const { hoistPortraitStrokes, restorePortraitStrokes, HOISTED } = await import("../src/llm/hoist");
    const { parsePlaylistText, itemsOf } = await import("../src/playlist/playlist");
    const plain = JSON.stringify({ elements: [{ id: "dot", type: "point", at: { x: 1, y: 1 } }], commands: [] });
    expect(hoistPortraitStrokes(plain).text).toBe(plain);
    // Model renamed the element: the sentinel has no blob — strokes drop, name survives.
    const revised = parsePlaylistText(JSON.stringify({ elements: [{ id: "renamed", type: "portrait", of: "Darwin", strokes: HOISTED }], commands: [] }));
    restorePortraitStrokes(revised, new Map([["p1", TRACE]]));
    expect(itemsOf(revised)[0].spec.elements![0].strokes).toBeUndefined();
  });

  test("stripStrokesForModel omits strokes and leaves everything else", async () => {
    const { stripStrokesForModel } = await import("../src/llm/hoist");
    const spec = {
      elements: [{ id: "p1", type: "portrait", of: "Darwin", strokes: TRACE, x: 100 }],
      commands: [],
    } as never;
    const out = stripStrokesForModel(spec) as { elements: { strokes?: string; of?: string; x?: number }[] };
    expect(out.elements[0].strokes).toBeUndefined();
    expect(out.elements[0].of).toBe("Darwin");
    expect(out.elements[0].x).toBe(100);
  });
});
