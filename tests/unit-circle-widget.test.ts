// unit_circle's live body (2026-09-27): drag the point round the circle, scrub
// or type the angle — everything recomputes under the pointer. The body is
// the pack document's own `widget: |` (packs/mathlogic.yaml), free play only.
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
  await ensureEnabledPacks(["mathlogic"]);
});

const O: Pt = [500, 380];
const R = 240;
const at = (deg: number, r = R): Pt => [O[0] + r * Math.cos((deg * Math.PI) / 180), O[1] + r * Math.sin((deg * Math.PI) / 180)];
const pageOf = (params: Record<string, unknown>) => layoutSpec({ template: "unit_circle", params, commands: [] } as unknown as Spec);
const sceneOf = (params: Record<string, unknown>): WidgetScene => buildWidgetScene(scenes.unit_circle, params, { layout: pageOf(params) })!;
const body = (): WidgetBody => scenes.unit_circle.widget!();
const names = () => Object.keys((scenes.unit_circle.manifest.params_schema as { properties: object }).properties);
const centre = (sc: WidgetScene, id: string): Pt => {
  const b = sc.boxes.get(id)!;
  return [b.x + b.w / 2, b.y + b.h / 2];
};
/** The angle a drag of the point from `a0` through `path` (degrees, pointer directions) ends at. */
function dragThrough(a0: number, path: number[], params: Record<string, unknown> = {}): number {
  const p = { angle_deg: a0, ...params };
  const sc = sceneOf(p);
  const b = body();
  let state = b.init(sc);
  let last: number | null = null;
  for (const deg of path) {
    const r = stepWidget(b, state, dragMoveEvent("point", at(a0), at(deg), sc), sc, names());
    expect(r.errors).toEqual([]);
    state = r.state;
    last = (r.effects[0]?.patch?.angle_deg as number | undefined) ?? last;
  }
  return last!;
}
/** A sweep from a0 to a1 in 1° steps, so the unwrap sees every frame. */
const sweep = (a0: number, a1: number): number[] => Array.from({ length: Math.abs(a1 - a0) + 1 }, (_, i) => a0 + Math.sign(a1 - a0) * i);

describe("unit_circle: the document's widget", () => {
  test("compiles as a live, editable body; free play only — no manifest widget flag, so no ask binds to it", () => {
    const m = scenes.unit_circle;
    expect(m.widget).toBeDefined();
    const b = body();
    expect(b.live).toBe(true);
    expect(typeof b.editable).toBe("function");
    expect(b.demo).toBeUndefined();
    expect(m.manifest.widget).toBeUndefined();
    const spec = { template: "unit_circle", params: {}, commands: [{ ask: { question: "Where?", answer: "x", widget: "unit_circle" } }] } as unknown as Spec;
    const issues = lintCommands(spec).filter((i) => i.rule === "widget");
    expect(issues.map((i) => i.message).join()).toMatch(/free play only/);
  });

  test("the point and the radius are its handles, the readout and θ its numbers; blank paper and the axes are not", () => {
    const sc = sceneOf({ angle_deg: 30, readout: "deg" });
    const parts = body().parts!;
    // The radius ends in the point, and a stroke within reach wins: either way the same gesture.
    expect(["point", "radius"]).toContain(partAt(sc, at(30), 18, parts));
    expect(["point", "radius"]).toContain(partAt(sc, at(30, R + 10), 18, parts)); // a fat finger just past the dot
    expect(partAt(sc, at(30, 120), 18, parts)).toBe("radius");
    expect(partAt(sc, centre(sc, "angle_value"), 18, parts)).toBe("angle_value");
    expect(partAt(sc, [900, 100], 18, parts)).toBeNull();
    expect(partAt(sc, [O[0] + R + 30, O[1]], 18, parts)).toBeNull(); // the x-axis past the circle
    // No readout drawn: its number is not a part.
    expect((body().parts as (s: WidgetScene) => string[])(sceneOf({ angle_deg: 30 }))).not.toContain("angle_value");
  });
});

describe("the drag: the pointer's direction from the origin is the angle", () => {
  test("every quadrant, from a 30° press", () => {
    expect(dragThrough(30, [72])).toBe(72);
    expect(dragThrough(30, sweep(30, 160))).toBe(160);
    expect(dragThrough(30, sweep(30, 200))).toBe(200);
    expect(dragThrough(30, sweep(30, 290))).toBe(290);
    expect(dragThrough(30, [-20])).toBe(-20); // clockwise past 0: negative, not 340
  });

  test("the pointer need not be on the circle: anywhere along the same direction", () => {
    expect(dragThrough(30, [100].map((d) => d))).toBe(100);
    const sc = sceneOf({ angle_deg: 30 });
    const r = stepWidget(body(), null, dragMoveEvent("radius", at(30, 100), at(110, 60), sc), sc, names());
    expect(r.effects[0].patch).toEqual({ angle_deg: 110 });
  });

  test("wrap-around keeps count of the turns: once round is 390, back the other way −330", () => {
    expect(dragThrough(30, sweep(30, 390))).toBe(390);
    expect(dragThrough(30, sweep(30, -330))).toBe(-330);
    expect(dragThrough(350, sweep(350, 372))).toBe(372);
    // A start past a full turn stays on its own turn.
    expect(dragThrough(400, [52])).toBe(412);
  });

  test("a jump across the ±180 seam in one frame is the short way round, not 360 off", () => {
    expect(dragThrough(175, [-172])).toBe(188);
    expect(dragThrough(-175, [172])).toBe(-188);
  });

  test("snapping: within 3° of a multiple of 30 or 45 it settles there; beyond, free", () => {
    expect(dragThrough(10, [28])).toBe(30);
    expect(dragThrough(10, [32.5])).toBe(30);
    expect(dragThrough(10, [43])).toBe(45);
    expect(dragThrough(10, [34])).toBe(34);
    expect(dragThrough(10, [37.5])).toBe(37.5);
    expect(dragThrough(100, [88])).toBe(90);
    expect(dragThrough(100, [136])).toBe(135);
    expect(dragThrough(200, [212])).toBe(210);
    expect(dragThrough(300, [-2.5 + 360])).toBe(360);
    expect(dragThrough(30, sweep(30, 388))).toBe(390); // on the second turn too
  });

  test("the origin has no direction: a pointer on it keeps the angle", () => {
    const sc = sceneOf({ angle_deg: 30 });
    const b = body();
    const s1 = stepWidget(b, b.init(sc), dragMoveEvent("radius", at(30, 100), at(80, 100), sc), sc, names());
    const s2 = stepWidget(b, s1.state, dragMoveEvent("radius", at(30, 100), [O[0] + 3, O[1] - 2], sc), sc, names());
    expect(s2.effects[0].patch).toEqual({ angle_deg: 80 });
  });

  test("the release delivers the same angle as the last frame", () => {
    const sc = sceneOf({ angle_deg: 30 });
    const run = runWidget(scenes.unit_circle, { angle_deg: 30 }, [...sweep(30, 250).map((d) => dragMoveEvent("point", at(30), at(d), sc)), { type: "drag", id: "point", to: null, point: at(250), domain: null, from: at(30), fromDomain: null }], { layout: pageOf({ angle_deg: 30 }) });
    expect(run.errors).toEqual([]);
    expect(run.params.angle_deg).toBe(250);
  });

  test("under a box fit the origin is where it is painted", () => {
    const params = { angle_deg: 30, box: "right" };
    const layout = layoutSpec({ template: "unit_circle", params, commands: [] } as unknown as Spec);
    const sc = buildWidgetScene(scenes.unit_circle, params, { layout })!;
    const o = sc.lines.get("radius")![0][0];
    expect(o[0]).toBeGreaterThan(600);
    const r = stepWidget(body(), null, dragMoveEvent("point", [0, 0], [o[0], o[1] + 50], sc), sc, names());
    expect(r.effects[0].patch).toEqual({ angle_deg: 90 });
  });
});

describe("the number: scrub and type", () => {
  test("drag sideways: 1° per 4 units, from the press-time angle, whole degrees", () => {
    const sc = sceneOf({ angle_deg: 30, readout: "deg" });
    const p = centre(sc, "angle_value");
    const step = (dx: number) => stepWidget(body(), null, dragMoveEvent("angle_value", p, [p[0] + dx, p[1] + 5], sc), sc, names()).effects[0].patch;
    expect(step(40)).toEqual({ angle_deg: 40 });
    expect(step(-41)).toEqual({ angle_deg: 20 });
    expect(step(3)).toEqual({ angle_deg: 30 });
  });

  test("a tap opens a field in degrees; the typed number is the angle", () => {
    const sc = sceneOf({ angle_deg: 30, readout: "both" });
    const f = body().editable!("angle_value", centre(sc, "angle_value"), sc);
    expect(f).toMatchObject({ value: 30, label: "Angle in degrees", min: -1080, max: 1080 });
    expect(body().editable!("point", at(30), sc)).toBeNull();
    const run = runWidget(scenes.unit_circle, { angle_deg: 30, readout: "both" }, [inputEvent("angle_value", 22.5)]);
    expect(run.params.angle_deg).toBe(22.5); // typed degrees are taken as typed — no snap
  });

  test("the θ label is the number too where no readout is drawn", () => {
    const sc = sceneOf({ angle_deg: 30 });
    expect(sc.ids).toContain("angle_label");
    expect(body().editable!("angle_label", centre(sc, "angle_label"), sc)).toMatchObject({ value: 30 });
  });

  test("radians alone: the field is in radians, and a typed radian near a multiple of 15° lands on it", () => {
    const sc = sceneOf({ angle_deg: 60, readout: "rad" });
    expect(body().editable!("angle_value", centre(sc, "angle_value"), sc)).toMatchObject({ value: 1.0472, label: "Angle in radians" });
    expect(runWidget(scenes.unit_circle, { readout: "rad" }, [inputEvent("angle_value", 1.047)]).params.angle_deg).toBe(60);
    expect(runWidget(scenes.unit_circle, { readout: "rad" }, [inputEvent("angle_value", 3.1416)]).params.angle_deg).toBe(180);
    expect(runWidget(scenes.unit_circle, { readout: "rad" }, [inputEvent("angle_value", 1)]).params.angle_deg).toBeCloseTo(57.2958, 3);
  });
});

describe("the layout: readout and values", () => {
  const text = (params: Record<string, unknown>) => {
    const d = scenes.unit_circle.layout!(params).drawables.find((x) => x.id === "angle_value");
    return d && d.kind === "text" ? d.text : null;
  };
  test("no readout by default (the bundled figure is unchanged)", () => {
    expect(text({ angle_deg: 30 })).toBeNull();
  });
  test("degrees whole (or a typed tenth), radians as a fraction of π on multiples of 15°", () => {
    expect(text({ angle_deg: 60, readout: "deg" })).toBe("θ = 60°");
    expect(text({ angle_deg: 137.4312, readout: "deg" })).toBe("θ = 137°");
    expect(text({ angle_deg: 22.5, readout: "deg" })).toBe("θ = 22.5°");
    expect(text({ angle_deg: -30, readout: "deg" })).toBe("θ = −30°");
    expect(text({ angle_deg: 60, readout: "rad" })).toBe("θ = π/3");
    expect(text({ angle_deg: 180, readout: "rad" })).toBe("θ = π");
    expect(text({ angle_deg: 390, readout: "rad" })).toBe("θ = 13π/6");
    expect(text({ angle_deg: -90, readout: "rad" })).toBe("θ = −π/2");
    expect(text({ angle_deg: 0, readout: "rad" })).toBe("θ = 0");
    expect(text({ angle_deg: 57, readout: "rad" })).toBe("θ = 0.99 rad");
    expect(text({ angle_deg: 135, readout: "both" })).toBe("θ = 135° = 3π/4");
  });
  test("values: theta_deg, theta_rad, sin, cos, tan, quadrant — tan absent where the radius is vertical", () => {
    const v = (a: number) => scenes.unit_circle.layout!({ angle_deg: a }).values!;
    expect(v(30).theta_deg).toBe(30);
    expect(v(30).theta_rad).toBeCloseTo(Math.PI / 6, 12);
    expect(v(30).sin).toBeCloseTo(0.5, 12);
    expect(v(30).cos).toBeCloseTo(Math.sqrt(3) / 2, 12);
    expect(v(30).tan).toBeCloseTo(1 / Math.sqrt(3), 12);
    expect([v(30).quadrant, v(120).quadrant, v(200).quadrant, v(300).quadrant, v(-30).quadrant, v(400).quadrant]).toEqual([1, 2, 3, 4, 4, 1]);
    expect(v(90).quadrant).toBe(0);
    expect(v(90).tan).toBeUndefined();
    expect(v(180).sin).toBe(0);
    expect(v(390).theta_deg).toBe(390);
  });
  test("{unit_circle.*} tokens in a cast's own text read the live numbers", () => {
    const spec = { template: "unit_circle", params: { angle_deg: 150 }, elements: [{ id: "note", type: "text", at: [820, 690], text: "sin = {unit_circle.sin:2}" }], commands: [] } as unknown as Spec;
    const out = layoutSpec(spec);
    const note = out.drawables.find((d) => d.id === "note");
    expect(note && note.kind === "text" ? note.text : null).toBe("sin = 0.50");
  });
  test("every readout, all four quadrants: lint clean", () => {
    for (const readout of ["deg", "rad", "both"]) {
      for (const a of [0, 10, -10, 30, 90, 135, 170, 180, 190, 225, 270, 269.9, 315, 390]) {
        const out = pageOf({ angle_deg: a, readout, quadrant_labels: true });
        expect(out.issues.filter((i) => i.severity === "error" || i.severity === "warn").map((i) => `${readout} ${a}: ${i.rule} ${i.message}`)).toEqual([]);
      }
    }
  });
});

describe("the movie: animate sweeps the point round", () => {
  const spec = { template: "unit_circle", params: { angle_deg: 0, readout: "deg" }, commands: [{ draw: ["x_axis", "y_axis", "circle", "radius", "point", "angle_value"] }, { animate: { angle_deg: 360 }, duration: 4 }] } as unknown as Spec;
  test("the planner tweens angle_deg 0 → 360 with no warning", () => {
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
    expect(step.targets).toEqual({ angle_deg: 360 });
    expect(step.starts).toEqual({ angle_deg: 0 });
    expect(p.warnings).toEqual([]);
  });
  test("each frame's layout puts the point at the tweened angle, and the readout follows", () => {
    for (const a of [0, 90, 179.63, 270, 360]) {
      const out = scenes.unit_circle.layout!({ angle_deg: a, readout: "deg" });
      const pt = out.anchors.point;
      expect(pt[0]).toBeCloseTo(at(a)[0], 6);
      expect(pt[1]).toBeCloseTo(at(a)[1], 6);
      const t = out.drawables.find((d) => d.id === "angle_value");
      expect(t && t.kind === "text" ? t.text : "").toBe(`θ = ${Math.round(a)}°`);
    }
  });
});

// ---- the host: the live path end to end ------------------------------------

function ucHandle(params: Record<string, unknown>) {
  const spec = { template: "unit_circle", params, commands: [] } as unknown as RenderHandle["spec"];
  const layout = layoutSpec(spec);
  const previews: Record<string, unknown>[] = [];
  let painted: ReturnType<typeof layoutSpec> | null = null;
  const timeline = {
    state: "paused",
    position: 1,
    vars: new Map<string, string>(),
    callbacks: {},
    previewParams: (o: Record<string, unknown>) => {
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

describe("the host: drag round, tap to type", () => {
  test("a drag of the point round all four quadrants paints live, and the release keeps it", () => {
    const { host, previews, warnings } = ucHandle({ angle_deg: 30, readout: "deg" });
    expect(host.live).toBe(true);
    expect(host.grabbable(at(30))).toBe(true);
    expect(host.press(at(30))).toBe(true);
    for (const d of sweep(30, 330)) host.move(at(d));
    expect(previews.at(-1)).toMatchObject({ angle_deg: 330 });
    expect(host.release(at(330))).toBe("drag");
    expect(previews.at(-1)).toMatchObject({ angle_deg: 330 });
    expect(warnings).toEqual([]);
  });

  test("a tap on the readout opens its field; the typed angle lands", () => {
    const { host, previews } = ucHandle({ angle_deg: 30, readout: "deg" });
    const b = elementBBoxes(layoutSpec({ template: "unit_circle", params: { angle_deg: 30, readout: "deg" }, commands: [] } as unknown as Spec)).get("angle_value")!;
    const p: Pt = [b.x + b.w / 2, b.y + b.h / 2];
    expect(host.scrubbable(p)).toBe(true);
    host.press(p);
    expect(host.release(p)).toBe("edit");
    expect(host.editField()!.field).toMatchObject({ value: 30, label: "Angle in degrees" });
    expect(host.commitEdit("225")).toEqual({ ok: true });
    expect(previews.at(-1)).toMatchObject({ angle_deg: 225 });
  });

  test("a tap on the point is not the body's: it passes on to the card", () => {
    const { host, previews } = ucHandle({ angle_deg: 30 });
    host.press(at(30));
    expect(host.release(at(30))).toBe("pass");
    expect(previews).toEqual([]);
  });
});
