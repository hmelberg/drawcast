// projectile_motion's live body (2026-09-28): drag the v₀ arrow's tip (angle
// and speed) or the platform (launch height), scrub or type the angle and
// v₀ — the parabola, apex, vectors, readouts and every {projectile.*} number
// recompute under the pointer, with the flight before the gesture left as a
// ghost. The body is the pack document's own `widget: |` (packs/physics.yaml).
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
const pageOf = (params: P) => layoutSpec({ template: "projectile_motion", params, commands: [] } as unknown as Spec);
const sceneOf = (params: P): WidgetScene => buildWidgetScene(scenes.projectile_motion, params, { layout: pageOf(params) })!;
const body = (): WidgetBody => scenes.projectile_motion.widget!();
const names = () => Object.keys((scenes.projectile_motion.manifest.params_schema as { properties: object }).properties);
const values = (params: P) => scenes.projectile_motion.layout!(params).values!;
const arrow = (sc: WidgetScene): Pt[] => sc.lines.get("v0")![0];
const tipOf = (sc: WidgetScene): Pt => arrow(sc).at(-1)!;
const launchOf = (sc: WidgetScene): Pt => arrow(sc)[0];
const landingOf = (sc: WidgetScene): Pt => sc.lines.get("path")![0].at(-1)!;
const centre = (sc: WidgetScene, id: string): Pt => {
  const b = sc.boxes.get(id)!;
  return [b.x + b.w / 2, b.y + b.h / 2];
};
function frame(params: P, id: string, from: Pt, to: Pt): P {
  const sc = sceneOf(params);
  const r = stepWidget(body(), null, dragMoveEvent(id, from, to, sc), sc, names());
  expect(r.errors).toEqual([]);
  return (r.effects[0]?.patch ?? {}) as P;
}
/** The pointer where the tip of a launch at `deg` and `v` is drawn. */
const tipFor = (sc: WidgetScene, deg: number, v: number): Pt => {
  const L = launchOf(sc), len = 24 + 10 * v, a = (deg * Math.PI) / 180;
  return [L[0] + len * Math.cos(a), L[1] + len * Math.sin(a)];
};
const BASE = { speed: 6, angle_deg: 45 };

describe("projectile_motion: the document's widget", () => {
  test("compiles as a live, editable body; free play only", () => {
    const m = scenes.projectile_motion;
    const b = body();
    expect(b.live).toBe(true);
    expect(typeof b.editable).toBe("function");
    expect(b.demo).toBeUndefined();
    expect(m.manifest.widget).toBeUndefined();
    const spec = { template: "projectile_motion", params: {}, commands: [{ ask: { question: "How far?", answer: "x", widget: "projectile_motion" } }] } as unknown as Spec;
    expect(lintCommands(spec).filter((i) => i.rule === "widget").map((i) => i.message).join()).toMatch(/free play only/);
  });

  test("the v₀ arrow, the platform and the numbers are its parts; the path and blank paper are not", () => {
    const p = { ...BASE, height: 2, show_values: true };
    const sc = sceneOf(p);
    const parts = body().parts!;
    expect(partAt(sc, tipOf(sc), 18, parts)).toBe("v0");
    expect(partAt(sc, centre(sc, "platform"), 18, parts)).toBe("platform");
    expect(partAt(sc, centre(sc, "angle_value"), 18, parts)).toBe("angle_value");
    expect(partAt(sc, centre(sc, "speed_value"), 18, parts)).toBe("speed_value");
    expect(partAt(sc, sc.lines.get("path")![0][30], 18, parts)).toBeNull();
    expect(partAt(sc, [900, 700], 18, parts)).toBeNull();
    expect((parts as (s: WidgetScene) => string[])(sceneOf(BASE))).toEqual(["v0"]);
  });
});

describe("the v₀ arrow: its tip is the angle and the speed", () => {
  test("the pointer's direction from the launch is the angle, its distance the speed", () => {
    const sc = sceneOf(BASE);
    expect(frame(BASE, "v0", tipOf(sc), tipFor(sc, 30, 8))).toMatchObject({ angle_deg: 30, speed: 8 });
    expect(frame(BASE, "v0", tipOf(sc), tipFor(sc, 70, 3.5))).toMatchObject({ angle_deg: 70, speed: 3.5 });
    // Grabbed mid-shaft, the tip moves by the pointer's travel — no jump.
    const L = launchOf(sc), t = tipOf(sc);
    const mid: Pt = [(L[0] + t[0]) / 2, (L[1] + t[1]) / 2];
    expect(frame(BASE, "v0", mid, mid)).toMatchObject({ angle_deg: 45, speed: 6 });
  });

  test("the tip stays under the pointer after the patch", () => {
    const sc = sceneOf(BASE);
    const to = tipFor(sc, 62, 7.3);
    const p2 = { ...BASE, ...frame(BASE, "v0", tipOf(sc), to) };
    const t2 = tipOf(sceneOf(p2));
    expect(t2[0]).toBeCloseTo(to[0], 0);
    expect(t2[1]).toBeCloseTo(to[1], 0);
  });

  test("clamps: 5–85°, speed 1–10", () => {
    const sc = sceneOf(BASE);
    const L = launchOf(sc);
    expect(frame(BASE, "v0", tipOf(sc), [L[0] + 80, L[1] - 40])).toMatchObject({ angle_deg: 5 });
    expect(frame(BASE, "v0", tipOf(sc), [L[0] - 10, L[1] + 80])).toMatchObject({ angle_deg: 85 });
    expect(frame(BASE, "v0", tipOf(sc), [L[0] + 5, L[1] + 5])).toMatchObject({ speed: 1 });
    expect(frame(BASE, "v0", tipOf(sc), [L[0] + 400, L[1] + 400])).toMatchObject({ speed: 10 });
  });

  test("the first move pins the view and leaves the flight before as the ghost", () => {
    const sc = sceneOf(BASE);
    const patch = frame(BASE, "v0", tipOf(sc), tipFor(sc, 30, 6));
    expect(patch.ghost).toEqual({ speed: 6, angle_deg: 45, height: 0 });
    expect(patch.view).toBeDefined();
    const sc2 = sceneOf({ ...BASE, ...patch });
    expect(sc2.ids).toContain("ghost_path");
    // The ghost is the old flight exactly where it was.
    expect(sc2.lines.get("ghost_path")![0].at(-1)![0]).toBeCloseTo(landingOf(sc)[0], 6);
    // Flatter at the same speed lands shorter, on the same page.
    expect(landingOf(sc2)[0]).toBeLessThan(landingOf(sc)[0]);
  });

  test("45° lands farthest; complementary angles land together", () => {
    const sc = sceneOf(BASE);
    const land = (deg: number) => landingOf(sceneOf({ ...BASE, ...frame(BASE, "v0", tipOf(sc), tipFor(sc, deg, 6)) }))[0];
    const x45 = land(45);
    for (const d of [20, 30, 40, 50, 60, 70]) expect(land(d)).toBeLessThan(x45);
    expect(land(30)).toBeCloseTo(land(60), 6);
    expect(land(20)).toBeCloseTo(land(70), 6);
  });

  test("a throw too fast for the pinned page pulls it back — the arrow's tip still follows", () => {
    const sc = sceneOf(BASE);
    const to = tipFor(sc, 45, 9);
    const p2 = { ...BASE, ...frame(BASE, "v0", tipOf(sc), to) };
    const sc2 = sceneOf(p2);
    expect(p2.speed).toBe(9);
    expect(landingOf(sc2)[0]).toBeLessThanOrEqual(120 + 690 + 1e-6);
    expect(tipOf(sc2)[0]).toBeCloseTo(to[0], 0);
    const out = pageOf(p2);
    expect([...out.issues, ...out.warnings]).toEqual([]);
  });
});

describe("the platform: drag the launch height", () => {
  test("up and down by the pointer's travel on the pinned page; it lowers to the ground", () => {
    const p = { ...BASE, height: 2 };
    const sc = sceneOf(p);
    const c = centre(sc, "platform");
    const top0 = launchOf(sc)[1];
    const up = frame(p, "platform", c, [c[0], c[1] + 30]);
    expect(up.height as number).toBeGreaterThan(2);
    expect(launchOf(sceneOf({ ...p, ...up }))[1]).toBeCloseTo(top0 + 30, 0);
    expect(frame(p, "platform", c, [c[0], c[1] - 2000]).height).toBe(0);
  });
  test("held to heights whose flight still fits the page — no pull-back from under the pointer", () => {
    const p = { ...BASE, height: 2 };
    const sc = sceneOf(p);
    const c = centre(sc, "platform");
    const top = frame(p, "platform", c, [c[0], c[1] + 3000]);
    expect(top.height as number).toBeLessThan(10);
    const q = { ...p, ...top };
    const v = values(q);
    const S = (landingOf(sceneOf(q))[0] - launchOf(sceneOf(q))[0]) / v.range;
    const S0 = (landingOf(sc)[0] - launchOf(sc)[0]) / values(p).range;
    expect(S).toBeCloseTo(S0, 1);
    const out = pageOf(q);
    expect([...out.issues, ...out.warnings]).toEqual([]);
  });
  test("from a height the best angle is below 45°: atan(v / √(v² + 2gh)), 29° here", () => {
    const at = (deg: number) => values({ speed: 6, angle_deg: deg, height: 4 }).range;
    expect(at(29)).toBeGreaterThan(at(45));
    expect(at(29)).toBeGreaterThan(at(24));
    expect(at(29)).toBeGreaterThan(at(34));
  });
});

describe("the numbers: scrub and type the angle and v₀", () => {
  const p = { ...BASE, show_values: true };
  test("the readouts: 45°, v₀ = 6, R and H", () => {
    const out = pageOf(p);
    const text = (id: string) => {
      const t = out.drawables.find((x) => x.id === id);
      return t && t.kind === "text" ? t.text : null;
    };
    expect(text("angle_value")).toBe("45°");
    expect(text("speed_value")).toBe("v₀ = 6");
    expect(text("apex_label")).toBe("H = 0.9");
    const range = out.drawables.find((x) => x.id === "range_mark");
    expect(JSON.stringify(range)).toContain("R = 3.6");
  });
  test("drag sideways: 1° or 0.1 per 4 units, from the press", () => {
    const sc = sceneOf(p);
    const a = centre(sc, "angle_value"), s = centre(sc, "speed_value");
    expect(frame(p, "angle_value", a, [a[0] + 40, a[1] + 3])).toMatchObject({ angle_deg: 55 });
    expect(frame(p, "angle_value", a, [a[0] - 400, a[1]])).toMatchObject({ angle_deg: 5 });
    expect(frame(p, "speed_value", s, [s[0] - 20, s[1]])).toMatchObject({ speed: 5.5 });
  });
  test("a tap opens a field; the typed number lands", () => {
    const sc = sceneOf(p);
    expect(body().editable!("angle_value", centre(sc, "angle_value"), sc)).toMatchObject({ value: 45, label: "Launch angle in degrees", min: 5, max: 85 });
    expect(body().editable!("speed_value", centre(sc, "speed_value"), sc)).toMatchObject({ value: 6, label: "Launch speed", min: 1, max: 10 });
    expect(body().editable!("v0", tipOf(sc), sc)).toBeNull();
    const run = runWidget(scenes.projectile_motion, p, [inputEvent("angle_value", 30)], { layout: pageOf(p) });
    expect(run.errors).toEqual([]);
    expect(run.params.angle_deg).toBe(30);
    expect(run.params.ghost).toMatchObject({ angle_deg: 45 });
  });
});

describe("the layout: values, the scale, lint", () => {
  test("values: range, max_height, time, angle, v0 — exact kinematics", () => {
    const v = values({ speed: 10, angle_deg: 30 });
    expect(v.range).toBeCloseTo((100 * Math.sin(Math.PI / 3)) / 10, 3);
    expect(v.max_height).toBeCloseTo(1.25, 3);
    expect(v.time).toBeCloseTo(1, 3);
    expect(v.angle).toBe(30);
    expect(v.v0).toBe(10);
    const h = values({ speed: 6, angle_deg: 30, height: 2 });
    expect(h.time).toBeCloseTo(1, 6);
    expect(h.range).toBeCloseTo(6 * Math.cos(Math.PI / 6), 3);
  });
  test("{projectile.*} tokens read the live numbers", () => {
    const spec = { template: "projectile_motion", params: { speed: 10, angle_deg: 45 }, elements: [{ id: "note", type: "text", at: [800, 690], text: "R = {projectile.range:1}" }], commands: [] } as unknown as Spec;
    const note = layoutSpec(spec).drawables.find((d) => d.id === "note");
    expect(note && note.kind === "text" ? note.text : null).toBe("R = 10.0");
  });
  test("the scale is the speed's, not the angle's: an angle sweep shows the true range", () => {
    const land = (deg: number) => landingOf(sceneOf({ speed: 6, angle_deg: deg }))[0];
    expect(land(45)).toBeCloseTo(120 + 650, 6); // 45° fills the width
    expect(land(30)).toBeCloseTo(120 + 650 * Math.sin(Math.PI / 3), 6);
    expect(land(30)).toBeCloseTo(land(60), 6);
  });
  test("every angle, speed, height, readout: lint clean", () => {
    for (const view of [undefined, { range: 3.6, height: 2.4 }])
      for (const speed of [1, 2.5, 6, 10])
        for (const angle_deg of [5, 12, 25, 34, 45, 58, 72, 85])
          for (const height of [0, 1.5, 8])
            for (const show_values of [false, true]) {
              const out = pageOf({ speed, angle_deg, height, show_values, show_components: true, ghost: { speed: 6, angle_deg: 45 }, ...(view ? { view } : {}) });
              expect([...out.issues.map((i) => `${speed} ${angle_deg} ${height}: ${i.message}`), ...out.warnings]).toEqual([]);
            }
  });
});

describe("the movie: animate the angle", () => {
  const spec = { template: "projectile_motion", params: { speed: 6, angle_deg: 20, show_values: true }, commands: [{ draw: ["ground", "path", "v0", "speed_value", "angle_arc", "angle_value", "range_mark"] }, { animate: { angle_deg: 70 }, duration: 5 }] } as unknown as Spec;
  test("the planner tweens angle_deg 20 → 70 with no warning", () => {
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
    expect(step.targets).toEqual({ angle_deg: 70 });
    expect(step.starts).toEqual({ angle_deg: 20 });
    expect(p.warnings).toEqual([]);
  });
  test("the landing rises to its farthest at 45° and falls back, frame by frame", () => {
    const xs = [20, 30, 40, 45, 50, 60, 70].map((a) => landingOf(sceneOf({ speed: 6, angle_deg: a }))[0]);
    expect(xs[3]).toBe(Math.max(...xs));
    expect(xs[0]).toBeLessThan(xs[1]);
    expect(xs[5]).toBeGreaterThan(xs[6]);
  });
});

// ---- the host ---------------------------------------------------------------

function projHandle(params: P) {
  const spec = { template: "projectile_motion", params, commands: [] } as unknown as RenderHandle["spec"];
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

describe("the host: throw again, tap to type", () => {
  test("a drag of the tip paints live and the release keeps it", () => {
    const { host, previews, warnings } = projHandle(BASE);
    const sc = sceneOf(BASE);
    const t = tipOf(sc);
    expect(host.grabbable(t)).toBe(true);
    expect(host.press(t)).toBe(true);
    for (let a = 45; a >= 25; a -= 2) host.move(tipFor(sc, a, 6));
    expect(previews.at(-1)).toMatchObject({ angle_deg: 25, speed: 6 });
    expect(host.release(tipFor(sc, 25, 6))).toBe("drag");
    expect(previews.at(-1)).toMatchObject({ angle_deg: 25, ghost: { angle_deg: 45 } });
    expect(warnings).toEqual([]);
  });
  test("a tap on the angle opens its field; a tap on the arrow passes on", () => {
    const p = { ...BASE, show_values: true };
    const { host, previews } = projHandle(p);
    const sc = sceneOf(p);
    const c = centre(sc, "angle_value");
    host.press(c);
    expect(host.release(c)).toBe("edit");
    expect(host.commitEdit("60")).toEqual({ ok: true });
    expect(previews.at(-1)).toMatchObject({ angle_deg: 60 });
    const other = projHandle(BASE);
    const t = tipOf(sceneOf(BASE));
    other.host.press(t);
    expect(other.host.release(t)).toBe("pass");
  });
});
