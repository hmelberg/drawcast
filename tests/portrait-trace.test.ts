// The portrait trace codec (spec/trace.ts) — the wire format shared by
// every shape kind (line/fill/wash/paper/dot) the DECODE/render path
// (src/layout/tier2.ts) still knows how to draw, plus the photo codec
// (img1:). Only look GENERATION (the tracer that turned a photo into
// poster/halftone/line shapes) was deleted — see docs/superpowers/plans/
// 2026-09-01-tidyup-publish-ledger.md.

import { describe, expect, test } from "vitest";
import { decodeTrace, encodeTrace, type PortraitTrace } from "../src/spec/trace";

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

describe("photo codec", () => {
  test("photo strings round-trip and reject non-image payloads", async () => {
    const { encodePhoto, decodePhoto } = await import("../src/spec/trace");
    const s = encodePhoto(1.3, "data:image/jpeg;base64,AAAA");
    expect(s.startsWith("img1:")).toBe(true);
    const back = decodePhoto(s)!;
    expect(back.aspect).toBeCloseTo(1.3, 2);
    expect(back.href).toBe("data:image/jpeg;base64,AAAA");
    expect(decodePhoto("img1:AA:https://evil.example/x.jpg")).toBeNull(); // data URIs only
    expect(decodePhoto("t2:AA:lAAAAAAAA")).toBeNull();
    expect(decodePhoto("img1:!!:data:image/png;base64,x")).toBeNull();
  });
});
