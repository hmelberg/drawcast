import { describe, expect, test } from "vitest";
import { iconSearchUrl, iconSvgUrl, resolveIcons, svgToRings, DEFAULT_PREFIXES, BY_PREFIXES } from "../src/render/icon";
import { ICON_SETS } from "../src/render/icon-sets";
import { decodeIcon } from "../src/spec/trace";

const SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M2 20h20v-8l-6 4v-4l-6 4V8H2z"/></svg>';
const deps = (routes: Record<string, unknown>) => ({
  fetch: (async (url: string) => ({ ok: url in routes, status: url in routes ? 200 : 404, json: async () => routes[url], text: async () => routes[url] as string })) as unknown as typeof fetch,
});

describe("resolveIcons", () => {
  test("permissive hit: rings embedded, credit set, size kept", async () => {
    const spec = { elements: [{ id: "f", type: "icon", of: "factory", size: 80, x: 1, y: 1 }], commands: [] };
    const r = await resolveIcons(spec as never, deps({ [iconSearchUrl("factory", DEFAULT_PREFIXES)]: { icons: ["lucide:factory"] }, [iconSvgUrl("lucide", "factory")]: SVG }));
    expect(r).toEqual([{ id: "f", ok: true }]);
    const el = spec.elements[0] as { strokes?: string; credit?: string; set?: string };
    expect(decodeIcon(el.strokes!)!.length).toBe(1);
    expect(el.credit).toBe("factory from lucide · ISC");
    expect(el.set).toBe("lucide");
  });
  test("permissive miss falls back to CC BY sets", async () => {
    const spec = { elements: [{ id: "f", type: "icon", of: "flask", x: 1, y: 1 }], commands: [] };
    const r = await resolveIcons(spec as never, deps({ [iconSearchUrl("flask", DEFAULT_PREFIXES)]: { icons: [] }, [iconSearchUrl("flask", BY_PREFIXES)]: { icons: ["fa6-solid:flask"] }, [iconSvgUrl("fa6-solid", "flask")]: SVG }));
    expect(r[0].ok).toBe(true);
    expect((spec.elements[0] as { credit?: string }).credit).toBe("flask from fa6-solid · CC BY 4.0");
  });
  test("BY-SA only with explicit set, never as a seed; logo sets never", async () => {
    const mk = (set: string) => ({ elements: [{ id: "e", type: "icon", of: "smile", set, x: 1, y: 1 }], commands: [] });
    const routes = { [iconSvgUrl("openmoji", "smile")]: SVG, [iconSvgUrl("simple-icons", "smile")]: SVG };
    expect((await resolveIcons(mk("openmoji") as never, deps(routes)))[0].ok).toBe(true);
    expect((await resolveIcons(mk("openmoji") as never, deps(routes), { forSeed: true }))[0]).toMatchObject({ ok: false, error: expect.stringMatching(/share-alike/) });
    expect((await resolveIcons(mk("simple-icons") as never, deps(routes)))[0]).toMatchObject({ ok: false, error: expect.stringMatching(/logo/) });
    const noSet = { elements: [{ id: "e", type: "icon", of: "smile", x: 1, y: 1 }], commands: [] };
    expect((await resolveIcons(noSet as never, deps({ [iconSearchUrl("smile", DEFAULT_PREFIXES)]: { icons: ["openmoji:smile"] } })))[0].ok).toBe(false);
  });
  test("unknown explicit set is rejected", async () => {
    const spec = { elements: [{ id: "e", type: "icon", of: "smile", set: "not-a-real-set", x: 1, y: 1 }], commands: [] };
    const r = await resolveIcons(spec as never, deps({}));
    expect(r[0]).toMatchObject({ ok: false, error: expect.stringMatching(/unknown icon set/) });
  });
  test("svgToRings normalises the viewBox to 0..1", () => {
    const rings = svgToRings(SVG);
    expect(rings[0].every(([x, y]) => x >= 0 && x <= 1 && y >= 0 && y <= 1)).toBe(true);
  });
  test("every default and BY prefix has a licence row of the right class", () => {
    for (const p of DEFAULT_PREFIXES) expect(ICON_SETS[p].cls).toBe("permissive");
    for (const p of BY_PREFIXES) expect(ICON_SETS[p].cls).toBe("by");
  });
});
