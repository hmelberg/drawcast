// Round 5 §3.3: an icon inside a box. A rect node's `icon` (a keyword, or
// {of, set}) is resolved by the same pipeline as an icon element (Iconify
// search, licence check, cache) into the machine-written `icon_strokes`; the
// layout draws the rings hand-drawn inside the box above the text, and the
// box grows to fit. Unresolved → text only, normal height, the usual warning.
import { describe, expect, test } from "vitest";
import { elementBBoxes, elementRings, layoutSpec } from "../src/layout/layout";
import { naturalNodeSize } from "../src/layout/group-layout";
import { drawablesForId, leafDrawables, type Drawable } from "../src/layout/model";
import { hoistPortraitStrokes, restorePortraitStrokes } from "../src/llm/hoist";
import { formatPlaylist, itemsOf, parsePlaylistText, singlePlaylist } from "../src/playlist/playlist";
import { iconSearchUrl, iconSvgUrl, resolveIcons, DEFAULT_PREFIXES } from "../src/render/icon";
import { encodeIcon } from "../src/spec/trace";
import { iconRingsOf } from "../src/spec/icon-data";
import { validateSpec } from "../src/spec/schema";
import type { Spec } from "../src/spec/types";

const SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M2 20h20v-8l-6 4v-4l-6 4V8H2z"/></svg>';
const deps = (routes: Record<string, unknown>) => ({
  fetch: (async (url: string) => ({ ok: url in routes, status: url in routes ? 200 : 404, json: async () => routes[url], text: async () => routes[url] as string })) as unknown as typeof fetch,
});

const STROKES = encodeIcon([[[0, 0], [1, 0], [1, 1], [0, 1]]]);
const node = (extra: Record<string, unknown>): Spec =>
  ({ elements: [{ id: "b", type: "node", shape: "rect", text: "Sharks", x: 300, y: 300, ...extra }], commands: [{ draw: ["b"] }] }) as unknown as Spec;
type Leaf = Exclude<Drawable, { kind: "group" }>;

describe("resolveIcons fills a node's icon_strokes", () => {
  test("a keyword icon on a node", async () => {
    const spec = node({ icon: "node-shark" });
    const r = await resolveIcons(spec, deps({ [iconSearchUrl("node-shark", DEFAULT_PREFIXES)]: { icons: ["lucide:fish"] }, [iconSvgUrl("lucide", "fish")]: SVG }));
    expect(r).toEqual([{ id: "b", ok: true }]);
    const el = spec.elements![0];
    expect(iconRingsOf(el.icon_strokes!)!.length).toBe(1);
    expect(el.credit).toBe("fish from lucide · ISC");
  });
  test("{of, set} goes straight to the named set; a logo set is refused, no strokes", async () => {
    const ok = node({ icon: { of: "node fish", set: "tabler" } });
    expect((await resolveIcons(ok, deps({ [iconSvgUrl("tabler", "node-fish")]: SVG })))[0].ok).toBe(true);
    expect(ok.elements![0].icon_strokes).toBeTruthy();
    const logo = node({ icon: { of: "node github", set: "simple-icons" } });
    expect((await resolveIcons(logo, deps({ [iconSvgUrl("simple-icons", "node-github")]: SVG })))[0]).toMatchObject({ ok: false, error: expect.stringMatching(/logo/) });
    expect(logo.elements![0].icon_strokes).toBeUndefined();
  });
  test("already resolved: nothing fetched; a node without icon is not reported", async () => {
    const spec = { elements: [{ id: "b", type: "node", shape: "rect", text: "x", icon: "shark", icon_strokes: STROKES }, { id: "c", type: "node", text: "y" }], commands: [] } as unknown as Spec;
    expect(await resolveIcons(spec, deps({}))).toEqual([{ id: "b", ok: true }]);
  });
});

describe("a rect node with an icon", () => {
  const plain = layoutSpec(node({}));
  const withIcon = layoutSpec(node({ icon: "shark", icon_strokes: STROKES }));
  const box = (r: ReturnType<typeof layoutSpec>) => elementBBoxes(r).get("b")!;
  const leaves = leafDrawables(drawablesForId(withIcon.drawables, "b")) as Leaf[];

  test("the box grows taller; the width is unchanged", () => {
    expect(box(withIcon).h).toBeGreaterThan(box(plain).h + 30);
    expect(box(withIcon).w).toBe(box(plain).w);
  });

  test("the icon rings are drawn inside the box, above the text, and go with the node id", () => {
    const rings = leaves.filter((d) => d.id.startsWith("b__icon"));
    expect(rings.length).toBe(1);
    const ring = rings[0] as Extract<Leaf, { kind: "stroke" }>;
    const outline = leaves.find((d) => d.id === "b") as Extract<Leaf, { kind: "stroke" }>;
    const hint = outline.shapeHint as { x: number; y: number; w: number; h: number };
    const xs = ring.pts.map((p) => p[0]), ys = ring.pts.map((p) => p[1]);
    expect(Math.min(...xs)).toBeGreaterThan(hint.x);
    expect(Math.max(...xs)).toBeLessThan(hint.x + hint.w);
    expect(Math.min(...ys)).toBeGreaterThan(hint.y);
    expect(Math.max(...ys)).toBeLessThan(hint.y + hint.h);
    // ≈ 45 % of the box height, centred horizontally.
    expect(Math.max(...ys) - Math.min(...ys)).toBeCloseTo(0.45 * hint.h, 0);
    expect((Math.min(...xs) + Math.max(...xs)) / 2).toBeCloseTo(300, 5);
    const text = leaves.find((d) => d.id === "b_text") as Extract<Leaf, { kind: "text" }>;
    expect(text.pos[1]).toBeLessThan(Math.min(...ys)); // y-up: below the icon
    expect(text.pos[1]).toBeGreaterThan(hint.y);
  });

  test("the icon rings are not the box's outline (hit-testing keeps the box); no warning", () => {
    expect(elementRings(withIcon).get("b")!.length).toBe(1);
    expect(withIcon.warnings.join(" ")).not.toMatch(/icon/);
  });

  test("the group layout's natural size agrees with the drawn box", () => {
    const el = node({ icon: "shark", icon_strokes: STROKES }).elements![0];
    expect(naturalNodeSize(el)).toEqual({ w: box(withIcon).w, h: box(withIcon).h });
  });

  test("an icon on a round node is not drawn, and says so", () => {
    const r = layoutSpec(node({ shape: "circle", icon: "shark", icon_strokes: STROKES }));
    expect(leafDrawables(drawablesForId(r.drawables, "b")).some((d) => d.id.includes("icon"))).toBe(false);
    expect(r.warnings.join(" ")).toMatch(/only in a rect node/);
  });

  test("a declared height is honoured", () => {
    const r = layoutSpec(node({ icon: "shark", icon_strokes: STROKES, height: 120 }));
    expect(box(r).h).toBe(120);
  });

  test("an unresolved icon: exactly like no icon, plus the warning", () => {
    // A keyword the offline cache does not hold ("shark" is in it since round 6's examples).
    const r = layoutSpec(node({ icon: "narwhal" }));
    expect(box(r)).toEqual(box(plain));
    expect(leafDrawables(drawablesForId(r.drawables, "b")).map((d) => d.id)).toEqual(leafDrawables(drawablesForId(plain.drawables, "b")).map((d) => d.id));
    expect(r.warnings.join(" ")).toMatch(/no icon for "narwhal"/);
  });

  test("an unresolved {of, set} warns with its keyword", () => {
    const r = layoutSpec(node({ icon: { of: "shark", set: "tabler" } }));
    expect(r.warnings.join(" ")).toMatch(/no icon for "shark"/);
  });
});

describe("schema and the model round trip", () => {
  test("icon (keyword or {of, set}) and icon_strokes validate on a node", () => {
    expect(validateSpec(node({ icon: "shark", icon_strokes: STROKES })).errors).toEqual([]);
    expect(validateSpec(node({ icon: { of: "shark", set: "tabler" } })).errors).toEqual([]);
  });
  test("icon_strokes never visits the model: hoisted and restored", () => {
    const doc = formatPlaylist(singlePlaylist(node({ icon: "shark", icon_strokes: STROKES })), "script");
    const h = hoistPortraitStrokes(doc);
    expect(h.text).not.toContain("ic1:");
    const back = parsePlaylistText(h.text);
    restorePortraitStrokes(back, h.blobs);
    expect(itemsOf(back)[0].spec.elements![0].icon_strokes).toBe(STROKES);
  });
});
