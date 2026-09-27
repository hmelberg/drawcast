// params-ui (2026-09-27): the parts every template with a live equation
// shares — the safe expression parser and its TeX, the parameters' shape,
// the drawn equation with addressable values, the drawn panel, the control
// targets a widget body works, and the domain's zoom and pan.
import { beforeAll, describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { ensureEngines, getLoadedEngines, type MathJaxEngine } from "../src/scenes/engines";
import { compile, namesIn, parseExpr, toTeX } from "../src/scenes/params-ui/expr";
import { PARAMS_SCHEMA, lintParams, readParams, stepFor, traySliders, withValue } from "../src/scenes/params-ui/params";
import { drawEquation, equationTeX, paramOfEqPart } from "../src/scenes/params-ui/equation";
import { drawPanel, panelRows, sliderX } from "../src/scenes/params-ui/panel";
import { controlField, controlParts, controlTarget, scrubValue, sliderPointerValue } from "../src/scenes/params-ui/controls";
import { panRange, sameRange, tidyRange, zoomRange } from "../src/scenes/params-ui/domain";
import { STEP_UNITS } from "../src/scenes/number-scrub";

beforeAll(async () => {
  await ensureEngines(["mathjax"]);
});

describe("the expression: parsed, never eval'd", () => {
  const ev = (src: string, env: Record<string, number> = {}) => compile(parseExpr(src))(env);
  test("precedence, juxtaposition and unicode", () => {
    expect(ev("-x^2", { x: 3 })).toBe(-9);
    expect(ev("2x^2", { x: 3 })).toBe(18);
    expect(ev("3(x+1)", { x: 1 })).toBe(6);
    expect(ev("(x-1)(x+2)", { x: 2 })).toBe(4);
    expect(ev("2^3^2")).toBe(512);
    expect(ev("2·π")).toBeCloseTo(2 * Math.PI);
    expect(ev("x²", { x: 4 })).toBe(16);
    expect(ev("exp(0) + ln(e) + sqrt(16) + abs(-2) + pow(2, 3)")).toBe(1 + 1 + 4 + 2 + 8);
  });
  test("a declared single letter before ( multiplies; an unknown longer name is refused as a function", () => {
    expect(ev("a(x+1)", { a: 2, x: 1 })).toBe(4);
    expect(() => parseExpr("sinn(x)")).toThrow(/unknown function "sinn"/);
    expect(compile(parseExpr("rate(x+1)", ["rate"]))({ rate: 3, x: 1 })).toBe(6);
  });
  test("nothing reaches a prototype or the page", () => {
    for (const bad of ["constructor(x)", "alert(1)", "x.constructor", "window['a']", "x; 1", "`x`", "a=>a"]) expect(() => parseExpr(bad)).toThrow();
    // A name that happens to be a prototype key is just a parameter.
    expect(compile(parseExpr("__proto__ + toString"))({})).toBeNaN();
    expect(() => parseExpr("x+".repeat(300) + "x")).toThrow(/longer/);
    expect(() => parseExpr("(".repeat(60) + "x" + ")".repeat(60))).toThrow(/deeply/);
  });
  test("free names in first-use order, constants left out", () => {
    expect(namesIn(parseExpr("a*sin(b*x + c) + pi + e"))).toEqual(["a", "b", "x", "c"]);
  });
});

describe("the equation as TeX, values written in", () => {
  const tex = (src: string, values: Record<string, string>, variable = "x") => toTeX(parseExpr(src), variable, { digits: (n) => values[n] ?? null }).tex;
  test("a negative coefficient turns the + before it", () => {
    expect(tex("a*x^2 + b*x + c", { a: "2", b: "-3", c: "1" })).toBe("\\mathord{2} x^{2} - \\mathord{3} x + \\mathord{1}");
    expect(tex("a*x^2 + b*x + c", { a: "-2", b: "3", c: "-1" })).toBe("\\mathord{-2} x^{2} + \\mathord{3} x - \\mathord{1}");
  });
  test("a number beside a number takes a dot, a negative value inside is bracketed", () => {
    expect(tex("x*a", { a: "2" })).toBe("x \\cdot \\mathord{2}");
    expect(tex("x*a", { a: "-2" })).toBe("x \\cdot \\left(\\mathord{-2}\\right)");
    expect(tex("a^2", { a: "-2" })).toBe("\\left(\\mathord{-2}\\right)^{2}");
  });
  test("functions and names", () => {
    expect(tex("A*sin(k*x + phi)", {})).toBe("\\mathord{A} \\sin(\\mathord{k} x + \\mathord{\\phi})");
    expect(tex("N0*exp(r*t)", { N0: "100", r: "0.10" }, "t")).toBe("\\mathord{100} e^{\\mathord{0.10} t}");
    expect(tex("sqrt(x)/a", { a: "2" })).toBe("\\frac{\\sqrt{x}}{\\mathord{2}}");
  });
});

describe("the parameters' shape", () => {
  test("declared, undeclared (1), editable, fixed, steps and controls", () => {
    const set = readParams({ given: { a: { value: 2, min: 0, max: 5 }, b: 3, c: { value: 1, fixed: true, control: "box", min: 0, max: 2 } }, names: ["a", "b", "c", "d"], controls: "both" });
    expect(set.params.map((p) => [p.name, p.value, p.editable, p.declared, p.control, p.step])).toEqual([
      ["a", 2, true, true, "slider", 0.1],
      ["b", 3, true, true, "box", 0.1],
      ["c", 1, false, true, "box", 0.05],
      ["d", 1, true, false, "box", 0.1],
    ]);
    expect(set.panel.map((p) => p.name)).toEqual(["a", "b", "d"]);
    expect(readParams({ given: {}, names: ["a", "b"], editable: ["b"] }).params.map((p) => p.editable)).toEqual([false, true]);
    expect(readParams({ given: {}, names: ["a", "b"], controls: "panel", panel: ["b"] }).panel.map((p) => p.name)).toEqual(["b"]);
    expect(stepFor(1.25)).toBe(0.01);
    expect(readParams({ given: {}, names: "abcdfghijk".split("") }).dropped).toEqual(["j", "k"]);
  });
  test("a patch keeps the author's form; the tray's paths follow it", () => {
    expect(withValue({ a: 2, b: { value: 1, min: 0 } }, "b", 3)).toEqual({ a: 2, b: { value: 3, min: 0 } });
    expect(withValue({ a: 2 }, "a", 3)).toEqual({ a: 3 });
    expect(withValue({}, "z", 3)).toEqual({ z: 3 });
    const given = { a: { value: 1, min: 0, max: 2 }, b: 1 };
    expect(traySliders(given, readParams({ given, names: ["a", "b"] })).map((s) => s.path)).toEqual(["params.a.value"]);
  });
  test("lint: a value outside its range, a range upside down, a name that is not a parameter", () => {
    const given = { a: { value: 9, min: 0, max: 5 }, b: { value: 1, min: 2, max: 1 } };
    const msgs = lintParams(given, readParams({ given, names: ["a", "b"] }), { editable: ["q"] }).map((i) => i.message);
    expect(msgs).toEqual(['param "a": value 9 is outside its range [0, 5]', 'param "b": min 2 is not below max 1', 'editable: "q" is not a parameter of the equation']);
  });
  test("equation_plot's manifest carries PARAMS_SCHEMA as it is", () => {
    const manifest = JSON.parse(readFileSync("src/scenes/equation_plot/manifest.json", "utf8"));
    for (const [k, v] of Object.entries(PARAMS_SCHEMA)) expect(manifest.params_schema.properties[k], k).toEqual(v);
  });
});

describe("the drawn equation", () => {
  const set = readParams({ given: { a: 2, b: { value: -3, fixed: true } }, names: ["a", "b"] });
  const node = parseExpr("a*x^2 + b*x + a");
  test("its TeX, values in", () => {
    expect(equationTeX({ lhsTeX: "y", node, variables: "x", set, form: "values" })).toEqual({ tex: "y = \\mathord{2.0} x^{2} - \\mathord{3.0} x + \\mathord{2.0}", order: ["a", "b", "a"] });
    expect(equationTeX({ lhsTeX: "z", node: parseExpr("a*x*y"), variables: ["x", "y"], set, form: "symbols" }).tex).toBe("z = \\mathord{a} x y");
  });
  test("each value its own part; a name written twice gets _2; fixed values are ink", () => {
    const mj = getLoadedEngines(["mathjax"]).mathjax as MathJaxEngine;
    const r = drawEquation(mj, { id: "eq", lhsTeX: "y", node, variables: "x", set, form: "values", center: [500, 600], width: 900 });
    expect(r.paramIds).toEqual(["eq_param_a", "eq_param_b", "eq_param_a_2"]);
    expect(r.drawables.map((d) => d.id)).toEqual(["eq", "eq_param_a", "eq_param_b", "eq_param_a_2"]);
    const color = (id: string) => r.drawables.find((d) => d.id === id)!.style.color;
    expect(color("eq_param_a")).not.toBe(color("eq_param_b"));
    expect(color("eq_param_b")).toBe(color("eq"));
    // Left to right in reading order.
    expect(r.anchors.eq_param_a[0]).toBeLessThan(r.anchors.eq_param_b[0]);
    expect(r.anchors.eq_param_b[0]).toBeLessThan(r.anchors.eq_param_a_2[0]);
    expect(paramOfEqPart("eq_param_a_2", set)).toBe("a");
    expect(paramOfEqPart("eq_param_q", set)).toBeNull();
    // Too wide: shrunk to fit.
    const narrow = drawEquation(mj, { id: "eq", lhsTeX: "y", node, variables: "x", set, form: "values", center: [500, 600], width: 150 });
    const xs = narrow.drawables.flatMap((d) => (d.kind === "group" ? d.children : [d])).flatMap((d) => (d.kind === "area" ? d.pts.map((p) => p[0]) : []));
    expect(Math.max(...xs) - Math.min(...xs)).toBeLessThanOrEqual(260);
  });
});

describe("the drawn panel and its controls", () => {
  const given = { a: { value: 1, min: 0, max: 4, label: "slope a" }, b: { value: 2, control: "box" as const }, c: { value: 0, fixed: true, min: -1, max: 1 } };
  const set = readParams({ given, names: ["a", "b", "c"], controls: "panel", panel: ["a", "b", "c"] });
  const rows = panelRows(set.panel, { x0: 740, x1: 975, yMid: 340 });
  test("rows stack about yMid; a slider's knob sits at its value", () => {
    expect(rows.map((r) => r.kind)).toEqual(["slider", "box", "slider"]);
    expect(rows[0].textY - rows[1].textY).toBe(84);
    expect(sliderX(rows[0], 1)).toBeCloseTo(rows[0].x0 + (rows[0].x1 - rows[0].x0) / 4);
    const panel = drawPanel(rows);
    expect(panel.ids).toEqual(["name_a", "value_a", "slider_a", "knob_a", "name_b", "box_b", "value_b", "name_c", "value_c", "slider_c", "knob_c"]);
    expect(panel.drawnWith.slider_a).toEqual(["name_a", "value_a", "knob_a"]);
  });
  test("targets: a slider's knob and track, a box and a value scrub; a fixed one is nothing", () => {
    expect(controlTarget("knob_a", set)?.kind).toBe("slider");
    expect(controlTarget("slider_a", set)?.kind).toBe("slider");
    expect(controlTarget("value_a", set)?.kind).toBe("scrub");
    expect(controlTarget("box_b", set)?.kind).toBe("scrub");
    expect(controlTarget("knob_c", set)).toBeNull();
    // controls "panel": the equation's numbers are not handles.
    expect(controlTarget("eq_param_a", set)).toBeNull();
    expect(controlParts(["eq_param_a", "value_a", "knob_a", "slider_a", "box_b", "knob_c"], set)).toEqual(["knob_a", "slider_a", "value_a", "box_b"]);
    expect(controlField(controlTarget("value_a", set)!)).toEqual({ value: 1, label: "slope a", step: 0.1, min: 0, max: 4 });
  });
  test("value mapping: steps of travel for a scrub, the pointer's place on a track", () => {
    const a = set.byName.get("a")!;
    expect(scrubValue(a, STEP_UNITS * 5 + 1)).toBe(1.5);
    expect(scrubValue(a, -STEP_UNITS * 50)).toBe(0);
    expect(sliderPointerValue(a, 850, 800, 900)).toBe(2);
    expect(sliderPointerValue(a, 1000, 800, 900)).toBe(4);
  });
});

describe("the domain: zoom and pan", () => {
  test("zoom keeps the point under the pointer and scales the span", () => {
    const r = zoomRange([-5, 5], 2, 2);
    expect(r).toEqual([-1.5, 3.5]);
    // The pointer's fraction along the axis is the same before and after.
    expect((2 - r[0]) / (r[1] - r[0])).toBeCloseTo((2 + 5) / 10);
    expect(zoomRange([-5, 5], 0, 0.5)).toEqual([-10, 10]);
    const tiny = zoomRange([0, 1], 0.5, 1e12);
    expect(tiny[1] - tiny[0]).toBeCloseTo(1e-6, 12);
  });
  test("pan moves the paper with the hand", () => {
    expect(panRange([0, 10], 4, 6)).toEqual([-2, 8]);
    expect(tidyRange([0.123456789, 10.987654321])).toEqual([0.12, 10.99]);
    expect(sameRange([0, 1], [0, 1 + 1e-12])).toBe(true);
    expect(sameRange(undefined, [0, 1])).toBe(false);
  });
});
