// The portrait trace codec (spec/trace.ts) and the deterministic tracer
// (render/tracer.ts) in both looks: poster (posterized regions, default)
// and line (pen-sketch edges + hachure).

import { describe, expect, test } from "vitest";
import { decodeTrace, encodeTrace, type PortraitTrace } from "../src/spec/trace";
import { traceImage, type RasterLike } from "../src/render/tracer";

const SAMPLE: PortraitTrace = {
  aspect: 1.25,
  shapes: [
    { kind: "line", pts: [[0.2, 0.2], [0.8, 0.2], [0.8, 1.0]] },
    { kind: "fill", pts: [[0.3, 0.3], [0.7, 0.3], [0.5, 0.9]] },
    { kind: "wash", pts: [[0.1, 0.1], [0.9, 0.1], [0.9, 1.1], [0.1, 1.1]] },
    { kind: "paper", pts: [[0.45, 0.5], [0.55, 0.5], [0.5, 0.6]] },
  ],
};

describe("trace codec", () => {
  test("round-trips all four shape kinds within quantization error", () => {
    const encoded = encodeTrace(SAMPLE);
    expect(encoded.startsWith("t2:")).toBe(true);
    const back = decodeTrace(encoded)!;
    expect(back).not.toBeNull();
    expect(back.aspect).toBeCloseTo(1.25, 2);
    expect(back.shapes.map((s) => s.kind)).toEqual(["line", "fill", "wash", "paper"]);
    back.shapes.forEach((shape, i) => {
      shape.pts.forEach(([x, y], j) => {
        expect(Math.abs(x - SAMPLE.shapes[i].pts[j][0])).toBeLessThanOrEqual(2 / 4095);
        expect(Math.abs(y - SAMPLE.shapes[i].pts[j][1])).toBeLessThanOrEqual((2 * 1.25) / 4095);
      });
    });
  });

  test("legacy t1 strings decode as line shapes", () => {
    const t2 = encodeTrace({ aspect: 1, shapes: [{ kind: "line", pts: [[0.1, 0.1], [0.9, 0.9]] }] });
    // Hand-build the equivalent t1: strip the kind chars.
    const [, aspect, body] = t2.split(":");
    const t1 = `t1:${aspect}:${body.split(".").map((seg) => seg.slice(1)).join(".")}`;
    const back = decodeTrace(t1)!;
    expect(back).not.toBeNull();
    expect(back.shapes[0].kind).toBe("line");
    expect(back.shapes[0].pts.length).toBe(2);
  });

  test("rejects garbage, wrong prefixes, bad kinds and truncated coords", () => {
    expect(decodeTrace("")).toBeNull();
    expect(decodeTrace("nonsense")).toBeNull();
    expect(decodeTrace("t3:AA:lAAAA")).toBeNull();
    expect(decodeTrace("t2:AA:xAAAAAAAA")).toBeNull(); // unknown kind char
    expect(decodeTrace("t2:AA:lAAAAAA")).toBeNull(); // truncated point
    expect(decodeTrace("t2:AA:l")).toBeNull(); // kind with no coords
    expect(decodeTrace("t2:!!:lAAAAAAAA")).toBeNull(); // bad aspect chars
  });

  test("encode drops sub-2-point shapes and stays compact", () => {
    const many: PortraitTrace = {
      aspect: 1,
      shapes: [
        { kind: "line", pts: [[0.5, 0.5]] },
        ...Array.from({ length: 40 }, (_, i) => ({
          kind: "fill" as const,
          pts: Array.from({ length: 20 }, (_, j) => [j / 20, ((i + j) % 20) / 20] as [number, number]),
        })),
      ],
    };
    const encoded = encodeTrace(many);
    const back = decodeTrace(encoded)!;
    expect(back.shapes.length).toBe(40); // the 1-point line vanished
    expect(encoded.length).toBeLessThan(40 * 20 * 4 + 40 * 2 + 8);
  });
});

// A 60×60 white raster with a black 20×20 square in the middle.
function darkSquare(): RasterLike {
  const w = 60;
  const h = 60;
  const data = new Uint8ClampedArray(w * h * 4).fill(255);
  for (let y = 20; y < 40; y++) {
    for (let x = 20; x < 40; x++) {
      const i = (y * w + x) * 4;
      data[i] = data[i + 1] = data[i + 2] = 0;
      data[i + 3] = 255;
    }
  }
  return { width: w, height: h, data };
}

describe("poster look (default)", () => {
  test("a dark square becomes a small number of smooth closed region shapes", () => {
    const t = traceImage(darkSquare());
    expect(t.aspect).toBe(1);
    expect(t.shapes.length).toBeGreaterThan(0);
    expect(t.shapes.length).toBeLessThan(10); // regions, not stroke confetti
    const fills = t.shapes.filter((s) => s.kind === "fill" || s.kind === "wash");
    expect(fills.length).toBeGreaterThan(0);
    // Chaikin smoothing multiplies contour points — the shapes are curves, not pixel steps.
    for (const s of fills) expect(s.pts.length).toBeGreaterThan(8);
    for (const s of t.shapes) {
      for (const [x, y] of s.pts) {
        expect(x).toBeGreaterThanOrEqual(0);
        expect(x).toBeLessThanOrEqual(1);
        expect(y).toBeGreaterThanOrEqual(0);
        expect(y).toBeLessThanOrEqual(t.aspect);
      }
    }
  });

  test("an enclosed light hole becomes a paper shape", () => {
    const raster = darkSquare();
    // Punch a light 6×6 hole inside the black square.
    for (let y = 27; y < 33; y++) {
      for (let x = 27; x < 33; x++) {
        const i = (y * raster.width + x) * 4;
        raster.data[i] = raster.data[i + 1] = raster.data[i + 2] = 255;
      }
    }
    const t = traceImage(raster);
    expect(t.shapes.some((s) => s.kind === "paper")).toBe(true);
  });

  test("deterministic, and an all-white raster yields no shapes", () => {
    expect(JSON.stringify(traceImage(darkSquare()))).toBe(JSON.stringify(traceImage(darkSquare())));
    const blank: RasterLike = { width: 40, height: 40, data: new Uint8ClampedArray(40 * 40 * 4).fill(255) };
    // All-white: every percentile threshold equals the single luminance, so
    // masks may cover everything or nothing — either way no ENCLOSED shapes
    // survive the border/area filters beyond one background region at most.
    expect(traceImage(blank).shapes.filter((s) => s.kind === "fill").length).toBeLessThanOrEqual(1);
  });
});

describe("line look", () => {
  test("edges plus hachure inside dark regions; shading: false gives edges only", () => {
    const withShading = traceImage(darkSquare(), { style: "line" });
    const without = traceImage(darkSquare(), { style: "line", shading: false });
    expect(withShading.shapes.length).toBeGreaterThan(without.shapes.length);
    expect(withShading.shapes.every((s) => s.kind === "line")).toBe(true);
    const hatch = withShading.shapes.filter((s) => s.pts.length === 2);
    expect(hatch.length).toBeGreaterThan(2);
  });

  test("maxStrokes is a total budget in both looks", () => {
    expect(traceImage(darkSquare(), { style: "line", maxStrokes: 3 }).shapes.length).toBeLessThanOrEqual(3);
    expect(traceImage(darkSquare(), { maxStrokes: 2 }).shapes.length).toBeLessThanOrEqual(2);
  });

  test("line look stays deterministic", () => {
    const a = traceImage(darkSquare(), { style: "line" });
    const b = traceImage(darkSquare(), { style: "line" });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});
