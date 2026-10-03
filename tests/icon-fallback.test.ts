// Icon fallbacks (quiz round): authors asked for things twemoji lacks
// (guinea pig, pyramid, Triceratops) and got a blank card or a wrong
// stand-in. A list of keywords is tried in order, one keyword through every
// set before the next; a pinned set is a preference, not a wall; and a match
// that names a different thing is reported, never drawn.
import { describe, expect, test } from "vitest";
import { goodMatch, iconKeyMatches, iconSearchUrl, iconSvgUrl, nameScore, resolveIcons, DEFAULT_PREFIXES, PICTURE_PREFIXES } from "../src/render/icon";
import { iconAsk } from "../src/spec/icon-data";
import { validateSpec } from "../src/spec/schema";

const SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M2 20h20v-8l-6 4v-4l-6 4V8H2z"/></svg>';
function deps(routes: Record<string, unknown>) {
  const asked: string[] = [];
  return {
    asked,
    fetch: (async (url: string) => {
      asked.push(url);
      return { ok: url in routes, status: url in routes ? 200 : 404, json: async () => routes[url], text: async () => routes[url] as string };
    }) as unknown as typeof fetch,
  };
}
const node = (id: string, icon: unknown) => ({ id, type: "node", shape: "rect", text: id, x: 300, y: 300, icon });

describe("a list of keywords", () => {
  test("iconAsk: an array is the thing first, its fallbacks after", () => {
    expect(iconAsk(["guinea pig", "hamster", "mouse"])).toEqual({ of: "guinea pig", or: ["hamster", "mouse"] });
    expect(iconAsk(["eel"])).toEqual({ of: "eel" });
    expect(iconAsk(["", 3])).toBeNull();
  });

  test("the schema takes a list on nodes and on cards (icon and match_icon)", () => {
    const spec = {
      elements: [
        { id: "n", type: "node", shape: "rect", text: "Cavy", x: 300, y: 300, icon: ["guinea pig", "hamster"] },
        { id: "c", type: "cards", select: "Andes", items: [{ text: "Cavy", in: true, icon: ["guinea pig", "hamster"] }, { text: "Rice", in: false, icon: { of: "rice", or: ["bowl"] } }] },
      ],
      commands: [{ draw: ["n"] }],
    };
    expect(validateSpec(spec as never).errors).toEqual([]);
  });

  test("one keyword through every set before the next: an ink picture of the thing beats a coloured stand-in", async () => {
    const spec = { elements: [node("a", ["kf-pyramid", "kf-triangle"])], commands: [] };
    const d = deps({
      [iconSearchUrl("kf-pyramid", DEFAULT_PREFIXES)]: { icons: ["tabler:kf-pyramid"] },
      [iconSvgUrl("tabler", "kf-pyramid")]: SVG,
      [iconSvgUrl("twemoji", "kf-triangle")]: SVG,
    });
    const r = await resolveIcons(spec as never, d);
    expect(r).toEqual([{ id: "a", ok: true, of: "kf-pyramid", icon: "tabler:kf-pyramid" }]);
    // twemoji by name and the colour family are asked for the thing first; the fallback never.
    expect(d.asked.indexOf(iconSvgUrl("twemoji", "kf-pyramid"))).toBe(0);
    expect(d.asked).toContain(iconSearchUrl("kf-pyramid", PICTURE_PREFIXES));
    expect(d.asked).not.toContain(iconSvgUrl("twemoji", "kf-triangle"));
  });

  test("the fallback that found it is reported (via)", async () => {
    const spec = { elements: [{ id: "c", type: "cards", select: "Pets", items: [{ text: "Cavy", in: true, icon: ["kf-cavy", "kf-hamster"] }, { text: "Rock", in: false }] }], commands: [] };
    const r = await resolveIcons(spec as never, deps({ [iconSvgUrl("twemoji", "kf-hamster")]: SVG }));
    expect(r).toEqual([{ id: "c_1", ok: true, of: "kf-cavy", via: "kf-hamster", icon: "twemoji:kf-hamster" }]);
  });

  test("a pinned set is a preference: none there, the rest of the order is tried — and the pin still matches", async () => {
    const el = { id: "p", type: "icon", of: "kf-obelisk", set: "twemoji", icon_look: "picture", x: 1, y: 1 } as Record<string, unknown>;
    const spec = { elements: [el], commands: [] };
    const routes = { [iconSearchUrl("kf-obelisk", DEFAULT_PREFIXES)]: { icons: ["mdi:kf-obelisk"] }, [iconSvgUrl("mdi", "kf-obelisk")]: SVG };
    const r = await resolveIcons(spec as never, deps(routes));
    expect(r[0]).toMatchObject({ ok: true, icon: "mdi:kf-obelisk" });
    expect(el.icon_key).toBe("kf-obelisk@mdi~twemoji");
    expect(el.set).toBe("twemoji");
    expect(iconKeyMatches(el.icon_key, { of: "kf-obelisk", set: "twemoji" })).toBe(true);
    // Resolved and unchanged: nothing is fetched again.
    const again = deps(routes);
    await resolveIcons(spec as never, again);
    expect(again.asked).toEqual([]);
  });

  test("the pinned set first, by name, for each keyword", async () => {
    const spec = { elements: [{ id: "p", type: "icon", of: "kf-lama", set: "twemoji", or: ["kf-llama"], icon_look: "picture", x: 1, y: 1 }], commands: [] };
    const r = await resolveIcons(spec as never, deps({ [iconSvgUrl("twemoji", "kf-llama")]: SVG }));
    expect(r[0]).toMatchObject({ ok: true, via: "kf-llama", icon: "twemoji:kf-llama" });
  });
});

describe("the weak-match rule", () => {
  test("good: the thing, the head noun, or the thing first (a part or kind of it); never another name", () => {
    expect(goodMatch(nameScore("pyramid", "pyramid"))).toBe(true);
    expect(goodMatch(nameScore("top-hat", "hat"))).toBe(true);
    expect(goodMatch(nameScore("triceratops-head", "triceratops"))).toBe(true);
    expect(goodMatch(nameScore("cactus", "pyramid"))).toBe(false);
    expect(goodMatch(nameScore("reel", "eel"))).toBe(false);
    expect(goodMatch(nameScore("sauropod", "triceratops"))).toBe(false);
  });

  test("a different thing is reported, not drawn — the nearest named in the error", async () => {
    const spec = { elements: [node("w", "kf-sphinx")], commands: [] };
    const r = await resolveIcons(spec as never, deps({ [iconSearchUrl("kf-sphinx", DEFAULT_PREFIXES)]: { icons: ["tabler:cactus"] }, [iconSvgUrl("tabler", "cactus")]: SVG }));
    expect(r[0]).toMatchObject({ ok: false, of: "kf-sphinx", error: 'no icon found for "kf-sphinx" (nearest: tabler:cactus — a different thing, not used)' });
    expect((spec.elements[0] as { icon_strokes?: string }).icon_strokes).toBeUndefined();
  });

  test("a weak match for the thing gives way to a fallback keyword", async () => {
    const spec = { elements: [node("w", ["kf-stego", "kf-lizard"])], commands: [] };
    const r = await resolveIcons(spec as never, deps({ [iconSearchUrl("kf-stego", DEFAULT_PREFIXES)]: { icons: ["tabler:sauropod"] }, [iconSvgUrl("twemoji", "kf-lizard")]: SVG }));
    expect(r[0]).toMatchObject({ ok: true, via: "kf-lizard", icon: "twemoji:kf-lizard" });
  });

  test("a part of the thing (the keyword first) is taken before a plainer fallback", async () => {
    const spec = { elements: [node("t", ["kf-trike", "kf-dino"])], commands: [] };
    const routes = { [iconSearchUrl("kf-trike", DEFAULT_PREFIXES)]: { icons: ["tabler:kf-trike-head"] }, [iconSvgUrl("tabler", "kf-trike-head")]: SVG, [iconSvgUrl("twemoji", "kf-dino")]: SVG };
    const r = await resolveIcons(spec as never, deps(routes));
    expect(r[0]).toMatchObject({ ok: true, icon: "tabler:kf-trike-head" });
    expect(r[0].via).toBeUndefined();
  });

  test("harmonising never trades the thing for a fallback in the figure's main set", async () => {
    const spec = { elements: [node("a", "kf-owl"), node("b", "kf-bat"), node("c", ["kf-ziggurat", "kf-tower"])], commands: [] };
    const routes = {
      [iconSvgUrl("twemoji", "kf-owl")]: SVG,
      [iconSvgUrl("twemoji", "kf-bat")]: SVG,
      [iconSvgUrl("twemoji", "kf-tower")]: SVG,
      [iconSearchUrl("kf-ziggurat", DEFAULT_PREFIXES)]: { icons: ["tabler:kf-ziggurat"] },
      [iconSvgUrl("tabler", "kf-ziggurat")]: SVG,
    };
    const r = await resolveIcons(spec as never, deps(routes));
    expect(r[2]).toMatchObject({ ok: true, icon: "tabler:kf-ziggurat" });
  });
});
