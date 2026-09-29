import { describe, expect, test } from "vitest";
import { layoutSpec } from "../src/layout/layout";
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
  test("regions are carried to the layout result; an ordinary image carries none", () => {
    const regions = { top: [0, 0, 1, 0.5] };
    const r = layoutSpec({
      elements: [
        { id: "md", type: "image", url: "https://x.org/a.png", look: "screen", strokes: shot, regions },
        { id: "p", type: "image", of: "Bicycle pump", strokes: shot },
      ],
      commands: [{ draw: ["md", "p"] }],
    } as never);
    expect(r.pictures?.md).toEqual({ view: [0, 0, 1, 1], regions });
    expect(r.pictures?.p).toBeUndefined();
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
});
