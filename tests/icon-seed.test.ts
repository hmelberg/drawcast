import { describe, expect, test } from "vitest";
import { iconSearchUrl, iconSvgUrl, resolveIcons, DEFAULT_PREFIXES } from "../src/render/icon";
import { iconSeedOf } from "../src/spec/icon-data";
import { encodeIcon } from "../src/spec/trace";

// Final fix I, item 1: the Generate icon seed reads the resolved icon in
// either form — the `ics1:` SVG resolveIcons stores since round 6, and the
// older `ic1:` rings — and names the set it came from (the key, not el.set).
const SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M2 20h20v-8l-6 4v-4l-6 4V8H2z"/></svg>';
const deps = (routes: Record<string, unknown>) => ({
  fetch: (async (url: string) => ({ ok: url in routes, status: url in routes ? 200 : 404, json: async () => routes[url], text: async () => routes[url] as string })) as unknown as typeof fetch,
});

describe("iconSeedOf", () => {
  test("a resolved seed icon (ics1: SVG) gives rings and the set it came from", async () => {
    const spec = { elements: [{ id: "seed_icon", type: "icon", of: "pump", x: 0, y: 0 }], commands: [] };
    const r = await resolveIcons(spec as never, deps({ [iconSearchUrl("pump", DEFAULT_PREFIXES)]: { icons: ["lucide:pump"] }, [iconSvgUrl("lucide", "pump")]: SVG }), { forSeed: true });
    expect(r[0].ok).toBe(true);
    const seed = iconSeedOf(spec.elements[0] as { strokes?: string; icon_key?: string });
    expect(seed).not.toBeNull();
    expect(seed!.rings.length).toBeGreaterThan(0);
    expect(seed!.set).toBe("lucide");
  });
  test("older ic1: rings still seed; the set comes from icon_key", () => {
    const strokes = encodeIcon([[[0, 0], [1, 0], [1, 1]]]);
    const seed = iconSeedOf({ strokes, icon_key: "pump@tabler" });
    expect(seed!.rings.length).toBe(1);
    expect(seed!.set).toBe("tabler");
  });
  test("no or unreadable data gives null", () => {
    expect(iconSeedOf({})).toBeNull();
    expect(iconSeedOf({ strokes: "nonsense" })).toBeNull();
  });
});
