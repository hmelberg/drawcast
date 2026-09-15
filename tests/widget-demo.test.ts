// tests/widget-demo.test.ts — the movie form of a template-bound ask.
// Plain node: no DOM anywhere on this path (the GATE needs one, so that stays
// source-pinned in tests/widget-ask.test.ts), which is the point — the exporter
// never attaches UI and must still see the widget demonstrate itself.
import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, test, vi } from "vitest";
import { compileTemplateDoc } from "../src/scenes/compile";
import { scenes } from "../src/scenes/registry";
import { ensureEnabledPacks, packTemplateIds } from "../src/scenes/packs";
import { widgetDemoFor } from "../src/render/widget-demo";
import { demoWidget, keyEvent, runWidget } from "../src/scenes/widget-run";
import { buildWidgetScene } from "../src/scenes/widget-scene";
import { layoutSpec } from "../src/layout/layout";
import type { BBox } from "../src/layout/geometry";
import type { PlanStep } from "../src/render/plan";
import type { Player } from "../src/render/player";
import type { Spec } from "../src/spec/types";
import type { TemplateDoc } from "../src/scenes/doc";

const doc = {
  template: "demo_pads",
  version: 1,
  kit: 10,
  status: "ready",
  description: "Two pads.",
  params: { type: "object", properties: { x: { type: "number" }, signal: { type: "string" } } },
  element_ids: { dot: "dot pad", gap: "gap pad", signal: "the strip" },
  examples: [{ request: "pads", params: {} }],
  layout: `
    const x = params.x ?? 300;
    const drawables = [kit.pad("dot", [x, 400], "·", { r: 40 }), kit.pad("gap", [500, 400], "gap", { w: 90, h: 60 }), kit.text("signal", [400, 550], params.signal ?? "", { fontSize: 30 })];
    return { drawables, labels: [], anchors: {}, order: ["dot", "gap", "signal"] };`,
  widget: `
    const init = () => ({ signal: "" });
    const on = (ev, st) => ({ state: st, effects: [] });
    // One effect per character of the answer, then the strip, then the word.
    const demo = (scene, answer) => {
      const out = [];
      for (const ch of answer) {
        out.push(ch === "."
          ? { pointer: "dot", sound: { hz: 700, ms: 80 }, glow: "dot", color: "#0a0" }
          : { pointer: "gap", sound: { notes: "C4:q" } });
      }
      out.push({ patch: { signal: answer } });
      out.push({ caption: "for " + (scene.vars.who ?? "nobody") });
      return out;
    };
    return { init, on, demo };`,
} as TemplateDoc;

scenes["demo_pads"] = compileTemplateDoc(doc).module!;

const spec = { title: "t", template: "demo_pads", params: {}, commands: [] } as unknown as Spec;
/** What the plan was made against… */
const planLayout = layoutSpec(spec);
/** …and where the figure actually stands now: the dot has moved right. */
const painted = layoutSpec({ ...spec, params: { x: 700 } } as unknown as Spec);

const askStep = {
  kind: "ask",
  question: "Send SOS?",
  answer: ".-",
  reveal: true,
  retry: false,
  required: false,
  widget: "demo_pads",
  widgetTemplate: true,
} as Extract<PlanStep, { kind: "ask" }>;

function fakePlayer(paintedLayout: typeof painted | null = painted) {
  const calls: string[] = [];
  const taps: BBox[] = [];
  const previews: { overrides: Record<string, unknown>; opts: { revealNew?: boolean } }[] = [];
  const player = {
    vars: new Map([["who", "hans"]]),
    getParamOverrides: () => ({}),
    paintedLayout: () => paintedLayout,
    tones: {
      beep: (hz: number, ms: number) => (calls.push(`beep ${hz} ${ms}`), ms),
      play: (voices: { notes: string }[], tempo: number) => (calls.push(`play ${voices[0].notes} @${tempo}`), 0),
    },
    caption: (t: string | null) => calls.push(`caption ${t}`),
    previewParams: (overrides: Record<string, unknown>, opts: { revealNew?: boolean } = {}) => {
      previews.push({ overrides, opts });
      calls.push(`preview ${JSON.stringify(overrides)}`);
    },
    glow: async (ids: string[], _ms?: number, color?: string) => void calls.push(`glow ${ids.join(",")}${color ? ` ${color}` : ""}`),
    tapAt: async (box: BBox, ms?: number) => {
      taps.push(box);
      calls.push(`tap @${ms}`);
    },
  };
  return { player: player as unknown as Player, calls, taps, previews };
}

const run = (p: Player, signal = new AbortController().signal) => widgetDemoFor(p, spec, planLayout)(signal, askStep);

describe("widgetDemoFor — the laser performs the widget's own demo", () => {
  test("effects run in order, and within one effect: sound, caption, patch, glow, pointer", async () => {
    const { player, calls } = fakePlayer();
    await run(player);
    expect(calls).toEqual([
      // "." → a plain tone, the pad glows, the laser taps it
      "beep 700 80",
      "glow dot #0a0",
      "tap @900",
      // "-" → notated sound, then the tap
      "play C4:q @120",
      "tap @900",
      // the strip catches up with the answer
      'preview {"signal":".-"}',
      // …and the widget's own word, read off the player's vars
      "caption for hans",
      // the caption is handed back when the demo is over
      "caption null",
    ]);
  });

  test("{hz, ms} goes to beep and {notes} to play — never the other way round", async () => {
    const { player, calls } = fakePlayer();
    await run(player);
    expect(calls.filter((c) => c.startsWith("beep"))).toEqual(["beep 700 80"]);
    expect(calls.filter((c) => c.startsWith("play"))).toEqual(["play C4:q @120"]);
  });

  test("a patch reaches previewParams with revealNew, carrying every patch so far", async () => {
    const { player, previews } = fakePlayer();
    await run(player);
    expect(previews).toEqual([{ overrides: { signal: ".-" }, opts: { revealNew: true } }]);
  });

  test("the caption is restored at the end, and only when the demo ever captioned", async () => {
    const { player, calls } = fakePlayer();
    await run(player);
    expect(calls.at(-1)).toBe("caption null");
    expect(calls.filter((c) => c === "caption null")).toHaveLength(1);
  });

  test("the taps land on the PAINTED geometry, not the geometry the plan was made against", async () => {
    const { player, taps } = fakePlayer();
    await run(player);
    const here = buildWidgetScene(scenes["demo_pads"], {}, { layout: painted })!;
    const stale = buildWidgetScene(scenes["demo_pads"], {}, { layout: planLayout })!;
    expect(taps[0]).toEqual(here.boxes.get("dot"));
    expect(taps[0]).not.toEqual(stale.boxes.get("dot")); // the dot really did move
    expect(taps[1]).toEqual(here.boxes.get("gap"));
  });

  test("without a painted layout it falls back to the one render() handed it", async () => {
    const { player, taps } = fakePlayer(null);
    await run(player);
    expect(taps[0]).toEqual(buildWidgetScene(scenes["demo_pads"], {}, { layout: planLayout })!.boxes.get("dot"));
  });

  test("an already-aborted signal performs nothing at all", async () => {
    const { player, calls } = fakePlayer();
    const ac = new AbortController();
    ac.abort();
    await run(player, ac.signal);
    expect(calls).toEqual([]);
  });

  test("a template with no widget body, and an ask with no answer, are both no-ops", async () => {
    const { player, calls } = fakePlayer();
    await widgetDemoFor(player, { ...spec, template: "free_body" } as unknown as Spec, planLayout)(new AbortController().signal, askStep);
    const { answer: _drop, ...answerless } = askStep;
    await widgetDemoFor(player, spec, planLayout)(new AbortController().signal, answerless as Extract<PlanStep, { kind: "ask" }>);
    expect(calls).toEqual([]);
  });

  test("a demo that throws is reported, not raised — the movie goes on", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const thrower = compileTemplateDoc({ ...doc, template: "demo_throws", widget: `return { init: () => 0, on: (e, s) => ({ state: s, effects: [] }), demo: () => { throw new Error("nope"); } };` } as TemplateDoc).module!;
    scenes["demo_throws"] = thrower;
    const { player, calls } = fakePlayer();
    await widgetDemoFor(player, { ...spec, template: "demo_throws" } as unknown as Spec, planLayout)(new AbortController().signal, askStep);
    expect(calls).toEqual([]);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("demo() threw: nope"));
    warn.mockRestore();
  });
});

// F6, the movie's own ruling: a demo that only TAPS leaves the figure frozen
// while the laser dances over it — the viewer sees the gestures and none of
// their consequences. Every shipped widget's demo must move the figure.
describe("the widgets pack demonstrates itself by CHANGING the figure", () => {
  const cases = [
    { template: "morse_key", params: { word: "SOS" }, answer: "SOS" },
    { template: "tower_of_hanoi", params: { disks: 3 }, answer: "solved" },
    { template: "logic_gates", params: { gate: "XOR" }, answer: "lit" },
    { template: "xylophone", params: {}, answer: "C4 E4 G4" },
    { template: "bubble_sort", params: { values: [5, 2, 8, 1, 9, 3] }, answer: "sorted" },
    { template: "tictactoe", params: {}, answer: "draw" },
  ];
  beforeAll(async () => {
    await ensureEnabledPacks(["widgets"]);
  });

  test("the list below covers every widget the pack ships", () => {
    const shipped = packTemplateIds("widgets").filter((id) => scenes[id]?.widget);
    expect(shipped.sort()).toEqual(cases.map((c) => c.template).sort());
  });

  test.each(cases)("$template's demo patches the params, taps, and reports nothing", ({ template, params, answer }) => {
    const { effects, errors } = demoWidget(scenes[template], params, answer);
    expect(errors, template).toEqual([]);
    expect(effects.filter((e) => e.patch).length, `${template}: the figure never changes`).toBeGreaterThan(0);
    expect(effects.filter((e) => e.pointer).length, `${template}: nothing is pointed at`).toBeGreaterThan(0);
  });

  test("morse: space held short is a dot, long a dash; Enter ends the letter; Enter again sends", () => {
    const m = scenes["morse_key"];
    const r = runWidget(m, { word: "SOS" }, [
      keyEvent(" ", 80), keyEvent(" ", 80), keyEvent(" ", 80), keyEvent("Enter", 50),
      keyEvent(" ", 400), keyEvent(" ", 400), keyEvent(" ", 400), keyEvent("Enter", 50),
      keyEvent(" ", 80), keyEvent(" ", 80), keyEvent(" ", 80), keyEvent("Enter", 50),
      keyEvent("Enter", 50),
    ]);
    expect(r.errors).toEqual([]);
    expect(r.params.decoded).toBe("SOS");
    expect(r.answer).toBe("SOS");
    expect(r.effects.flat().filter((e) => e.answer !== undefined)).toHaveLength(1);
  });
  test("hanoi's demo ends on the solved tower whatever the disk count", () => {
    for (const disks of [3, 4, 5]) {
      const d = demoWidget(scenes["tower_of_hanoi"], { disks }, "solved");
      const last = [...d.effects].reverse().find((e) => e.patch)!;
      expect((last.patch as { pegs: string }).pegs.split("|")[2]).toHaveLength(disks);
    }
  });
  test("every gate's demo taps something and ends lit", () => {
    for (const gate of ["AND", "OR", "XOR", "NAND"]) {
      const d = demoWidget(scenes["logic_gates"], { gate }, "lit");
      expect(d.effects.some((e) => e.pointer)).toBe(true);
      expect(d.effects.at(-1)!.glow).toEqual(["bulb"]);
    }
  });
});

describe("widgetDemoFor — source pins for what plain node cannot show", () => {
  const src = readFileSync("src/render/widget-demo.ts", "utf8");
  test("the demo reads the same scene the live host does: painted layout, the player's vars, one shared measure", () => {
    // makeBrowserMeasure falls back to the heuristic without a document, so in
    // node both branches measure alike — only the source can say they agree.
    expect(src).toContain("vars: Object.fromEntries(player.vars)");
    expect(src).toContain("layout: player.paintedLayout() ?? layout");
    expect(src).toContain("const measure = makeBrowserMeasure()");
    // ...built in ONE place, so the demo's own scene, the first scene and every
    // rebuilt one cannot drift apart.
    const builds = src.match(/(?:buildWidgetScene|demoWidget)\(.*\)/g) ?? [];
    expect(builds.length).toBeGreaterThanOrEqual(3);
    for (const call of builds) expect(call).toContain("sceneOpts()");
  });
});
