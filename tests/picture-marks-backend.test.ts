import { afterEach, describe, expect, test } from "vitest";
import { rendererFor, setLuminanceProbe } from "../src/render/svg-backend";
import { encodeLinkedPhoto, encodePhoto } from "../src/spec/trace";
import { FIGURE_GROUND } from "../src/layout/ink";
import { layoutSpec } from "../src/layout/layout";
import { heuristicMeasure } from "../src/layout/measure";
import { installMiniDom, FakeNode } from "./helpers/mini-dom";
import type { MarkFrame, MarkKind } from "../src/render/marks";
import type { BBox } from "../src/layout/geometry";

const SPEC = { elements: [{ id: "t", type: "text", text: "Hi", x: 500, y: 375 }], commands: [{ draw: ["t"] }] };

async function mounted(style: "clean" | "sketchy" = "clean") {
  const { restore, doc } = installMiniDom();
  const layout = layoutSpec(SPEC as never, heuristicMeasure);
  const container = new FakeNode("div", doc as never);
  const r = await rendererFor(style).mount(layout, SPEC as never, container as never);
  for (const el of r.elements.values()) el.finish();
  const svg = container.children[0];
  return { restore, effects: r.effects!, overlay: svg.children[svg.children.length - 1] };
}

const FRAME: BBox = { x: 100, y: 100, w: 800, h: 500 };
const frameOf = (kind: MarkKind, box: BBox, over: Partial<MarkFrame> = {}): MarkFrame => ({
  kind,
  frame: FRAME,
  box,
  level: 0.8,
  write: 1,
  depth: 0.5,
  breathe: 1,
  ...over,
});

const find = (root: FakeNode, tag: string) => root.querySelectorAll(tag);
const count = (n: FakeNode): number => n.children.reduce((s, c) => s + 1 + count(c), 0);

describe("setMark / endMark", () => {
  test("light: one group with a mask, a wash at depth × level; a second frame updates the same nodes", async () => {
    const { restore, effects, overlay } = await mounted();
    try {
      effects.setMark!("md", frameOf("light", { x: 200, y: 200, w: 100, h: 100 }));
      const groups = overlay.children.filter((n) => n.getAttribute("data-mark") === "md");
      expect(groups).toHaveLength(1);
      const g = groups[0];
      const mask = find(g, "mask")[0];
      expect(mask).toBeDefined();
      const maskId = mask.getAttribute("id");
      const wash = find(g, "rect").find((r) => r.getAttribute("mask") === `url(#${maskId})`)!;
      expect(wash).toBeDefined();
      expect(Number(wash.getAttribute("fill-opacity"))).toBeCloseTo(0.5 * 0.8, 3);
      expect(find(g, "feGaussianBlur")).toHaveLength(1);
      const ellipse = find(g, "ellipse")[0];
      const cx0 = ellipse.getAttribute("cx");
      const nodes = count(g);

      effects.setMark!("md", frameOf("light", { x: 500, y: 300, w: 60, h: 60 }, { level: 1, depth: 0.6 }));
      expect(overlay.children.filter((n) => n.getAttribute("data-mark") === "md")).toHaveLength(1);
      expect(overlay.children.find((n) => n.getAttribute("data-mark") === "md")).toBe(g);
      expect(count(g)).toBe(nodes);
      expect(find(g, "ellipse")[0]).toBe(ellipse);
      expect(ellipse.getAttribute("cx")).not.toBe(cx0);
      expect(Number(wash.getAttribute("fill-opacity"))).toBeCloseTo(0.6, 3);
    } finally {
      restore();
    }
  });

  for (const style of ["clean", "sketchy"] as const) {
    for (const kind of ["ring", "box", "arrow"] as const) {
      test(`${kind} (${style}): a transform that follows the box, the same nodes`, async () => {
        const { restore, effects, overlay } = await mounted(style);
        try {
          effects.setMark!("md", frameOf(kind, { x: 200, y: 200, w: 100, h: 100 }));
          const g = overlay.children.find((n) => n.getAttribute("data-mark") === "md")!;
          const placed = () => [g, ...find(g, "g")].map((n) => n.getAttribute("transform")).filter(Boolean).join("|");
          const t0 = placed();
          expect(t0).not.toBe("");
          const nodes = count(g);
          effects.setMark!("md", frameOf(kind, { x: 400, y: 300, w: 200, h: 80 }));
          expect(placed()).not.toBe(t0);
          expect(count(g)).toBe(nodes);
          expect(Number(g.style.opacity)).toBeCloseTo(0.8, 3);
        } finally {
          restore();
        }
      });
    }
  }

  test("a half-written ring has its dash offset part way", async () => {
    const { restore, effects, overlay } = await mounted("sketchy");
    try {
      effects.setMark!("md", frameOf("ring", { x: 200, y: 200, w: 100, h: 100 }, { write: 0.5 }));
      const g = overlay.children.find((n) => n.getAttribute("data-mark") === "md")!;
      const p = find(g, "path")[0];
      expect(Number(p.style.strokeDashoffset)).toBeCloseTo(50, 3); // mini-dom length 100
    } finally {
      restore();
    }
  });

  test("arrow: placed from the frame's own tip and tail when it carries them", async () => {
    const { restore, effects, overlay } = await mounted();
    try {
      effects.setMark!("md", frameOf("arrow", { x: 200, y: 200, w: 100, h: 100 }, { tip: [400, 300], tail: [400, 400] }));
      const g = overlay.children.find((n) => n.getAttribute("data-mark") === "md")!;
      const t = g.getAttribute("transform")!;
      expect(t.startsWith("translate(400.0 ")).toBe(true);
      expect(t).toContain("scale(");
    } finally {
      restore();
    }
  });

  test("light (tuning): a small part still gets a pool of at least 55, and a warm lift that follows the hole and the level", async () => {
    const { restore, effects, overlay } = await mounted();
    try {
      effects.setMark!("md", frameOf("light", { x: 300, y: 300, w: 2, h: 2 }, { level: 0.5 }));
      const g = overlay.children.find((n) => n.getAttribute("data-mark") === "md")!;
      const hole = find(find(g, "mask")[0], "ellipse")[0];
      expect(Number(hole.getAttribute("rx"))).toBeGreaterThanOrEqual(55);
      expect(Number(hole.getAttribute("ry"))).toBeGreaterThanOrEqual(55);
      const lift = g.children.find((n) => n.tagName === "ellipse")!;
      expect(lift).toBeDefined();
      expect(lift.getAttribute("fill")).toBe("#fff8e6");
      expect(lift.getAttribute("style")).toContain("mix-blend-mode: screen");
      expect(lift.getAttribute("filter")).toBe(hole.getAttribute("filter"));
      expect(Number(lift.getAttribute("fill-opacity"))).toBeCloseTo(0.05, 3);
      expect([lift.getAttribute("cx"), lift.getAttribute("cy")]).toEqual([hole.getAttribute("cx"), hole.getAttribute("cy")]);
      effects.setMark!("md", frameOf("light", { x: 600, y: 200, w: 200, h: 100 }, { level: 1 }));
      expect(g.children.find((n) => n.tagName === "ellipse")).toBe(lift);
      expect([lift.getAttribute("cx"), lift.getAttribute("cy")]).toEqual([hole.getAttribute("cx"), hole.getAttribute("cy")]);
      expect(lift.getAttribute("cx")).toBe("700.0");
      expect(Number(lift.getAttribute("fill-opacity"))).toBeCloseTo(0.1, 3);
      expect(Number(hole.getAttribute("rx"))).toBeCloseTo(135, 1);
    } finally {
      restore();
    }
  });

  test("glow: the circle's radius scales with breathe", async () => {
    const { restore, effects, overlay } = await mounted();
    try {
      effects.setMark!("md", frameOf("glow", { x: 200, y: 200, w: 50, h: 50 }, { breathe: 1 }));
      const g = overlay.children.find((n) => n.getAttribute("data-mark") === "md")!;
      const c = find(g, "circle")[0];
      expect(Number(c.getAttribute("r"))).toBeCloseTo(30, 3);
      expect(find(g, "radialGradient")).toHaveLength(1);
      effects.setMark!("md", frameOf("glow", { x: 200, y: 200, w: 50, h: 50 }, { breathe: 1.08 }));
      expect(find(g, "circle")[0]).toBe(c);
      expect(Number(c.getAttribute("r"))).toBeCloseTo(32.4, 3);
    } finally {
      restore();
    }
  });

  test("endMark removes the group and its mask", async () => {
    const { restore, effects, overlay } = await mounted();
    try {
      effects.setMark!("md", frameOf("light", { x: 200, y: 200, w: 100, h: 100 }));
      effects.setMark!("other", frameOf("glow", { x: 200, y: 200, w: 100, h: 100 }));
      effects.endMark!("md");
      expect(overlay.children.some((n) => n.getAttribute("data-mark") === "md")).toBe(false);
      expect(find(overlay, "mask")).toHaveLength(0);
      expect(overlay.children.some((n) => n.getAttribute("data-mark") === "other")).toBe(true);
      effects.endMark!("md"); // idempotent
    } finally {
      restore();
    }
  });

  test("a different kind on the same owner replaces the mark", async () => {
    const { restore, effects, overlay } = await mounted();
    try {
      effects.setMark!("md", frameOf("light", { x: 200, y: 200, w: 100, h: 100 }));
      effects.setMark!("md", frameOf("glow", { x: 200, y: 200, w: 100, h: 100 }));
      const gs = overlay.children.filter((n) => n.getAttribute("data-mark") === "md");
      expect(gs).toHaveLength(1);
      expect(find(gs[0], "mask")).toHaveLength(0);
      expect(find(gs[0], "circle")).toHaveLength(1);
    } finally {
      restore();
    }
  });
});

describe("the light follows the picture's tone", () => {
  afterEach(() => setLuminanceProbe(null));

  async function withPicture(strokes: string, url: string) {
    const spec = { elements: [{ id: "md", type: "image", url, look: "photo", strokes }], commands: [{ draw: ["md"] }] };
    const { restore, doc } = installMiniDom();
    const layout = layoutSpec(spec as never, heuristicMeasure);
    const container = new FakeNode("div", doc as never);
    const r = await rendererFor("clean").mount(layout, spec as never, container as never);
    for (const el of r.elements.values()) el.finish();
    const svg = container.children[0];
    return { restore, effects: r.effects!, overlay: svg.children[svg.children.length - 1] };
  }
  const washOf = (overlay: FakeNode) => {
    const g = overlay.children.find((n) => n.getAttribute("data-mark") === "md")!;
    return find(g, "rect").find((r) => (r.getAttribute("mask") ?? "").startsWith("url(#"))!;
  };
  const tick = () => new Promise((r) => setTimeout(r, 0));
  const DATA = "data:image/png;base64,AAAA";

  for (const [lum, color, name] of [[0.2, "#1b140e", "dark → torch"], [0.9, FIGURE_GROUND, "light → paper"]] as const) {
    test(`a data: picture measured ${name}`, async () => {
      const probed: string[] = [];
      setLuminanceProbe(async (href) => (probed.push(href), lum));
      const { restore, effects, overlay } = await withPicture(encodePhoto(1.5, DATA), DATA);
      try {
        const f = frameOf("light", { x: 300, y: 300, w: 50, h: 50 }, { level: 1 });
        // Probed at mount: by the first light the tone is already known.
        expect(probed).toEqual([DATA]);
        await tick();
        effects.setMark!("md", f);
        expect(washOf(overlay).getAttribute("fill")).toBe(color);
        const lift = overlay.children.find((n) => n.getAttribute("data-mark") === "md")!.children.find((n) => n.tagName === "ellipse")!;
        expect(Number(lift.getAttribute("fill-opacity"))).toBeCloseTo(lum < 0.42 ? 0.16 : 0.1, 3);
        effects.endMark!("md");
        effects.setMark!("md", f); // measured once per href
        expect(probed).toEqual([DATA]);
      } finally {
        restore();
      }
    });
  }

  test("a light painted once and left takes the tone when the probe lands, with no further setMark", async () => {
    let land: (v: number) => void = () => {};
    setLuminanceProbe(() => new Promise<number>((r) => (land = r)));
    const { restore, effects, overlay } = await withPicture(encodePhoto(1.5, DATA), DATA);
    try {
      effects.setMark!("md", frameOf("light", { x: 300, y: 300, w: 50, h: 50 }, { level: 1 }));
      const wash = washOf(overlay);
      expect(wash.getAttribute("fill")).toBe(FIGURE_GROUND);
      land(0.2);
      await tick();
      expect(washOf(overlay)).toBe(wash);
      expect(wash.getAttribute("fill")).toBe("#1b140e");
    } finally {
      restore();
    }
  });

  test("an ended light is not repainted when the probe lands", async () => {
    let land: (v: number) => void = () => {};
    setLuminanceProbe(() => new Promise<number>((r) => (land = r)));
    const { restore, effects, overlay } = await withPicture(encodePhoto(1.5, DATA), DATA);
    try {
      effects.setMark!("md", frameOf("light", { x: 300, y: 300, w: 50, h: 50 }));
      effects.endMark!("md");
      land(0.2);
      await tick();
      expect(overlay.children.some((n) => n.getAttribute("data-mark") === "md")).toBe(false);
    } finally {
      restore();
    }
  });

  test("the probe starts when the picture is mounted, before any light", async () => {
    const probed: string[] = [];
    setLuminanceProbe(() => (probed.push("x"), new Promise<number>(() => {})));
    const { restore, effects } = await withPicture(encodePhoto(1.5, DATA), DATA);
    try {
      expect(probed).toHaveLength(1);
      effects.setMark!("md", frameOf("light", { x: 300, y: 300, w: 50, h: 50 }));
      expect(probed).toHaveLength(1); // the first light joins the measure in flight
    } finally {
      restore();
    }
  });

  test("tones are cached by a cheap key, at most 32", async () => {
    const { primeTone, luminanceCacheSize, toneKey } = await import("../src/render/svg-backend");
    setLuminanceProbe(async () => 0.5);
    const long = (k: number) => `data:image/png;base64,${"A".repeat(5000)}${k.toString().padStart(3, "0")}`;
    primeTone(long(1));
    primeTone(long(2));
    await tick();
    expect(luminanceCacheSize()).toBe(2);
    expect(toneKey(long(1)).length).toBeLessThan(200);
    for (let k = 0; k < 40; k++) primeTone(long(100 + k));
    await tick();
    expect(luminanceCacheSize()).toBe(32);
  });

  test("a linked https picture is never probed: paper wash", async () => {
    let calls = 0;
    setLuminanceProbe(async () => (calls++, 0.1));
    const url = "https://x.org/a.png";
    const { restore, effects, overlay } = await withPicture(encodeLinkedPhoto(1.5, url), url);
    try {
      effects.setMark!("md", frameOf("light", { x: 300, y: 300, w: 50, h: 50 }));
      await tick();
      effects.setMark!("md", frameOf("light", { x: 300, y: 300, w: 50, h: 50 }));
      expect(calls).toBe(0);
      expect(washOf(overlay).getAttribute("fill")).toBe(FIGURE_GROUND);
    } finally {
      restore();
    }
  });
});


describe("the luminance probe", () => {
  /** A fake 2D context that composites like a canvas: a fill, then an image with alpha over it. */
  function fakeCtx() {
    const px = new Uint8ClampedArray(4 * 4 * 4); // 4×4, transparent
    const hex = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
    const ctx = {
      fillStyle: "#000000" as string,
      fillRect: () => {
        const [r, g, b] = hex(ctx.fillStyle);
        for (let i = 0; i < px.length; i += 4) px.set([r, g, b, 255], i);
      },
      drawImage: (img: { data: Uint8ClampedArray }) => {
        for (let i = 0; i < px.length; i += 4) {
          const a = img.data[i + 3] / 255;
          const under = px[i + 3] / 255;
          for (let c = 0; c < 3; c++) px[i + c] = a * img.data[i + c] + (1 - a) * px[i + c];
          px[i + 3] = 255 * (a + under * (1 - a));
        }
      },
      getImageData: () => ({ data: px }),
    };
    return ctx;
  }
  test("a mostly transparent picture of dark lines measures as what the viewer sees: paper", async () => {
    const { drawnLuminance } = await import("../src/render/svg-backend");
    const data = new Uint8ClampedArray(4 * 4 * 4);
    for (const k of [0, 5, 10]) data.set([20, 20, 20, 255], k * 4); // three dark line pixels, the rest clear
    const v = drawnLuminance(fakeCtx() as never, { data } as never, 4);
    expect(v).not.toBeNull();
    expect(v!).toBeGreaterThan(0.42);
  });
});
