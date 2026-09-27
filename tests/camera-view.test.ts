// The camera beyond one page (2026-09-27): a template world larger than the
// page, the viewer's paused pan/zoom math, and `camera: {on: …}`.
import { afterEach, describe, expect, test } from "vitest";
import { CANVAS, FULL_VIEW } from "../src/layout/canvas";
import {
  atRest,
  cameraBox,
  clampView,
  fitZoom,
  FIT_MAX_ZOOM,
  FIT_SHORT_MIN_ZOOM,
  looksLikeMouseWheel,
  MIN_VIEW_W,
  panBy,
  pinchStep,
  restView,
  restZoom,
  wheelZoomFactor,
  zoomAbout,
} from "../src/render/camera";
import { planCommands, type PlanStep } from "../src/render/plan";
import { layoutSpec, elementBBoxes } from "../src/layout/layout";
import { scenes } from "../src/scenes/registry";
import { defaultDrawOpts, defaultStyle } from "../src/layout/model";
import { validateSpec } from "../src/spec/schema";
import type { BBox } from "../src/layout/geometry";

const PAGE: BBox = { x: 0, y: 0, w: CANVAS.w, h: CANVAS.h };
/** Three pages wide, one and a half deep, grown right and down from the page. */
const WORLD: BBox = { x: 0, y: -375, w: 3000, h: 1125 };
const close = (a: BBox, b: BBox, digits = 6) => {
  for (const k of ["x", "y", "w", "h"] as const) expect(a[k]).toBeCloseTo(b[k], digits);
};

describe("restView", () => {
  test("no world, or a world inside the page, rests on FULL_VIEW", () => {
    expect(restView()).toEqual({ ...FULL_VIEW, x: 0, y: 0 });
    expect(restView({ x: 100, y: 100, w: 300, h: 200 })).toEqual(restView());
    expect(restView({ x: 0, y: 0, w: NaN, h: 5 })).toEqual(restView());
  });
  test("a wide world is fitted at the page's aspect, letterboxed about its centre", () => {
    const r = restView(WORLD);
    expect(r.w / r.h).toBeCloseTo(CANVAS.w / CANVAS.h, 9);
    // 3000 wide decides: 2250 tall, centred on the world's middle (y 187.5).
    close(r, { x: 0, y: 187.5 - 1125, w: 3000, h: 2250 });
    expect(restZoom(r)).toBeCloseTo(1 / 3, 9);
  });
  test("the page always stays in the overview", () => {
    const r = restView({ x: 1200, y: 0, w: 800, h: 750 }); // a world beside the page
    expect(r.x).toBeLessThanOrEqual(0);
    expect(r.x + r.w).toBeGreaterThanOrEqual(2000);
  });
});

describe("the viewer's view", () => {
  const rest = restView(WORLD);
  test("zoomAbout keeps the pivot where it is on screen", () => {
    const b = rest;
    const pivot: [number, number] = [2400, 100];
    const z = zoomAbout(b, 2, pivot, rest);
    expect(z.w).toBeCloseTo(b.w / 2, 9);
    // The pivot's fraction across the view is unchanged.
    expect((pivot[0] - z.x) / z.w).toBeCloseTo((pivot[0] - b.x) / b.w, 9);
    expect((pivot[1] - z.y) / z.h).toBeCloseTo((pivot[1] - b.y) / b.h, 9);
  });
  test("zoom clamps at 8× the page and out at the rest view", () => {
    let b = rest;
    for (let i = 0; i < 40; i++) b = zoomAbout(b, 1.5, [500, 300], rest);
    expect(b.w).toBeCloseTo(MIN_VIEW_W, 9);
    for (let i = 0; i < 40; i++) b = zoomAbout(b, 1 / 1.5, [500, 300], rest);
    expect(b).toEqual(rest);
    expect(atRest(b, rest)).toBe(true);
  });
  test("a pan never leaves the rest view", () => {
    const z = zoomAbout(rest, 3, [1500, 187.5], rest);
    const far = panBy(z, 1e6, -1e6, rest);
    expect(far.x + far.w).toBeCloseTo(rest.x + rest.w, 9);
    expect(far.y).toBeCloseTo(rest.y, 9);
    expect(far.w).toBeCloseTo(z.w, 9);
    // At rest there is nothing to pan.
    expect(panBy(rest, 50, 50, rest)).toEqual(rest);
  });
  test("clampView keeps the page's aspect and slides rather than shrinks", () => {
    const c = clampView({ x: -500, y: 0, w: 400, h: 300 }, PAGE);
    expect(c).toEqual({ x: 0, y: 0, w: 400, h: 300 });
    expect(clampView({ x: 0, y: 0, w: 5000, h: 10 }, PAGE)).toEqual(PAGE);
  });
  test("a pinch with still fingers apart zooms about their midpoint; a moved pinch pans too", () => {
    const b = { x: 0, y: 0, w: 500, h: 375 };
    const zoom = pinchStep(b, { mid: [250, 200], spread: 100 }, { mid: [250, 200], spread: 200 }, PAGE);
    close(zoom, zoomAbout(b, 2, [250, 200], PAGE));
    // Same spread, midpoint slid right by 40 logical units: the paper follows the fingers.
    const pan = pinchStep(b, { mid: [250, 200], spread: 100 }, { mid: [290, 200], spread: 100 }, PAGE);
    close(pan, b); // already at the left edge: clamped
    const mid = pinchStep({ x: 200, y: 100, w: 500, h: 375 }, { mid: [450, 300], spread: 100 }, { mid: [490, 300], spread: 100 }, PAGE);
    close(mid, { x: 160, y: 100, w: 500, h: 375 });
  });
  test("wheel: a mouse notch is capped, a trackpad pinch is gentle, both zoom in on a negative delta", () => {
    expect(wheelZoomFactor({ deltaY: -100, deltaMode: 0 })).toBeCloseTo(Math.exp(0.48), 9);
    expect(wheelZoomFactor({ deltaY: 3, deltaMode: 0 })).toBeLessThan(1);
    expect(wheelZoomFactor({ deltaY: 3, deltaMode: 0 })).toBeGreaterThan(0.95);
    expect(looksLikeMouseWheel({ deltaX: 0, deltaY: 100, deltaMode: 0 })).toBe(true);
    expect(looksLikeMouseWheel({ deltaX: 0, deltaY: 1, deltaMode: 1 })).toBe(true);
    expect(looksLikeMouseWheel({ deltaX: 2, deltaY: 12, deltaMode: 0 })).toBe(false);
  });
});

describe("cameraBox and fitZoom", () => {
  test("on one page: zoom 1 is the rest (null), zoom 2 half a page, clamped inside", () => {
    expect(cameraBox(500, 375, 1, PAGE)).toBeNull();
    expect(cameraBox(0, 0, 2, PAGE)).toEqual({ x: 0, y: 0, w: 500, h: 375 });
  });
  test("on a world: zoom stays page-relative, zoom 1 is one page, and the rest zoom is null", () => {
    const rest = restView(WORLD);
    expect(cameraBox(2500, -100, 1, rest)).toEqual({ x: 2000, y: -475, w: 1000, h: 750 });
    expect(cameraBox(1500, 0, restZoom(rest), rest)).toBeNull();
  });
  test("fitZoom frames the tighter side with the margin", () => {
    expect(fitZoom({ x: 0, y: 0, w: 500, h: 100 }, 1)).toBe(2);
    expect(fitZoom({ x: 0, y: 0, w: 0, h: 100 }, 1)).toBeNull();
  });
  test("a wide, short target (a matrix row) is framed close, cropped at the sides; a small one does not balloon", () => {
    // 830 × 40 at margin 1.4 would be zoom 0.86 — the page, no zoom at all.
    expect(fitZoom({ x: 85, y: 400, w: 830, h: 40 }, 1.4)).toBe(FIT_SHORT_MIN_ZOOM);
    // A tall-enough wide target keeps its whole-width fit.
    expect(fitZoom({ x: 0, y: 0, w: 700, h: 300 }, 1.4)).toBeCloseTo(1000 / 980, 9);
    // A cell stops at FIT_MAX_ZOOM.
    expect(fitZoom({ x: 0, y: 0, w: 40, h: 25 }, 1.4)).toBe(FIT_MAX_ZOOM);
    // On a world, a target larger than the page still frames below 1.
    expect(fitZoom({ x: 0, y: 0, w: 2000, h: 900 }, 1.4)!).toBeLessThan(1);
  });
  test("camera on a matrix row: centred on it, closer than the page", () => {
    const row = { x: 85, y: 400, w: 830, h: 40 };
    const p = planCommands([{ draw: ["row"] }, { camera: { on: "row" } }], ["row"], { bboxOf: (id) => (id === "row" ? row : null) });
    const box = p.steps.find((s): s is Extract<PlanStep, { kind: "camera" }> => s.kind === "camera")!.box!;
    expect(box.w).toBeCloseTo(1000 / FIT_SHORT_MIN_ZOOM, 6);
    expect(box.x + box.w / 2).toBeCloseTo(500, 6);
    expect(box.y).toBeLessThan(row.y);
    expect(box.y + box.h).toBeGreaterThan(row.y + row.h);
  });
});

describe("camera commands", () => {
  const boxes: Record<string, BBox> = {
    a: { x: 100, y: 100, w: 100, h: 50 },
    b: { x: 300, y: 200, w: 100, h: 50 },
    far: { x: 2600, y: -300, w: 200, h: 100 },
  };
  const bboxOf = (id: string) => boxes[id] ?? null;
  const cameraSteps = (p: ReturnType<typeof planCommands>) => p.steps.filter((s): s is Extract<PlanStep, { kind: "camera" }> => s.kind === "camera");

  test("`on` frames one element exactly as center.ref + zoom fit does", () => {
    const viaOn = cameraSteps(planCommands([{ draw: ["a"] }, { camera: { on: "a" } }], ["a"], { bboxOf }));
    const viaFit = cameraSteps(planCommands([{ draw: ["a"] }, { camera: { center: { ref: "a" }, zoom: "fit" } }], ["a"], { bboxOf }));
    expect(viaOn[0].box).not.toBeNull();
    expect(viaOn[0].box).toEqual(viaFit[0].box);
  });
  test("`on` a list frames their union; a number zoom overrides the fit", () => {
    const [s] = cameraSteps(planCommands([{ draw: ["a", "b"] }, { camera: { on: ["a", "b"] } }], ["a", "b"], { bboxOf }));
    const box = s.box!;
    for (const id of ["a", "b"]) {
      const b = boxes[id];
      expect(b.x).toBeGreaterThanOrEqual(box.x);
      expect(b.x + b.w).toBeLessThanOrEqual(box.x + box.w);
      expect(b.y).toBeGreaterThanOrEqual(box.y);
      expect(b.y + b.h).toBeLessThanOrEqual(box.y + box.h);
    }
    const [n] = cameraSteps(planCommands([{ camera: { on: ["a", "b"], zoom: 4 } }], ["a", "b"], { bboxOf }));
    expect(n.box!.w).toBeCloseTo(250, 9);
  });
  test("`on` frames an element with its attached words (a tree's node and its name)", () => {
    const withName: Record<string, BBox> = { ...boxes, a_name: { x: 200, y: 110, w: 180, h: 30 } };
    const p = planCommands([{ camera: { on: "a" } }], ["a", "a_name"], { bboxOf: (id) => withName[id] ?? null, attachedTo: (id) => (id === "a" ? ["a_name"] : []) });
    const box = cameraSteps(p)[0].box!;
    expect(box.x + box.w).toBeGreaterThanOrEqual(380);
    expect(box.x).toBeLessThanOrEqual(100);
  });
  test("an unknown id in `on` warns and the rest still frame", () => {
    const p = planCommands([{ camera: { on: ["a", "nope"] } }], ["a"], { bboxOf });
    expect(p.warnings.join(" ")).toMatch(/nope/);
    expect(cameraSteps(p)[0].box).not.toBeNull();
  });
  test("on a world: an element off the page is reachable, and reset returns to the whole world", () => {
    const p = planCommands([{ camera: { on: "far" } }, { camera: { reset: true } }, { camera: { zoom: 1 } }], ["far"], { bboxOf, world: WORLD });
    const [on, reset, one] = cameraSteps(p);
    const far = boxes.far;
    expect(on.box!.x).toBeLessThanOrEqual(far.x);
    expect(on.box!.x + on.box!.w).toBeGreaterThanOrEqual(far.x + far.w);
    expect(reset.box).toBeNull();
    // zoom 1 on a world is one page — no longer "the rest".
    expect(one.box!.w).toBeCloseTo(CANVAS.w, 9);
  });
  test("on a world, fit may frame a target larger than the page (zoom below 1)", () => {
    const big = { x: 0, y: -300, w: 2000, h: 900 };
    const p = planCommands([{ camera: { on: "big" } }], ["big"], { bboxOf: (id) => (id === "big" ? big : null), world: WORLD });
    const box = cameraSteps(p)[0].box!;
    expect(box.w).toBeGreaterThan(CANVAS.w);
    expect(box.w).toBeLessThan(restView(WORLD).w);
  });
  test("the schema takes `on` alone", () => {
    const r = validateSpec({ elements: [{ id: "a", type: "text", text: "A", x: 100, y: 100 }], commands: [{ draw: ["a"] }, { camera: { on: ["a"] } }] });
    expect(r.ok).toBe(true);
  });
});

describe("a template that reports a world", () => {
  afterEach(() => {
    delete scenes.temp_world_scene;
  });
  const install = (world?: BBox) => {
    scenes.temp_world_scene = {
      manifest: { name: "temp_world_scene", status: "ready", description: "test-only", params_schema: {}, element_ids: {}, examples: [] },
      layout: () => ({
        drawables: [
          { id: "root", kind: "stroke" as const, pts: [[100, 400], [300, 400]] as [number, number][], z: 1, style: defaultStyle(), drawOpts: defaultDrawOpts("sketch") },
          { id: "leaf", kind: "stroke" as const, pts: [[2600, -200], [2900, -200]] as [number, number][], z: 1, style: defaultStyle(), drawOpts: defaultDrawOpts("sketch") },
        ],
        labels: [
          { id: "leaf_label", anchor: [2990, -200] as [number, number], side: "right" as const, text: "Death", fontSize: 20, style: defaultStyle(), drawOpts: defaultDrawOpts("sketch") },
        ],
        anchors: {},
        order: ["root", "leaf", "leaf_label"],
        ...(world ? { world } : {}),
      }),
    };
  };

  test("the layout carries the world, and off-page ink is not out of canvas", () => {
    install(WORLD);
    const r = layoutSpec({ template: "temp_world_scene", commands: [{ draw: ["root", "leaf"] }] });
    expect(r.world).toEqual(WORLD);
    expect(r.issues.filter((i) => i.rule === "out-of-canvas")).toEqual([]);
    expect(r.fit).toBeUndefined(); // never grown: the camera brings it in
    // The label is placed inside the world, not clamped back onto the page.
    const label = elementBBoxes(r).get("leaf_label")!;
    expect(label.x).toBeGreaterThan(CANVAS.w);
    expect(label.x + label.w).toBeLessThanOrEqual(WORLD.x + WORLD.w);
  });
  test("without the world the same ink is out of canvas (the opt-in is the whole change)", () => {
    install();
    const r = layoutSpec({ template: "temp_world_scene", commands: [{ draw: ["root", "leaf"] }] });
    expect(r.world).toBeUndefined();
    expect(r.issues.some((i) => i.rule === "out-of-canvas")).toBe(true);
  });
  test("ink beyond the reported world is still out of bounds, named against the world", () => {
    install({ x: 0, y: 0, w: 2000, h: 750 });
    const r = layoutSpec({ template: "temp_world_scene", commands: [{ draw: ["root", "leaf"] }] });
    const off = r.issues.filter((i) => i.rule === "out-of-canvas");
    expect(off.length).toBeGreaterThan(0);
    expect(off[0].message).toMatch(/world/);
  });
  test("a params.box fits the template onto the page and drops the world", () => {
    install(WORLD);
    const r = layoutSpec({ template: "temp_world_scene", params: { box: "left" }, commands: [{ draw: ["root", "leaf"] }] });
    expect(r.world).toBeUndefined();
  });
});
