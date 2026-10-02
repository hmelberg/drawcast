// Round 6 §8: icons authored as keywords only. The artwork lives in
// `assets:` (published / embedded) or the offline icon cache (examples,
// lint, tests), one name per keyword; a picture look (default for nodes and
// cards) shows the SVG itself, faded in whole, in figure coordinates; the
// drawn look (default for an icon element) traces it by hand.
import { describe, expect, test } from "vitest";
import { layoutSpec, elementBBoxes } from "../src/layout/layout";
import { drawablesForId, leafDrawables, type Drawable, type ImageDrawable } from "../src/layout/model";
import { expandSpec } from "../src/spec/expand";
import { validateSpec } from "../src/spec/schema";
import { hoistStrokes } from "../src/spec/assets";
import {
  encodeIconSvg,
  hoistIcons,
  iconAssetName,
  iconCreditOf,
  iconLookOf,
  iconPictureOf,
  missingIcons,
  registerIconStore,
  withIconData,
} from "../src/spec/icon-data";
import { iconSearchUrl, iconSvgUrl, pictureNames, resolveIcons, DEFAULT_PREFIXES, PICTURE_PREFIXES } from "../src/render/icon";
import { embeddedPlaylist } from "../src/publish/embed";
import { singlePlaylist, itemsOf } from "../src/playlist/playlist";
import type { Spec } from "../src/spec/types";

type Leaf = Exclude<Drawable, { kind: "group" }>;
const SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24"><path fill="currentColor" d="M2 20h20v-8l-6 4v-4l-6 4V8H2z"/></svg>';
const COLOUR = '<svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 36 36"><path fill="#d99e82" d="M2 2h32v32H2z"/></svg>';

// A store of our own, with keywords no other test uses.
const store: Record<string, string> = {
  [iconAssetName({ of: "kw-whale" }, "picture")]: encodeIconSvg("twemoji", "kw-whale", COLOUR),
  [iconAssetName({ of: "kw-whale" }, "drawn")]: encodeIconSvg("lucide", "kw-whale", SVG),
  [iconAssetName({ of: "kw-gear", set: "tabler" }, "picture")]: encodeIconSvg("tabler", "kw-gear", SVG),
};
registerIconStore(store);

const node = (extra: Record<string, unknown>): Spec =>
  ({ elements: [{ id: "b", type: "node", shape: "rect", text: "Whales", x: 300, y: 300, ...extra }], commands: [{ draw: ["b"] }] }) as unknown as Spec;
const leavesOf = (spec: Spec, id: string): Leaf[] => leafDrawables(drawablesForId(layoutSpec(spec).drawables, id)) as Leaf[];

describe("the data and its name", () => {
  test("one name per keyword: the set when pinned, .drawn when a bare keyword is drawn", () => {
    expect(iconAssetName({ of: "Hot pepper" }, "picture")).toBe("icon.hot-pepper");
    expect(iconAssetName({ of: "hot pepper" }, "drawn")).toBe("icon.hot-pepper.drawn");
    expect(iconAssetName({ of: "dog", set: "twemoji" }, "drawn")).toBe("icon.dog.twemoji");
  });
  test("the SVG is kept whole, without its 1em size; the credit is rebuilt from it", () => {
    const data = encodeIconSvg("twemoji", "dog", COLOUR);
    expect(data).toMatch(/^ics1:twemoji:dog:<svg /);
    expect(data).not.toMatch(/width="1em"/);
    expect(iconCreditOf(data)).toBe("dog from twemoji · CC BY 4.0");
  });
  test("a line icon's picture is in ink: currentColor becomes the box's colour", () => {
    const pic = iconPictureOf(encodeIconSvg("lucide", "x", SVG), "#123456")!;
    expect(decodeURIComponent(pic.href)).toContain('fill="#123456"');
    expect(pic.href.startsWith("data:image/svg+xml")).toBe(true);
    expect(pic.aspect).toBe(1);
  });
  test("looks: drawn for an icon element, picture for nodes and cards, icon_look wins", () => {
    expect(iconLookOf({ type: "icon" })).toBe("drawn");
    expect(iconLookOf({ type: "node" })).toBe("picture");
    expect(iconLookOf({ type: "cards" })).toBe("picture");
    expect(iconLookOf({ type: "icon", icon_look: "picture" })).toBe("picture");
    expect(iconLookOf({ type: "node", icon_look: "drawn" })).toBe("drawn");
  });
});

describe("a keyword-only spec lays out with its icons from the offline store", () => {
  test("a node: a picture — one image, faded in, inside the box above the text; no warning", () => {
    const spec = node({ icon: "kw-whale" });
    const r = layoutSpec(spec);
    expect(r.warnings).toEqual([]);
    const leaves = leavesOf(spec, "b");
    const pics = leaves.filter((d): d is ImageDrawable => d.kind === "image");
    expect(pics).toHaveLength(1);
    expect(pics[0].id).toBe("b__icon__pic");
    expect(pics[0].reveal).toBe("fade");
    expect(decodeURIComponent(pics[0].href)).toContain("#d99e82");
    const box = elementBBoxes(r).get("b")!;
    expect(pics[0].pos[0]).toBeCloseTo(box.x + box.w / 2, 0);
    expect(pics[0].pos[1]).toBeGreaterThan(box.y + box.h / 2);
    expect(pics[0].pos[1] + pics[0].h / 2).toBeLessThanOrEqual(box.y + box.h);
    // The box grew for the icon, exactly as a drawn one does.
    expect(box.h).toBeGreaterThan(90);
  });
  test("a node drawn: traced rings in the box's ink, no picture", () => {
    const leaves = leavesOf(node({ icon: "kw-whale", icon_look: "drawn" }), "b");
    expect(leaves.some((d) => d.kind === "image")).toBe(false);
    expect(leaves.filter((d) => d.id.startsWith("b__icon__r")).length).toBeGreaterThan(0);
  });
  test("an icon element: drawn by default, a picture when asked", () => {
    const icon = (extra: Record<string, unknown>): Spec => ({ elements: [{ id: "i", type: "icon", of: "kw-whale", x: 200, y: 200, size: 80, ...extra }], commands: [{ draw: ["i"] }] }) as unknown as Spec;
    const drawn = leavesOf(icon({}), "i");
    expect(drawn.every((d) => d.kind === "stroke")).toBe(true);
    const pic = leavesOf(icon({ icon_look: "picture" }), "i");
    expect(pic).toHaveLength(1);
    expect(pic[0]).toMatchObject({ kind: "image", id: "i__pic", pos: [200, 200], w: 80, h: 80, reveal: "fade" });
  });
  test("cards: the expansion finds the icons, so every card is 96 high with a picture", () => {
    const spec = { elements: [{ id: "r", type: "cards", items: [{ text: "Whale", icon: "kw-whale" }, { text: "Gear", icon: { of: "kw-gear", set: "tabler" } }], ends: ["big", "small"] }], commands: [{ draw: ["r"] }] } as unknown as Spec;
    const before = JSON.stringify(spec);
    const ex = expandSpec(spec);
    expect(JSON.stringify(spec)).toBe(before); // never the document
    const card = ex.elements!.find((e) => e.id === "r_1")!;
    expect(card).toMatchObject({ height: 96, credit: "kw-whale from twemoji · CC BY 4.0" });
    const r = layoutSpec(ex);
    expect(r.warnings).toEqual([]);
    expect(leafDrawables(drawablesForId(r.drawables, "r_2")).some((d) => d.kind === "image")).toBe(true);
  });
  test("cards drawn: icon_look on the cards element reaches every card", () => {
    const spec = { elements: [{ id: "r", type: "cards", icon_look: "drawn", items: [{ text: "Whale", icon: "kw-whale" }, "B"], ends: ["a", "b"] }], commands: [{ draw: ["r"] }] } as unknown as Spec;
    const ex = expandSpec(spec);
    expect(ex.elements!.find((e) => e.id === "r_1")).toMatchObject({ icon_look: "drawn", height: 96 });
    expect(leafDrawables(drawablesForId(layoutSpec(ex).drawables, "r_1")).some((d) => d.kind === "image")).toBe(false);
  });
  test("withIconData hands back the same object when there is nothing to fill", () => {
    const spec = node({ icon: "kw-not-anywhere" });
    expect(withIconData(spec)).toBe(spec);
  });
});

describe("a keyword missing from the offline cache", () => {
  test("is named — in the layout's warning (the cache is complete in tests) and by missingIcons", () => {
    const spec = node({ icon: "kw-nowhere-at-all" });
    const r = layoutSpec(spec);
    expect(r.warnings.join(" ")).toMatch(/no icon for "kw-nowhere-at-all" — "kw-nowhere-at-all" is not in the offline icon cache/);
    expect(missingIcons(spec)).toEqual([{ of: "kw-nowhere-at-all" }]);
  });
});

describe("hoisting icon data into assets, and back", () => {
  const data = encodeIconSvg("twemoji", "kw-owl", COLOUR);
  const resolved = (): Spec =>
    ({
      elements: [
        { id: "b", type: "node", shape: "rect", text: "Owl", x: 300, y: 300, icon: "kw-owl", icon_strokes: data, icon_key: "kw-owl@twemoji", credit: "kw-owl from twemoji · CC BY 4.0" },
        { id: "i", type: "icon", of: "kw-owl", set: "twemoji", strokes: data, icon_key: "kw-owl@twemoji", credit: "kw-owl from twemoji · CC BY 4.0", x: 600, y: 300 },
        { id: "c", type: "cards", items: [{ text: "A", match: "B", icon: "kw-owl", icon_strokes: data, match_icon: "kw-owl", match_icon_strokes: data, icon_key: "kw-owl@twemoji" }, { text: "C", match: "D" }] },
      ],
      commands: [{ draw: ["b", "i", "c"] }],
    }) as unknown as Spec;

  test("every icon keeps its keyword only; the data sits once per name under assets", () => {
    const spec = resolved();
    expect(hoistIcons(spec)).toBe(4);
    expect(Object.keys(spec.assets!).sort()).toEqual(["icon.kw-owl", "icon.kw-owl.twemoji"]);
    const [b, i, c] = spec.elements!;
    expect(b).toEqual({ id: "b", type: "node", shape: "rect", text: "Owl", x: 300, y: 300, icon: "kw-owl" });
    expect(i).toEqual({ id: "i", type: "icon", of: "kw-owl", set: "twemoji", x: 600, y: 300 });
    expect(c.items![0]).toEqual({ text: "A", match: "B", icon: "kw-owl", match_icon: "kw-owl" });
    expect(validateSpec(spec).ok).toBe(true);
  });
  test("…and back: the hoisted spec lays out with the same icons, from its own assets", () => {
    const spec = resolved();
    hoistIcons(spec);
    const r = layoutSpec(expandSpec(spec));
    expect(r.warnings).toEqual([]);
    expect(leafDrawables(drawablesForId(r.drawables, "b")).some((d) => d.kind === "image")).toBe(true);
    expect(leafDrawables(drawablesForId(r.drawables, "i")).length).toBeGreaterThan(0);
  });
  test("hoistStrokes (the Embed dialog) hoists icons by keyword, never as an @id reference", () => {
    const spec = resolved();
    hoistStrokes(spec);
    expect(spec.elements![1].strokes).toBeUndefined();
    expect(spec.assets!["i"]).toBeUndefined();
  });
  test("the resolver reads an icon from the spec's assets with nothing fetched", async () => {
    const spec = resolved();
    hoistIcons(spec);
    const asked: string[] = [];
    const fetch = (async (u: string) => {
      asked.push(u);
      return { ok: false, status: 404 };
    }) as unknown as typeof globalThis.fetch;
    const r = await resolveIcons(spec, { fetch });
    expect(r.every((x) => x.ok)).toBe(true);
    expect(asked).toEqual([]);
    expect(spec.elements![0].credit).toBe("kw-owl from twemoji · CC BY 4.0");
  });
  test("publishing hoists: the published copy carries keywords and assets", async () => {
    const none = async () => [];
    const pl = await embeddedPlaylist(singlePlaylist(resolved()), { resolvePortraits: none, resolveSources: none, resolveImages: none, resolveIcons: none, contactEmail: "" });
    const s = itemsOf(pl)[0].spec;
    expect(s.elements![0].icon_strokes).toBeUndefined();
    expect(s.assets!["icon.kw-owl"]).toBe(data);
  });
});

describe("a picture prefers the colour set", () => {
  const routes = (r: Record<string, unknown>) => {
    const asked: string[] = [];
    return {
      asked,
      fetch: (async (url: string) => {
        asked.push(url);
        return { ok: url in r, status: url in r ? 200 : 404, json: async () => r[url], text: async () => r[url] as string };
      }) as unknown as typeof fetch,
    };
  };
  test("the names tried: an alias, the keyword, <keyword>-face", () => {
    expect(pictureNames("car")).toEqual(["automobile", "car", "car-face"]);
    expect(pictureNames("Hot pepper")).toEqual(["hot-pepper", "hot-pepper-face"]);
  });
  test("a node's bare keyword: twemoji by its own name, no search", async () => {
    const d = routes({ [iconSvgUrl("twemoji", "kw-frog")]: COLOUR });
    const spec = node({ icon: "kw-frog" });
    expect(await resolveIcons(spec, d)).toEqual([{ id: "b", ok: true }]);
    expect(spec.elements![0].credit).toBe("kw-frog from twemoji · CC BY 4.0");
    expect(d.asked).toEqual([iconSvgUrl("twemoji", "kw-frog")]);
  });
  test("…then <keyword>-face", async () => {
    const d = routes({ [iconSvgUrl("twemoji", "kw-cat-face")]: COLOUR });
    const spec = node({ icon: "kw-cat" });
    await resolveIcons(spec, d);
    expect(spec.elements![0].credit).toBe("kw-cat-face from twemoji · CC BY 4.0");
  });
  test("…no twemoji of that name: the colour family searched, an exact name only — else the line icon, in ink", async () => {
    const d = routes({
      [iconSearchUrl("kw-car", PICTURE_PREFIXES)]: { icons: ["twemoji:tram-kw-car", "noto:police-kw-car"] },
      [iconSearchUrl("kw-car", DEFAULT_PREFIXES)]: { icons: ["tabler:kw-car"] },
      [iconSvgUrl("tabler", "kw-car")]: SVG,
    });
    const spec = node({ icon: "kw-car" });
    await resolveIcons(spec, d);
    expect(spec.elements![0].credit).toBe("kw-car from tabler · MIT");
    expect(d.asked.some((u) => u.includes("tram-kw-car.svg") || u.includes("police-kw-car.svg"))).toBe(false);
  });
  test("…an exact name in another colour set: that picture (noto, no credit owed)", async () => {
    const d = routes({ [iconSearchUrl("kw-lighthouse", PICTURE_PREFIXES)]: { icons: ["noto:kw-lighthouse"] }, [iconSvgUrl("noto", "kw-lighthouse")]: COLOUR });
    const spec = node({ icon: "kw-lighthouse" });
    await resolveIcons(spec, d);
    expect(spec.elements![0].credit).toBe("kw-lighthouse from noto · Apache-2.0");
  });
  test("drawn: the colour set is not tried first", async () => {
    const d = routes({ [iconSearchUrl("kw-cow", DEFAULT_PREFIXES)]: { icons: ["lucide:kw-cow"] }, [iconSvgUrl("lucide", "kw-cow")]: SVG });
    const spec = node({ icon: "kw-cow", icon_look: "drawn" });
    await resolveIcons(spec, d);
    expect(d.asked[0]).toBe(iconSearchUrl("kw-cow", DEFAULT_PREFIXES));
    expect(spec.elements![0].credit).toBe("kw-cow from lucide · ISC");
  });
  test("an old rings-only icon whose picture cannot be had is asked for once a session, not every render", async () => {
    const n = { id: "b", type: "node", shape: "rect", text: "x", icon: "kw-offline-old", icon_strokes: "ic1:[[[0,0],[1,0],[1,1]]]" };
    const d1 = routes({});
    await resolveIcons({ elements: [{ ...n }], commands: [] } as unknown as Spec, d1);
    expect(d1.asked.length).toBeGreaterThan(0);
    const d2 = routes({});
    expect(await resolveIcons({ elements: [{ ...n }], commands: [] } as unknown as Spec, d2)).toEqual([{ id: "b", ok: true }]);
    expect(d2.asked).toEqual([]);
  });
});

describe("credits for icons named by keyword (fix round 1)", () => {
  test("a published copy (data hoisted into assets) still credits its icons", async () => {
    const { creditsOf } = await import("../src/export/credits");
    const data = encodeIconSvg("ph", "kw-baby", SVG);
    const spec = { elements: [{ id: "i", type: "icon", of: "kw-baby", set: "ph", strokes: data, credit: "kw-baby from ph · MIT", x: 1, y: 1 }], commands: [] } as unknown as Spec;
    hoistIcons(spec);
    expect(spec.elements![0].credit).toBeUndefined();
    expect(creditsOf([spec])).toEqual(["kw-baby from ph · MIT"]);
  });
  test("a keyword-only example credits from the offline cache; cards too", async () => {
    const { creditsOf } = await import("../src/export/credits");
    const spec = { elements: [{ id: "r", type: "cards", items: [{ text: "W", icon: "kw-whale" }, "B"] }], commands: [] } as unknown as Spec;
    expect(creditsOf([spec])).toEqual(["kw-whale from twemoji · CC BY 4.0"]);
  });
});
