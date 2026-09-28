// Live math (design 2026-09-29): `{name}` in a math formula's TeX writes the
// var's value as a part of its own, coloured, scrubbed or typed while paused.
import { beforeAll, describe, expect, test } from "vitest";
import { ensureEngines } from "../src/scenes/engines";
import { layoutSpec } from "../src/layout/layout";
import { flattenDrawables, PARAM_PALETTE, type Drawable } from "../src/layout/model";
import { liveMathColors, liveTeX, partOfChain, symbolTeX, texNamesVars } from "../src/layout/live-math";
import { animatableVars, liveDecimals, varInfos, varNameErrors, varScrub, varValues, withVarValues } from "../src/spec/vars";
import { validateSpec } from "../src/spec/schema";
import { lintCommands } from "../src/lint/lint";
import type { Spec } from "../src/spec/types";
import examples from "../src/examples.json";
import { liveVarHostFor, varOfPart } from "../src/ui/live-vars";
import { INITIAL_STATE, planCommands, type Plan } from "../src/render/plan";
import { planOptionsFor, type RenderHandle } from "../src/render";
import { splitVarOverrides } from "../src/render/params";
import { STEP_UNITS } from "../src/scenes/number-scrub";

const infosOf = (vars: Spec["vars"]) => new Map(varInfos(vars).map((v) => [v.name, v]));

const discount: Spec = {
  vars: { B: { value: 100, fixed: true }, r: 0.035, t: 20, PV: { expr: "B/(1+r)^t", decimals: 1 } },
  elements: [
    { id: "pv", type: "math", tex: "PV = \\frac{{B}}{(1+{r})^{{t}}} = {PV}", x: 500, y: 500 },
    { id: "bar", type: "shape", shape: "rect", x: 500, y: 200, width: 60, height: 100, bind: { height: "PV" } },
    { id: "note", type: "text", text: "Worth {PV} today at {r:3}", x: 500, y: 100 },
  ],
  commands: [{ draw: ["pv", "bar", "note"] }],
};

function findGroup(ds: Drawable[], id: string): Drawable | null {
  for (const d of ds) {
    if (d.id === id) return d;
    if (d.kind === "group") {
      const hit = findGroup(d.children, id);
      if (hit) return hit;
    }
  }
  return null;
}

describe("var definitions", () => {
  test("plain numbers and the object form read the same; a computed var follows the ones before it", () => {
    expect(varValues({ a: 2, b: { value: 3 }, c: { expr: "a*b" } })).toEqual({ a: 2, b: 3, c: 6 });
    expect(animatableVars({ a: 2, c: { expr: "a*2" } })).toEqual({ a: 2 });
    expect(varNameErrors({ a: 1, b: { value: 1, min: 0 }, c: { expr: "a+b" } })).toEqual([]);
    expect(varNameErrors({ c: { expr: "a+1" }, a: 1 }).join(" ")).toMatch(/reads only the vars listed before it/);
    expect(varNameErrors({ a: { value: 1, expr: "2" } }).join(" ")).toMatch(/both value and expr/);
    expect(varNameErrors({ a: { min: 0 } }).join(" ")).toMatch(/needs a value/);
    expect(varNameErrors({ a: { value: 1, colour: "red" } }).join(" ")).toMatch(/unknown field "colour"/);
    expect(varNameErrors({ a: { value: 1, min: 2, max: 1 } }).join(" ")).toMatch(/min must be below its max/);
    expect(varNameErrors({ a: { value: 5, min: 0, max: 1 } }).join(" ")).toMatch(/outside its min–max/);
    expect(validateSpec({ ...discount }).errors).toEqual([]);
  });

  test("a swept value keeps the definition, and the number as written", () => {
    const v = withVarValues({ r: 0.035, s: { value: 2, color: "#123456" } }, { r: 0.04, s: 3 });
    expect(v).toEqual({ r: { value: 0.04, _written: 0.035 }, s: { value: 3, color: "#123456", _written: 2 } });
    const r = varInfos(v).find((x) => x.name === "r")!;
    expect(r.value).toBe(0.04);
    expect(liveDecimals(r)).toBe(3); // 0.040, never "0"
    expect(varScrub(r).step).toBe(0.001);
  });

  test("scrub steps: the written decimals, a nice 1 %, or 1 % of the range; floor 0 unless negative", () => {
    const one = (def: NonNullable<Spec["vars"]>[string]) => varScrub(varInfos({ x_: def })[0]);
    expect(one(0.035)).toEqual({ step: 0.001, min: 0, max: Infinity });
    expect(one(20)).toEqual({ step: 1, min: 0, max: Infinity });
    expect(one(1000).step).toBe(10);
    expect(one(-2).min).toBe(-Infinity);
    expect(one({ value: 0.03, min: 0, max: 0.1 })).toEqual({ step: 0.001, min: 0, max: 0.1 });
    expect(one({ value: 5, step: 0.5, max: 8 })).toEqual({ step: 0.5, min: 0, max: 8 });
  });

  test("each var a formula makes live takes the next PARAM_PALETTE colour in vars order; its own color wins; fixed, computed and unshown have none", () => {
    const vars: Spec["vars"] = { a: 1, k: { value: 2, fixed: true }, z: 3, b: 2, c: { value: 1, color: "#000000" }, d: 1, e: { expr: "a" } };
    const elements = [
      { id: "m", type: "math" as const, tex: "{a} + {k} + {b} + {e} + \\frac{z}{2}" },
      { id: "n", type: "math" as const, tex: "x", steps: ["{c} = {d}"] },
      { id: "t", type: "text" as const, text: "{z}" },
    ];
    expect(liveMathColors(vars, elements)).toEqual({ a: PARAM_PALETTE[0], b: PARAM_PALETTE[1], c: "#000000", d: PARAM_PALETTE[3] });
  });
});

describe("lint", () => {
  test("form on a formula naming no var, and a link's form on a formula, are warned", () => {
    const base = { vars: { r: 0.03 }, commands: [] } as Spec;
    const rules = (el: Record<string, unknown>) => lintCommands({ ...base, elements: [el as never] }).filter((i) => i.rule === "math-form").map((i) => i.message);
    expect(rules({ id: "m", type: "math", tex: "{r}", form: "both" })).toEqual([]);
    expect(rules({ id: "m", type: "math", tex: "x^2", form: "symbols" })[0]).toMatch(/does nothing/);
    expect(rules({ id: "m", type: "math", tex: "{r}", form: "card" })[0]).toMatch(/a link's/);
  });
});

describe("the TeX", () => {
  const o = { id: "pv", vars: { B: 100, r: 0.035, t: 20, u: 50 }, infos: infosOf({ B: 100, r: 0.035, t: 20, u: 50 }), colors: { r: "#1f7a7a" } };

  test("{name} writes the value in its own braces, marked k deep; an argument keeps its letter", () => {
    const r = liveTeX("(1+{r})^{{t}} + x^{t} + \\frac{u}{1-u}", o);
    expect(r.tex).toBe("(1+{\\mathord{0.035}})^{{\\mathord{\\mathord{20}}}} + x^{t} + \\frac{u}{1-u}");
    expect([...r.marks.values()].map((p) => p.id)).toEqual(["pv_var_r", "pv_var_t"]);
    expect(r.marks.get("\\mathord{0.035}")).toEqual({ id: "pv_var_r", name: "r", live: true, color: "#1f7a7a" });
  });

  test("a formula naming no var is returned as the same string", () => {
    for (const tex of ["W = 10 \\cdot \\frac{u}{{1 - u}}", "\\frac{a}{b}", "\\{r\\}", "\\text{r}", "e^{i\\pi}"]) expect(liveTeX(tex, o).tex).toBe(tex);
    expect(texNamesVars("W = 10 \\cdot \\frac{u}{{1 - u}}", o.vars)).toBe(false);
  });

  test("every bundled formula is written exactly as before (none shows a var as a token)", () => {
    let n = 0;
    for (const ex of examples as { spec?: Spec }[]) {
      const spec = ex.spec;
      if (!spec?.elements) continue;
      const vars = varValues(spec.vars);
      for (const el of spec.elements) {
        const texs = el.type === "math" ? [el.tex, ...(el.steps ?? []).map((s) => (typeof s === "string" ? s : s.tex))] : [];
        for (const tex of texs) {
          if (typeof tex !== "string") continue;
          n++;
          expect(liveTeX(tex, { id: el.id, vars, infos: infosOf(spec.vars), colors: {} }).tex).toBe(tex);
        }
      }
    }
    expect(n).toBeGreaterThan(20);
  });

  test("later occurrences are _2, _3 …; decimals inline; the decimal comma stays in the number", () => {
    const r = liveTeX("{r} + {r:1} + {t}", { ...o, decimalComma: true });
    expect([...r.marks.values()].map((p) => p.id)).toEqual(["pv_var_r", "pv_var_r_2", "pv_var_t"]);
    expect(r.tex).toContain("0{,}035");
    expect(r.tex).toContain("\\mathord{\\mathord{0{,}0}}");
  });

  test("symbols and both", () => {
    expect(liveTeX("PV = \\frac{{B}}{(1+{r})^{{t}}}", { ...o, form: "symbols" }).tex).toBe("PV = \\frac{{\\mathord{B}}}{(1+{\\mathord{\\mathord{r}}})^{{\\mathord{\\mathord{\\mathord{t}}}}}}");
    const both = liveTeX("PV = {r}", { ...o, form: "both" });
    expect(both.tex).toBe("PV = {\\mathord{r}} = {\\mathord{\\mathord{0.035}}}");
    expect([...both.marks.values()].map((p) => p.id)).toEqual(["pv_var_r", "pv_var_r_2"]);
    expect(symbolTeX("beta")).toBe("\\beta");
    expect(symbolTeX("r_1")).toBe("r_{1}");
    expect(symbolTeX("rate")).toBe("\\mathit{rate}");
  });

  test("the outermost run of marks names the occurrence, even with equal numbers", () => {
    const r = liveTeX("{r} + {s}", { ...o, vars: { r: 0.5, s: 0.5 }, infos: infosOf({ r: 0.5, s: 0.5 }) });
    const m1 = "\\mathord{0.5}", m2 = "\\mathord{\\mathord{0.5}}";
    expect(partOfChain(["0.5", m1, `{${m1}}`, "whole"], r.marks)!.name).toBe("r");
    expect(partOfChain(["0.5", m1, m2, `{${m2}}`, "whole"], r.marks)!.name).toBe("s");
    expect(partOfChain(["+", "whole"], r.marks)).toBeNull();
  });
});

describe("layout (real mathjax)", () => {
  beforeAll(async () => {
    await ensureEngines(["mathjax"]);
  });

  test("each var occurrence is a nested part in the var's colour; a computed or fixed var is ink", () => {
    const l = layoutSpec(discount);
    expect(l.issues.filter((i) => i.severity === "error")).toEqual([]);
    const pv = l.drawables.find((d) => d.id === "pv")!;
    const r = findGroup([pv], "pv_var_r")!;
    const t = findGroup([pv], "pv_var_t")!;
    expect(r).toBeTruthy();
    expect(t).toBeTruthy();
    const leaves = (d: Drawable) => flattenDrawables([d]).filter((x) => x.kind === "area");
    expect(leaves(r).length).toBe(5); // 0 . 0 3 5
    expect(leaves(r).every((x) => x.style.color === PARAM_PALETTE[0])).toBe(true);
    expect(leaves(t).every((x) => x.style.color === PARAM_PALETTE[1])).toBe(true);
    const b = findGroup([pv], "pv_var_B")!;
    expect(leaves(b).every((x) => x.style.color !== PARAM_PALETTE[0] && x.style.color !== PARAM_PALETTE[1])).toBe(true);
    // PV = 100/1.035^20 = 50.3 — written in, one decimal.
    expect(findGroup([pv], "pv_var_PV")).toBeTruthy();
    // The formula stays one thing to draw, move and erase.
    expect(l.order).toContain("pv");
    expect(l.order.some((id) => id.includes("_var_"))).toBe(false);
  });

  test("a live var's number reads in its colour in words too, row by row when a label wraps; a page with no live formula colours nothing", () => {
    const l = layoutSpec(discount);
    const note = l.drawables.find((d) => d.id === "note") as { runs?: { text: string; color?: string }[][] };
    expect(note.runs).toEqual([[{ text: "Worth 50.3 today at " }, { text: "0.035", color: PARAM_PALETTE[0] }]]);
    const wrapped = layoutSpec({
      ...discount,
      elements: [
        ...discount.elements!,
        { id: "lab", type: "label", attach_to: "bar", side: "right", text: "At a rate of {r:3} a year for {t} years the future gain is worth much less" },
      ],
      commands: [{ draw: ["pv", "bar", "note", "lab"] }],
    });
    const lab = wrapped.drawables.find((d) => d.id === "lab") as { lines?: string[]; runs?: { text: string; color?: string }[][] };
    expect(lab.lines!.length).toBeGreaterThan(1);
    expect(lab.runs!.length).toBe(lab.lines!.length);
    lab.runs!.forEach((row, i) => expect(row.map((r) => r.text).join("")).toBe(lab.lines![i]));
    const coloured = lab.runs!.flat().filter((r) => r.color);
    expect(coloured).toEqual([{ text: "0.035", color: PARAM_PALETTE[0] }, { text: "20", color: PARAM_PALETTE[1] }]);
    // No formula shows the var: it is not live, so its number is plain ink.
    const plain = layoutSpec({ vars: { f: 2 }, elements: [{ id: "t", type: "text", text: "f is {f}", x: 500, y: 300 }], commands: [{ draw: ["t"] }] });
    expect((plain.drawables.find((d) => d.id === "t") as { runs?: unknown }).runs).toBeUndefined();
  });

  test("a changed var re-lays out everything that reads it", () => {
    const at = (r: number) => layoutSpec({ ...discount, vars: withVarValues(discount.vars, { r }) });
    const text = (l: ReturnType<typeof layoutSpec>) => (l.drawables.find((d) => d.id === "note") as { text: string }).text;
    const height = (l: ReturnType<typeof layoutSpec>) => {
      const pts = flattenDrawables(l.drawables.filter((d) => d.id === "bar")).flatMap((d) => (d.kind === "stroke" ? d.pts : []));
      return Math.max(...pts.map((p) => p[1])) - Math.min(...pts.map((p) => p[1]));
    };
    const a = at(0.035), b = at(0.07);
    expect(text(a)).toBe("Worth 50.3 today at 0.035");
    expect(text(b)).toBe("Worth 25.8 today at 0.070");
    expect(height(b)).toBeLessThan(height(a) * 0.6);
    const count = (l: ReturnType<typeof layoutSpec>) => flattenDrawables([findGroup(l.drawables, "pv_var_r")!]).filter((x) => x.kind === "area").length;
    expect(count(b)).toBe(5); // 0.070: the written decimals kept
  });
});

describe("the viewer changes a var on the figure (live-vars host)", () => {
  beforeAll(async () => {
    await ensureEngines(["mathjax"]);
  });

  /** A paused handle at one boundary; previewParams paints, as the player's does. */
  function handle(spec: Spec, opts: { visible?: string[]; params?: Record<string, number> } = {}) {
    const layout = layoutSpec(spec);
    const previews: Record<string, unknown>[] = [];
    let painted: ReturnType<typeof layoutSpec> | null = null;
    const timeline = {
      state: "paused",
      position: 1,
      previewParams: (o: Record<string, unknown>) => {
        previews.push(o);
        const split = splitVarOverrides(o);
        painted = layoutSpec({ ...spec, vars: withVarValues(spec.vars, split.vars) });
      },
      paintedLayout: () => painted,
      getParamOverrides: () => ({}),
    };
    const plan = { steps: [], states: [{ ...INITIAL_STATE, visible: opts.visible ?? spec.elements!.map((e) => e.id), params: opts.params ?? {} }], labels: {}, warnings: [], minted: [] } as unknown as Plan;
    const hd = { spec, layout, plan, timeline } as unknown as RenderHandle;
    const host = liveVarHostFor(hd, { frame: (fn) => (fn(), () => {}) })!;
    const centre = (id: string): [number, number] => {
      const g = findGroup((timeline.paintedLayout() ?? layout).drawables, id)!;
      const pts = flattenDrawables([g]).flatMap((d) => (d.kind === "area" ? d.pts : []));
      const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
      return [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2];
    };
    const noteText = () => ((timeline.paintedLayout() ?? layout).drawables.find((d) => d.id === "note") as { text: string }).text;
    return { host, previews, centre, noteText, timeline };
  }

  test("no live var in any formula: no host", () => {
    const hd = { spec: { vars: { u: 50 }, elements: [{ id: "f", type: "math", tex: "\\frac{u}{1-u}" }], commands: [] } } as unknown as RenderHandle;
    expect(liveVarHostFor(hd)).toBeNull();
    const fixed = { spec: { vars: { u: { value: 5, fixed: true } }, elements: [{ id: "f", type: "math", tex: "{u}" }], commands: [] } } as unknown as RenderHandle;
    expect(liveVarHostFor(fixed)).toBeNull();
  });

  test("a drag sideways on r scrubs it a step per STEP_UNITS, and the text and bar bound to it follow", () => {
    const h = handle(discount);
    const [x, y] = h.centre("pv_var_r");
    expect(h.host.scrubbable([x, y])).toBe(true);
    expect(h.host.scrubbable([x, y + 200])).toBe(false);
    // B is fixed: no handle on it.
    expect(h.host.scrubbable(h.centre("pv_var_B"))).toBe(false);
    expect(h.host.press([x, y])).toBe(true);
    h.host.move([x + 10 * STEP_UNITS, y]);
    expect(h.previews.at(-1)).toEqual({ "vars.r": 0.045 });
    expect(h.noteText()).toBe("Worth 41.5 today at 0.045");
    expect(h.host.release([x + 35 * STEP_UNITS, y])).toBe("drag");
    expect(h.previews.at(-1)).toEqual({ "vars.r": 0.07 });
    expect(h.noteText()).toBe("Worth 25.8 today at 0.070");
    // Never below 0: a var written positive has a floor there.
    const [x2, y2] = h.centre("pv_var_r");
    h.host.press([x2, y2]);
    h.host.release([x2 - 500 * STEP_UNITS, y2]);
    expect(h.previews.at(-1)).toEqual({ "vars.r": 0 });
  });

  test("a tap opens the number field; a typed number is the new value; out of range is refused", () => {
    const spec: Spec = { ...discount, vars: { ...discount.vars, r: { value: 0.035, min: 0, max: 0.1 } } };
    const h = handle(spec);
    const c = h.centre("pv_var_r");
    h.host.press(c);
    expect(h.host.release(c)).toBe("edit");
    const f = h.host.editField()!;
    expect(f.id).toBe("pv_var_r");
    expect(f.field).toMatchObject({ value: 0.035, min: 0, max: 0.1, step: 0.001 });
    expect(h.host.commitEdit("0.5")).toEqual({ ok: false, error: "at most 0.1" });
    expect(h.host.commitEdit("0,05")).toEqual({ ok: true });
    expect(h.previews.at(-1)).toEqual({ "vars.r": 0.05 });
    expect(h.host.editField()).toBeNull();
  });

  test("the scrub starts from the value the storyboard animated to; reset forgets the viewer's value", () => {
    const h = handle(discount, { params: { "vars.t": 30 } });
    const c = h.centre("pv_var_t");
    h.host.press(c);
    h.host.release([c[0] + 3 * STEP_UNITS, c[1]]);
    expect(h.previews.at(-1)).toEqual({ "vars.t": 33 });
    h.host.reset();
    h.host.press(c);
    h.host.release([c[0] + 2 * STEP_UNITS, c[1]]);
    expect(h.previews.at(-1)).toEqual({ "vars.t": 32 });
  });

  test("an undrawn formula has nothing to grab", () => {
    const h = handle(discount, { visible: ["bar"] });
    expect(h.host.press(h.centre("pv_var_r"))).toBe(false);
  });

  test("a cancelled drag puts the value back", () => {
    const h = handle(discount);
    const c = h.centre("pv_var_t");
    h.host.press(c);
    h.host.move([c[0] + 5 * STEP_UNITS, c[1]]);
    h.host.cancel();
    expect(h.previews.at(-1)).toEqual({});
  });

  test("varOfPart reads a name that itself ends in _<digits> whole first", () => {
    expect(varOfPart("eq_var_r", ["eq"], new Set(["r"]))).toBe("r");
    expect(varOfPart("eq_var_r_2", ["eq"], new Set(["r"]))).toBe("r");
    expect(varOfPart("eq_var_k_1", ["eq"], new Set(["k_1"]))).toBe("k_1");
    expect(varOfPart("eq_var_k_1_2", ["eq"], new Set(["k_1"]))).toBe("k_1");
    expect(varOfPart("other_var_r", ["eq"], new Set(["r"]))).toBeNull();
  });
});

describe("animate still sweeps the var, and the drawn number follows", () => {
  beforeAll(async () => {
    await ensureEngines(["mathjax"]);
  });
  test("the plan keeps vars.r; the layout at a frame writes the swept number; a computed var is not a sweep target", () => {
    const spec: Spec = { ...discount, commands: [{ draw: ["pv", "bar", "note"] }, { animate: { r: 0.06 }, duration: 2 }, { animate: { PV: 3 }, duration: 1 }] };
    const l = layoutSpec(spec);
    const plan = planCommands(spec.commands, l.order, { varsBase: spec.vars ?? null, animateBase: null, ...planOptionsFor(spec, l) });
    expect(plan.states.at(-1)!.params["vars.r"]).toBe(0.06);
    expect(plan.states.at(-1)!.params["vars.PV"]).toBeUndefined();
    expect(plan.warnings.join(" ")).toMatch(/PV/);
    const mid = layoutSpec({ ...spec, vars: withVarValues(spec.vars, { r: 0.05 }) });
    const digits = flattenDrawables([findGroup(mid.drawables, "pv_var_r")!]).filter((d) => d.kind === "area").length;
    expect(digits).toBe(5); // 0.050
  });
});
