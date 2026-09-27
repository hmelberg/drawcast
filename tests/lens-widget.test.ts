// ray_diagram's live body (2026-09-28): drag the object (distance and
// height) or either F, scrub or type d and f — rays, image and every
// {lens.*} number recompute under the pointer. The body is the pack
// document's own `widget: |` (packs/physics.yaml), free play only.
import { beforeAll, describe, expect, test } from "vitest";
import { ensureEnabledPacks } from "../src/scenes/packs";
import { scenes } from "../src/scenes/registry";
import { buildWidgetScene } from "../src/scenes/widget-scene";
import { dragMoveEvent, inputEvent, partAt, runWidget, stepWidget } from "../src/scenes/widget-run";
import { layoutSpec, elementBBoxes, domainMapping } from "../src/layout/layout";
import { lintCommands } from "../src/lint/lint";
import { planCommands, INITIAL_STATE, type Plan } from "../src/render/plan";
import { planOptionsFor, type RenderHandle } from "../src/render/index";
import { widgetHostFor } from "../src/ui/widget-host";
import type { Pt } from "../src/layout/model";
import type { WidgetBody, WidgetScene } from "../src/scenes/widget-types";
import type { Spec } from "../src/spec/types";

beforeAll(async () => {
  await ensureEnabledPacks(["physics"]);
});

type P = Record<string, unknown>;
const pageOf = (params: P) => layoutSpec({ template: "ray_diagram", params, commands: [] } as unknown as Spec);
const sceneOf = (params: P): WidgetScene => buildWidgetScene(scenes.ray_diagram, params, { layout: pageOf(params) })!;
const body = (): WidgetBody => scenes.ray_diagram.widget!();
const names = () => Object.keys((scenes.ray_diagram.manifest.params_schema as { properties: object }).properties);
const values = (params: P) => scenes.ray_diagram.layout!(params).values!;
const tipOf = (sc: WidgetScene): Pt => sc.lines.get("object")![0].at(-1)!;
const footOf = (sc: WidgetScene): Pt => sc.lines.get("object")![0][0];
const centre = (sc: WidgetScene, id: string): Pt => {
  const b = sc.boxes.get(id)!;
  return [b.x + b.w / 2, b.y + b.h / 2];
};
const xOf = (sc: WidgetScene, id: string) => sc.lines.get(id)![0][0][0];
/** The patch one live frame of a drag makes: `id` pressed at `from`, moved by `by`. */
function frame(params: P, id: string, from: Pt, by: Pt): P {
  const sc = sceneOf(params);
  const r = stepWidget(body(), null, dragMoveEvent(id, from, [from[0] + by[0], from[1] + by[1]], sc), sc, names());
  expect(r.errors).toEqual([]);
  return (r.effects[0]?.patch ?? {}) as P;
}
const BASE = { focal_length: 10, object_distance: 25, object_height: 6 };

describe("ray_diagram: the document's widget", () => {
  test("compiles as a live, editable body; free play only — no manifest widget flag, so no ask binds to it", () => {
    const m = scenes.ray_diagram;
    expect(m.widget).toBeDefined();
    const b = body();
    expect(b.live).toBe(true);
    expect(typeof b.editable).toBe("function");
    expect(b.demo).toBeUndefined();
    expect(m.manifest.widget).toBeUndefined();
    const spec = { template: "ray_diagram", params: {}, commands: [{ ask: { question: "Where?", answer: "x", widget: "ray_diagram" } }] } as unknown as Spec;
    expect(lintCommands(spec).filter((i) => i.rule === "widget").map((i) => i.message).join()).toMatch(/free play only/);
  });

  test("the object, either F and the numbers are its parts; the lens, the rays and blank paper are not", () => {
    const sc = sceneOf({ ...BASE, show_distances: true });
    const parts = body().parts!;
    expect(partAt(sc, tipOf(sc), 18, parts)).toBe("object");
    const mid: Pt = [footOf(sc)[0], (footOf(sc)[1] + tipOf(sc)[1]) / 2];
    expect(partAt(sc, mid, 18, parts)).toBe("object");
    expect(partAt(sc, [xOf(sc, "focal_right"), sc.lines.get("axis")![0][0][1]], 18, parts)).toBe("focal_right");
    expect(partAt(sc, centre(sc, "label_left"), 18, parts)).toBe("label_left");
    expect(partAt(sc, centre(sc, "do_value"), 18, parts)).toBe("do_value");
    expect(partAt(sc, centre(sc, "f_value"), 18, parts)).toBe("f_value");
    expect(partAt(sc, [xOf(sc, "lens"), 520], 18, parts)).toBeNull();
    expect(partAt(sc, [900, 700], 18, parts)).toBeNull();
    // No distances drawn: no numbers among the parts.
    expect((parts as (s: WidgetScene) => string[])(sceneOf(BASE))).not.toContain("do_value");
  });
});

describe("dragging the object", () => {
  test("the tip follows the pointer: sideways is the distance, up is the height", () => {
    const sc = sceneOf(BASE);
    const t0 = tipOf(sc);
    const patch = frame(BASE, "object", t0, [60, 40]);
    const sc2 = sceneOf({ ...BASE, ...patch });
    expect(tipOf(sc2)[0]).toBeCloseTo(t0[0] + 60, 0);
    expect(tipOf(sc2)[1]).toBeCloseTo(t0[1] + 40, 0);
    expect(patch.object_distance as number).toBeLessThan(25);
    expect(patch.object_height as number).toBeGreaterThan(6);
  });

  test("the first move pins the view to the page as it stands: nothing refits, the lens stays put", () => {
    const sc = sceneOf(BASE);
    const patch = frame(BASE, "object", tipOf(sc), [1, 0]);
    expect(patch.view).toBeDefined();
    const sc2 = sceneOf({ ...BASE, ...patch });
    expect(xOf(sc2, "lens")).toBeCloseTo(xOf(sc, "lens"), 6);
    expect(xOf(sc2, "focal_right")).toBeCloseTo(xOf(sc, "focal_right"), 6);
    // A view the cast set is left alone.
    const own = { ...BASE, view: { left: 30, right: 45, height: 8 } };
    expect(frame(own, "object", tipOf(sceneOf(own)), [5, 0]).view).toBeUndefined();
  });

  test("a grab anywhere on the arrow moves it by the pointer's travel (no jump to the tip)", () => {
    const sc = sceneOf(BASE);
    const mid: Pt = [footOf(sc)[0], (footOf(sc)[1] + tipOf(sc)[1]) / 2];
    expect(frame(BASE, "object", mid, [0, 0])).toMatchObject({ object_distance: 25, object_height: 6 });
  });

  test("through F: real and inverted outside, no image at F, virtual and upright inside — the extensions appear", () => {
    const view = { left: 30, right: 45, height: 8 };
    const p = { ...BASE, view };
    const sc = sceneOf(p);
    const perUnit = (xOf(sc, "focal_right") - xOf(sc, "lens")) / 10;
    const to = (d: number) => ({ ...p, ...frame(p, "object", tipOf(sc), [(25 - d) * perUnit, 0]) });
    const out = to(18);
    expect(values(out)).toMatchObject({ image_kind: 1, upright: 0 });
    expect(values(out).m).toBeLessThan(0);
    const at = to(10.3); // within 8 units of F: snaps onto it
    expect(at.object_distance).toBe(10);
    expect(values(at).image_kind).toBe(0);
    expect(values(at).di).toBeUndefined();
    expect(sceneOf(at).ids).not.toContain("image");
    const inside = to(6);
    expect(values(inside)).toMatchObject({ image_kind: -1, upright: 1 });
    expect(sceneOf(inside).ids).toEqual(expect.arrayContaining(["ray_parallel_ext", "ray_center_ext", "image"]));
    expect(to(20.2).object_distance).toBe(20); // and onto 2F: the same-size image
    expect(values(to(20.2)).m).toBe(-1);
  });

  test("clamps: the object stays on its page, off the lens, and at least a little tall", () => {
    const p = { ...BASE, view: { left: 30, right: 45, height: 8 } };
    const sc = sceneOf(p);
    const far = frame(p, "object", tipOf(sc), [-2000, 0]);
    expect(far.object_distance).toBe(30);
    const near = frame(p, "object", tipOf(sc), [2000, 0]);
    expect(near.object_distance as number).toBeGreaterThan(0.5);
    const nearTip = tipOf(sceneOf({ ...p, ...near }));
    expect(xOf(sceneOf({ ...p, ...near }), "lens") - nearTip[0]).toBeGreaterThanOrEqual(17.9);
    const low = frame(p, "object", tipOf(sc), [0, -2000]);
    expect(low.object_height as number).toBeGreaterThan(0.5);
    const high = frame(p, "object", tipOf(sc), [0, 2000]);
    expect(high.object_height).toBeCloseTo(8.96, 2);
  });
});

describe("dragging F", () => {
  test("the right F dragged right, or the left F dragged left, lengthens f; snaps onto the object", () => {
    const sc = sceneOf(BASE);
    const perUnit = (xOf(sc, "focal_right") - xOf(sc, "lens")) / 10;
    const axisY = sc.lines.get("axis")![0][0][1];
    expect(frame(BASE, "focal_right", [xOf(sc, "focal_right"), axisY], [4 * perUnit, 0]).focal_length).toBeCloseTo(14, 2);
    expect(frame(BASE, "focal_left", [xOf(sc, "focal_left"), axisY], [-4 * perUnit, 0]).focal_length).toBeCloseTo(14, 2);
    expect(frame(BASE, "label_left", centre(sc, "label_left"), [2 * perUnit, 0]).focal_length).toBeCloseTo(8, 2);
    // f = d: the object at F — no image; f = d/2: the object at 2F.
    const p = { ...BASE, view: { left: 30, right: 45, height: 8 } };
    const sp = sceneOf(p);
    const u = (xOf(sp, "focal_right") - xOf(sp, "lens")) / 10;
    const onObject = frame(p, "focal_right", [xOf(sp, "focal_right"), axisY], [14.8 * u, 0]);
    expect(onObject.focal_length).toBe(25);
    expect(values({ ...p, ...onObject }).image_kind).toBe(0);
    expect(frame(p, "focal_right", [xOf(sp, "focal_right"), axisY], [2.6 * u, 0]).focal_length).toBe(12.5);
  });

  test("clamps: F stays on the page and off the lens", () => {
    const sc = sceneOf(BASE);
    const axisY = sc.lines.get("axis")![0][0][1];
    const long = frame(BASE, "focal_right", [xOf(sc, "focal_right"), axisY], [3000, 0]);
    const short = frame(BASE, "focal_right", [xOf(sc, "focal_right"), axisY], [-3000, 0]);
    const v = long.view as { left: number; right: number };
    expect(long.focal_length as number).toBeLessThanOrEqual(0.97 * Math.min(v.left, v.right) + 1e-9);
    expect(short.focal_length as number).toBeGreaterThan(0.5);
    const page = sceneOf({ ...BASE, ...long });
    expect(page.ids).toEqual(expect.arrayContaining(["focal_left", "focal_right"]));
  });
});

describe("a diverging lens", () => {
  test("always a virtual, upright, smaller image between F and the lens, wherever the object is dragged", () => {
    const p = { ...BASE, lens_type: "diverging" };
    const sc = sceneOf(p);
    for (const dx of [-200, -50, 0, 80, 200, 400]) {
      const q = { ...p, ...frame(p, "object", tipOf(sc), [dx, 0]) };
      const v = values(q);
      expect(v.image_kind).toBe(-1);
      expect(v.m).toBeGreaterThan(0);
      expect(v.m).toBeLessThan(1);
      expect(v.di).toBeLessThan(0);
      expect(-v.di).toBeLessThan(10);
      expect(sceneOf(q).ids).toContain("ray_parallel_ext");
      expect(sceneOf(q).ids).not.toContain("ray_center_ext");
    }
  });
  test("no snapping to F: a diverging lens has no image at infinity", () => {
    const p = { ...BASE, lens_type: "diverging", view: { left: 30, right: 45, height: 8 } };
    const sc = sceneOf(p);
    const perUnit = (xOf(sc, "focal_right") - xOf(sc, "lens")) / 10;
    expect(frame(p, "object", tipOf(sc), [14.7 * perUnit, 0]).object_distance).toBeCloseTo(10.3, 2);
  });
});

describe("the numbers: scrub and type d and f", () => {
  const p = { ...BASE, show_distances: true };
  test("the marks read d = 25 and f = 10", () => {
    const d = scenes.ray_diagram.layout!(p).drawables;
    const text = (id: string) => {
      const t = d.find((x) => x.id === id);
      return t && t.kind === "text" ? t.text : null;
    };
    expect(text("do_value")).toBe("d = 25");
    expect(text("f_value")).toBe("f = 10");
    expect(text("do_value")).not.toBeNull();
  });
  test("drag sideways: a step of about 1 % per 4 units, from the press", () => {
    const sc = sceneOf(p);
    const c = centre(sc, "do_value");
    expect(frame(p, "do_value", c, [40, 3]).object_distance).toBe(30); // 10 steps of 0.5
    expect(frame(p, "do_value", c, [-8, 0]).object_distance).toBe(24);
    expect(frame(p, "f_value", centre(sc, "f_value"), [20, 0]).focal_length).toBeCloseTo(10.5, 9); // 5 steps of 0.1
  });
  test("a tap opens a field; the typed number lands (and pins the view)", () => {
    const sc = sceneOf(p);
    expect(body().editable!("do_value", centre(sc, "do_value"), sc)).toMatchObject({ value: 25, label: "Object distance" });
    expect(body().editable!("f_value", centre(sc, "f_value"), sc)).toMatchObject({ value: 10, label: "Focal length" });
    expect(body().editable!("object", tipOf(sc), sc)).toBeNull();
    const run = runWidget(scenes.ray_diagram, p, [inputEvent("do_value", 7.5)], { layout: pageOf(p) });
    expect(run.errors).toEqual([]);
    expect(run.params.object_distance).toBe(7.5);
    expect(run.params.view).toBeDefined();
    expect(values(run.params).image_kind).toBe(-1);
  });
});

describe("the layout: values and every state lint clean", () => {
  test("the thin-lens equation holds: 1/f = 1/do + 1/di, m = −di/do", () => {
    for (const [f, d] of [[10, 25], [10, 15], [12, 7], [5, 40], [10, 20]]) {
      const v = values({ focal_length: f, object_distance: d });
      expect(1 / v.do + 1 / v.di).toBeCloseTo(1 / f, 3);
      expect(v.m).toBeCloseTo(-v.di / v.do, 2);
    }
    const div = values({ focal_length: 10, object_distance: 10, lens_type: "diverging" });
    expect(div.di).toBeCloseTo(-5, 6);
    expect(div.m).toBeCloseTo(0.5, 6);
  });
  test("{lens.*} tokens in a cast's own text read the live numbers", () => {
    const spec = { template: "ray_diagram", params: { focal_length: 10, object_distance: 15 }, elements: [{ id: "note", type: "text", at: [800, 690], text: "m = {lens.m:1}" }], commands: [] } as unknown as Spec;
    const note = layoutSpec(spec).drawables.find((d) => d.id === "note");
    expect(note && note.kind === "text" ? note.text : null).toBe("m = -2.0");
  });
  test("converging and diverging, auto-fit and a fixed view, the object from the lens to the page's edge: lint clean", () => {
    for (const view of [undefined, { left: 30, right: 45, height: 8 }])
      for (const lens_type of ["converging", "diverging"])
        for (const d of [0.6, 3, 7.5, 9.99, 10, 10.01, 12, 20, 29.5])
          for (const h of [1, 6, 8.9]) {
            const out = pageOf({ focal_length: 10, object_distance: d, object_height: h, lens_type, show_distances: true, ...(view ? { view } : {}) });
            expect([...out.issues.map((i) => `${lens_type} d=${d} h=${h}: ${i.rule} ${i.message}`), ...out.warnings]).toEqual([]);
          }
  });
  test("the object inside f/2 keeps both F on the page (the auto-fit once lost the near one)", () => {
    const sc = sceneOf({ focal_length: 10, object_distance: 2, object_height: 6 });
    expect(xOf(sc, "focal_left")).toBeGreaterThanOrEqual(60);
  });
});

describe("the movie: the object walked in through F under a fixed view", () => {
  const view = { left: 30, right: 45, height: 8 };
  const spec = { template: "ray_diagram", params: { focal_length: 10, object_distance: 25, object_height: 4, view }, commands: [{ draw: ["axis", "lens", "focal_left", "focal_right", "object", "ray_parallel", "ray_center", "image"] }, { animate: { object_distance: 6 }, duration: 5 }] } as unknown as Spec;
  test("the planner tweens object_distance 25 → 6 with no warning", () => {
    const layout = layoutSpec(spec);
    const bboxes = elementBBoxes(layout);
    const p = planCommands(spec.commands!, layout.order, {
      bboxOf: (id: string) => bboxes.get(id) ?? null,
      windows: layout.windows ?? {},
      ...domainMapping(spec.domain, layout.fit),
      animateBase: spec.params ?? {},
      ...planOptionsFor(spec, layout),
    } as never);
    const step = p.steps.find((s) => s.kind === "animate") as unknown as { targets: Record<string, number>; starts: Record<string, number | null> };
    expect(step.targets).toEqual({ object_distance: 6 });
    expect(step.starts).toEqual({ object_distance: 25 });
    expect(p.warnings).toEqual([]);
  });
  test("each frame: the lens and F stand still, the object really moves, the image goes from real to virtual", () => {
    const lensAt = xOf(sceneOf(spec.params as P), "lens");
    let last = -Infinity;
    for (const d of [25, 18, 12, 10.4, 10, 9.6, 8, 6]) {
      const q = { ...(spec.params as P), object_distance: d };
      const sc = sceneOf(q);
      expect(xOf(sc, "lens")).toBeCloseTo(lensAt, 6);
      expect(footOf(sc)[0]).toBeGreaterThan(last);
      last = footOf(sc)[0];
      expect(values(q).image_kind).toBe(d > 10 ? 1 : d === 10 ? 0 : -1);
      const out = pageOf(q);
      expect([...out.issues, ...out.warnings]).toEqual([]);
    }
  });
});

// ---- the host: the live path end to end ------------------------------------

function lensHandle(params: P) {
  const spec = { template: "ray_diagram", params, commands: [] } as unknown as RenderHandle["spec"];
  const layout = layoutSpec(spec);
  const previews: P[] = [];
  let painted: ReturnType<typeof layoutSpec> | null = null;
  const timeline = {
    state: "paused",
    position: 1,
    vars: new Map<string, string>(),
    callbacks: {},
    previewParams: (o: P) => {
      painted = layoutSpec({ ...spec, params: { ...params, ...o } } as unknown as RenderHandle["spec"]);
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
  const warnings: string[] = [];
  const host = widgetHostFor(hd, { frame: (fn) => (fn(), () => undefined), warn: (m) => warnings.push(m) })!;
  return { host, previews, warnings };
}

describe("the host: drag the object in through F, tap to type", () => {
  test("a drag paints live frame by frame, and the release keeps the last", () => {
    const { host, previews, warnings } = lensHandle(BASE);
    const sc = sceneOf(BASE);
    const t = tipOf(sc);
    expect(host.live).toBe(true);
    expect(host.grabbable(t)).toBe(true);
    expect(host.press(t)).toBe(true);
    for (let dx = 0; dx <= 300; dx += 20) host.move([t[0] + dx, t[1]]);
    const last = previews.at(-1)!;
    expect(last.object_distance as number).toBeLessThan(10);
    expect(host.release([t[0] + 300, t[1]])).toBe("drag");
    expect(previews.at(-1)).toMatchObject({ object_distance: last.object_distance });
    expect(warnings).toEqual([]);
  });
  test("a tap on d opens its field; a tap on the object passes on to the card", () => {
    const p = { ...BASE, show_distances: true };
    const { host, previews } = lensHandle(p);
    const sc = sceneOf(p);
    const c = centre(sc, "do_value");
    expect(host.scrubbable(c)).toBe(true);
    host.press(c);
    expect(host.release(c)).toBe("edit");
    expect(host.editField()!.field).toMatchObject({ value: 25 });
    expect(host.commitEdit("12")).toEqual({ ok: true });
    expect(previews.at(-1)).toMatchObject({ object_distance: 12 });
  });
  test("a tap on the object is not the body's: it passes on to the card", () => {
    const { host, previews } = lensHandle(BASE);
    const t = tipOf(sceneOf(BASE));
    host.press(t);
    expect(host.release(t)).toBe("pass");
    expect(previews).toEqual([]);
  });
});

describe("under a box fit", () => {
  // The box fit follows each frame's ink union (template-fit.ts: a figure
  // whose outermost ink moves "breathes slightly"), so there the
  // gesture stays within a few units of the pointer.
  test("the tip follows the pointer on a figure drawn into the right half", () => {
    const p = { ...BASE, box: "right" };
    const sc = sceneOf(p);
    const t0 = tipOf(sc);
    expect(t0[0]).toBeGreaterThan(450);
    const patch = frame(p, "object", t0, [30, 20]);
    const t1 = tipOf(sceneOf({ ...p, ...patch }));
    expect(Math.abs(t1[0] - (t0[0] + 30))).toBeLessThan(4);
    expect(Math.abs(t1[1] - (t0[1] + 20))).toBeLessThan(6);
  });
});
