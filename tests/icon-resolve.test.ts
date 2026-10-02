import { describe, expect, test } from "vitest";
import { iconSearchUrl, iconSvgUrl, resolveIcons, searchQueries, svgToRings, DEFAULT_PREFIXES, EXTRA_PREFIXES, BY_PREFIXES } from "../src/render/icon";
import { ICON_SETS } from "../src/render/icon-sets";
import { iconRingsOf } from "../src/spec/icon-data";

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
    expect(iconRingsOf(el.strokes!)!.length).toBe(1);
    expect(el.credit).toBe("factory from lucide · ISC");
    // The set found is in the key, never pinned on the element (fix round 1).
    expect(el.set).toBeUndefined();
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
  test("first-tier miss tries healthicons/mdi before the CC BY sets", async () => {
    const spec = { elements: [{ id: "k", type: "icon", of: "kidney", x: 1, y: 1 }], commands: [] };
    const r = await resolveIcons(spec as never, deps({ [iconSearchUrl("kidney", EXTRA_PREFIXES)]: { icons: ["healthicons:kidneys"] }, [iconSearchUrl("kidney", BY_PREFIXES)]: { icons: ["fa6-solid:kidney"] }, [iconSvgUrl("healthicons", "kidneys")]: SVG }));
    expect(r[0].ok).toBe(true);
    expect((spec.elements[0] as { credit?: string }).credit).toBe("kidneys from healthicons · MIT");
  });
  test("a miss retries the keyword singular, then with leading words dropped", async () => {
    const spec = { elements: [{ id: "c", type: "icon", of: "Red blood cells", x: 1, y: 1 }], commands: [] };
    const r = await resolveIcons(spec as never, deps({ [iconSearchUrl("blood cell", EXTRA_PREFIXES)]: { icons: ["healthicons:blood-cells"] }, [iconSvgUrl("healthicons", "blood-cells")]: SVG }));
    expect(r[0].ok).toBe(true);
    expect((spec.elements[0] as { icon_key?: string }).icon_key).toBe("red-blood-cells@healthicons");
  });
  test("searchQueries: exact first, singular, trimmed — never one word from a phrase", () => {
    expect(searchQueries("cows")).toEqual(["cows", "cow"]);
    expect(searchQueries("Red blood cells")).toEqual(["red blood cells", "red blood cell", "blood cells", "blood cell"]);
    expect(searchQueries("coal power plant")).toEqual(["coal power plant", "power plant"]);
    expect(searchQueries("glasses")).toEqual(["glasses", "glass"]);
    expect(searchQueries("berries")).toEqual(["berries", "berry"]);
    expect(searchQueries("virus")).toEqual(["virus"]);
    expect(searchQueries("bus")).toEqual(["bus"]);
    // Alternatives as written come before any looser form of the first keyword.
    expect(searchQueries("insulin pens", ["syringe", "vial"])).toEqual(["insulin pens", "syringe", "vial", "insulin pen"]);
  });
  test("or: an icon element falls back to its alternatives, keyed and named by of", async () => {
    const spec = { elements: [{ id: "i", type: "icon", of: "insulin", or: ["syringe"], x: 1, y: 1 }], commands: [] };
    const r = await resolveIcons(spec as never, deps({ [iconSearchUrl("syringe", DEFAULT_PREFIXES)]: { icons: ["lucide:syringe"] }, [iconSvgUrl("lucide", "syringe")]: SVG }));
    expect(r[0].ok).toBe(true);
    const el = spec.elements[0] as { credit?: string; icon_key?: string };
    expect(el.credit).toBe("syringe from lucide · ISC");
    expect(el.icon_key).toBe("insulin@lucide");
  });
  test("or: a node's {of, or} and a pinned set try the alternatives by name", async () => {
    const node = { elements: [{ id: "n", type: "node", text: "Insulin", icon: { of: "insulin", or: ["syringe"] }, x: 1, y: 1 }], commands: [] };
    const n = await resolveIcons(node as never, deps({ [iconSvgUrl("twemoji", "syringe")]: SVG }));
    expect(n[0].ok).toBe(true);
    expect((node.elements[0] as { credit?: string }).credit).toBe("syringe from twemoji · CC BY 4.0");
    const pinned = { elements: [{ id: "p", type: "icon", of: "insulin", set: "tabler", or: ["vaccine", "syringe"], x: 1, y: 1 }], commands: [] };
    const p = await resolveIcons(pinned as never, deps({ [iconSvgUrl("tabler", "syringe")]: SVG }));
    expect(p[0].ok).toBe(true);
    expect((pinned.elements[0] as { credit?: string }).credit).toBe("syringe from tabler · MIT");
  });
  test("or: every keyword missing names them all", async () => {
    const spec = { elements: [{ id: "i", type: "icon", of: "glucagon", or: ["vial"], x: 1, y: 1 }], commands: [] };
    const r = await resolveIcons(spec as never, deps({}));
    expect(r[0]).toMatchObject({ ok: false, error: 'no icon found for "glucagon" or "vial"' });
  });
  test("every default and BY prefix has a licence row of the right class", () => {
    for (const p of [...DEFAULT_PREFIXES, ...EXTRA_PREFIXES]) expect(ICON_SETS[p].cls).toBe("permissive");
    for (const p of BY_PREFIXES) expect(ICON_SETS[p].cls).toBe("by");
  });
});
