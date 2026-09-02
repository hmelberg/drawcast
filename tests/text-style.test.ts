import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { BASE_FONT_SIZE, applyTextStyle, effectiveTextStyle, scaledMeasure, type TextStyle } from "../src/layout/text-style";
import { heuristicMeasure } from "../src/layout/measure";
import { Z_TEXT, defaultDrawOpts, defaultStyle, type Drawable, type TextDrawable } from "../src/layout/model";
import type { LayoutResult } from "../src/layout/layout";
import { validateSpec } from "../src/spec/schema";
import { DEFAULT_SETTINGS, SETTINGS_TABS } from "../src/store";
import { rendererFor } from "../src/render/svg-backend";
import { FakeNode, installMiniDom } from "./helpers/mini-dom";

// Hans 2026-09-02: "control the font size of all (or most) of the text …
// with an argument in the spec? Or the player." Agreed scope: a global text
// size and family, set as defaults in the spec's `text:` block and
// overridable per viewer in Settings → Playback; a spec-level weight; CSS
// property names, snake_cased, CSS keyword values. Precedence: the viewer's
// setting if set, else the spec, else the app default (26, cursive, normal).
// Per-element bold/italic wait for a drawcast that needs them.

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");

describe("effectiveTextStyle — one rule for one value", () => {
  test("nothing said anywhere: the app defaults", () => {
    expect(effectiveTextStyle({})).toEqual({ scale: 1, family: "cursive", weight: "normal" });
    expect(BASE_FONT_SIZE).toBe(26);
  });

  test("the spec's text block sets the defaults — size as a base, scaled against 26", () => {
    const ts = effectiveTextStyle({ text: { font_size: 39, font_family: "sans-serif", font_weight: "bold" } });
    expect(ts).toEqual({ scale: 1.5, family: "sans-serif", weight: "bold" });
  });

  test("the viewer's setting wins over the spec; a null setting follows the spec", () => {
    const spec = { text: { font_size: 39, font_family: "sans-serif" as const } };
    expect(effectiveTextStyle(spec, { fontSize: 22, family: "monospace" })).toEqual({ scale: 22 / 26, family: "monospace", weight: "normal" });
    expect(effectiveTextStyle(spec, { fontSize: null, family: null })).toEqual({ scale: 1.5, family: "sans-serif", weight: "normal" });
  });

  test("weight has no viewer override — it is the maker's emphasis", () => {
    const ts = effectiveTextStyle({ text: { font_weight: "bold" } }, { fontSize: 22, family: "cursive" });
    expect(ts.weight).toBe("bold");
  });

  test("sizes are clamped to what still lays out (16–48)", () => {
    expect(effectiveTextStyle({ text: { font_size: 200 } }).scale).toBe(48 / 26);
    expect(effectiveTextStyle({ text: { font_size: 5 } }).scale).toBe(16 / 26);
  });
});

describe("scaledMeasure — layout reserves room for the text that will be drawn", () => {
  test("measures at the scaled size", () => {
    const calls: number[] = [];
    const m = scaledMeasure((text, size) => (calls.push(size), heuristicMeasure(text, size)), 1.5);
    expect(m("abc", 26)).toEqual(heuristicMeasure("abc", 39));
    expect(calls).toEqual([39]);
  });
});

function text(id: string, extra: Partial<TextDrawable> = {}): TextDrawable {
  return { id, kind: "text", pos: [100, 100], text: "Price", fontSize: 26, anchor: "middle", z: Z_TEXT, style: defaultStyle(), drawOpts: defaultDrawOpts(), ...extra };
}
const bold: TextStyle = { scale: 1.5, family: "sans-serif", weight: "bold" };

describe("applyTextStyle — the drawn text matches what was measured", () => {
  const layout = (): LayoutResult => ({
    drawables: [
      text("t1"),
      text("code", { font: "mono" }),
      { id: "g", kind: "group", z: Z_TEXT, style: defaultStyle(), drawOpts: defaultDrawOpts(), children: [text("t2", { fontSize: 20 })] } as Drawable,
    ],
    order: ["t1", "code", "g"],
    issues: [],
    warnings: [],
  });

  test("scales every text drawable, nested ones included, and stamps family and weight", () => {
    const out = applyTextStyle(layout(), bold);
    const t1 = out.drawables[0] as TextDrawable;
    expect([t1.fontSize, t1.family, t1.weight]).toEqual([39, "sans-serif", "bold"]);
    const t2 = (out.drawables[2] as { children: TextDrawable[] }).children[0];
    expect(t2.fontSize).toBe(30);
  });

  test("code keeps its monospace face whatever the family", () => {
    const code = applyTextStyle(layout(), bold).drawables[1] as TextDrawable;
    expect(code.font).toBe("mono");
  });

  test("does not mutate the layout it was given", () => {
    const l = layout();
    applyTextStyle(l, bold);
    expect((l.drawables[0] as TextDrawable).fontSize).toBe(26);
  });
});

describe("the SVG backend draws the stamped face", () => {
  async function textNodes(d: TextDrawable): Promise<FakeNode[]> {
    const { restore, doc } = installMiniDom();
    try {
      const container = new FakeNode("div", doc as never);
      const layout: LayoutResult = { drawables: [d], order: [d.id], issues: [], warnings: [] };
      await rendererFor("clean").mount(layout, {} as never, container as never);
      const out: FakeNode[] = [];
      const walk = (n: FakeNode) => {
        if (n.tagName === "text") out.push(n);
        n.children.forEach(walk);
      };
      walk(container);
      return out;
    } finally {
      restore();
    }
  }

  test("sans-serif and bold reach the <text> element; cursive is the handwriting stack", async () => {
    const [sans] = await textNodes(text("t", { family: "sans-serif", weight: "bold" }));
    expect(sans.getAttribute("font-family")).toMatch(/sans-serif/);
    expect(sans.getAttribute("font-family")).not.toMatch(/Patrick Hand/);
    expect(sans.getAttribute("font-weight")).toBe("bold");
    const [hand] = await textNodes(text("t", { family: "cursive" }));
    expect(hand.getAttribute("font-family")).toMatch(/Patrick Hand/);
    expect(hand.hasAttribute("font-weight")).toBe(false);
  });

  test("code stays monospace under a sans-serif family", async () => {
    const [code] = await textNodes(text("t", { font: "mono", family: "sans-serif" }));
    expect(code.getAttribute("font-family")).toMatch(/monospace/);
    expect(code.getAttribute("font-family")).not.toMatch(/sans-serif/);
  });
});

describe("the spec's text block", () => {
  const base = { template: "supply_demand", commands: [{ draw: "axes" }] };
  test("accepts CSS names with CSS keyword values", () => {
    expect(validateSpec({ ...base, text: { font_size: 32, font_family: "sans-serif", font_weight: "bold" } }).ok).toBe(true);
    expect(validateSpec({ ...base, text: { font_family: "monospace" } }).ok).toBe(true);
  });
  test("rejects a font name, a numeric weight, and an unknown property", () => {
    expect(validateSpec({ ...base, text: { font_family: "Comic Sans" } }).ok).toBe(false);
    expect(validateSpec({ ...base, text: { font_weight: 700 } }).ok).toBe(false);
    expect(validateSpec({ ...base, text: { font_style: "italic" } }).ok).toBe(false);
  });
});

describe("the compiler prompt teaches the block", () => {
  test("names the properties, the keyword values, and the sparing-use rule", () => {
    const prompt = read("../src/llm/prompts/compiler-v1.md");
    expect(prompt).toMatch(/^## Text/m);
    for (const s of ["`text:`", "font_size", "font_family", "font_weight", "cursive", "sans-serif", "monospace", "26"]) expect(prompt).toContain(s);
  });
});

describe("Settings → Playback carries the viewer's two overrides", () => {
  test("text size and font file under playback, default to follow-the-drawcast", () => {
    const playback = SETTINGS_TABS.find((t) => t.id === "playback")!.fields;
    expect(playback).toContain("textSize");
    expect(playback).toContain("textFamily");
    expect(DEFAULT_SETTINGS.textSize).toBeNull();
    expect(DEFAULT_SETTINGS.textFamily).toBeNull();
  });
});

describe("wiring — where the override applies and where it must not", () => {
  test("render() derives the style, scales the layout, and hands the HTML text its scale and face", () => {
    const src = read("../src/render/index.ts");
    expect(src).toMatch(/effectiveTextStyle\(spec, options\.text\)/);
    expect(src).toMatch(/applyTextStyle\(/);
    expect(src).toMatch(/scaledMeasure\(/);
    expect(src).toMatch(/--cs-text-scale/);
    expect(src).toMatch(/--sketch-font/);
  });
  test("captions and the title scale with the drawing", () => {
    const css = read("../src/render/figure-style.ts");
    expect(css.match(/var\(--cs-text-scale, 1\)/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
  });
  test("the playlist session passes the override through to every render", () => {
    expect(read("../src/playlist/session.ts")).toMatch(/text: opts\.text/);
  });
  test("the app applies it in Player mode only — the editor shows the spec's default — and the viewer applies it", () => {
    const main = read("../src/main.ts");
    expect(main).toMatch(/text: isPlayer \? \{ fontSize: settings\.textSize, family: settings\.textFamily \} : undefined/);
    const viewer = read("../src/viewer.ts");
    expect(viewer).toMatch(/text: \{ fontSize: settings\.textSize, family: settings\.textFamily \}/);
  });
});
