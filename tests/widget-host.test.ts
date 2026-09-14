// tests/widget-host.test.ts
import { readFileSync } from "node:fs";
import { describe, expect, test, vi } from "vitest";
import { compileTemplateDoc } from "../src/scenes/compile";
import { scenes } from "../src/scenes/registry";
import { widgetHostFor } from "../src/ui/widget-host";
import { layoutSpec } from "../src/layout/layout";
import type { RenderHandle } from "../src/render";
import type { TemplateDoc } from "../src/scenes/doc";

const doc = {
  template: "host_pads",
  version: 1,
  kit: 10,
  status: "ready",
  description: "Two pads.",
  params: { type: "object", properties: { signal: { type: "string" } } },
  element_ids: { dot: "dot pad", gap: "gap pad", signal: "the strip" },
  examples: [{ request: "pads", params: {} }],
  layout: `
    const drawables = [kit.pad("dot", [300, 400], "·", { r: 40 }), kit.pad("gap", [500, 400], "gap", { w: 90, h: 60 }), kit.text("signal", [400, 550], params.signal ?? "", { fontSize: 30 })];
    return { drawables, labels: [], anchors: {}, order: ["dot", "gap", "signal"] };`,
  widget: `
    const init = () => ({ signal: "" });
    const on = (ev, st) => {
      if (ev.id === "dot") { const signal = st.signal + "."; return { state: { signal }, effects: [{ sound: { hz: 700, ms: 80 } }, { patch: { signal } }, { glow: "dot" }] }; }
      if (ev.id === "gap") return { state: st, effects: [{ answer: st.signal }, { caption: "sent" }, { patch: { nope: 1 } }] };
      return { state: st, effects: [] };
    };
    return { init, on };`,
} as TemplateDoc;

scenes["host_pads"] = compileTemplateDoc(doc).module!;

function fakeHandle() {
  const spec = { template: "host_pads", params: {}, commands: [] } as unknown as RenderHandle["spec"];
  const layout = layoutSpec(spec);
  const calls: string[] = [];
  const timeline = {
    state: "paused",
    position: 0,
    vars: new Map<string, string>(),
    callbacks: {},
    tones: { beep: (hz: number, ms: number) => (calls.push(`beep ${hz} ${ms}`), ms), play: () => 0, cancel: () => undefined, pause: () => undefined, resume: () => undefined },
    previewParams: (o: Record<string, unknown>) => calls.push(`preview ${JSON.stringify(o)}`),
    paintedLayout: () => null,
    glow: async (ids: string[]) => void calls.push(`glow ${ids.join(",")}`),
    tapAt: async () => undefined,
    caption: (t: string | null) => calls.push(`caption ${t}`),
    getParamOverrides: () => ({}),
  };
  const hd = { spec, layout, timeline } as unknown as RenderHandle;
  return { hd, calls, timeline };
}

describe("widgetHostFor", () => {
  test("null for a template without a widget body", () => {
    const { hd } = fakeHandle();
    (hd.spec as { template: string }).template = "free_body";
    expect(widgetHostFor(hd)).toBeNull();
  });

  test("a click on a part runs the widget and performs the effects in order", () => {
    const { hd, calls } = fakeHandle();
    const host = widgetHostFor(hd)!;
    expect(host.over([300, 400])).toBe(true);
    expect(host.over([900, 700])).toBe(false);
    expect(host.clickAt([300, 400])).toBe(true);
    expect(calls).toEqual(["beep 700 80", 'preview {"signal":"."}', "glow dot"]);
    expect(host.clickAt([300, 400])).toBe(true);
    expect(calls[4]).toBe('preview {"signal":".."}'); // patches accumulate
  });

  test("a click on nothing is not consumed", () => {
    const { hd, calls } = fakeHandle();
    const host = widgetHostFor(hd)!;
    expect(host.clickAt([900, 700])).toBe(false);
    expect(calls).toEqual([]);
  });

  test("answer effects are remembered and published; unknown params are warned, not applied", () => {
    const warn = vi.fn();
    const { hd, calls } = fakeHandle();
    const host = widgetHostFor(hd, { warn })!;
    const seen: string[] = [];
    host.onAnswer((v) => seen.push(v));
    host.clickAt([300, 400]);
    host.clickAt([500, 400]);
    expect(host.lastAnswer()).toBe(".");
    expect(seen).toEqual(["."]);
    expect(calls).toContain("caption sent");
    expect(calls.filter((c) => c.includes("nope"))).toEqual([]);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('"nope" is not a template param'));
  });

  test("reset forgets state, patches and the caption", () => {
    const { hd, calls } = fakeHandle();
    const host = widgetHostFor(hd)!;
    host.clickAt([300, 400]);
    host.clickAt([500, 400]);
    host.reset();
    expect(host.lastAnswer()).toBeNull();
    expect(calls.at(-1)).toBe("caption null");
    host.clickAt([300, 400]);
    expect(calls.at(-2)).toBe('preview {"signal":"."}'); // state started over
  });
});

describe("attachWidgetHost — source pins", () => {
  const src = readFileSync("src/ui/widget-host.ts", "utf8");
  const controls = readFileSync("src/ui/controls.ts", "utf8");
  const infocard = readFileSync("src/ui/infocard.ts", "utf8");
  test("listens in the capture phase, stands aside while playing and while a gate is open", () => {
    expect(src).toContain('stage.addEventListener("click"');
    expect(src).toMatch(/hd\.timeline\.state === "playing"\) return/);
    expect(src).toMatch(/gateIsOpen\(stage\)\) return/);
    expect(src).toContain("e.stopPropagation()");
  });
  test("resets on play, on a step boundary and chains the callbacks", () => {
    expect(src).toContain("const prevOnState = hd.timeline.callbacks.onState");
    expect(src).toContain("const prevOnStep = hd.timeline.callbacks.onStep");
    expect(src).toMatch(/if \(s === "playing"\) host\.reset\(\)/);
  });
  test("the cursor class marks parts while paused", () => {
    expect(src).toContain('stage.classList.toggle("cs-cardable"');
  });
  test("controls attaches it beside the chess free play, before the info cards", () => {
    const a = controls.indexOf("attachWidgetHost(stage, hd)");
    const b = controls.indexOf("attachInfoCards(stage, hd, widgetHost)");
    expect(a).toBeGreaterThan(-1);
    expect(a).toBeLessThan(b);
  });
  test("the info card stands aside for widget parts", () => {
    expect(infocard).toMatch(/widgetHost\?\.over\(p\)\) return null/);
  });
});
