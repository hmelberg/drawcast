// Icons under the bars (round 7 §6): a picture each, between the axis and
// the label, part of its bar; a keyword missing from the cache is named.
import { beforeAll, describe, expect, test } from "vitest";
import dataYaml from "../src/scenes/packs/data.yaml?raw";
import { registerPack } from "../src/scenes/packs";
import { scenes } from "../src/scenes/registry";
import { layoutSpec } from "../src/layout/layout";
import { expandSpec } from "../src/spec/expand";
import { flattenDrawables, type GroupDrawable, type ImageDrawable, type StrokeDrawable, type TextDrawable } from "../src/layout/model";
import { hoistIcons, iconSlots } from "../src/spec/icon-data";
import { validateSceneLayout } from "../src/scenes/compile";
import { translatableStrings } from "../src/spec/i18n";
import type { Spec } from "../src/spec/types";

beforeAll(() => {
  expect(registerPack("data", dataYaml).errors).toEqual([]);
});
const chart = (params: object) => ({ template: "bar_chart", params, elements: [], commands: [] }) as unknown as Spec;
const find = (l: ReturnType<typeof layoutSpec>, id: string) => flattenDrawables(l.drawables).find((d) => d.id === id);
const params = { labels: ["Shark", "Dog", "Snake"], values: [1, 25, 50], icons: ["shark", "dog", "snake"] };

describe("icons under the bars", () => {
  test("a picture each, under the axis and over the label, inside its bar's group", () => {
    const l = layoutSpec(expandSpec(chart(params)));
    expect(l.warnings).toEqual([]);
    const bar = l.drawables.find((d) => d.id === "bar_1") as GroupDrawable;
    const pic = flattenDrawables(bar.children).find((d) => d.id === "bar_1__icon__pic") as ImageDrawable;
    expect(pic.kind).toBe("image");
    expect(pic.href.startsWith("data:image/")).toBe(true);
    const label = find(l, "bar_1__l") as TextDrawable;
    const axisY = (find(l, "axes__x") as StrokeDrawable).pts[0][1];
    expect(pic.pos[1] + pic.h / 2).toBeLessThan(axisY);
    expect(pic.pos[1] - pic.h / 2).toBeGreaterThan(label.pos[1]);
    expect(Math.max(pic.w, pic.h)).toBeLessThanOrEqual(44.01);
  });

  test("the row is kept for the keywords: the chart does not jump when the data arrives", () => {
    const bare = layoutSpec(chart(params));
    const full = layoutSpec(expandSpec(chart(params)));
    expect((find(bare, "bar_1__l") as TextDrawable).pos).toEqual((find(full, "bar_1__l") as TextDrawable).pos);
  });

  test("a keyword missing from the cache is named in a warning (Review Focus 5)", () => {
    const l = layoutSpec(expandSpec(chart({ ...params, icons: ["shark", "zzqxblorp", "snake"] })));
    expect(l.warnings.some((w) => /zzqxblorp/.test(w))).toBe(true);
  });

  test("every keyword missing (no icon_data is made at all): each is still named", () => {
    const spec = expandSpec(chart({ ...params, icons: ["zzqxblorp", "qqvwmph", null] }));
    expect(spec.params!.icon_data).toBeUndefined();
    const l = layoutSpec(spec);
    expect(l.warnings.some((w) => /zzqxblorp/.test(w))).toBe(true);
    expect(l.warnings.some((w) => /qqvwmph/.test(w))).toBe(true);
  });

  test("the icon keeps its id and its place through a re-layout at new values (a staged chart, animate)", () => {
    const a = layoutSpec(expandSpec(chart(params)));
    const b = layoutSpec(expandSpec(chart({ ...params, values: [5, 10, 20] })));
    const pa = find(a, "bar_2__icon__pic") as ImageDrawable;
    const pb = find(b, "bar_2__icon__pic") as ImageDrawable;
    expect(pb).toBeDefined();
    expect(pb.pos).toEqual(pa.pos);
    expect(pb.href).toBe(pa.href);
  });

  test("more than 12 bars: no icons, and the template lint says so", () => {
    const labels = Array.from({ length: 13 }, (_, i) => `B${i + 1}`);
    const l = layoutSpec(expandSpec(chart({ labels, values: labels.map((_, i) => i + 1), icons: labels.map(() => "dog") })));
    expect(flattenDrawables(l.drawables).some((d) => /__icon/.test(d.id))).toBe(false);
    expect(l.issues.some((i) => i.rule === "template-params" && /icons/.test(i.message))).toBe(true);
  });

  test("slots, hoist and translation: keywords only in the document", () => {
    const spec = expandSpec(chart(params));
    expect(iconSlots(spec)).toHaveLength(3);
    const copy = structuredClone(spec);
    expect(hoistIcons(copy)).toBe(3);
    expect(copy.params!.icon_data).toBeUndefined();
    expect(Object.keys(copy.assets ?? {})).toContain("icon.shark");
    const schema = scenes.bar_chart!.manifest.params_schema as Record<string, unknown>;
    expect(translatableStrings(spec, schema).map((t) => t.text)).toEqual(["Shark", "Dog", "Snake"]);
  });

  test("a pack body may draw only self-contained pictures", () => {
    const img = { id: "x", kind: "image", href: "https://example.com/a.svg", pos: [10, 10], w: 10, h: 10 };
    expect(validateSceneLayout({ drawables: [img], labels: [], anchors: {}, order: ["x"] }).some((e) => /data:image/.test(e))).toBe(true);
    expect(validateSceneLayout({ drawables: [{ ...img, href: "data:image/svg+xml;charset=utf-8,%3Csvg%2F%3E" }], labels: [], anchors: {}, order: ["x"] })).toEqual([]);
  });
});
