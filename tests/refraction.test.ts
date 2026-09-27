// refraction (2026-09-28): Snell's law and Fresnel's reflectance, the switch
// to total internal reflection past the critical angle, the figure's parts
// and numbers, the paused viewer's gestures, the movie's sweep.
import { describe, expect, test } from "vitest";
import { scenes } from "../src/scenes/registry";
import { catalogParts } from "../src/scenes/catalog";
import { apparentPoint, criticalAngle, incidenceFor, readModel, reflectance, slabShift, snell, type RefractionParams } from "../src/scenes/refraction/model";
import { layoutRefraction, mediumOpacity } from "../src/scenes/refraction/layout";
import { lintRefraction } from "../src/scenes/refraction/lint";
import { aimPatch, nameAt, REFRACTION_PARTS, scrubIndex } from "../src/scenes/refraction/widget";
import { buildWidgetScene } from "../src/scenes/widget-scene";
import { STEP_UNITS } from "../src/scenes/number-scrub";
import type { WidgetScene } from "../src/scenes/widget-types";
import { layoutSpec } from "../src/layout/layout";
import { flattenDrawables, type Pt } from "../src/layout/model";
import { validateSpec } from "../src/spec/schema";
import { planCommands, INITIAL_STATE, type Plan } from "../src/render/plan";
import { withOverrides } from "../src/render/params";
import { widgetHostFor } from "../src/ui/widget-host";
import type { RenderHandle } from "../src/render";

const module = scenes["refraction"];
const asRec = (p: RefractionParams) => p as unknown as Record<string, unknown>;
const pageFor = (p: RefractionParams) => layoutSpec({ template: "refraction", params: p, commands: [] } as unknown as RenderHandle["spec"]);
const sceneOf = (p: RefractionParams): WidgetScene => buildWidgetScene(module, asRec(p), { layout: pageFor(p) })!;
const ids = (p: RefractionParams): string[] => layoutRefraction(p).order;
const stroke = (p: RefractionParams, id: string): Pt[] => {
  const d = flattenDrawables(layoutRefraction(p).drawables).find((x) => x.id === id) as { pts: Pt[] } | undefined;
  return d!.pts;
};
const dirOf = (pts: Pt[]): Pt => {
  const [a, b] = [pts[0], pts[pts.length - 1]];
  const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
  return [(b[0] - a[0]) / L, (b[1] - a[1]) / L];
};
const centre = (sc: WidgetScene, id: string): Pt => {
  const b = sc.boxes.get(id)!;
  return [b.x + b.w / 2, b.y + b.h / 2];
};
const patchOf = (r: { effects: unknown }): Record<string, unknown> => (r.effects as { patch: Record<string, unknown> }[])[0]?.patch;

describe("the physics", () => {
  test("Snell's law: air into water at 45° bends to 32.1°, and the law holds both ways", () => {
    expect(snell(1, 1.33, 45)).toBeCloseTo(32.12, 2);
    expect(snell(1, 1, 30)).toBeCloseTo(30, 9);
    for (const t of [0, 10, 40, 80]) {
      const t2 = snell(1.5, 1, Math.min(t, 41))!;
      expect(1.5 * Math.sin((Math.min(t, 41) * Math.PI) / 180)).toBeCloseTo(1 * Math.sin((t2 * Math.PI) / 180), 9);
      expect(incidenceFor(1.5, 1, t2)).toBeCloseTo(Math.min(t, 41), 6);
    }
  });
  test("the critical angle: water to air 48.8°; none when light slows down; past it no refraction", () => {
    expect(criticalAngle(1.33, 1)).toBeCloseTo(48.75, 2);
    expect(criticalAngle(1, 1.33)).toBeNull();
    expect(snell(1.33, 1, 48.7)).not.toBeNull();
    expect(snell(1.33, 1, 48.8)).toBeNull();
    expect(incidenceFor(1, 1.33, 60)).toBeNull(); // no incidence refracts past the limit into the slower medium's partner
  });
  test("Fresnel: about 2 % at normal incidence on water, all of it past the critical angle, rising toward grazing", () => {
    expect(reflectance(1, 1.33, 0)).toBeCloseTo(((1.33 - 1) / 2.33) ** 2, 6);
    expect(reflectance(1.33, 1, 60)).toBe(1);
    const r = [0, 30, 60, 80, 89].map((t) => reflectance(1, 1.5, t));
    expect(r[4]).toBeGreaterThan(r[3]);
    expect(r[3]).toBeGreaterThan(r[1]);
    // Just below the critical angle most of the light already reflects.
    expect(reflectance(1.33, 1, 48.5)).toBeGreaterThan(0.4);
  });
  test("the apparent position: a straw tip in water looks shallower, by n2/n1 near the normal", () => {
    const m = readModel({ medium1: "water", medium2: "air", theta1_deg: 0.001 });
    const I = apparentPoint(m)!;
    expect(I[1] / m.R).toBeCloseTo(1 / 1.33, 3);
    const m30 = readModel({ medium1: "water", medium2: "air", theta1_deg: 30 });
    const I30 = apparentPoint(m30)!;
    expect(I30[1]).toBeLessThan(m30.R * Math.cos(Math.PI / 6)); // shallower than the real tip
    expect(I30[0]).toBeCloseTo(-m30.R * Math.sin(Math.PI / 6), 6); // straight above/below it
  });
  test("a slab shifts the ray sideways by t·sin(θ1 − θ2)/cos θ2", () => {
    expect(slabShift(50, snell(1, 1.5, 50)!)).toBeCloseTo(Math.sin(((50 - 30.71) * Math.PI) / 180) / Math.cos((30.71 * Math.PI) / 180), 3);
    expect(slabShift(0, 0)).toBe(0);
  });
});

describe("the figure", () => {
  test("a built-in with a lint, a live body, no ask flag — and the catalog offers it", () => {
    expect(module.layout && module.widget && module.lint).toBeTruthy();
    expect(module.manifest.widget).toBeUndefined();
    const { stable } = catalogParts({ request: "why does a straw look bent in water" });
    expect(stable).toContain("refraction");
  });
  test("every manifest example lays out clean, with no lint at all", () => {
    for (const ex of module.manifest.examples) {
      const res = layoutSpec({ template: "refraction", params: ex.params, elements: [] } as never);
      expect(res.warnings, ex.request).toEqual([]);
      expect(res.issues, ex.request).toEqual([]);
      expect(lintRefraction(ex.params as RefractionParams), ex.request).toEqual([]);
    }
  });
  test("names fill in indices; the washes deepen with the index", () => {
    const m = readModel({ medium1: "air", medium2: "glass" });
    expect([m.n1, m.n2]).toEqual([1, 1.5]);
    expect(readModel({ medium2: "diamond" }).n2).toBe(2.42);
    expect(readModel({}).name2).toBe("water");
    expect(mediumOpacity(1.5)).toBeGreaterThan(mediumOpacity(1.33));
  });
  test("below the critical angle: a refracted ray and θ2; past it: gone, and total internal reflection says so", () => {
    const below = layoutRefraction({ medium1: "water", medium2: "air", theta1_deg: 40 });
    expect(below.order).toEqual(expect.arrayContaining(["refracted_ray", "theta2_label", "reflected_ray", "critical_line", "critical_label"]));
    expect(below.order).not.toContain("tir_label");
    expect(below.values).toMatchObject({ theta1: 40, tir: 0, critical: 48.8 });
    expect(below.values!.theta2).toBeCloseTo(58.7, 1);
    const past = layoutRefraction({ medium1: "water", medium2: "air", theta1_deg: 60 });
    expect(past.order).not.toContain("refracted_ray");
    expect(past.order).not.toContain("theta2_label");
    expect(past.order).toEqual(expect.arrayContaining(["reflected_ray", "tir_label"]));
    expect(past.values).toMatchObject({ tir: 1, reflected: 100 });
    expect(past.values!.theta2).toBeUndefined();
    // Light slowing down has no critical angle to mark.
    expect(ids({ medium1: "air", medium2: "water" })).not.toContain("critical_line");
  });
  test("the reflected ray is at the mirror angle, and as strong as the reflectance", () => {
    const P: RefractionParams = { theta1_deg: 35 };
    const inc = dirOf(stroke(P, "incident_ray__a"));
    const ref = dirOf(stroke(P, "reflected_ray"));
    expect(ref[0]).toBeCloseTo(inc[0], 6);
    expect(ref[1]).toBeCloseTo(-inc[1], 6);
    const faint = flattenDrawables(layoutRefraction(P).drawables).find((d) => d.id === "reflected_ray")!.style.opacity;
    const full = flattenDrawables(layoutRefraction({ medium1: "water", medium2: "air", theta1_deg: 70 }).drawables).find((d) => d.id === "reflected_ray")!.style.opacity;
    expect(faint).toBeLessThan(0.5);
    expect(full).toBe(1);
  });
  test("the refracted ray's drawn angle is θ2 from the normal", () => {
    const P: RefractionParams = { medium1: "air", medium2: "glass", theta1_deg: 50 };
    const d = dirOf(stroke(P, "refracted_ray"));
    expect((Math.atan2(d[0], -d[1]) * 180) / Math.PI).toBeCloseTo(snell(1, 1.5, 50)!, 6);
  });
  test("mirrored: from the right and from below the lamp sits where it says", () => {
    const O = readModel({}).O;
    const lamp = (p: RefractionParams): Pt => layoutRefraction(p).anchors.source;
    expect(lamp({})[0]).toBeLessThan(O[0]);
    expect(lamp({})[1]).toBeGreaterThan(O[1]);
    expect(lamp({ from: "right" })[0]).toBeGreaterThan(O[0]);
    expect(lamp({ light_from: "below" })[1]).toBeLessThan(O[1]);
  });
  test("a slab: the ray leaves parallel to the one that came in, shifted", () => {
    const P: RefractionParams = { medium1: "air", medium2: "glass", slab: true, theta1_deg: 50 };
    const l = layoutRefraction(P);
    expect(l.order).toEqual(expect.arrayContaining(["boundary2", "medium3", "exit_ray", "shift_arrow", "shift_label", "incident_extension"]));
    const a = dirOf(stroke(P, "incident_ray__a"));
    const b = dirOf(stroke(P, "exit_ray"));
    expect(b[0]).toBeCloseTo(a[0], 6);
    expect(b[1]).toBeCloseTo(a[1], 6);
    expect(l.values!.shift).toBeCloseTo(slabShift(50, snell(1, 1.5, 50)!), 3);
  });
  test("a sweep of every option through every angle lays out with no lint (labels placed clear)", () => {
    const variants: RefractionParams[] = [
      { show_law: true },
      { medium1: "water", medium2: "air", show_law: true, wavefronts: true },
      { medium1: "water", medium2: "air", light_from: "below", apparent: true, eye: true, source_label: "straw tip", show_critical: false },
      { medium1: "air", medium2: "glass", slab: true, wavefronts: true },
      { medium1: "glass", medium2: "air", from: "right", show_law: true },
      { medium1: "air", medium2: "diamond", light_from: "below", from: "right" },
    ];
    for (const v of variants)
      for (let t = 0; t <= 89; t += 7) {
        const P = { ...v, theta1_deg: t };
        const res = layoutSpec({ template: "refraction", params: P, elements: [] } as never);
        expect(res.issues.filter((i) => i.severity === "error"), JSON.stringify(P)).toEqual([]);
        // The template's own lint may speak (an eye past the critical angle); the page's may not.
        expect(res.issues.map((i) => i.message).filter((msg) => !msg.startsWith("template refraction:")), JSON.stringify(P)).toEqual([]);
      }
  });
  test("the lint: an index below 1, an unknown medium, a critical angle that cannot be, an eye in the dark", () => {
    expect(lintRefraction({ n1: 0.8 })[0].message).toMatch(/below 1/);
    expect(lintRefraction({ medium2: "honey" })[0].message).toMatch(/give n2/);
    expect(lintRefraction({ medium2: "honey", n2: 1.5 })).toEqual([]);
    expect(lintRefraction({ show_critical: true }).map((i) => i.message).join()).toMatch(/no critical angle/);
    expect(lintRefraction({ medium1: "water", medium2: "air", theta1_deg: 70, eye: true, apparent: true })).toHaveLength(2);
    expect(lintRefraction({ theta1_deg: 95 })[0].message).toMatch(/drawn as 89.5/);
  });
});

describe("the paused viewer", () => {
  test("the lamp or the incident ray: the angle follows the pointer; across the normal the lamp changes side", () => {
    const P: RefractionParams = { theta1_deg: 40 };
    const m = readModel(P);
    const at = (deg: number, side: 1 | -1): Pt => m.world([side * -Math.sin((deg * Math.PI) / 180) * 150, Math.cos((deg * Math.PI) / 180) * 150]);
    expect(aimPatch("source", P, at(25, 1))).toEqual({ theta1_deg: 25 });
    expect(aimPatch("incident_ray", P, at(70, 1))).toEqual({ theta1_deg: 70 });
    expect(aimPatch("source", P, at(30, -1))).toEqual({ theta1_deg: 30, from: "right" });
    // Below the boundary it is as far over as it goes.
    expect(aimPatch("source", P, [m.O[0] - 100, m.O[1] - 50])).toEqual({ theta1_deg: 89.5 });
  });
  test("the refracted ray: pulled to θ2, the incidence that gives it; the reflected ray is the lamp's mirror", () => {
    const P: RefractionParams = { medium1: "air", medium2: "water", theta1_deg: 40 };
    const m = readModel(P);
    const down = (deg: number): Pt => m.world([Math.sin((deg * Math.PI) / 180) * 150, -Math.cos((deg * Math.PI) / 180) * 150]);
    const t1 = Math.round(incidenceFor(1, 1.33, 30)!);
    expect(aimPatch("refracted_ray", P, down(30))).toEqual({ theta1_deg: t1 });
    // Past the limit (48.8° in water) no incidence reaches: as far as it goes.
    expect(aimPatch("refracted_ray", P, down(70))).toEqual({ theta1_deg: 89.5 });
    expect(aimPatch("reflected_ray", P, m.world([Math.sin(0.5) * 150, Math.cos(0.5) * 150]))).toEqual({ theta1_deg: Math.round((0.5 * 180) / Math.PI) });
  });
  test("an index scrubs by hundredths within 1–3, the medium's name following the index it lands on", () => {
    expect(scrubIndex(1.33, 17 * STEP_UNITS)).toBe(1.5);
    expect(scrubIndex(1.33, -100 * STEP_UNITS)).toBe(1);
    expect(nameAt(1.5, { name: "water", n: 1.33 })).toBe("glass");
    expect(nameAt(1.33, { name: "pond", n: 1.33 })).toBe("pond");
    expect(nameAt(1.4, { name: "water", n: 1.33 })).toBe("");
    expect(nameAt(1.5, { name: "vann", n: 1.33 })).toBe(""); // a Norwegian cast's names are not overwritten in English
  });
  test("the body end to end: a drag on n2 scrubs it; θ labels and n labels take typing; θ2 typed solves θ1", () => {
    const P: RefractionParams = { medium1: "air", medium2: "water", theta1_deg: 40 };
    const sc = sceneOf(P);
    const body = module.widget!();
    const state = body.init(sc);
    expect(body.live).toBe(true);
    expect(REFRACTION_PARTS.every((id) => typeof id === "string")).toBe(true);
    const n2 = centre(sc, "n2_label");
    const r = body.on({ type: "drag_move", id: "n2_label", from: n2, fromDomain: sc.toDomain(n2), point: [n2[0] + 17 * STEP_UNITS, n2[1]], domain: sc.toDomain([n2[0] + 17 * STEP_UNITS, n2[1]]) }, state, sc);
    expect(patchOf(r)).toEqual({ n2: 1.5, medium2: "glass" });
    expect(body.editable!("n1_label", n2, sc)).toMatchObject({ value: 1, min: 1, max: 3, step: 0.01 });
    expect(body.editable!("theta1_label", n2, sc)).toMatchObject({ value: 40, max: 89.5 });
    expect(body.editable!("theta2_label", n2, sc)!.max).toBeCloseTo(48.7, 1);
    const typed = body.on({ type: "input", id: "theta2_label", value: 30, point: n2 }, state, sc);
    expect((patchOf(typed).theta1_deg as number)).toBeCloseTo(incidenceFor(1, 1.33, 30)!, 1);
    const n1 = body.on({ type: "input", id: "n1_label", value: 1.33, point: n2 }, state, sc);
    expect(patchOf(n1)).toEqual({ n1: 1.33, medium1: "water" });
    const back = body.on({ type: "input", id: "n1_label", value: 1, point: n2 }, state, sc);
    expect(patchOf(back)).toEqual({ n1: 1, medium1: "air" });
  });
  test("the host: a press on the lamp drags live; a tap on n types; a tap on a ray passes", () => {
    const P: RefractionParams = { theta1_deg: 40 };
    const spec = { template: "refraction", params: P, commands: [] } as unknown as RenderHandle["spec"];
    const layout = layoutSpec(spec);
    const previews: Record<string, unknown>[] = [];
    let painted: ReturnType<typeof layoutSpec> | null = null;
    const timeline = {
      state: "paused",
      position: 1,
      vars: new Map<string, string>(),
      callbacks: {},
      previewParams: (o: Record<string, unknown>) => {
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
    expect(host.live).toBe(true);
    const sc = sceneOf(P);
    // A tap on a ray is not the body's: it passes to the card.
    const ray = sc.lines.get("reflected_ray")![0];
    const mid: Pt = [(ray[0][0] + ray[1][0]) / 2, (ray[0][1] + ray[1][1]) / 2];
    expect(host.press(mid)).toBe(true);
    expect(host.release(mid)).toBe("pass");
    // The lamp, dragged to 30° from the normal (the page's own mapping).
    const lamp = centre(sc, "source");
    expect(host.grabbable(lamp)).toBe(true);
    expect(host.press(lamp)).toBe(true);
    const to = sc.toLogical(readModel(P).world([-Math.sin(Math.PI / 6) * 200, Math.cos(Math.PI / 6) * 200]));
    host.move(to);
    expect(host.release(to)).toBe("drag");
    expect(previews.at(-1)).toMatchObject({ theta1_deg: 30 });
    const nl = centre(sc, "n2_label");
    expect(host.scrubbable(nl)).toBe(true);
    expect(host.press(nl)).toBe(true);
    expect(host.release(nl)).toBe("edit");
    expect(host.commitEdit("1,5")).toEqual({ ok: true });
    expect(previews.at(-1)).toMatchObject({ n2: 1.5, medium2: "glass" });
  });
});

describe("the host after an animate", () => {
  test("paused past an animate (no preview painted), the parts are hit where the animate left them", () => {
    // The player commits an animate's end with no painted layout: the host
    // must lay the page out at the boundary's params, not the authored ones.
    const P: RefractionParams = { theta1_deg: 30 };
    const spec = { template: "refraction", params: P, commands: [] } as unknown as RenderHandle["spec"];
    const layout = layoutSpec(spec);
    const timeline = {
      state: "paused",
      position: 1,
      vars: new Map<string, string>(),
      callbacks: {},
      previewParams: () => undefined,
      paintedLayout: () => null,
      glow: async () => undefined,
      tapAt: async () => undefined,
      caption: () => undefined,
      getParamOverrides: () => ({}),
    };
    const plan = { steps: [], states: [{ ...INITIAL_STATE, visible: layout.order, params: { theta1_deg: 60 } }], labels: {}, warnings: [], minted: [] } as unknown as Plan;
    const host = widgetHostFor({ spec, layout, plan, timeline } as unknown as RenderHandle, { frame: (fn) => (fn(), () => undefined), warn: () => undefined })!;
    const now = centre(sceneOf({ theta1_deg: 60 }), "source");
    const then = centre(sceneOf(P), "source");
    expect(host.grabbable(now)).toBe(true);
    expect(host.grabbable(then)).toBe(false);
  });
});

describe("the movie", () => {
  test("animate theta1_deg sweeps past the critical angle: the refracted ray goes, reflection takes all", () => {
    const P: RefractionParams = { medium1: "water", medium2: "air", light_from: "below", theta1_deg: 20 };
    const spec = { template: "refraction", params: P, commands: [{ animate: { theta1_deg: 70 }, duration: 4 }] };
    expect(validateSpec(spec).ok).toBe(true);
    const plan = planCommands(spec.commands as never, [], { animateBase: asRec(P) });
    const step = plan.steps.find((s) => s.kind === "animate") as { starts: Record<string, number | null> };
    expect(step.starts).toEqual({ theta1_deg: 20 });
    const at = (t: number) => layoutRefraction(withOverrides(asRec(P), { theta1_deg: t }) as RefractionParams);
    const seen = [20, 35, 45, 48, 49, 55, 70].map((t) => at(t).order.includes("refracted_ray"));
    expect(seen).toEqual([true, true, true, true, false, false, false]);
    expect(at(48).values!.reflected).toBeGreaterThan(at(35).values!.reflected);
    // n2 animates too: raise it past n1 and the light gets out again.
    expect(layoutRefraction(withOverrides(asRec({ ...P, theta1_deg: 60 }), { n2: 1.4 }) as RefractionParams).order).toContain("refracted_ray");
  });
});
