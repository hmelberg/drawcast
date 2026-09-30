import { describe, expect, test } from "vitest";
import { elementBBoxes, layoutSpec } from "../src/layout/layout";
import { planCommands } from "../src/render/plan";
import { planOptionsFor } from "../src/render/index";
import { flattenDrawables } from "../src/layout/model";
import { encodePhoto, encodeLinkedPhoto } from "../src/spec/trace";
import { heuristicMeasure } from "../src/layout/measure";
import { installMiniDom, FakeNode } from "./helpers/mini-dom";
import { rendererFor } from "../src/render/svg-backend";

const shot = encodePhoto(0.5, "data:image/png;base64,AAAA"); // 2:1 picture
const img = (r: ReturnType<typeof layoutSpec>, id = "md") => flattenDrawables(r.drawables).find((d) => d.id === `${id}__img`) as any;

describe("screen picture layout", () => {
  test("look screen defaults to 900 wide; view crops and sets the shown aspect", () => {
    const r = layoutSpec({ elements: [{ id: "md", type: "image", url: "https://x.org/a.png", look: "screen", strokes: shot, view: [0, 0, 1, 0.5] }], commands: [{ draw: ["md"] }] } as never);
    const d = img(r);
    expect(d.w).toBe(900);
    // Whole picture 900 × 450; the top half of it shown → 900 × 225.
    expect(d.h).toBeCloseTo(225, 5);
    expect(d.view).toEqual([0, 0, 1, 0.5]);
    expect(r.pictures?.md).toEqual({ view: [0, 0, 1, 0.5], regions: {} });
  });
  test("regions are carried to the layout result; an ordinary image carries the whole view (final fix I4)", () => {
    const regions = { top: [0, 0, 1, 0.5] };
    const r = layoutSpec({
      elements: [
        { id: "md", type: "image", url: "https://x.org/a.png", look: "screen", strokes: shot, regions },
        { id: "p", type: "image", of: "Bicycle pump", strokes: shot },
      ],
      commands: [{ draw: ["md", "p"] }],
    } as never);
    expect(r.pictures?.md).toEqual({ view: [0, 0, 1, 1], regions });
    expect(r.pictures?.p).toEqual({ view: [0, 0, 1, 1], regions: {} });
    expect(img(r, "p").w).toBe(220);
  });
  test("a linked picture lays out like an embedded one", () => {
    const r = layoutSpec({ elements: [{ id: "md", type: "image", url: "https://x.org/a.png", look: "screen", strokes: encodeLinkedPhoto(0.5, "https://x.org/a.png") }], commands: [{ draw: ["md"] }] } as never);
    expect(img(r)).toMatchObject({ kind: "image", href: "https://x.org/a.png", w: 900 });
  });
  test("the svg draws a cropped picture through a nested viewBox", async () => {
    const { restore, doc } = installMiniDom();
    try {
      const spec = { elements: [{ id: "md", type: "image", url: "https://x.org/a.png", look: "screen", strokes: shot, view: [0.5, 0, 0.5, 1] }], commands: [{ draw: ["md"] }] };
      const layout = layoutSpec(spec as never, heuristicMeasure);
      const container = new FakeNode("div", doc as never);
      await rendererFor("clean").mount(layout, spec as never, container as never);
      const all: FakeNode[] = [];
      const walk = (n: FakeNode) => { all.push(n); n.children.forEach(walk); };
      walk(container);
      const nested = all.find((n) => n.tagName === "svg" && n.getAttribute("viewBox") === "500 0 500 1000");
      expect(nested).toBeDefined();
      expect(nested!.children[0].getAttribute("width")).toBe("1000");
    } finally {
      restore();
    }
  });
  test("screen images keep the centre instead of joining the auto-row", () => {
    const r = layoutSpec({
      elements: [
        { id: "a", type: "image", url: "https://x.org/a.png", look: "screen", strokes: shot },
        { id: "b", type: "image", url: "https://x.org/b.png", look: "screen", strokes: shot },
      ],
      commands: [{ draw: ["a", "b"] }],
    } as never);
    const imgA = img(r, "a");
    const imgB = img(r, "b");
    // Both screen images should be centred at x=500, not spread into a row
    expect(imgA.pos[0]).toBe(500);
    expect(imgB.pos[0]).toBe(500);
  });
  test("plain (non-screen) images still form a row when multiple", () => {
    const r = layoutSpec({
      elements: [
        { id: "c", type: "image", of: "Commons image 1", strokes: shot },
        { id: "d", type: "image", of: "Commons image 2", strokes: shot },
      ],
      commands: [{ draw: ["c", "d"] }],
    } as never);
    const imgC = img(r, "c");
    const imgD = img(r, "d");
    // Plain images should still form a row with different x positions
    expect(imgC.pos[0]).not.toBe(imgD.pos[0]);
    expect(imgC.pos[0]).not.toBe(500);
  });
  test("a tall screen picture fits the page: default width min(900, 690 / shown aspect) (final fix I1)", () => {
    const tall = encodePhoto(1.37, "data:image/png;base64,AAAA");
    const d = img(layoutSpec({ elements: [{ id: "md", type: "image", url: "https://x.org/a.png", look: "screen", strokes: tall }], commands: [{ draw: ["md"] }] } as never));
    expect(d.w).toBeCloseTo(690 / 1.37, 1);
    expect(d.h).toBeCloseTo(690, 5);
    const wide = img(layoutSpec({ elements: [{ id: "md", type: "image", url: "https://x.org/a.png", look: "screen", strokes: shot }], commands: [{ draw: ["md"] }] } as never));
    expect(wide.w).toBe(900);
    const authored = img(layoutSpec({ elements: [{ id: "md", type: "image", url: "https://x.org/a.png", look: "screen", strokes: tall, width: 800 }], commands: [{ draw: ["md"] }] } as never));
    expect(authored.w).toBe(800);
  });
  test("a place on an ordinary image resolves in the planner (final fix I4)", () => {
    const spec = { elements: [{ id: "p", type: "image", of: "Bicycle pump", strokes: shot }], commands: [{ draw: ["p"] }, { point: { at: { ref: "p@top" } } }] };
    const layout = layoutSpec(spec as never);
    const bboxes = elementBBoxes(layout);
    const plan = planCommands(spec.commands as never, layout.order, { bboxOf: (id) => bboxes.get(id) ?? null, ...planOptionsFor(spec as never, layout) });
    expect(plan.warnings).toEqual([]);
    const s = plan.steps.find((x) => x.kind === "point") as any;
    expect(s).toBeDefined();
    const d = img(layout, "p");
    expect(s.x).toBeCloseTo(d.pos[0], 5);
  });
  test("planOptionsFor's pictureOf: the __img drawable's centre becomes its rect, with the view (final fix T6-triage a)", () => {
    const spec = { elements: [{ id: "md", type: "image", url: "https://x.org/a.png", look: "screen", strokes: shot, view: [0, 0, 1, 0.5], regions: { top: [0, 0, 1, 0.25] } }], commands: [{ draw: ["md"] }] };
    const layout = layoutSpec(spec as never);
    const d = img(layout);
    const pic = planOptionsFor(spec as never, layout).pictureOf!("md");
    expect(pic).toEqual({ frame: { rect: { x: d.pos[0] - d.w / 2, y: d.pos[1] - d.h / 2, w: d.w, h: d.h }, view: [0, 0, 1, 0.5] }, regions: { top: [0, 0, 1, 0.25] } });
    expect(pic!.frame.rect.w).toBe(900);
    expect(pic!.frame.rect.h).toBeCloseTo(225, 5);
    expect(planOptionsFor(spec as never, layout).pictureOf!("nope")).toBeNull();
  });
});
