// Live math (design 2026-09-29): `{name}` in a math formula's TeX writes the
// var's value as a part of its own, coloured, scrubbed or typed while paused.
import { beforeAll, describe, expect, test } from "vitest";
import { ensureEngines } from "../src/scenes/engines";
import { layoutSpec } from "../src/layout/layout";
import { flattenDrawables, PARAM_PALETTE, type Drawable } from "../src/layout/model";
import { liveTeX, partOfChain, symbolTeX, texNamesVars } from "../src/layout/live-math";
import { animatableVars, liveDecimals, liveVarColors, varInfos, varNameErrors, varScrub, varValues, withVarValues } from "../src/spec/vars";
import { validateSpec } from "../src/spec/schema";
import type { Spec } from "../src/spec/types";

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

  test("each live var takes the next PARAM_PALETTE colour in vars order; its own color wins; fixed and computed have none", () => {
    expect(liveVarColors({ a: 1, k: { value: 2, fixed: true }, b: 2, c: { value: 1, color: "#000000" }, d: 1, e: { expr: "a" } })).toEqual({
      a: PARAM_PALETTE[0],
      b: PARAM_PALETTE[1],
      c: "#000000",
      d: PARAM_PALETTE[3],
    });
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
