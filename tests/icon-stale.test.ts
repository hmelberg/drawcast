import { describe, expect, test } from "vitest";
import { iconSearchUrl, iconSvgUrl, resolveIcons, DEFAULT_PREFIXES } from "../src/render/icon";
import { iconRingsOf, iconSlots, registerIconStore } from "../src/spec/icon-data";
import offlineIcons from "../src/scenes/icon-cache.json";
import { validateSpec } from "../src/spec/schema";

// Deferred minor (round 5): editing an `icon` after it was resolved left the
// old strokes in place. The resolver now stores the key it resolved beside
// the strokes and resolves again when the `icon` no longer matches it.

const SQUARE = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M2 2h20v20H2z"/></svg>';
const TRI = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M2 22L12 2l10 20z"/></svg>';
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
// Distinct keywords per test: the resolver caches by keyword and set.
const routes = {
  [iconSvgUrl("twemoji", "stale-shark")]: SQUARE,
  [iconSvgUrl("twemoji", "stale-dolphin")]: TRI,
  [iconSearchUrl("stale-cow", DEFAULT_PREFIXES)]: { icons: ["tabler:stale-cow"] },
  [iconSvgUrl("tabler", "stale-cow")]: SQUARE,
  [iconSearchUrl("stale-pig", DEFAULT_PREFIXES)]: { icons: ["tabler:stale-pig"] },
  [iconSvgUrl("tabler", "stale-pig")]: TRI,
  [iconSvgUrl("twemoji", "stale-ant")]: SQUARE,
  [iconSvgUrl("twemoji", "stale-bee")]: TRI,
};

describe("stale icon strokes", () => {
  test("a node: resolving stores the key; editing the icon resolves again", async () => {
    const node = { id: "n", type: "node", shape: "rect", text: "Shark", icon: { of: "stale-shark", set: "twemoji" } } as Record<string, unknown>;
    const spec = { elements: [node], commands: [] };
    await resolveIcons(spec as never, deps(routes));
    expect(node.icon_key).toBe("stale-shark@twemoji");
    const first = node.icon_strokes;
    // Resolved and unchanged: nothing fetched.
    const d0 = deps(routes);
    await resolveIcons(spec as never, d0);
    expect(d0.asked).toEqual([]);
    // Edited: the old strokes are replaced.
    node.icon = { of: "stale-dolphin", set: "twemoji" };
    const r = await resolveIcons(spec as never, deps(routes));
    expect(r).toEqual([{ id: "n", ok: true }]);
    expect(node.icon_strokes).not.toBe(first);
    expect(node.icon_key).toBe("stale-dolphin@twemoji");
    expect(node.credit).toBe("stale-dolphin from twemoji · CC BY 4.0");
  });

  test("an edit that cannot be resolved drops the stale strokes (no wrong picture), and says so", async () => {
    const node = { id: "n", type: "node", shape: "rect", text: "X", icon: "stale-shark", icon_strokes: "ic1:[[[0,0],[1,0],[1,1]]]", icon_key: "stale-whale@twemoji" } as Record<string, unknown>;
    const r = await resolveIcons({ elements: [node], commands: [] } as never, deps({}));
    expect(r[0].ok).toBe(false);
    expect(node.icon_strokes).toBeUndefined();
    expect(node.icon_key).toBeUndefined();
  });

  test("an older spec (strokes, no key) is trusted as it is", async () => {
    const node = { id: "n", type: "node", shape: "rect", text: "X", icon: "anything", icon_look: "drawn", icon_strokes: "ic1:[[[0,0],[1,0],[1,1]]]" } as Record<string, unknown>;
    const d = deps({});
    expect(await resolveIcons({ elements: [node], commands: [] } as never, d)).toEqual([{ id: "n", ok: true }]);
    expect(d.asked).toEqual([]);
  });

  test("older rings asked for as a picture: the artwork is looked up, and the rings kept when it cannot be had", async () => {
    const node = { id: "n", type: "node", shape: "rect", text: "X", icon: "anything-old", icon_strokes: "ic1:[[[0,0],[1,0],[1,1]]]" } as Record<string, unknown>;
    const d = deps({});
    expect(await resolveIcons({ elements: [node], commands: [] } as never, d)).toEqual([{ id: "n", ok: true }]);
    expect(d.asked.length).toBeGreaterThan(0);
    expect(node.icon_strokes).toBe("ic1:[[[0,0],[1,0],[1,1]]]");
  });

  test("a keyword with no set matches the set it was found in", async () => {
    const node = { id: "n", type: "node", shape: "rect", text: "Cow", icon: "stale-cow" } as Record<string, unknown>;
    const spec = { elements: [node], commands: [] };
    await resolveIcons(spec as never, deps(routes));
    expect(node.icon_key).toBe("stale-cow@tabler");
    const d = deps(routes);
    await resolveIcons(spec as never, d);
    expect(d.asked).toEqual([]);
  });

  test("an icon element: the resolver never pins a `set`, so a new `of` is searched afresh", async () => {
    const el = { id: "i", type: "icon", of: "stale-cow", x: 1, y: 1 } as Record<string, unknown>;
    const spec = { elements: [el], commands: [] };
    await resolveIcons(spec as never, deps(routes));
    expect(el.set).toBeUndefined();
    expect(el.icon_key).toBe("stale-cow@tabler");
    const first = el.strokes;
    el.of = "stale-pig";
    expect(await resolveIcons(spec as never, deps(routes))).toEqual([{ id: "i", ok: true }]);
    expect(el.strokes).not.toBe(first);
    expect(el.icon_key).toBe("stale-pig@tabler");
    expect(iconRingsOf(el.strokes as string)).not.toBeNull();
  });

  test("a card item and its match partner", async () => {
    const it = { text: "Ant", match: "Bee", icon: { of: "stale-ant", set: "twemoji" }, match_icon: { of: "stale-ant", set: "twemoji" } } as Record<string, unknown>;
    const spec = { elements: [{ id: "c", type: "cards", items: [it] }], commands: [] };
    await resolveIcons(spec as never, deps(routes));
    expect(it.icon_key).toBe("stale-ant@twemoji");
    expect(it.match_icon_key).toBe("stale-ant@twemoji");
    const before = it.match_icon_strokes;
    it.match_icon = { of: "stale-bee", set: "twemoji" };
    await resolveIcons(spec as never, deps(routes));
    expect(it.match_icon_strokes).not.toBe(before);
    expect(it.match_icon_key).toBe("stale-bee@twemoji");
    expect(it.match_credit).toBe("stale-bee from twemoji · CC BY 4.0");
  });

  test("the key validates on a node, an icon element and a card item", () => {
    const spec = {
      elements: [
        { id: "n", type: "node", shape: "rect", text: "A", icon: "ant", icon_strokes: "ic1:[]", icon_key: "ant@twemoji" },
        { id: "i", type: "icon", of: "ant", icon_key: "ant@twemoji", x: 100, y: 100 },
        { id: "c", type: "cards", items: [{ text: "A", match: "B", icon: "ant", icon_key: "ant@twemoji", match_icon: "bee", match_icon_key: "bee@twemoji" }, { text: "C", match: "D" }] },
      ],
      commands: [],
    };
    const v = validateSpec(spec as never);
    expect(v.ok, JSON.stringify(v)).toBe(true);
  });
});

test("an older document whose `set` the resolver once filled: a new `of` is still searched afresh", async () => {
  const el = { id: "i", type: "icon", of: "stale-pig", set: "ph", icon_key: "stale-cow@ph", strokes: "ic1:[[[0,0],[1,0],[1,1]]]", x: 1, y: 1 } as Record<string, unknown>;
  const d = deps(routes);
  expect(await resolveIcons({ elements: [el], commands: [] } as never, d)).toEqual([{ id: "i", ok: true }]);
  // The search found tabler's pig (not ph's, nor a fetch pinned to the old key's set).
  expect(el.icon_key).toBe("stale-pig@tabler");
  expect(el.strokes).not.toBe("ic1:[[[0,0],[1,0],[1,1]]]");
});

describe("bundled examples carry keywords only (round 6 §8)", () => {
  const specsOf = async (): Promise<{ title?: string; elements?: unknown[] }[]> => {
    const { default: bundled } = await import("../src/examples.json");
    const specs: { title?: string; elements?: unknown[] }[] = [];
    for (const e of bundled as { spec?: never }[]) if (e.spec) specs.push(e.spec);
    return specs;
  };
  test("no inline icon data, key or credit in any bundled example", async () => {
    const inline: string[] = [];
    for (const s of await specsOf()) {
      for (const slot of iconSlots(s as never)) {
        for (const f of [slot.data, "icon_key", "match_icon_key", slot.credit]) if (slot.host[f] !== undefined) inline.push(`${s.title}: ${f}`);
      }
    }
    expect(inline).toEqual([]);
  });
  test("every icon in every bundled example resolves from the offline cache with nothing fetched", async () => {
    registerIconStore(offlineIcons as Record<string, string>);
    const d = { ...deps({}), offline: async () => offlineIcons as Record<string, string> };
    const failed: string[] = [];
    for (const s of await specsOf()) {
      const copy = JSON.parse(JSON.stringify(s)) as { title?: string };
      for (const r of await resolveIcons(copy as never, d)) if (!r.ok) failed.push(`${copy.title}: ${r.id} (${r.error})`);
    }
    expect(failed).toEqual([]);
    expect(d.asked).toEqual([]);
  }, 30000);
});
