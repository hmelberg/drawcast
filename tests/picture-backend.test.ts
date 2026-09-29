import { describe, expect, test } from "vitest";
import { rendererFor } from "../src/render/svg-backend";
import { layoutSpec } from "../src/layout/layout";
import { heuristicMeasure } from "../src/layout/measure";
import { installMiniDom, FakeNode } from "./helpers/mini-dom";
import { planCommands } from "../src/render/plan";
import { Player } from "../src/render/player";
import { SpeechManager } from "../src/render/speech";
import type { BackendEffects } from "../src/render/backend";
import { FOCUS_DIM } from "../src/render/backend";
import { FULL_VIEW4 } from "../src/spec/places";

const SPEC = { elements: [{ id: "t", type: "text", text: "Hi", x: 500, y: 375 }], commands: [{ draw: ["t"] }] };

async function mounted() {
  const { restore, doc } = installMiniDom();
  const layout = layoutSpec(SPEC as never, heuristicMeasure);
  const container = new FakeNode("div", doc as never);
  const r = await rendererFor("clean").mount(layout, SPEC as never, container as never);
  for (const el of r.elements.values()) el.finish();
  const svg = container.children[0];
  return { restore, effects: r.effects!, overlay: svg.children[svg.children.length - 1] };
}

describe("the box effect", () => {
  test("a box with no leaves draws a mark round the given box, at the level's opacity", async () => {
    const { restore, effects, overlay } = await mounted();
    try {
      effects.setHighlight(["md:left"], "box", 0.5, { x: 100, y: 300, w: 200, h: 200 });
      expect(overlay.children.length).toBe(1);
      expect(Number(overlay.children[0].style.opacity)).toBeCloseTo(0.5, 3);
      effects.endHighlight(["md:left"]);
      expect(overlay.children.length).toBe(0);
    } finally {
      restore();
    }
  });
});

describe("the spotlight", () => {
  test("setSpotlight draws one even-odd wash per picture; endSpotlight removes it", async () => {
    const { restore, effects, overlay } = await mounted();
    try {
      effects.setSpotlight!([{ frame: { x: 100, y: 300, w: 400, h: 200 }, holes: [{ x: 100, y: 300, w: 200, h: 200 }] }], FOCUS_DIM);
      const wash = overlay.children.find((n) => n.getAttribute("fill-rule") === "evenodd");
      expect(wash).toBeDefined();
      expect(Number(wash!.getAttribute("fill-opacity"))).toBeCloseTo(1 - FOCUS_DIM, 3);
      effects.endSpotlight!();
      expect(overlay.children.find((n) => n.getAttribute("fill-rule") === "evenodd")).toBeUndefined();
    } finally {
      restore();
    }
  });

  test("the player plays a focus step's spots and always ends them", async () => {
    const spots: number[] = [];
    let ended = false;
    const effects: BackendEffects = {
      setHighlight: () => undefined,
      endHighlight: () => undefined,
      setFocus: () => undefined,
      endFocus: () => undefined,
      setSpotlight: (_s, a) => spots.push(a),
      endSpotlight: () => (ended = true),
      setPointer: () => undefined,
      setCamera: () => undefined,
    };
    const rect = { x: 100, y: 300, w: 400, h: 200 };
    const plan = planCommands([{ draw: ["md"] }, { focus: { target: "md:left", duration: 0.5 } }] as never, ["md"], {
      bboxOf: () => rect,
      pictureOf: () => ({ frame: { rect, view: FULL_VIEW4 }, regions: { left: [0, 0, 0.5, 1] } }),
    } as never);
    const stub = (id: string) => ({ id, durationMs: 10, finish: () => undefined, hide: () => undefined, setProgress: () => undefined }) as never;
    const player = new Player(plan, new Map([["md", stub("md")]]), new SpeechManager(), null, { mode: "narrated", effects });
    const frames: ((now: number) => void)[] = [];
    player.raf = (cb) => frames.push(cb);
    const done = player.play();
    const flush = () => new Promise((r) => setTimeout(r, 10));
    await flush();
    let now = performance.now();
    for (let guard = 0; player.state === "playing" && guard < 60; guard++) {
      now += 120;
      for (const cb of frames.splice(0)) cb(now);
      await flush();
    }
    await done;
    expect(spots.length).toBeGreaterThan(0);
    expect(Math.min(...spots)).toBeCloseTo(FOCUS_DIM, 2);
    expect(ended).toBe(true);
  });
});
