// The music engine (design 2026-09-24-music-notation-and-staff §4): SMuFL
// glyphs from Petaluma, lazy-loaded, and notes whose stems start exactly
// where the font says they meet the head — the join Hans found imperfect in
// the hand-built note-value example.

import { beforeAll, describe, expect, test } from "vitest";
import { ensureEngines, enginesForSpec, getLoadedEngines, KNOWN_ENGINES, type MusicEngine } from "../src/scenes/engines";
import { layoutSpec, elementBBoxes } from "../src/layout/layout";
import { validateSpec } from "../src/spec/schema";
import { MUSIC_SYMBOLS } from "../src/spec/types";
import { symbolPlan } from "../src/scenes/music/symbols";
import type { Spec } from "../src/spec/types";

type Pt = [number, number];
const dist = (a: Pt, b: Pt) => Math.hypot(a[0] - b[0], a[1] - b[1]);
/** Shortest distance from p to a closed polyline. */
function toRing(p: Pt, ring: Pt[]): number {
  let best = Infinity;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length];
    const [dx, dy] = [b[0] - a[0], b[1] - a[1]];
    const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy || 1)));
    best = Math.min(best, dist(p, [a[0] + t * dx, a[1] + t * dy]));
  }
  return best;
}

let music: MusicEngine;
beforeAll(async () => {
  await ensureEngines(["music"]);
  music = getLoadedEngines(["music"]).music as MusicEngine;
});

describe("the engine", () => {
  test("is a known engine, and a spec with a music element asks for it", () => {
    expect(KNOWN_ENGINES).toContain("music");
    expect(enginesForSpec({ elements: [{ id: "q", type: "music", symbol: "quarter_note", x: 1, y: 1 }] })).toContain("music");
    expect(enginesForSpec({ elements: [{ id: "t", type: "text", text: "hi", x: 1, y: 1 }] })).not.toContain("music");
  });

  test("every friendly symbol has a plan, and every glyph a plan names is in the data", () => {
    for (const s of MUSIC_SYMBOLS) {
      const plan = symbolPlan(s, "3/4");
      expect(plan, s).not.toBeNull();
      const names = "row" in plan! ? plan!.row : "time" in plan! ? plan!.time.flat() : [];
      for (const n of names) expect(music.has(n), `${s} → ${n}`).toBe(true);
    }
  });
});

describe("a note joins", () => {
  const SP = 26;
  for (const stem of ["up", "down"] as const) {
    for (const value of ["half", "quarter", "eighth", "sixteenth"] as const) {
      test(`${value}, stem ${stem}: the stem starts on the head's outline and the flag meets its end`, () => {
        const n = music.note(value, [300, 400], SP, { stem });
        expect(n.stem).not.toBeNull();
        // The stem's start sits on the head: within half a stem's width of its outline.
        const onHead = Math.min(...[n.head.pts, ...(n.head.holes ?? [])].map((r) => toRing(n.stem!.from, r)));
        expect(onHead).toBeLessThan(n.stem!.width);
        // It goes the right way, about three and a half staff spaces.
        const len = n.stem!.to[1] - n.stem!.from[1];
        expect(stem === "up" ? len : -len).toBeGreaterThan(2.5 * SP);
        if (value === "eighth" || value === "sixteenth") {
          expect(n.flag).not.toBeNull();
          expect(toRing(n.stem!.to, n.flag!.pts)).toBeLessThan(0.25 * SP);
        } else {
          expect(n.flag).toBeNull();
        }
      });
    }
  }

  test("a whole note has no stem; dots sit to the right of the head", () => {
    const whole = music.note("whole", [300, 400], SP);
    expect(whole.stem).toBeNull();
    const dotted = music.note("quarter", [300, 400], SP, { dots: 2 });
    expect(dotted.dots).toHaveLength(2);
    const headRight = Math.max(...dotted.head.pts.map((p) => p[0]));
    for (const d of dotted.dots) expect(Math.min(...d.pts.map((p) => p[0]))).toBeGreaterThan(headRight);
  });
});

describe("the music element", () => {
  const spec = (els: Spec["elements"]): Spec => ({ elements: els, commands: [{ draw: els!.map((e) => e.id) }] });

  test("validates, and refuses an unknown symbol or a bad time", () => {
    expect(validateSpec(spec([{ id: "q", type: "music", symbol: "quarter_note", x: 300, y: 400 }])).ok).toBe(true);
    expect(validateSpec(spec([{ id: "q", type: "music", symbol: "kazoo", x: 300, y: 400 }])).ok).toBe(false);
    expect(validateSpec(spec([{ id: "t", type: "music", symbol: "time", time: "three", x: 300, y: 400 }])).ok).toBe(false);
    expect(validateSpec(spec([{ id: "t", type: "music", symbol: "time", time: "3/4", x: 300, y: 400 }])).ok).toBe(true);
  });

  test("lays out as one group centred on its x/y, with no issue", () => {
    const r = layoutSpec(spec([{ id: "q", type: "music", symbol: "eighth_note", x: 300, y: 400, size: 30 }, { id: "c", type: "music", symbol: "treble_clef", x: 600, y: 400 }]));
    expect(r.issues.filter((i) => i.severity === "error")).toEqual([]);
    const b = elementBBoxes(r);
    const q = b.get("q")!;
    expect(q.h).toBeGreaterThan(3 * 30); // head + stem + flag
    const c = b.get("c")!;
    expect(c.x + c.w / 2).toBeCloseTo(600, 0);
    expect(c.y + c.h / 2).toBeCloseTo(400, 0);
  });
});

import { apiSchema } from "../src/llm/compile";
import { SOUND_ONLY_ELEMENT_PROPS, specSchema } from "../src/spec/schema";

describe("the sound gate", () => {
  test("the music element's keys are exactly the ones whose descriptions begin music:", () => {
    const all = (specSchema.properties.elements.items as { properties: Record<string, { description?: string }> }).properties;
    const derived = Object.keys(all).filter((k) => /^music:/.test(all[k].description ?? ""));
    expect([...SOUND_ONLY_ELEMENT_PROPS].sort()).toEqual(derived.sort());
  });

  test("a request about neither sound nor music is not handed the music element", () => {
    const el = (s: object) => (s as { properties: { elements: { items: { properties: Record<string, { enum?: string[] }> } } } }).properties.elements.items.properties;
    const bare = el(apiSchema({ sound: false }));
    expect(bare.type.enum).not.toContain("music");
    for (const k of SOUND_ONLY_ELEMENT_PROPS) expect(bare[k]).toBeUndefined();
    expect(el(apiSchema({ sound: true })).type.enum).toContain("music");
  });
});
