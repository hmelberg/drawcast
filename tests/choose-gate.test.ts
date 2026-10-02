// The choose gate (spec 2026-10-03-round6 §4): the viewer taps a drawn
// option on the figure; blank paper and drawn things that are not options do
// nothing; Tab/Enter work from the keys; a judged pick gets ✓/✗.
//
// No jsdom in this repo: the gate is mounted on a minimal fake DOM (the one
// tests/guess-account-gate.test.ts uses) whose stage has an svg 1000×750 px
// on a 1000×750 viewBox, so client pixels are logical units (y flipped).

import { afterAll, beforeAll, describe, expect, test } from "vitest";
import type { AskGateStep } from "../src/ui/controls";
import type { ChooseGeometry } from "../src/ui/choose-gate";
import { chooseTargets, hitChoice } from "../src/ui/choose-model";
import type { Pt } from "../src/layout/model";

type Listener = (e: unknown) => void;

class FakeEl {
  className = "";
  attrs: Record<string, string> = {};
  children: FakeEl[] = [];
  text = "";
  hidden = false;
  disabled = false;
  offsetHeight = 0;
  parent: FakeEl | null = null;
  listeners: Record<string, Listener[]> = {};
  style: Record<string, unknown> = { setProperty: () => {}, removeProperty: () => {} };
  classList = {
    set: new Set<string>(),
    add: (c: string) => void this.classList.set.add(c),
    remove: (c: string) => void this.classList.set.delete(c),
    toggle: (c: string, on?: boolean) => void ((on ?? !this.classList.set.has(c)) ? this.classList.set.add(c) : this.classList.set.delete(c)),
    contains: (c: string) => this.classList.set.has(c),
  };
  constructor(public tag: string) {}
  get textContent(): string {
    return this.text + this.children.map((c) => c.textContent).join("");
  }
  set textContent(v: string) {
    this.text = v;
    this.children = [];
  }
  setAttribute(k: string, v: string): void {
    this.attrs[k] = v;
  }
  append(...xs: (FakeEl | string)[]): void {
    for (const x of xs) typeof x === "string" ? (this.text += x) : this.appendChild(x);
  }
  appendChild(x: FakeEl): FakeEl {
    x.parent = this;
    this.children.push(x);
    return x;
  }
  remove(): void {
    if (this.parent) this.parent.children = this.parent.children.filter((c) => c !== this);
    this.parent = null;
  }
  replaceWith(x: FakeEl): void {
    if (!this.parent) return;
    const p = this.parent;
    p.children = p.children.map((c) => (c === this ? x : c));
    x.parent = p;
    this.parent = null;
  }
  addEventListener(t: string, f: Listener): void {
    (this.listeners[t] ??= []).push(f);
  }
  removeEventListener(): void {}
  querySelector(): null {
    return null;
  }
  closest(): null {
    return null;
  }
  getBoundingClientRect() {
    return { left: 0, top: 0, width: 800, height: 600 };
  }
  setPointerCapture(): void {}
  click(): void {
    for (const f of this.listeners["click"] ?? []) f({ stopPropagation: () => {}, preventDefault: () => {} });
  }
  find(cls: string): FakeEl | null {
    if (this.className.split(" ").includes(cls)) return this;
    for (const c of this.children) {
      const f = c.find(cls);
      if (f) return f;
    }
    return null;
  }
}

const docListeners: Record<string, Listener[]> = {};
const g = globalThis as Record<string, unknown>;
const saved = { document: g.document, window: g.window };

beforeAll(() => {
  g.document = {
    createElement: (tag: string) => new FakeEl(tag),
    addEventListener: (t: string, f: Listener) => void (docListeners[t] ??= []).push(f),
    removeEventListener: (t: string, f: Listener) => void (docListeners[t] = (docListeners[t] ?? []).filter((x) => x !== f)),
  };
  g.window = globalThis;
  g.requestAnimationFrame ??= (cb: FrameRequestCallback) => setTimeout(() => cb(0), 0) as unknown as number;
});
afterAll(() => {
  g.document = saved.document;
  g.window = saved.window;
});

const key = (k: string, shiftKey = false): void => {
  for (const f of [...(docListeners["keydown"] ?? [])]) f({ key: k, shiftKey, target: null, preventDefault: () => {}, stopPropagation: () => {} });
};

const svg = { getBoundingClientRect: () => ({ left: 0, top: 0, width: 1000, height: 750 }), viewBox: { baseVal: { x: 0, y: 0, width: 1000, height: 750 } } };
const makeStage = (): FakeEl => {
  const s = new FakeEl("div");
  (s as unknown as { querySelector: (q: string) => unknown }).querySelector = (q: string) => (q === "svg.cs-svg" ? svg : null);
  (s as unknown as { getBoundingClientRect: () => unknown }).getBoundingClientRect = () => ({ left: 0, top: 0, width: 1000, height: 750 });
  return s;
};

/** Logical (x, y-up) → the client event the gate reads. */
const at = (x: number, y: number) => ({ clientX: x, clientY: 750 - y, stopPropagation: () => {}, preventDefault: () => {} });
const fire = (el: FakeEl, type: string, e: unknown): void => {
  for (const f of el.listeners[type] ?? []) f(e);
};

// door_1 and door_2 are outlined rectangles; "sign" is a word (box only);
// "path" an open stroke; "wall" is drawn but not an option.
const ring = (x: number, y: number, w: number, h: number): Pt[] => [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
const GEO: ChooseGeometry = {
  boxes: new Map([
    ["door_1", { x: 100, y: 100, w: 100, h: 200 }],
    ["door_2", { x: 300, y: 100, w: 100, h: 200 }],
    ["handle", { x: 380, y: 190, w: 10, h: 10 }],
    ["sign", { x: 600, y: 100, w: 80, h: 20 }],
    ["path", { x: 600, y: 300, w: 200, h: 200 }],
    ["wall", { x: 0, y: 0, w: 1000, h: 400 }],
  ]),
  rings: new Map([
    ["door_1", [ring(100, 100, 100, 200)]],
    ["door_2", [ring(300, 100, 100, 200)]],
    ["handle", [ring(380, 190, 10, 10)]],
    ["wall", [ring(0, 0, 1000, 400)]],
  ]),
  lines: new Map([["path", [[[600, 300], [800, 500]]]]]),
};
const OPTIONS = [
  { id: "door_1", label: "Door 1", members: ["door_1"] },
  { id: "door_2", label: "Door 2", members: ["door_2"] },
  { id: "sign", label: "Sign", members: ["sign"] },
  { id: "path", label: "Path", members: ["path"] },
];

describe("the choose hit model", () => {
  const targets = chooseTargets(OPTIONS, GEO.boxes, GEO.rings, GEO.lines);
  test("inside an outline, a word's box, or near a stroke; never blank paper or a non-option", () => {
    expect(hitChoice(targets, [150, 200])).toBe("door_1");
    expect(hitChoice(targets, [640, 110])).toBe("sign");
    expect(hitChoice(targets, [705, 400])).toBe("path"); // 3.5 from the line
    expect(hitChoice(targets, [650, 450])).toBe(null); // inside the stroke's box, far from the line
    expect(hitChoice(targets, [250, 200])).toBe(null); // the wall between the doors
    expect(hitChoice(targets, [900, 700])).toBe(null);
  });
  test("a near miss on an outline counts (fat fingers)", () => {
    expect(hitChoice(targets, [210, 200])).toBe("door_1");
  });
  test("a group stands for its members: their geometry together", () => {
    const [both] = chooseTargets([{ id: "doors", members: ["door_1", "door_2"] }], GEO.boxes, GEO.rings, GEO.lines);
    expect(both.box).toEqual({ x: 100, y: 100, w: 300, h: 200 });
    expect(hitChoice([both], [350, 150])).toBe("doors");
    expect(hitChoice([both], [250, 150])).toBe(null);
  });
  test("the smaller of two containing options wins (the handle inside the door)", () => {
    const ts = chooseTargets([{ id: "door_2", members: ["door_2"] }, { id: "handle", members: ["handle"] }], GEO.boxes, GEO.rings, GEO.lines);
    expect(hitChoice(ts, [385, 195])).toBe("handle");
    expect(hitChoice(ts, [320, 150])).toBe("door_2");
  });
});

describe("the choose gate", () => {
  const open = async (extra: Partial<AskGateStep> = {}) => {
    const { chooseGateFor } = await import("../src/ui/choose-gate");
    const stage = makeStage();
    const ac = new AbortController();
    let result: string | null | undefined;
    const step = { question: "Which door?", retry: false, required: false, choose: OPTIONS, ...extra } as unknown as AskGateStep;
    const done = chooseGateFor(stage as unknown as HTMLElement, null as never, () => GEO)(ac.signal, step).then((r) => (result = r));
    const gate = stage.find("cs-choosegate")!;
    return { stage, gate, done, ac, result: () => result };
  };
  const settle = () => new Promise((r) => setTimeout(r, 5));

  test("hover rings the option under the pointer; blank paper rings nothing", async () => {
    const { gate, stage, ac } = await open();
    const ringEl = stage.find("cs-choose-ring")!;
    expect(ringEl.hidden).toBe(true);
    fire(gate, "pointermove", at(150, 200));
    expect(ringEl.hidden).toBe(false);
    expect(stage.classList.contains("cs-cardable")).toBe(true);
    // The ring sits round door_1's box (padded): left 94px.
    expect(ringEl.style.left).toBe("94px");
    fire(gate, "pointermove", at(250, 200));
    expect(ringEl.hidden).toBe(true);
    expect(stage.classList.contains("cs-cardable")).toBe(false);
    ac.abort();
  });

  test("a tap on blank paper does nothing; a tap on an option answers with its id", async () => {
    const { gate, done, result } = await open();
    fire(gate, "click", at(250, 200));
    await settle();
    expect(result()).toBeUndefined();
    fire(gate, "click", at(350, 150));
    await done;
    expect(result()).toBe("door_2");
  });

  test("judged: a ✓ or ✗ on the tapped thing", async () => {
    const right = await open({ answer: "door_2" });
    fire(right.gate, "click", at(350, 150));
    await right.done;
    expect(right.gate.find("cs-figgate-mark")?.className).toBe("cs-figgate-mark right");
    const wrong = await open({ answer: "door_2" });
    fire(wrong.gate, "click", at(150, 150));
    await wrong.done;
    expect(wrong.gate.find("cs-figgate-mark")?.className).toBe("cs-figgate-mark wrong");
    expect(wrong.result()).toBe("door_1");
  });

  test("a pick takes the Skip pill away with the gate's controls; only the verdict lingers (final fix wave E)", async () => {
    const g = await open({ answer: "door_2" });
    expect(g.gate.find("skip")).not.toBe(null);
    fire(g.gate, "click", at(350, 150));
    await g.done;
    expect(g.gate.find("skip")).toBe(null);
    expect(g.gate.find("cs-figgate-mark")).not.toBe(null);
  });

  test("an opinion: no mark, the ring stays on the pick", async () => {
    const g = await open({ judge: false });
    fire(g.gate, "click", at(150, 150));
    await g.done;
    expect(g.gate.find("cs-figgate-mark")).toBe(null);
    expect(g.stage.find("cs-choose-ring")!.classList.contains("picked")).toBe(true);
  });

  test("keys: Tab moves the ring, Shift-Tab back, Enter picks", async () => {
    const g = await open();
    const ringEl = g.stage.find("cs-choose-ring")!;
    key("Tab");
    expect(ringEl.style.left).toBe("94px"); // door_1
    key("Tab");
    key("Tab");
    key("Tab", true); // back to door_2
    expect(ringEl.style.left).toBe("294px");
    key("Enter");
    await g.done;
    expect(g.result()).toBe("door_2");
  });

  test("Space does not pick (a focused Play button would take it too); the pick clears the hand cursor at once", async () => {
    const g = await open();
    key("Tab");
    key(" ");
    await settle();
    expect(g.result()).toBeUndefined();
    fire(g.gate, "pointermove", at(150, 200));
    expect(g.stage.classList.contains("cs-cardable")).toBe(true);
    fire(g.gate, "click", at(150, 200));
    await g.done;
    expect(g.stage.classList.contains("cs-cardable")).toBe(false);
  });

  test("keys: a digit picks that option", async () => {
    const g = await open();
    key("3");
    await g.done;
    expect(g.result()).toBe("sign");
  });

  test("Skip answers null; abort answers null", async () => {
    const g = await open();
    g.gate.find("skip")!.click();
    await g.done;
    expect(g.result()).toBe(null);
    const h = await open();
    h.ac.abort();
    await h.done;
    expect(h.result()).toBe(null);
  });
});

describe("template parts and groups on a real layout", () => {
  test("a bar_chart's bars are hit by their outlines; a group by its members'", async () => {
    const { layoutSpec, elementBBoxes, elementRings, elementLines } = await import("../src/layout/layout");
    const { heuristicMeasure } = await import("../src/layout/measure");
    const { ensureEnabledPacks, PACK_DEFS } = await import("../src/scenes/packs");
    await ensureEnabledPacks(Object.keys(PACK_DEFS));
    const spec = {
      template: "bar_chart",
      params: { labels: ["A", "B", "C"], values: [3, 5, 2] },
      elements: [{ id: "first_two", type: "group", members: ["bar_1", "bar_2"] }],
      commands: [{ draw: ["axes", "bar_1", "bar_2", "bar_3"] }],
    };
    const layout = layoutSpec(spec as never, heuristicMeasure);
    const boxes = elementBBoxes(layout, heuristicMeasure);
    const ts = chooseTargets(
      [
        { id: "bar_1", members: ["bar_1"] },
        { id: "bar_3", members: ["bar_3"] },
      ],
      boxes,
      elementRings(layout),
      elementLines(layout),
    );
    const b1 = boxes.get("bar_1")!;
    const b2 = boxes.get("bar_2")!;
    expect(hitChoice(ts, [b1.x + b1.w / 2, b1.y + b1.h / 2])).toBe("bar_1");
    // bar_2 is drawn but not an option: nothing.
    expect(hitChoice(ts, [b2.x + b2.w / 2, b2.y + b2.h / 2])).toBe(null);
    const members = layout.groups["first_two"];
    expect(members).toEqual(["bar_1", "bar_2"]);
    const [g] = chooseTargets([{ id: "first_two", members }], boxes, elementRings(layout), elementLines(layout));
    expect(hitChoice([g], [b2.x + b2.w / 2, b2.y + b2.h / 2])).toBe("first_two");
  });
});

describe("the options where they stand now", () => {
  const centre = (b: { x: number; y: number; w: number; h: number }): Pt => [b.x + b.w / 2, b.y + b.h / 2];

  test("a move before the ask: the option is hit where it went, not where it was laid out", async () => {
    const { layoutSpec } = await import("../src/layout/layout");
    const { heuristicMeasure } = await import("../src/layout/measure");
    const { planCommands } = await import("../src/render/plan");
    const { planOptionsFor } = await import("../src/render/index");
    const { chooseGeometryFor } = await import("../src/ui/choose-gate");
    const spec = {
      elements: [
        { id: "door_1", type: "node", shape: "rect", text: "Door 1", x: 200, y: 375, width: 120, height: 80 },
        { id: "door_2", type: "node", shape: "rect", text: "Door 2", x: 500, y: 375, width: 120, height: 80 },
      ],
      commands: [
        { draw: ["door_1", "door_2"] },
        { move: { target: "door_1", by: [0, 200] } },
        { ask: { question: "Which?", choose: ["door_1", "door_2"], answer: "door_1" } },
      ],
    };
    const layout = layoutSpec(spec as never, heuristicMeasure);
    const boxes = (await import("../src/layout/layout")).elementBBoxes(layout, heuristicMeasure);
    const plan = planCommands(spec.commands as never, layout.order, { bboxOf: (id) => boxes.get(id) ?? null, ...planOptionsFor(spec as never, layout) });
    const askAt = plan.steps.findIndex((s) => s.kind === "ask");
    const hd = { layout, plan, timeline: { paintedLayout: () => null, position: askAt } };
    const geo = chooseGeometryFor(hd as never, heuristicMeasure);
    const ts = chooseTargets(OPTIONS.slice(0, 2), geo.boxes, geo.rings, geo.lines);
    const was = centre(boxes.get("door_1")!);
    expect(hitChoice(ts, was)).toBe(null);
    expect(hitChoice(ts, [was[0], was[1] + 200])).toBe("door_1");
    expect(hitChoice(ts, centre(boxes.get("door_2")!))).toBe("door_2");
  });

  test("an animated bar: the painted layout's height is what is hit", async () => {
    const { layoutSpec, elementBBoxes } = await import("../src/layout/layout");
    const { heuristicMeasure } = await import("../src/layout/measure");
    const { planCommands } = await import("../src/render/plan");
    const { chooseGeometryFor } = await import("../src/ui/choose-gate");
    const { ensureEnabledPacks, PACK_DEFS } = await import("../src/scenes/packs");
    await ensureEnabledPacks(Object.keys(PACK_DEFS));
    const base = { template: "bar_chart", params: { labels: ["A", "B"], values: [2, 8] } };
    const before = layoutSpec(base as never, heuristicMeasure);
    const after = layoutSpec({ ...base, params: { ...base.params, values: [8, 8] } } as never, heuristicMeasure);
    const b0 = elementBBoxes(before, heuristicMeasure).get("bar_1")!;
    const b1 = elementBBoxes(after, heuristicMeasure).get("bar_1")!;
    expect(b1.h).toBeGreaterThan(b0.h * 2);
    const plan = planCommands([{ draw: ["bar_1", "bar_2"] }, { ask: { question: "?", choose: ["bar_1", "bar_2"], answer: "bar_1" } }] as never, before.order, {});
    const tall: Pt = [b1.x + b1.w / 2, b1.y + b1.h - 5]; // near the top of the grown bar, far above the old one
    const geoNow = chooseGeometryFor({ layout: before, plan, timeline: { paintedLayout: () => after, position: 1 } } as never, heuristicMeasure);
    expect(hitChoice(chooseTargets([{ id: "bar_1", members: ["bar_1"] }], geoNow.boxes, geoNow.rings, geoNow.lines), tall)).toBe("bar_1");
    const geoOld = chooseGeometryFor({ layout: before, plan, timeline: { paintedLayout: () => null, position: 1 } } as never, heuristicMeasure);
    expect(hitChoice(chooseTargets([{ id: "bar_1", members: ["bar_1"] }], geoOld.boxes, geoOld.rings, geoOld.lines), tall)).toBe(null);
  });

  test("poseGeometry: a turn maps the outline; a baked id is left alone", async () => {
    const { poseGeometry } = await import("../src/ui/choose-model");
    const geo = { boxes: new Map([["a", { x: 0, y: 0, w: 10, h: 10 }]]), rings: new Map([["a", [ring(0, 0, 10, 10)]]]), lines: new Map() };
    const turned = poseGeometry(geo, { a: [100, 0] }, { a: { deg: 90, pivot: [0, 0] } });
    const r = turned.rings.get("a")![0].map(([x, y]) => [Math.round(x), Math.round(y)]);
    expect(r).toEqual([[100, 0], [100, 10], [90, 10], [90, 0]]);
    expect(turned.boxes.get("a")).toEqual({ x: 90, y: 0, w: 10, h: 10 });
    expect(poseGeometry(geo, { a: [100, 0] }, {}, new Set(["a"])).boxes.get("a")).toEqual({ x: 0, y: 0, w: 10, h: 10 });
  });
});
