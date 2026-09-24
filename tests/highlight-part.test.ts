// highlight.part — one piece of a target: a formula's symbol or term (by the
// TeX its glyphs' token chains name, as math.colors matches), or a phrase of
// a label or a code line. Hans, 2026-09-24: "Sometimes, in an equation, it
// could be one character, or the whole equations, or a line, or part of a line."

import { beforeAll, describe, expect, test } from "vitest";
import { ensureEngines, getLoadedEngines, type MathJaxEngine } from "../src/scenes/engines";
import { mathDrawables } from "../src/layout/math";
import { findPart, rowOffset } from "../src/layout/highlight-part";
import { layoutSpec } from "../src/layout/layout";
import { heuristicMeasure } from "../src/layout/measure";
import { COLORS, type AreaDrawable, type Drawable, type GroupDrawable } from "../src/layout/model";
import { rendererFor } from "../src/render/svg-backend";
import { planCommands } from "../src/render/plan";
import { lintLayout } from "../src/lint/lint";
import { installMiniDom, FakeNode } from "./helpers/mini-dom";
import type { Command } from "../src/spec/types";

let mj: MathJaxEngine;
beforeAll(async () => {
  await ensureEngines(["mathjax"]);
  mj = getLoadedEngines(["mathjax"]).mathjax as MathJaxEngine;
});

const TEX = "s = \\dfrac{v^2}{2a} + v\\,t_r";
const glyphs = () => (mathDrawables({ id: "eq", type: "math", tex: TEX } as never, mj, 500, 375).drawables[0] as GroupDrawable).children as AreaDrawable[];

describe("findPart on a formula", () => {
  test("every glyph carries its TeX token chain", () => {
    const g = glyphs();
    expect(g.every((k) => Array.isArray(k.tex) && k.tex.length > 0)).toBe(true);
  });

  test("one symbol: t_r names the t and its subscript, nothing else", () => {
    const hits = findPart(glyphs(), "t_r");
    expect(hits).toHaveLength(1);
    expect(hits[0]).toEqual({ kind: "glyphs", leafIds: ["eq__g10", "eq__g11"] });
  });

  test("a term: the fraction is its numerator, bar and denominator", () => {
    const hit = findPart(glyphs(), "\\dfrac{v^2}{2a}")[0];
    expect(hit.kind === "glyphs" && hit.leafIds).toEqual(["eq__g3", "eq__g4", "eq__g5", "eq__g6", "eq__g7"]);
  });

  test("a single letter lights every occurrence, as colours do", () => {
    const hit = findPart(glyphs(), "v")[0];
    expect(hit.kind === "glyphs" && hit.leafIds).toEqual(["eq__g3", "eq__g9"]);
  });

  test("surrounding and repeated spaces do not matter (normalizeTex, as for colours)", () => {
    expect(findPart(glyphs(), "  t_r ")).toHaveLength(1);
  });

  test("something the formula does not contain names nothing", () => {
    expect(findPart(glyphs(), "x")).toEqual([]);
    expect(findPart(glyphs(), "  ")).toEqual([]);
  });
});

describe("findPart on text", () => {
  const style = { color: COLORS.ink, strokeWidth: 2, opacity: 1, roughness: 1 } as never;
  const drawOpts = { mode: "sketch", duration: 400 } as never;
  const text = (id: string, t: string, lines?: string[]): Drawable => ({ id, kind: "text", pos: [0, 0], text: t, lines, fontSize: 20, anchor: "start", z: 2, style, drawOpts });

  test("verbatim, first occurrence on the drawn rows", () => {
    expect(findPart([text("a", "rng = np.random.default_rng(7)") as never], "default_rng(7)")).toEqual([{ kind: "text", leafId: "a", row: 0, col: 16, len: 14 }]);
    expect(findPart([text("b", "long label", ["long", "label here"]) as never], "here")).toEqual([{ kind: "text", leafId: "b", row: 1, col: 6, len: 4 }]);
  });

  test("rowOffset reads the rows end to end", () => {
    expect(rowOffset(["long", "label here"], 1, 6)).toBe(10);
  });
});

async function mount(spec: object) {
  const { restore, doc } = installMiniDom();
  const layout = layoutSpec(spec as never, heuristicMeasure);
  const container = new FakeNode("div", doc as never);
  const r = await rendererFor("clean").mount(layout, spec as never, container as never);
  for (const el of r.elements.values()) el.finish();
  const svg = container.children[0];
  const overlay = svg.children[svg.children.length - 1];
  const underlay = svg.children.find((c) => c.getAttribute("class") === "cs-underlay")!;
  return { restore, effects: r.effects!, overlay, underlay, layout };
}

describe("the renderer lights only the part", () => {
  const EQ_SPEC = { elements: [{ id: "eq", type: "math", tex: TEX, x: 500, y: 375 }], commands: [{ draw: ["eq"] }] };

  test("glow on a formula symbol echoes just its glyphs", async () => {
    const { restore, effects, overlay } = await mount(EQ_SPEC);
    try {
      effects.setHighlight(["eq"], "glow", 1, null, undefined, 1000, "t_r");
      expect(overlay.children.map((c) => c.dataset.leafId)).toEqual(["eq__g10", "eq__g11"]);
      effects.endHighlight(["eq"]);
      effects.setHighlight(["eq"], "glow", 1, null, undefined, 1000);
      expect(overlay.children).toHaveLength(12);
    } finally {
      restore();
    }
  });

  test("a part that names nothing lights the whole target", async () => {
    const { restore, effects, overlay } = await mount(EQ_SPEC);
    try {
      effects.setHighlight(["eq"], "glow", 1, null, undefined, 1000, "x");
      expect(overlay.children).toHaveLength(12);
    } finally {
      restore();
    }
  });

  test("underline and circle are drawn round the part, not the formula", async () => {
    const { restore, effects, overlay } = await mount(EQ_SPEC);
    const whole = { x: 0, y: 0, w: 1000, h: 750 };
    try {
      effects.setHighlight(["eq"], "underline", 1, whole, undefined, 1000, "t_r");
      const line = overlay.children[0].querySelectorAll("path")[0].getAttribute("d")!;
      const [x0, , x1] = line.match(/-?[\d.]+/g)!.map(Number);
      // tᵣ is a pair of small glyphs at the formula's right end — a few dozen
      // units wide, nowhere near the 1000-unit box the step passed in.
      expect(x1 - x0).toBeLessThan(60);
      expect(x0).toBeGreaterThan(500);
      effects.endHighlight(["eq"]);
      effects.setHighlight(["eq"], "circle", 1, whole, undefined, 1000, "t_r");
      expect(overlay.children).toHaveLength(1);
    } finally {
      restore();
    }
  });

  test("glow on a phrase of a code line puts the marker under that phrase only", async () => {
    const spec = {
      elements: [{ id: "sim", type: "code", language: "python", show: "code", code: "import numpy as np\nrng = np.random.default_rng(7)", x: 500, y: 375, width: 700 }],
      commands: [{ draw: ["sim"] }],
    };
    const { restore, effects, underlay, layout } = await mount(spec);
    try {
      effects.setHighlight(["sim_line_2"], "glow", 1, null, undefined, 1000, "default_rng(7)");
      const d = underlay.children[0].getAttribute("d")!;
      const [x0, , x1] = d.match(/-?[\d.]+/g)!.map(Number);
      const line = layout.drawables.flatMap(function flat(x: Drawable): Drawable[] {
        return x.kind === "group" ? x.children.flatMap(flat) : [x];
      }).find((x) => x.id === "sim_line_2") as Extract<Drawable, { kind: "text" }>;
      const fs = line.fontSize;
      const band = fs * 1.1;
      // Box edges a quarter em outside columns 16 and 30.
      // (the path is written to one decimal)
      expect(Math.abs(x0 - band / 2 - (line.pos[0] + 16 * 0.62 * fs - 0.25 * fs))).toBeLessThan(0.06);
      expect(Math.abs(x1 + band / 2 - (line.pos[0] + 30 * 0.62 * fs + 0.25 * fs))).toBeLessThan(0.06);
    } finally {
      restore();
    }
  });

  test("tint on a phrase of a label hides everything but the phrase on the echo", async () => {
    const spec = { elements: [{ id: "lab", type: "text", text: "reaction distance", x: 500, y: 375 }], commands: [{ draw: ["lab"] }] };
    const { restore, effects, overlay } = await mount(spec);
    try {
      effects.setHighlight(["lab"], "glow", 1, null, undefined, 1000, "distance");
      const spans = overlay.children[0].querySelectorAll("tspan");
      const shown = spans.filter((s) => s.getAttribute("fill-opacity") !== "0").map((s) => s.textContent).join("");
      const hidden = spans.filter((s) => s.getAttribute("fill-opacity") === "0").map((s) => s.textContent).join("");
      expect(shown).toBe("distance");
      expect(hidden).toBe("reaction ");
    } finally {
      restore();
    }
  });
});

describe("plan and lint", () => {
  test("the plan carries the part to the player", () => {
    const plan = planCommands([{ draw: ["eq"] }, { highlight: { target: ["eq"], part: "t_r" } }] as Command[], ["eq"], { bboxOf: () => ({ x: 0, y: 0, w: 10, h: 10 }) });
    const step = plan.steps.find((s) => s.kind === "highlight");
    expect(step && step.kind === "highlight" && step.part).toBe("t_r");
  });

  test("lint warns when a part names nothing in its targets, and is quiet when it does", () => {
    const spec = (part: string) => ({ elements: [{ id: "eq", type: "math", tex: TEX, x: 500, y: 375 }], commands: [{ draw: ["eq"] }, { highlight: { target: ["eq"], part } }] });
    const issues = (part: string) => {
      const s = spec(part);
      const l = layoutSpec(s as never, heuristicMeasure);
      return lintLayout(l.drawables, heuristicMeasure, s.commands as Command[]).filter((i) => i.rule === "highlight-part");
    };
    expect(issues("t_r")).toEqual([]);
    expect(issues("v\\,t_r")).toHaveLength(1);
  });
});
