// W15: the estimate slider (spec/slider.ts) — an ask's `estimate` expands to a
// slider scale; the guess on it is a scale guess with its own look and marks.
import { describe, expect, test } from "vitest";
import { layoutSpec } from "../src/layout/layout";
import { expandSpec } from "../src/spec/expand";
import { validateSpec } from "../src/spec/schema";
import type { Spec } from "../src/spec/types";
import { scaleGeometry } from "../src/spec/scale";
import { COUNTER_SIZE, expandEstimates } from "../src/spec/slider";
import { guessParts, guessSetup, nudge } from "../src/guess/handles";
import { besideMarks, besideOffsets, besideValues } from "../src/guess/reveal";
import { guessMarks } from "../src/guess/marks";

const ask = { question: "How many bones does an adult have?", estimate: { min: 0, max: 500, value: 206, unit: "bones" }, store: "g", right: "Yes: {g.true}.", wrong: "You said {g}; it is {g.true}." };
const spec = { title: "Bones", commands: [{ card: { title: "Bones" } }, { ask }] } as unknown as Spec;

function setup() {
  const s = expandSpec(spec);
  const layout = layoutSpec(s);
  const parts = guessParts(s, "estimate_1");
  return { s, setup: guessSetup(s, s.params ?? {}, layout, parts) };
}

describe("ask.estimate", () => {
  test("expands to a slider scale and a guess on it that waits for Done", () => {
    const s = expandEstimates(spec);
    expect(s.elements?.[0]).toMatchObject({ id: "estimate_1", type: "scale", slider: true, min: 0, max: 500, value: 206, unit: "bones" });
    const a = s.commands![1].ask!;
    expect(a.on).toBe("estimate_1");
    expect(a.release).toBe(false);
    expect(a.estimate).toBeUndefined();
    expect(expandEstimates(s)).toBe(s);
  });

  test("validates as a guess; on beside it, or a value outside the range, is an error", () => {
    expect(validateSpec(spec).errors).toEqual([]);
    const both = { ...spec, commands: [{ ask: { ...ask, on: "x" } }] } as unknown as Spec;
    expect(validateSpec(both).errors.join(" ")).toMatch(/leave out on/);
    const out = { ...spec, commands: [{ ask: { ...ask, estimate: { min: 0, max: 100, value: 206 } } }] } as unknown as Spec;
    expect(validateSpec(out).errors.join(" ")).toMatch(/between min and max/);
    const extra = { ...spec, commands: [{ ask: { ...ask, estimate: { min: 0, max: 500, value: 206, colour: "red" } } }] } as unknown as Spec;
    expect(validateSpec(extra).ok).toBe(false);
  });

  test("draws a track, a thumb and a big counter written like the scale", () => {
    const { s } = setup();
    const els = new Map((s.elements ?? []).map((e) => [e.id, e]));
    expect(els.get("estimate_1_line")?.closed).toBe(true);
    const num = els.get("estimate_1_answer_num")!;
    expect(num.text).toBe("206 bones");
    expect(num.font_size).toBe(COUNTER_SIZE);
    // The counter stands over the track; the tick numbers under it.
    const g = scaleGeometry({ id: "estimate_1", type: "scale", min: 0, max: 500, value: 206, x: (els.get("estimate_1")!.x as number), y: (els.get("estimate_1")!.y as number), width: (els.get("estimate_1")!.width as number) });
    expect(num.y as number).toBeGreaterThan(g.y + 100);
    expect(els.get("estimate_1_tick_1_num")!.y as number).toBeLessThan(g.y);
  });

  test("a log slider writes words, a timeline BC", () => {
    const big = expandSpec({ commands: [{ ask: { question: "?", estimate: { min: 1, max: 1e12, value: 8e9, log: true, unit: "people" } } }] } as unknown as Spec);
    expect(big.elements?.find((e) => e.id === "estimate_1_answer_num")?.text).toBe("8 billion people");
    const bc = expandSpec({ commands: [{ ask: { question: "?", estimate: { min: -3000, max: 2000, value: -2560 } } }] } as unknown as Spec);
    expect(bc.elements?.find((e) => e.id === "estimate_1_answer_num")?.text).toBe("2560 BC");
  });

  test("the guess shows the track too, and the arrow keys fine-tune", () => {
    const { setup: st } = setup();
    expect(st.handles).toHaveLength(1);
    const h = st.handles[0];
    expect(h.shows).toEqual(["estimate_1", "estimate_1_answer"]);
    expect(h.truth).toEqual([206]);
    expect(nudge(h, [200], 0, 1)[0]).toBe(201);
    expect(nudge(h, [200], 0, 1, true)[0]).toBe(210);
  });

  test("the reveal: the counter runs to the truth, yours stays faded, the gap bracketed", () => {
    const { setup: st } = setup();
    const hs = st.handles;
    expect(besideValues(hs, [[150]], [0])[0][0]).toBeCloseTo(150);
    expect(besideValues(hs, [[150]], [0.5])[0][0]).toBeCloseTo(178);
    expect(besideValues(hs, [[150]], [1])[0][0]).toBeCloseTo(206);
    // No pin drop on a slider.
    expect(besideOffsets(hs, [0.2])).toEqual({});
    const m = besideMarks(hs, [[150]], [1], 0.35);
    expect(m.texts.map((t) => t.text)).toEqual(expect.arrayContaining(["150 bones", "+56 bones"]));
    expect(m.lines.some((l) => l.fill !== undefined)).toBe(true);
    // Morph: a dashed ghost of your thumb.
    expect(guessMarks(hs, [[150]], 1).lines.some((l) => l.dashed)).toBe(true);
  });
});
