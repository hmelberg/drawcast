import { describe, expect, test } from "vitest";
import { compileTemplateDoc } from "../src/scenes/compile";
import { buildWidgetScene, paramNamesOf } from "../src/scenes/widget-scene";
import { demoWidget, partAt, runWidget, stepWidget } from "../src/scenes/widget-run";
import type { TemplateDoc } from "../src/scenes/doc";

// A two-pad counter: dot adds ".", gap commits the count as the answer.
const doc = {
  template: "tap_counter",
  version: 1,
  kit: 10,
  status: "ready",
  description: "Two pads.",
  params: { type: "object", properties: { signal: { type: "string" } } },
  element_ids: { dot: "dot pad", gap: "gap pad", signal: "the strip" },
  examples: [{ request: "pads", params: {} }],
  layout: `
    const drawables = [
      kit.pad("dot", [300, 400], "·", { r: 40 }),
      kit.pad("gap", [500, 400], "gap", { w: 90, h: 60 }),
      kit.text("signal", [400, 550], params.signal ?? "", { fontSize: 30 }),
    ];
    return { drawables, labels: [], anchors: {}, order: ["dot", "gap", "signal"] };`,
  widget: `
    const init = () => ({ signal: "" });
    const on = (ev, st, scene) => {
      if (ev.id === "dot") { const signal = st.signal + "."; return { state: { signal }, effects: [{ sound: { hz: 700, ms: 80 } }, { patch: { signal } }] }; }
      if (ev.id === "gap") return { state: st, effects: [{ answer: String(st.signal.length) }, { caption: "sent " + scene.params.signal }] };
      return { state: st, effects: [] };
    };
    const demo = (scene, answer) => Array.from({ length: Number(answer) }, () => ({ pointer: "dot", sound: { hz: 700, ms: 80 } })).concat([{ pointer: "gap" }]);
    const judge = (given, answer) => Number(given) === Number(answer);
    return { init, on, demo, judge };`,
} as TemplateDoc;

const module = compileTemplateDoc(doc).module!;

describe("buildWidgetScene", () => {
  test("parts are the layout's top-level ids with boxes and the pad outlines as rings", () => {
    const scene = buildWidgetScene(module, {})!;
    expect(scene.ids).toEqual(["dot", "gap", "signal"]);
    expect(scene.boxes.get("dot")!.w).toBeCloseTo(80, 0);
    expect(scene.rings.has("dot")).toBe(true);
    expect(scene.rings.has("signal")).toBe(false);
    expect(scene.toDomain([500, 400])).toBeNull();
    expect(paramNamesOf(module)).toEqual(["signal"]);
  });
  test("`visible` keeps the boundary's parts and drops the rest — ids, boxes and rings together", () => {
    const scene = buildWidgetScene(module, {}, { visible: new Set(["dot", "signal"]) })!;
    expect(scene.ids).toEqual(["dot", "signal"]);
    expect(scene.boxes.has("gap")).toBe(false);
    expect(scene.rings.has("gap")).toBe(false);
    expect(scene.rings.has("dot")).toBe(true);
  });
  test("with a domain, toDomain and toLogical invert each other", () => {
    const scene = buildWidgetScene(module, {}, { domain: { x: [0, 10], y: [0, 5] } })!;
    const p = scene.toLogical([5, 2.5]);
    expect(scene.toDomain(p)![0]).toBeCloseTo(5);
    expect(scene.toDomain(p)![1]).toBeCloseTo(2.5);
  });
});

// The widget's SURFACE (spec §2.3): the parts you can be INSIDE of. Before
// this, every top-level part was the widget's — and a title, a strip or a
// legend silently lost its info card to a body that ignores the click.
describe("partAt — only a part with a closed outline is tappable", () => {
  const scene = buildWidgetScene(module, { signal: "...." })!;
  test("a pad answers; the text beside it does not, though it IS a part", () => {
    expect(partAt(scene, [300, 400])).toBe("dot");
    expect(scene.ids).toContain("signal");
    const b = scene.boxes.get("signal")!;
    expect(b.w).toBeGreaterThan(0);
    expect(partAt(scene, [b.x + b.w / 2, b.y + b.h / 2])).toBeNull();
  });
  test("the fat-finger slop still rescues a near miss — among the outlined parts", () => {
    expect(partAt(scene, [300, 348])).toBe("dot"); // 12 logical units below the pad
    expect(partAt(scene, [300, 300])).toBeNull();
  });
});

describe("stepWidget", () => {
  test("returns the new state and validated effects", () => {
    const scene = buildWidgetScene(module, {})!;
    const body = module.widget!();
    const r = stepWidget(body, body.init(scene), { type: "click", id: "dot", point: [300, 400], domain: null }, scene, ["signal"]);
    expect(r.errors).toEqual([]);
    expect(r.state).toEqual({ signal: "." });
    expect(r.effects).toEqual([{ sound: { hz: 700, ms: 80 } }, { patch: { signal: "." } }]);
  });
  test("a body that throws is contained: state unchanged, the error reported", () => {
    const scene = buildWidgetScene(module, {})!;
    const body = { init: () => ({ n: 1 }), on: () => { throw new Error("boom"); } };
    const r = stepWidget(body, { n: 1 }, { type: "click", id: "dot", point: [0, 0], domain: null }, scene, []);
    expect(r.state).toEqual({ n: 1 });
    expect(r.effects).toEqual([]);
    expect(r.errors[0]).toMatch(/boom/);
  });
  test("a malformed return is contained the same way", () => {
    const scene = buildWidgetScene(module, {})!;
    const body = { init: () => 0, on: () => 42 as unknown as { state: unknown; effects: unknown } };
    const r = stepWidget(body, 0, { type: "click", id: "dot", point: [0, 0], domain: null }, scene, []);
    expect(r.state).toBe(0);
    expect(r.errors[0]).toMatch(/must return \{ state, effects \}/);
  });
});

describe("runWidget — the harness", () => {
  test("a click sequence by part id yields states, effects, the patched params and the last answer", () => {
    const r = runWidget(module, {}, ["dot", "dot", "dot", "gap"]);
    expect(r.errors).toEqual([]);
    expect(r.states.at(-1)).toEqual({ signal: "..." });
    expect(r.params).toEqual({ signal: "..." });
    expect(r.answer).toBe("3");
    expect(r.effects[3]).toEqual([{ answer: "3" }, { caption: "sent ..." }]); // the scene was rebuilt after the patches
  });
  test("an unknown part id is an error, not a throw", () => {
    const r = runWidget(module, {}, ["nope"]);
    expect(r.errors).toEqual(['click: "nope" is not a part (dot, gap, signal)']);
  });
  test("demoWidget validates the demo's effects, and defaults to one tap on the first part", () => {
    expect(demoWidget(module, {}, "2").effects).toEqual([{ pointer: "dot", sound: { hz: 700, ms: 80 } }, { pointer: "dot", sound: { hz: 700, ms: 80 } }, { pointer: "gap" }]);
    const noDemo = compileTemplateDoc({ ...doc, widget: "return { init: () => 0, on: (e, s) => ({ state: s, effects: [] }) };" } as TemplateDoc).module!;
    expect(demoWidget(noDemo, {}, "x").effects).toEqual([{ pointer: "dot" }]);
  });
});
