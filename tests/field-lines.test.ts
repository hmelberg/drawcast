// field_lines (2026-09-28): the field of point charges, its lines traced
// numerically (Gauss kept: lines ∝ |q|), equipotentials, the test charge's
// force; the paused viewer's drag, tap-to-flip and scrub; the movie; speed.
import { describe, expect, test } from "vitest";
import { scenes } from "../src/scenes/registry";
import { catalogParts } from "../src/scenes/catalog";
import { contours, fieldAt, FRAME, MAX_LINES, potentialAt, probe, readCharges, traceField, traceLine, type FieldLinesParams } from "../src/scenes/field_lines/model";
import { chargeText, layoutFieldLines } from "../src/scenes/field_lines/layout";
import { lintFieldLines } from "../src/scenes/field_lines/lint";
import { CHARGE_STEP_UNITS, movedTo, scrubCharge } from "../src/scenes/field_lines/widget";
import { buildWidgetScene } from "../src/scenes/widget-scene";
import type { WidgetScene } from "../src/scenes/widget-types";
import { layoutSpec } from "../src/layout/layout";
import { flattenDrawables, type Pt } from "../src/layout/model";
import { validateSpec } from "../src/spec/schema";
import { planCommands, INITIAL_STATE, type Plan } from "../src/render/plan";
import { withOverrides } from "../src/render/params";
import { widgetHostFor } from "../src/ui/widget-host";
import type { RenderHandle } from "../src/render";

const module = scenes["field_lines"];
const asRec = (p: FieldLinesParams) => p as unknown as Record<string, unknown>;
const pageFor = (p: FieldLinesParams) => layoutSpec({ template: "field_lines", params: p, commands: [] } as unknown as RenderHandle["spec"]);
const sceneOf = (p: FieldLinesParams): WidgetScene => buildWidgetScene(module, asRec(p), { layout: pageFor(p) })!;
const centre = (sc: WidgetScene, id: string): Pt => {
  const b = sc.boxes.get(id)!;
  return [b.x + b.w / 2, b.y + b.h / 2];
};
const patchOf = (r: { effects: unknown }): Record<string, unknown> => (r.effects as { patch: Record<string, unknown> }[])[0]?.patch;
const DIPOLE: FieldLinesParams = { charges: [{ q: 1, x: -2, y: 0 }, { q: -1, x: 2, y: 0 }] };
const LIKE: FieldLinesParams = { charges: [{ q: 1, x: -2, y: 0 }, { q: 1, x: 2, y: 0 }] };

describe("the physics", () => {
  test("one charge: E = q/r², pointing away from a positive charge and toward a negative one; V = q/r", () => {
    const cs = readCharges({ charges: [{ q: 2, x: 0, y: 0 }] });
    const f = fieldAt(cs, 2, 0);
    expect(f.ex).toBeCloseTo(0.5, 9);
    expect(f.ey).toBeCloseTo(0, 9);
    expect(potentialAt(cs, 0, 2)).toBeCloseTo(1, 9);
    const neg = fieldAt(readCharges({ charges: [{ q: -1, x: 0, y: 0 }] }), 0, 1);
    expect(neg.ey).toBeCloseTo(-1, 9);
  });
  test("a dipole's field on its perpendicular bisector points from + toward −, and V is 0 there", () => {
    const cs = readCharges(DIPOLE);
    const p = probe(cs, 0, 1.5);
    expect(p.ex).toBeGreaterThan(0);
    expect(p.ey).toBeCloseTo(0, 9);
    expect(p.V).toBeCloseTo(0, 9);
    expect(p.angle).toBeCloseTo(0, 6);
  });
  test("a traced line follows the field: every step along E, ending on the negative charge", () => {
    const cs = readCharges(DIPOLE);
    const t = traceLine(cs, [-2 + cs[0].r + 0.03, 0.001], 1);
    expect(t.end).toEqual({ kind: "charge", index: 1 });
    for (let i = 1; i < t.pts.length - 1; i += 7) {
      const [a, b] = [t.pts[i - 1], t.pts[i]];
      const f = fieldAt(cs, (a[0] + b[0]) / 2, (a[1] + b[1]) / 2);
      const d = [b[0] - a[0], b[1] - a[1]];
      expect((d[0] * f.ex + d[1] * f.ey) / (Math.hypot(d[0], d[1]) * Math.hypot(f.ex, f.ey))).toBeGreaterThan(0.99);
    }
  });
  test("Gauss: lines ∝ |q| — a dipole's + sends 8 and its − receives 8; +2 with −1 sends 16 and half go out", () => {
    const d = traceField(readCharges(DIPOLE));
    const fromPos = d.filter((l) => !l.inward);
    expect(fromPos).toHaveLength(8);
    const onNeg = d.filter((l) => l.end.kind === "charge" && l.end.index === 1).length;
    expect(onNeg).toBeGreaterThanOrEqual(7);
    expect(onNeg).toBeLessThanOrEqual(9);
    const u = traceField(readCharges({ charges: [{ q: 2, x: -1.5, y: 0 }, { q: -1, x: 1.5, y: 0 }] }));
    expect(u.filter((l) => !l.inward)).toHaveLength(16);
    // The −q's 8: from the +2q directly, or looping out past the page's edge and back in.
    const touching = u.filter((l) => l.end.kind === "charge" && l.end.index === 1).length;
    expect(touching).toBeGreaterThanOrEqual(6);
    expect(touching).toBeLessThanOrEqual(10);
  });
  test("like charges: no line ends on a charge; a lone negative charge's lines come in from the edge", () => {
    for (const l of traceField(readCharges(LIKE))) expect(l.end.kind).not.toBe("charge");
    const neg = traceField(readCharges({ charges: [{ q: -1, x: 0, y: 0 }] }));
    expect(neg).toHaveLength(8);
    for (const l of neg) {
      expect(l.inward).toBe(true);
      const last = l.pts[l.pts.length - 1];
      expect(Math.hypot(last[0], last[1])).toBeLessThan(0.5); // ends at the charge
    }
  });
  test("every line stays in the frame, and the count is capped however big the charges", () => {
    const big = readCharges({ charges: [{ q: 5, x: -3, y: 1 }, { q: -5, x: 3, y: -1 }, { q: 5, x: 0, y: 2 }, { q: -5, x: 0, y: -2 }] });
    const lines = traceField(big, 16);
    expect(lines.length).toBeLessThanOrEqual(MAX_LINES + 4);
    for (const l of lines)
      for (const [x, y] of l.pts) {
        expect(x).toBeGreaterThanOrEqual(FRAME.x[0] - 1e-9);
        expect(x).toBeLessThanOrEqual(FRAME.x[1] + 1e-9);
        expect(y).toBeGreaterThanOrEqual(FRAME.y[0] - 1e-9);
        expect(y).toBeLessThanOrEqual(FRAME.y[1] + 1e-9);
      }
  });
  test("an equipotential of one charge is a circle: V = 1 at r = 1", () => {
    const cs = readCharges({ charges: [{ q: 1, x: 0, y: 0 }] });
    const lines = contours(cs, [1]);
    expect(lines.length).toBeGreaterThan(0);
    for (const l of lines) for (const [x, y] of l) expect(Math.hypot(x, y)).toBeCloseTo(1, 1);
  });
});

describe("the figure", () => {
  test("a built-in with a lint, a live body, no ask flag — and the catalog offers it", () => {
    expect(module.layout && module.widget && module.lint).toBeTruthy();
    expect(module.manifest.widget).toBeUndefined();
    const { stable } = catalogParts({ request: "electric field lines of a dipole" });
    expect(stable).toContain("field_lines");
  });
  test("every manifest example lays out clean, with no lint at all", () => {
    for (const ex of module.manifest.examples) {
      const res = layoutSpec({ template: "field_lines", params: ex.params, elements: [] } as never);
      expect(res.warnings, ex.request).toEqual([]);
      expect(res.issues, ex.request).toEqual([]);
      expect(lintFieldLines(ex.params as FieldLinesParams), ex.request).toEqual([]);
    }
  });
  test("parts: a disc per charge with its label, the lines by the charge they start at, the sets", () => {
    const l = layoutFieldLines({ ...DIPOLE, equipotentials: true, test_charge: { x: 0, y: 1.5 } });
    expect(l.order).toEqual(expect.arrayContaining(["lines_0", "charge_0", "charge_1", "charge_label_0", "charge_label_1", "equipotentials", "test_charge", "test_force", "test_force_label"]));
    expect(l.groups!.charges).toEqual(["charge_0", "charge_label_0", "charge_1", "charge_label_1"]);
    expect(l.groups!.lines).toContain("lines_0");
    expect(chargeText({ q: 2 })).toBe("+2q");
    expect(chargeText({ q: -1 })).toBe("−q");
    expect(chargeText({ q: 1, label: "q₁" })).toBe("q₁");
  });
  test("the test charge: the force points along E (against it for a negative one), and the values read it", () => {
    const P: FieldLinesParams = { charges: [{ q: 1, x: 0, y: 0 }], test_charge: { x: 2, y: 0 } };
    const l = layoutFieldLines(P);
    expect(l.values).toMatchObject({ E: 0.25, E_angle: 0, Ex: 0.25, Ey: 0, V: 0.5, F: 0.25, lines: 8, net_charge: 1 });
    const arrow = (p: FieldLinesParams) => (flattenDrawables(layoutFieldLines(p).drawables).find((d) => d.id === "test_force") as { pts: Pt[] }).pts;
    const a = arrow(P);
    expect(a[1][0]).toBeGreaterThan(a[0][0]);
    const b = arrow({ ...P, test_charge: { x: 2, y: 0, q: -1 } });
    expect(b[1][0]).toBeLessThan(b[0][0]);
  });
  test("the words stand clear: no field line runs through a charge's label (lint-clean across positions)", () => {
    for (let x = -4; x <= 4; x += 1)
      for (const y of [-1.5, 0, 1.5]) {
        const P: FieldLinesParams = { charges: [{ q: 2, x: -3, y: 0 }, { q: -1, x, y }, { q: 1, x: 3.5, y: 2 }], equipotentials: true, test_charge: { x: 0, y: -2 } };
        if (lintFieldLines(P).length > 0) continue;
        const res = layoutSpec({ template: "field_lines", params: P, elements: [] } as never);
        expect(res.issues.map((i) => i.message), JSON.stringify(P)).toEqual([]);
      }
  });
  test("fast enough to re-trace every drag frame: four charges with equipotentials in a few ms", () => {
    const P: FieldLinesParams = { charges: [{ q: 3, x: -3, y: 1 }, { q: -2, x: 2, y: -1 }, { q: 1, x: 0, y: 2 }, { q: -2, x: 0.5, y: -2 }], equipotentials: true, test_charge: { x: 1, y: 1 } };
    layoutFieldLines(P); // warm
    const n = 20;
    const t0 = performance.now();
    for (let i = 0; i < n; i++) layoutFieldLines({ ...P, charges: P.charges!.map((c, j) => (j === 1 ? { ...c, x: c.x + i * 0.05 } : c)) });
    const ms = (performance.now() - t0) / n;
    console.log(`field_lines layout: ${ms.toFixed(2)} ms per frame (4 charges, equipotentials)`);
    expect(ms).toBeLessThan(40);
  });
  test("the lint: none, too many, off the page, discs touching, a test charge on a charge", () => {
    expect(lintFieldLines({ charges: [] })[0].severity).toBe("error");
    expect(lintFieldLines({ charges: [1, 2, 3, 4, 5].map((x) => ({ q: 1, x, y: 0 })) }).some((i) => /at most 4/.test(i.message))).toBe(true);
    expect(lintFieldLines({ charges: [{ q: 1, x: 7, y: 0 }] })[0].message).toMatch(/off the page/);
    expect(lintFieldLines({ charges: [{ q: 1, x: 0, y: 0 }, { q: -1, x: 0.3, y: 0 }] })[0].message).toMatch(/touch/);
    expect(lintFieldLines({ charges: [{ q: 1, x: 0, y: 0 }], test_charge: { x: 0.1, y: 0 } })[0].message).toMatch(/sits on/);
    expect(lintFieldLines(DIPOLE)).toEqual([]);
  });
});

describe("the paused viewer", () => {
  test("a charge moves by the drag, stays on the page, and never lands on another", () => {
    expect(movedTo(DIPOLE, 0, 1, 0.5)).toEqual([-1, 0.5]);
    const onto = movedTo(DIPOLE, 0, 4, 0)!; // dropped on the −q: pushed out to the edge of its room
    expect(Math.hypot(onto[0] - 2, onto[1])).toBeGreaterThanOrEqual(0.6 - 1e-9);
    const far = movedTo(DIPOLE, 1, 10, 10)!;
    expect(far[0]).toBeLessThanOrEqual(FRAME.x[1] - 0.4 + 1e-9);
    expect(far[1]).toBeLessThanOrEqual(FRAME.y[1] - 0.4 + 1e-9);
    expect(scrubCharge(1, 3 * CHARGE_STEP_UNITS)).toBe(4);
    expect(scrubCharge(1, -40 * CHARGE_STEP_UNITS)).toBe(-5);
    expect(scrubCharge(1, CHARGE_STEP_UNITS - 1)).toBe(1);
  });
  test("the body: drag a charge, drag the test charge, scrub a label, type a value", () => {
    const P: FieldLinesParams = { ...DIPOLE, test_charge: { x: 0, y: 1.5 } };
    const sc = sceneOf(P);
    const body = module.widget!();
    const state = body.init(sc);
    const c0 = centre(sc, "charge_0");
    const to = sc.toLogical([-1, 1]);
    const moved = body.on({ type: "drag_move", id: "charge_0", from: c0, fromDomain: sc.toDomain(c0), point: to, domain: sc.toDomain(to) }, state, sc);
    const cs = patchOf(moved).charges as { x: number; y: number }[];
    expect(cs[0].x).toBeCloseTo(-1, 1);
    expect(cs[0].y).toBeCloseTo(1, 1);
    expect(cs[1]).toEqual({ q: -1, x: 2, y: 0 });
    const tc = centre(sc, "test_charge");
    const tt = sc.toLogical([1, 1]);
    const t = body.on({ type: "drag", id: "test_charge", to: null, from: tc, fromDomain: sc.toDomain(tc), point: tt, domain: sc.toDomain(tt) }, state, sc);
    const tcP = patchOf(t).test_charge as { x: number; y: number };
    expect(tcP.x).toBeCloseTo(1, 1);
    expect(tcP.y).toBeCloseTo(1, 1);
    const lab = centre(sc, "charge_label_1");
    const s = body.on({ type: "drag_move", id: "charge_label_1", from: lab, fromDomain: sc.toDomain(lab), point: [lab[0] - 2 * CHARGE_STEP_UNITS, lab[1]], domain: null }, state, sc);
    expect((patchOf(s).charges as { q: number }[])[1].q).toBe(-3);
    expect(body.editable!("charge_label_1", lab, sc)).toMatchObject({ value: -1, min: -5, max: 5 });
    expect(body.editable!("charge_1", lab, sc)).toBeNull();
    const typed = body.on({ type: "input", id: "charge_label_0", value: 2.5, point: lab }, state, sc);
    expect((patchOf(typed).charges as { q: number }[])[0].q).toBe(2.5);
    const flip = body.on({ type: "click", id: "charge_1", point: lab, domain: null }, state, sc);
    expect((patchOf(flip).charges as { q: number }[])[1].q).toBe(1);
  });
  test("the host: a tap on a charge flips it (the body's own tap), a drag moves it live, a tap on its label types", () => {
    const P: FieldLinesParams = { ...DIPOLE };
    const spec = { template: "field_lines", params: P, commands: [] } as unknown as RenderHandle["spec"];
    const layout = layoutSpec(spec);
    const previews: Record<string, unknown>[] = [];
    let painted: ReturnType<typeof layoutSpec> | null = null;
    let current: Record<string, unknown> = {};
    const timeline = {
      state: "paused",
      position: 1,
      vars: new Map<string, string>(),
      callbacks: {},
      previewParams: (o: Record<string, unknown>) => {
        current = o;
        painted = layoutSpec({ ...spec, params: { ...P, ...o } } as unknown as RenderHandle["spec"]);
        previews.push(o);
      },
      paintedLayout: () => painted,
      glow: async () => undefined,
      tapAt: async () => undefined,
      caption: () => undefined,
      getParamOverrides: () => ({}),
    };
    const plan = { steps: [], states: [{ ...INITIAL_STATE, visible: layout.order }], labels: {}, warnings: [], minted: [] } as unknown as Plan;
    const hd = { spec, layout, plan, timeline } as unknown as RenderHandle;
    const host = widgetHostFor(hd, { frame: (fn) => (fn(), () => undefined), warn: () => undefined })!;
    const sc = sceneOf(P);
    const c1 = centre(sc, "charge_1");
    expect(host.grabbable(c1)).toBe(true);
    expect(host.press(c1)).toBe(true);
    expect(host.release(c1)).toBe("click");
    expect((current.charges as { q: number }[])[1].q).toBe(1);
    // Now like charges: a drag moves the second one live.
    expect(host.press(c1)).toBe(true);
    const to: Pt = [c1[0], c1[1] + 80];
    host.move(to);
    expect(host.release(to)).toBe("drag");
    const after = current.charges as { q: number; x: number; y: number }[];
    expect(after[1].q).toBe(1);
    expect(after[1].y).toBeGreaterThan(0.5);
    // Its label types (the host re-reads the painted scene).
    const lab = centre(sceneOf({ ...P, ...current } as FieldLinesParams), "charge_label_0");
    expect(host.press(lab)).toBe(true);
    expect(host.release(lab)).toBe("edit");
    expect(host.commitEdit("-2")).toEqual({ ok: true });
    expect((current.charges as { q: number }[])[0].q).toBe(-2);
  });
});

describe("the movie", () => {
  test("animate a charge's position: the lines re-trace every frame", () => {
    const spec = { template: "field_lines", params: DIPOLE, commands: [{ animate: { "charges.1.x": 0.8 }, duration: 3 }] };
    expect(validateSpec(spec).ok).toBe(true);
    const plan = planCommands(spec.commands as never, [], { animateBase: asRec(DIPOLE) });
    const step = plan.steps.find((s) => s.kind === "animate") as { starts: Record<string, number | null> };
    expect(step.starts).toEqual({ "charges.1.x": 2 });
    const at = (x: number) => layoutFieldLines(withOverrides(asRec(DIPOLE), { "charges.1.x": x }) as FieldLinesParams);
    const a = flattenDrawables(at(2).drawables).filter((d) => d.id.startsWith("lines_0__"));
    const b = flattenDrawables(at(0.8).drawables).filter((d) => d.id.startsWith("lines_0__"));
    expect(JSON.stringify(a)).not.toEqual(JSON.stringify(b));
    expect(at(0.8).anchors.charge_1[0]).toBeLessThan(at(2).anchors.charge_1[0]);
    // A sign animates through 0 too: at 0 the charge makes no field.
    const z = layoutFieldLines(withOverrides(asRec(DIPOLE), { "charges.1.q": 0 }) as FieldLinesParams);
    expect(z.values!.net_charge).toBe(1);
  });
});
