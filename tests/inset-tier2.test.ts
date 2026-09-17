import { describe, expect, test } from "vitest";
import { elementBBoxes, layoutSpec } from "../src/layout/layout";
import { heuristicMeasure } from "../src/layout/measure";
import { applyTextStyle, DEFAULT_TEXT_STYLE } from "../src/layout/text-style";
import { INSET_MAIN, INSET_MAX, INSET_RIGHT, INSET_TOP, INSET_W, INSET_H, type InsetPicture } from "../src/layout/inset";
import { pictureOf } from "../src/render/inset";
import { planOptionsFor } from "../src/render/index";
import { flattenDrawables, leafDrawables, type GroupDrawable, type TextDrawable } from "../src/layout/model";
import type { Spec, SpecElement } from "../src/spec/types";

const SOURCE: Spec = {
  title: "The model",
  elements: [
    { id: "tri", type: "polygon", points: [[100, 100], [300, 100], [200, 300]] },
    { id: "cap", type: "text", text: "A triangle", x: 200, y: 340 },
  ],
  commands: [{ draw: ["tri", "cap"] }],
};
const picture = (): InsetPicture => ({ ...pictureOf(SOURCE, heuristicMeasure, planOptionsFor, "pic"), spec: SOURCE, index: 0 });
const inset = (extra: Partial<SpecElement> = {}): SpecElement => ({ id: "pic", type: "inset", of: "The model", picture: picture(), ...extra });
const host = (els: SpecElement[], extra: Partial<Spec> = {}): Spec => ({ elements: els, commands: [{ draw: els.map((e) => e.id) }], ...extra });

const groupOf = (spec: Spec, id: string) => layoutSpec(spec, heuristicMeasure).drawables.find((d) => d.id === id) as GroupDrawable;

describe("insetDrawable (spec §4.4)", () => {
  test("a default-column inset is a group whose box is the first slot, with a frame and a role: inset picture", () => {
    const g = groupOf(host([inset()]), "pic");
    expect(g.kind).toBe("group");
    expect(g.box).toEqual({ x: INSET_RIGHT - INSET_W, y: INSET_TOP - INSET_H, w: INSET_W, h: INSET_H });
    expect(g.children[0].id).toBe("pic__frame");
    const pic = g.children[1] as GroupDrawable;
    expect(pic.role).toBe("inset");
    expect(pic.children.length).toBeGreaterThan(0);
    for (const leaf of leafDrawables(pic.children)) {
      expect(leaf.id.startsWith("pic__p")).toBe(true);
    }
  });
  test("the second column inset takes the second slot; elementBBoxes reports the slot", () => {
    const spec = host([inset(), inset({ id: "pic2" })]);
    const boxes = elementBBoxes(layoutSpec(spec, heuristicMeasure), heuristicMeasure);
    expect(boxes.get("pic")!.y).toBe(INSET_TOP - INSET_H);
    expect(boxes.get("pic2")!.y).toBe(INSET_TOP - INSET_H - (INSET_H + 16));
  });
  test("crop: true fills the slot with the ink; crop: false keeps the canvas scale", () => {
    const cropped = groupOf(host([inset()]), "pic").children[1] as GroupDrawable;
    const whole = groupOf(host([inset({ crop: false })]), "pic").children[1] as GroupDrawable;
    const widthOf = (g: GroupDrawable) => {
      const xs = leafDrawables(g.children).flatMap((d) => (d.kind === "stroke" ? d.pts.map((p) => p[0]) : []));
      return Math.max(...xs) - Math.min(...xs);
    };
    expect(widthOf(cropped)).toBeGreaterThan(widthOf(whole) * 2);
  });
  test("explicit x/y and width place the box; at places it too", () => {
    const g = groupOf(host([inset({ x: 300, y: 300, width: 400 })]), "pic");
    expect(g.box).toEqual({ x: 100, y: 150, w: 400, h: 300 });
    const spec = host([{ id: "anchor", type: "shape", shape: "rect", x: 200, y: 200, width: 50, height: 50 }, inset({ at: { ref: "anchor", side: "right", gap: 10 } })]);
    const boxes = elementBBoxes(layoutSpec(spec, heuristicMeasure), heuristicMeasure);
    // shape/rect's x,y is its lower-left corner (place.ts/tier2.ts shapeDrawable), so the anchor's
    // right edge is 200 + 50 = 250, not 225 — relativeDelta (place.ts:187-206) puts the inset's
    // left edge there plus the gap. The rule under test is that `at` places an inset at all.
    expect(boxes.get("pic")!.x).toBeCloseTo(250 + 10, 3);
  });
  test("named anchors: the universal nine off the slot, plus the source's element ids inside the picture", () => {
    const l = layoutSpec(host([inset()]), heuristicMeasure);
    const named = l.namedAnchors.pic;
    expect(named.center).toEqual([INSET_RIGHT - INSET_W / 2, INSET_TOP - INSET_H / 2]);
    expect(named.tri).toBeDefined();
    const [x, y] = named.tri;
    expect(x).toBeGreaterThan(INSET_RIGHT - INSET_W);
    expect(x).toBeLessThan(INSET_RIGHT);
    expect(y).toBeGreaterThan(INSET_TOP - INSET_H);
    expect(y).toBeLessThan(INSET_TOP);
    // A freehand element can be placed on it. (`point`'s `at` is reserved for
    // {x, y}/intersection_of — {ref, anchor} is invalid there by design
    // (tier2.ts resolvePointDomain) — so this uses `text`, which goes through
    // the common at.ref/anchor placement path like most element types.)
    const spec = host([inset(), { id: "dot", type: "text", text: "x", at: { ref: "pic", anchor: "tri" } }]);
    const l2 = layoutSpec(spec, heuristicMeasure);
    expect(l2.warnings.filter((w) => /anchor/.test(w))).toEqual([]);
  });
  test("an unresolved inset draws the frame alone and warns; no picture at all is silent", () => {
    const l = layoutSpec(host([inset({ picture: { error: 'no item titled "Nope"' } })]), heuristicMeasure);
    const g = l.drawables.find((d) => d.id === "pic") as GroupDrawable;
    expect(g.children.map((c) => c.id)).toEqual(["pic__frame"]);
    expect(l.warnings).toContain('inset "pic": no item titled "Nope"');
    const silent = layoutSpec(host([{ id: "pic", type: "inset", of: "The model" }]), heuristicMeasure);
    expect(silent.warnings).toEqual([]);
    expect(silent.issues).toEqual([]);
  });
  test("a bound default-column inset finds its slot by id, not by the (copied) object bind hands back", () => {
    // evalBindings (spec/vars.ts) returns a NEW object for an element with a
    // `bind` field once any binding is applied — so the `el` insetDrawable
    // sees is not the same object `column` was filtered from. Regression for
    // the fix round 1 crash: `column.indexOf(el)` used to return -1 here,
    // `columnSlots(1)[-1]` is undefined, and reading `.x` off it threw. An
    // inset degrades, never throws (spec 2026-09-17-inset).
    const spec = host([inset({ width: 1, bind: { width: "10 * t" } })], { vars: { t: 2 } });
    expect(() => layoutSpec(spec, heuristicMeasure)).not.toThrow();
    const l = layoutSpec(spec, heuristicMeasure);
    const g = l.drawables.find((d) => d.id === "pic") as GroupDrawable;
    expect(g.box).toEqual({ x: INSET_RIGHT - INSET_W, y: INSET_TOP - INSET_H, w: INSET_W, h: INSET_H });
    expect(l.issues.filter((i) => i.severity === "error")).toEqual([]);
  });
});

describe("the template box default (spec §4.7)", () => {
  const withTemplate = (els: SpecElement[], params: Record<string, unknown> = {}): Spec => ({
    template: "supply_demand",
    params,
    elements: els,
    commands: [{ draw: els.map((e) => e.id) }],
  });
  test("a default-column inset puts a boxless template inside INSET_MAIN", () => {
    const l = layoutSpec(withTemplate([inset()]), heuristicMeasure);
    expect(l.fit).toBeDefined();
    expect(l.fit!.box).toEqual(INSET_MAIN);
  });
  test("an explicit box wins; an explicitly placed inset changes nothing", () => {
    const explicit = layoutSpec(withTemplate([inset()], { box: "left" }), heuristicMeasure);
    expect(explicit.fit!.box.w).toBe(420);
    const placed = layoutSpec(withTemplate([inset({ x: 300, y: 300 })]), heuristicMeasure);
    expect(placed.fit).toBeUndefined();
  });
});

describe("text style and lint leave the picture alone (spec §3, §6)", () => {
  test("applyTextStyle does not scale or re-face leaves inside a role: inset group", () => {
    const l = layoutSpec(host([inset()]), heuristicMeasure);
    const before = leafDrawables(flattenDrawables(l.drawables)).filter((d): d is TextDrawable => d.kind === "text" && d.id.startsWith("pic__p"));
    const after = applyTextStyle(l, { ...DEFAULT_TEXT_STYLE, scale: 1.5, family: "monospace" });
    const afterTexts = leafDrawables(flattenDrawables(after.drawables)).filter((d): d is TextDrawable => d.kind === "text" && d.id.startsWith("pic__p"));
    expect(afterTexts.map((t) => t.fontSize)).toEqual(before.map((t) => t.fontSize));
    expect(afterTexts.every((t) => t.family === before[0].family)).toBe(true);
  });
  test("font-too-small and the overlap rules skip the picture; inset-count warns at six", () => {
    const l = layoutSpec(host([inset()]), heuristicMeasure);
    expect(l.issues.filter((i) => i.rule === "font-too-small")).toEqual([]);
    expect(l.issues.filter((i) => i.rule.startsWith("overlap"))).toEqual([]);
    const six = host(Array.from({ length: INSET_MAX + 1 }, (_, k) => inset({ id: `p${k}` })));
    const l6 = layoutSpec(six, heuristicMeasure);
    const count = l6.issues.filter((i) => i.rule === "inset-count");
    expect(count).toHaveLength(1);
    expect(count[0].severity).toBe("warn");
    expect(count[0].ids).toEqual(Array.from({ length: INSET_MAX + 1 }, (_, k) => `p${k}`));
  });
});
