import { describe, expect, test } from "vitest";
import { unembeddedImages } from "../src/ui/insert";
import { embeddedPlaylist } from "../src/publish/embed";
import { encodeIconSvg, hoistIcons } from "../src/spec/icon-data";

// Final fix I, item 3: a node's icon and a card's icon / match_icon are
// borrowed artwork too — when they are a cast's only icons, Publish and the
// Embed dialog must still count them, so they are hoisted into assets:.
const SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 36 36"><path d="M1 1L30 30"/></svg>';
const one = (elements: unknown[], assets?: Record<string, string>) => ({ entries: [{ kind: "item", spec: { elements, commands: [], ...(assets ? { assets } : {}) } }] }) as never;

describe("unembeddedImages counts every icon slot", () => {
  test("a node's icon with no data counts; with data or under assets it does not", () => {
    expect(unembeddedImages(one([{ id: "n", type: "node", shape: "rect", text: "Owl", icon: "owl" }]))).toBe(1);
    expect(unembeddedImages(one([{ id: "n", type: "node", shape: "rect", text: "Owl", icon: "owl", icon_strokes: encodeIconSvg("twemoji", "owl", SVG) }]))).toBe(0);
    expect(unembeddedImages(one([{ id: "n", type: "node", shape: "rect", text: "Owl", icon: "owl" }], { "icon.owl": encodeIconSvg("twemoji", "owl", SVG) }))).toBe(0);
  });
  test("a card's icon and match_icon each count", () => {
    const cards = { id: "c", type: "cards", mode: "match", items: [{ text: "Penicillin", icon: "pill", match: "Kills bacteria", match_icon: "microbe" }, { text: "Plain" }] };
    expect(unembeddedImages(one([cards]))).toBe(2);
    const filled = structuredClone(cards) as { items: Record<string, unknown>[] };
    filled.items[0].icon_strokes = encodeIconSvg("twemoji", "pill", SVG);
    expect(unembeddedImages(one([filled]))).toBe(1);
  });
  test("publish embeds a node-only cast: its icon ends under assets:", async () => {
    const pl = one([{ id: "n", type: "node", shape: "rect", text: "Owl", icon: "owl" }]);
    expect(unembeddedImages(pl)).toBe(1);
    const fill = async (s: { elements: Record<string, unknown>[] }) => void (s.elements[0].icon_strokes = encodeIconSvg("twemoji", "owl", SVG));
    const done = await embeddedPlaylist(pl, { resolvePortraits: async () => [], resolveSources: async () => [], resolveImages: async () => [], resolveIcons: fill as never, contactEmail: "" });
    expect(unembeddedImages(done)).toBe(0);
    const spec = (done as unknown as { entries: { spec: { assets?: Record<string, string>; elements: Record<string, unknown>[] } }[] }).entries[0].spec;
    expect(Object.keys(spec.assets ?? {})).toEqual(["icon.owl"]);
    expect(spec.elements[0].icon_strokes).toBeUndefined();
    expect(hoistIcons(spec as never)).toBe(0);
  });
});
