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
  strokes: [
    [[0.2, 0.2], [0.8, 0.2], [0.8, 1.0], [0.2, 1.0], [0.2, 0.2]],
    [[0.35, 0.7], [0.4, 0.75], [0.45, 0.7]],
    [[0.55, 0.7], [0.6, 0.75], [0.65, 0.7]],
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

  test("embedded strokes render as a group of scaled polylines at the given position", () => {
    const res = layoutSpec(spec({ strokes: TRACE }));
    const flat = flattenDrawables(res.drawables);
    const strokes = flat.filter((d) => d.id.startsWith("p1__s"));
    expect(strokes.length).toBe(3);
    // Width 160, aspect 1.25 → all points inside the 160×200 box around (200, 500).
    for (const d of strokes) {
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

describe("portrait resolver helpers", () => {
  test("wikiSummaryUrl encodes names the REST API way", () => {
    expect(wikiSummaryUrl("A. W. Phillips")).toBe("https://en.wikipedia.org/api/rest_v1/page/summary/A._W._Phillips");
  });

  test("cache keys: strokes need none; url and name key separately; version bumps invalidate", () => {
    expect(portraitCacheKey({ type: "portrait", strokes: TRACE })).toBeNull();
    expect(portraitCacheKey({ type: "portrait", of: "Keynes" })).toBe(`p${TRACE_VERSION}|name|keynes`);
    expect(portraitCacheKey({ type: "portrait", url: "https://x/y.jpg" })).toBe(`p${TRACE_VERSION}|url|https://x/y.jpg`);
    expect(portraitCacheKey({ type: "portrait" })).toBeNull();
  });

  test("thumbFromSummary prefers the thumbnail, falls back to the original, else null", () => {
    expect(thumbFromSummary({ thumbnail: { source: "t.jpg" }, originalimage: { source: "o.jpg" } })).toBe("t.jpg");
    expect(thumbFromSummary({ originalimage: { source: "o.jpg" } })).toBe("o.jpg");
    expect(thumbFromSummary({ extract: "no image" })).toBeNull();
    expect(thumbFromSummary(null)).toBeNull();
  });
});
