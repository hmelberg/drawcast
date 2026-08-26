// The portrait foundations: the compact trace codec (src/spec/trace.ts) and
// the deterministic image→strokes tracer (src/render/tracer.ts). The tracer
// takes an ImageData-shaped RasterLike, so everything here runs on plain
// byte arrays — no DOM canvas, no browser.

import { describe, expect, test } from "vitest";
import { decodeTrace, encodeTrace, type PortraitTrace } from "../src/spec/trace";
import { traceImage, type RasterLike } from "../src/render/tracer";

/** A w×h raster filled with one gray level (opaque). */
function flatRaster(w: number, h: number, level: number): RasterLike {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    data[i * 4] = level;
    data[i * 4 + 1] = level;
    data[i * 4 + 2] = level;
    data[i * 4 + 3] = 255;
  }
  return { width: w, height: h, data };
}

/** Paint a filled size×size square at (x0, y0) with one gray level. */
function fillSquare(img: RasterLike, x0: number, y0: number, size: number, level: number): void {
  for (let y = y0; y < y0 + size; y++) {
    for (let x = x0; x < x0 + size; x++) {
      const o = (y * img.width + x) * 4;
      img.data[o] = level;
      img.data[o + 1] = level;
      img.data[o + 2] = level;
      img.data[o + 3] = 255;
    }
  }
}

describe("trace codec", () => {
  test("round-trips a hand-made trace within quantization error", () => {
    const t: PortraitTrace = {
      aspect: 1.25,
      strokes: [
        [[0, 0], [0.5, 0.625], [1, 1.25]],
        [[0.25, 0.1], [0.75, 1.2], [0.1, 0.3]],
      ],
    };
    const s = encodeTrace(t);
    expect(s.startsWith("t1:")).toBe(true);
    const back = decodeTrace(s);
    expect(back).not.toBeNull();
    expect(back!.aspect).toBeCloseTo(1.25, 6);
    expect(back!.strokes.length).toBe(t.strokes.length);
    const xTol = 2 / 4095;
    const yTol = (2 * t.aspect) / 4095;
    for (let i = 0; i < t.strokes.length; i++) {
      expect(back!.strokes[i].length).toBe(t.strokes[i].length);
      for (let j = 0; j < t.strokes[i].length; j++) {
        expect(Math.abs(back!.strokes[i][j][0] - t.strokes[i][j][0])).toBeLessThanOrEqual(xTol);
        expect(Math.abs(back!.strokes[i][j][1] - t.strokes[i][j][1])).toBeLessThanOrEqual(yTol);
      }
    }
  });

  test("rejects malformed input with null", () => {
    expect(decodeTrace("")).toBeNull();
    expect(decodeTrace("garbage")).toBeNull();
    expect(decodeTrace("t1:")).toBeNull();
    // Wrong prefix, valid-looking tail.
    expect(decodeTrace("x1:AA:AAAAAAAA")).toBeNull();
    // Bad char inside a stroke.
    expect(decodeTrace("t1:AA:AAA!AAAA")).toBeNull();
    // Truncated: chop one char off a real encoding (stroke length % 4 !== 0).
    const s = encodeTrace({ aspect: 1, strokes: [[[0, 0], [0.5, 0.5], [1, 1]]] });
    expect(decodeTrace(s.slice(0, s.length - 1))).toBeNull();
  });

  test("encodes 100 strokes of 20 points in under 9000 chars", () => {
    const strokes: [number, number][][] = [];
    for (let i = 0; i < 100; i++) {
      const stroke: [number, number][] = [];
      for (let j = 0; j < 20; j++) stroke.push([j / 19, (i / 99) * 1.25]);
      strokes.push(stroke);
    }
    const s = encodeTrace({ aspect: 1.25, strokes });
    expect(s.length).toBeLessThan(9000);
  });
});

describe("traceImage", () => {
  /** 60×60 white raster with a black 20×20 square in the middle. */
  function squareRaster(): RasterLike {
    const img = flatRaster(60, 60, 255);
    fillSquare(img, 20, 20, 20, 0);
    return img;
  }

  test("finds strokes around a black square, all in range", () => {
    const res = traceImage(squareRaster());
    expect(res.aspect).toBe(1);
    expect(res.strokes.length).toBeGreaterThan(0);
    for (const stroke of res.strokes) {
      expect(stroke.length).toBeGreaterThanOrEqual(2);
      for (const [x, y] of stroke) {
        expect(x).toBeGreaterThanOrEqual(0);
        expect(x).toBeLessThanOrEqual(1);
        expect(y).toBeGreaterThanOrEqual(0);
        expect(y).toBeLessThanOrEqual(res.aspect);
      }
    }
  });

  test("is deterministic across calls", () => {
    const a = traceImage(squareRaster());
    const b = traceImage(squareRaster());
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  test("respects maxStrokes", () => {
    const res = traceImage(squareRaster(), { maxStrokes: 3 });
    expect(res.strokes.length).toBeLessThanOrEqual(3);
    expect(res.strokes.length).toBeGreaterThan(0);
  });

  test("returns zero strokes for an all-white raster", () => {
    const res = traceImage(flatRaster(50, 40, 255));
    expect(res.aspect).toBeCloseTo(40 / 50, 10);
    expect(res.strokes).toEqual([]);
  });
});

describe("hachure shading (trace v2)", () => {
  const darkSquare = () => {
    const w = 60, h = 60;
    const data = new Uint8ClampedArray(w * h * 4).fill(255);
    for (let y = 20; y < 40; y++) {
      for (let x = 20; x < 40; x++) {
        const i = (y * w + x) * 4;
        data[i] = data[i + 1] = data[i + 2] = 0;
        data[i + 3] = 255;
      }
    }
    return { width: w, height: h, data };
  };

  test("dark regions gain hatch strokes; shading: false gives edges only", async () => {
    const { traceImage } = await import("../src/render/tracer");
    const withShading = traceImage(darkSquare());
    const without = traceImage(darkSquare(), { shading: false });
    expect(withShading.strokes.length).toBeGreaterThan(without.strokes.length);
    // Hatch strokes (2-point diagonals) sit INSIDE the dark square region.
    const hatch = withShading.strokes.filter((st) => st.length === 2);
    expect(hatch.length).toBeGreaterThan(2);
    for (const [a, b] of hatch) {
      for (const [x] of [a, b]) {
        expect(x).toBeGreaterThan(0.25);
        expect(x).toBeLessThan(0.72);
      }
    }
  });

  test("maxStrokes is a TOTAL budget: edges keep priority, hatch fills the rest", async () => {
    const { traceImage } = await import("../src/render/tracer");
    const t = traceImage(darkSquare(), { maxStrokes: 6 });
    expect(t.strokes.length).toBeLessThanOrEqual(6);
    const capped = traceImage(darkSquare(), { maxStrokes: 2 });
    expect(capped.strokes.length).toBeLessThanOrEqual(2);
  });

  test("shading stays deterministic", async () => {
    const { traceImage } = await import("../src/render/tracer");
    expect(JSON.stringify(traceImage(darkSquare()))).toBe(JSON.stringify(traceImage(darkSquare())));
  });
});
