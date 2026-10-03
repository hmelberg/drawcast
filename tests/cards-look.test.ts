// Round 5 §3.2–3.3: card looks (paper — the default — flat, outline) and an
// icon on a card. A look is plain node fields on every card the element
// expands to (radius, shadow, a fill), and rounded ends on the sort bins;
// outline is exactly the cards as they were. An item's icon is the card
// node's icon; any resolved icon makes every card of the element taller (96)
// so the rows stay even. And over every bundled cards example: no card
// overlaps another card, a bin title or the canvas edge, where it is drawn
// and where the truth puts it — as authored and with an icon on every card.
import { describe, expect, test } from "vitest";
import bundledExamples from "../src/examples.json";
import { expandedRenderSpec } from "../src/render/resolve";
import { cardsElements, cardsGeometry, cardsGeometryIn, CARD_FLAT, CARD_PAPER, type CardsElementLike } from "../src/spec/cards";
import { expandSpec } from "../src/spec/expand";
import { validateSpec } from "../src/spec/schema";
import { elementBBoxes, layoutSpec } from "../src/layout/layout";
import { formulaHooksFor } from "../src/render/index";
import { iconSearchUrl, iconSvgUrl, resolveIcons, DEFAULT_PREFIXES } from "../src/render/icon";
import { creditsOf } from "../src/export/credits";
import { hoistPortraitStrokes, restorePortraitStrokes } from "../src/llm/hoist";
import { formatPlaylist, itemsOf, parsePlaylistText, singlePlaylist } from "../src/playlist/playlist";
import { encodeIcon } from "../src/spec/trace";
import { iconRingsOf } from "../src/spec/icon-data";
import type { BBox } from "../src/layout/geometry";
import type { Spec, SpecElement } from "../src/spec/types";

const STROKES = encodeIcon([[[0, 0], [1, 0], [1, 1], [0, 1]]]);
const SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M2 20h20v-8l-6 4v-4l-6 4V8H2z"/></svg>';
const deps = (routes: Record<string, unknown>) => ({
  fetch: (async (url: string) => ({ ok: url in routes, status: url in routes ? 200 : 404, json: async () => routes[url], text: async () => routes[url] as string })) as unknown as typeof fetch,
});

const rank: CardsElementLike = { id: "r", type: "cards", items: ["USA", "Germany", "Norway", "UK"], ends: ["most", "least"] };
const sort: CardsElementLike = { id: "s", type: "cards", bins: ["Fixed", "Variable"], items: [{ text: "Rent", bin: "Fixed" }, { text: "Flour", bin: "Variable" }, { text: "Insurance", bin: "Fixed" }, { text: "Packaging", bin: "Variable" }] };
const compare: CardsElementLike = { id: "c", type: "cards", compare: "Which kills more?", items: [{ text: "Sharks", value: 6 }, { text: "Cows", value: 20 }, { text: "Snakes", value: 100000 }, { text: "Bees", value: 60 }] };
const decide: CardsElementLike = { id: "d", type: "cards", options: [{ text: "Treat now", goto: "a" }, { text: "Test again", goto: "b", best: true }], then: "end" };
const fill: CardsElementLike = { id: "m_tiles", type: "cards", fill: "m", items: [{ text: "x^2", blank: 1 }, { text: "2x" }] };
const match: CardsElementLike = { id: "t", type: "cards", items: [{ text: "Aspirin", match: "Thins blood" }, { text: "Insulin", match: "Lowers sugar" }, { text: "Penicillin", match: "Kills bacteria" }] };

const nodes = (els: SpecElement[]) => els.filter((e) => e.type === "node");
const withLook = (el: CardsElementLike, look?: string) => ({ ...el, ...(look ? { look } : {}) }) as CardsElementLike;

describe("looks", () => {
  test.each([rank, sort, compare, decide, fill, match])("$id: paper is the default — radius 10, paper fill, a shadow", (el) => {
    for (const n of nodes(cardsElements(el))) {
      expect(n).toMatchObject({ radius: 10, shadow: true, style: { fill: CARD_PAPER } });
    }
    expect(CARD_PAPER).toBe("#fffdf8");
  });

  test.each([rank, sort, compare, decide, fill, match])("$id: flat — radius 10, an 8 % ink tint, no shadow", (el) => {
    for (const n of nodes(cardsElements(withLook(el, "flat")))) {
      expect(n.radius).toBe(10);
      expect(n.shadow).toBeUndefined();
      expect(n.style?.fill).toBe(CARD_FLAT);
    }
  });

  test("the flat tint is the ink at 8 % over the figure's sheet", () => {
    // #3d3833 at 0.08 over #faf6ec, channel by channel.
    expect(CARD_FLAT).toBe("#ebe7dd");
  });

  test.each([rank, sort, compare, decide, fill, match])("$id: outline is exactly the cards as they were — no radius, shadow or fill", (el) => {
    for (const n of nodes(cardsElements(withLook(el, "outline")))) {
      expect(n.radius).toBeUndefined();
      expect(n.shadow).toBeUndefined();
      expect(n.style).toBeUndefined();
    }
  });

  test("outline reproduces today's rank elements field for field", () => {
    const els = cardsElements(withLook(rank, "outline"));
    const n = els.find((e) => e.id === "r_1")!;
    expect(Object.keys(n).sort()).toEqual(["font_size", "height", "id", "shape", "text", "type", "width", "x", "y"]);
    expect(n.height).toBe(56);
  });

  test("an explicit style still wins for colours", () => {
    const n = nodes(cardsElements({ ...rank, style: { color: "#2f6b8f", fill: "#ffeedd" } }))[0];
    expect(n.style).toEqual({ color: "#2f6b8f", fill: "#ffeedd" });
    expect(n.shadow).toBe(true);
    const c = nodes(cardsElements({ ...rank, style: { color: "#2f6b8f" } }))[0];
    expect(c.style).toEqual({ color: "#2f6b8f", fill: CARD_PAPER });
  });

  test("sort bins: rounded bottom corners under paper and flat, square under outline", () => {
    const bin = (look?: string) => cardsElements(withLook(sort, look)).find((e) => e.id === "s_bin_1_box")!;
    const square = bin("outline").points as [number, number][];
    expect(square.length).toBe(4);
    for (const look of [undefined, "flat"]) {
      const pts = bin(look).points as [number, number][];
      expect(pts.length).toBeGreaterThan(4);
      // Same open box: starts and ends at the top corners, same extent.
      expect(pts[0]).toEqual(square[0]);
      expect(pts[pts.length - 1]).toEqual(square[3]);
      expect(Math.min(...pts.map((p) => p[1]))).toBeCloseTo(square[1][1], 6);
      // No point at the sharp bottom corners any more.
      expect(pts.some((p) => p[0] === square[1][0] && p[1] === square[1][1])).toBe(false);
    }
  });

  test("look validates on a cards element; an unknown look does not", () => {
    const spec = (look: string) => ({ elements: [{ ...rank, look }], commands: [{ draw: ["r"] }] }) as unknown as Spec;
    for (const l of ["paper", "flat", "outline"]) expect(validateSpec(spec(l)).errors).toEqual([]);
    expect(validateSpec(spec("glossy")).ok).toBe(false);
  });

  test("the looks stay on their own elements: screen on cards, paper/flat/outline on an image, are errors", () => {
    expect(validateSpec(spec2("screen", "cards")).errors.join(" ")).toMatch(/look is paper, flat or outline/);
    for (const l of ["paper", "flat", "outline"]) expect(validateSpec(spec2(l, "image")).errors.join(" ")).toMatch(/look is "screen"/);
    expect(validateSpec(spec2("screen", "image")).errors).toEqual([]);
  });
});

describe("icons on cards", () => {
  const iconRank: CardsElementLike = { id: "r", type: "cards", items: [{ text: "Sharks", icon: "shark", icon_strokes: STROKES, credit: "fish from lucide · ISC" }, "Cows", "Bees"] };

  test("an item's icon (and its resolved rings and credit) go on its card node", () => {
    const els = cardsElements(iconRank);
    const n1 = els.find((e) => e.id === "r_1")!;
    expect(n1).toMatchObject({ icon: "shark", icon_strokes: STROKES, credit: "fish from lucide · ISC" });
    expect(els.find((e) => e.id === "r_2")!.icon).toBeUndefined();
  });

  test("any resolved icon makes every card of the element 96 high", () => {
    const g = cardsGeometry(iconRank);
    expect(g.h).toBe(96);
    for (const n of nodes(cardsElements(iconRank))) expect(n.height).toBe(96);
    expect(cardsGeometry(rank).h).toBe(56);
  });

  test("an unresolved icon keeps the card short (text only) but still names the icon, so layout warns", () => {
    // A keyword the offline cache does not hold ("shark" is in it since round 6's examples).
    const el: CardsElementLike = { ...rank, items: [{ text: "Narwhals", icon: "narwhal" }, "Cows"] };
    expect(cardsGeometry(el).h).toBe(56);
    const n = cardsElements(el).find((e) => e.id === "r_1")!;
    expect(n.icon).toBe("narwhal");
    const r = layoutSpec(expandSpec({ elements: [el], commands: [{ draw: ["r"] }] } as unknown as Spec));
    expect(r.warnings.join(" ")).toMatch(/no icon for "narwhal"/);
  });

  test.each([
    ["sort", sort],
    ["compare", compare],
    ["match", match],
  ] as const)("%s: 96 high with icons, and the geometry around the cards grows with them", (_m, base) => {
    const items = (base.items ?? []).map((it) => ({ ...(typeof it === "string" ? { text: it } : it), icon: "x", icon_strokes: STROKES }));
    const el = { ...base, items } as CardsElementLike;
    const g = cardsGeometry(el);
    expect(g.h).toBe(96);
    if (g.mode === "sort") {
      // Every true slot is inside its bin, under the title.
      g.truth.forEach((p, i) => {
        const b = g.binBoxes[g.truthBin[i]];
        expect(p[1] + g.h / 2).toBeLessThanOrEqual(b.c[1] + b.h / 2 - 40);
        expect(p[1] - g.h / 2).toBeGreaterThanOrEqual(b.c[1] - b.h / 2);
      });
    }
    if (g.mode === "compare") {
      // A row's value labels stay clear of the next row's cards.
      const ys = [...new Set(g.home.map((p) => p[1]))].sort((a, b) => b - a);
      for (let r = 1; r < ys.length; r++) expect(ys[r - 1] - g.h / 2 - 20 - 12).toBeGreaterThan(ys[r] + g.h / 2);
    }
    if (g.mode === "match") {
      const ys = g.home.slice(0, g.pairs).map((p) => p[1]);
      for (let r = 1; r < ys.length; r++) expect(ys[r - 1] - ys[r]).toBeGreaterThanOrEqual(g.h);
    }
  });

  test("match: a partner's own icon (match_icon) goes on the partner card", () => {
    const el: CardsElementLike = { ...match, items: [{ text: "Aspirin", match: "Thins blood", icon: "pill", icon_strokes: STROKES, match_icon: "droplet", match_icon_strokes: STROKES }, { text: "Insulin", match: "Lowers sugar" }] };
    const els = cardsElements(el);
    expect(els.find((e) => e.id === "t_1")).toMatchObject({ icon: "pill", icon_strokes: STROKES });
    expect(els.find((e) => e.id === "t_m_1")).toMatchObject({ icon: "droplet", icon_strokes: STROKES });
    expect(cardsGeometry(el).h).toBe(96);
  });

  test("an item's icon validates (keyword or {of, set}, with the machine fields)", () => {
    const spec = { elements: [{ ...rank, items: [{ text: "Sharks", icon: "shark", icon_strokes: STROKES, credit: "c" }, { text: "Cows", icon: { of: "cow", set: "tabler" } }] }], commands: [{ draw: ["r"] }] } as unknown as Spec;
    expect(validateSpec(spec).errors).toEqual([]);
    const m = { elements: [{ ...match, items: [{ text: "A", match: "B", match_icon: "drop", match_icon_strokes: STROKES, match_credit: "c" }, { text: "C", match: "D" }] }], commands: [{ draw: ["t"] }] } as unknown as Spec;
    expect(validateSpec(m).errors).toEqual([]);
  });

  test("the card's id is still what is drawn: the icon is its sub-drawable, inside the box", () => {
    const r = layoutSpec(expandSpec({ elements: [iconRank], commands: [{ draw: ["r"] }] } as unknown as Spec));
    const boxes = elementBBoxes(r);
    const card = boxes.get("r_1")!;
    expect(card.h).toBeGreaterThanOrEqual(96);
    expect(r.order).not.toContain("r_1__icon");
    expect(r.warnings.join(" ")).not.toMatch(/icon/);
  });
});

describe("resolving, crediting and hoisting card icons", () => {
  test("resolveIcons fills a card item's icon_strokes and credit (and a partner's)", async () => {
    const spec = { elements: [{ ...match, items: [{ text: "A", match: "B", icon: "cards-pill", match_icon: "cards-drop" }, { text: "C", match: "D" }] }], commands: [] } as unknown as Spec;
    const r = await resolveIcons(
      spec,
      deps({
        [iconSearchUrl("cards-pill", DEFAULT_PREFIXES)]: { icons: ["lucide:pill"] },
        [iconSearchUrl("cards-drop", DEFAULT_PREFIXES)]: { icons: ["lucide:droplet"] },
        [iconSvgUrl("lucide", "pill")]: SVG,
        [iconSvgUrl("lucide", "droplet")]: SVG,
      }),
    );
    expect(r).toEqual([{ id: "t_1", ok: true }, { id: "t_m_1", ok: true }]);
    const it = (spec.elements![0].items as unknown as Record<string, string>[])[0];
    expect(iconRingsOf(it.icon_strokes)!.length).toBe(1);
    expect(it.credit).toBe("pill from lucide · ISC");
    expect(iconRingsOf(it.match_icon_strokes)!.length).toBe(1);
    expect(it.match_credit).toBe("droplet from lucide · ISC");
  });

  test("an unresolvable card icon is reported and leaves no strokes", async () => {
    const spec = { elements: [{ ...rank, items: [{ text: "A", icon: "cards-nothing-here" }, "B"] }], commands: [] } as unknown as Spec;
    const r = await resolveIcons(spec, deps({}));
    expect(r[0]).toMatchObject({ id: "r_1", ok: false });
    expect((spec.elements![0].items as unknown as Record<string, unknown>[])[0].icon_strokes).toBeUndefined();
  });

  test("render's order: a card icon is resolved BEFORE the cards expand, so the card and its geometry are 96 high", async () => {
    // size 1: alone on the page the cards would grow (page frame 2026-10-04); here the icon's 96 is the point.
    const authored = { elements: [{ ...match, size: 1, items: [{ text: "A", match: "B", icon: "cards-order-pill", match_icon: "cards-order-drop" }, { text: "C", match: "D" }] }], commands: [{ draw: ["t"] }] } as unknown as Spec;
    const before = JSON.stringify(authored);
    const icons = deps({
      [iconSearchUrl("cards-order-pill", DEFAULT_PREFIXES)]: { icons: ["lucide:pill"] },
      [iconSearchUrl("cards-order-drop", DEFAULT_PREFIXES)]: { icons: ["lucide:droplet"] },
      [iconSvgUrl("lucide", "pill")]: SVG,
      [iconSvgUrl("lucide", "droplet")]: SVG,
    });
    const none = async () => undefined;
    const spec = await expandedRenderSpec(authored, {
      resolvePortraits: none,
      resolveSources: none,
      resolveCode: none,
      resolveImages: none,
      resolveIcons: (s) => resolveIcons(s, icons),
      contactEmail: "",
      style: "sketchy",
    });
    const card = spec.elements!.find((e) => e.id === "t_1")!;
    const partner = spec.elements!.find((e) => e.id === "t_m_1")!;
    expect(card).toMatchObject({ type: "node", height: 96, icon: "cards-order-pill" });
    expect(iconRingsOf(card.icon_strokes!)).toBeTruthy();
    expect(partner).toMatchObject({ height: 96, icon: "cards-order-drop" });
    expect(iconRingsOf(partner.icon_strokes!)).toBeTruthy();
    expect(cardsGeometryIn(spec, "t")!.h).toBe(96);
    const box = elementBBoxes(layoutSpec(spec)).get("t_1")!;
    expect(box.h).toBeGreaterThanOrEqual(96);
    // Never the document: the authored spec is untouched.
    expect(JSON.stringify(authored)).toBe(before);
  });

  test("a revise that changes a card's icon drops the old rings AND their credit", () => {
    const spec = { elements: [{ ...rank, items: [{ text: "A", icon: "pill", icon_strokes: STROKES, credit: "pill from lucide · ISC" }, "B"] }], commands: [{ draw: ["r"] }] } as unknown as Spec;
    const h = hoistPortraitStrokes(formatPlaylist(singlePlaylist(spec), "script"));
    const back = parsePlaylistText(h.text.replace(/\bicon pill\b/, "icon syringe"));
    restorePortraitStrokes(back, h.blobs);
    const it = (itemsOf(back)[0].spec.elements![0].items as unknown as Record<string, string>[])[0];
    expect(it.icon).toBe("syringe");
    expect(it.icon_strokes).toBeUndefined();
    expect(it.credit).toBeUndefined();
  });

  test("creditsOf reads a card item's credits", () => {
    const spec = { elements: [{ ...rank, items: [{ text: "A", credit: "pill from lucide · ISC", match_credit: "droplet from lucide · ISC" }, "B"] }] } as unknown as Spec;
    expect(creditsOf([spec])).toEqual(["pill from lucide · ISC", "droplet from lucide · ISC"]);
  });

  test("a card item's strokes never visit the model: hoisted and restored", () => {
    const spec = { elements: [{ ...match, items: [{ text: "A", match: "B", icon: "pill", icon_strokes: STROKES, match_icon: "drop", match_icon_strokes: STROKES }, { text: "C", match: "D" }] }], commands: [{ draw: ["t"] }] } as unknown as Spec;
    const doc = formatPlaylist(singlePlaylist(spec), "script");
    const h = hoistPortraitStrokes(doc);
    expect(h.text).not.toContain(STROKES);
    const back = parsePlaylistText(h.text);
    restorePortraitStrokes(back, h.blobs);
    const it = (itemsOf(back)[0].spec.elements![0].items as unknown as Record<string, string>[])[0];
    expect(it.icon_strokes).toBe(STROKES);
    expect(it.match_icon_strokes).toBe(STROKES);
  });
});

// —— Review focus 1: the bundled examples, laid out ——

interface BundledExample {
  request: string;
  spec?: Spec;
  playlist?: string;
  specimen?: boolean;
}

const CANVAS = { w: 1000, h: 750 };

function specsOf(ex: BundledExample): Spec[] {
  if (ex.spec) return [ex.spec];
  if (ex.playlist) return itemsOf(parsePlaylistText(ex.playlist)).map((it) => it.spec);
  return [];
}

/** Every item of every cards element (and formula-ask tile row) given a resolved icon. */
function withIcons(spec: Spec): Spec {
  const s = structuredClone(spec);
  for (const el of s.elements ?? []) {
    if ((el as { type: string }).type !== "cards" || !Array.isArray(el.items)) continue;
    el.items = el.items.map((it) => {
      const o = typeof it === "string" ? { text: it } : { ...it };
      return { ...o, icon: "x", icon_strokes: STROKES, ...("match" in o ? { match_icon: "y", match_icon_strokes: STROKES } : {}) };
    });
  }
  return s;
}

const cardCases = (bundledExamples as BundledExample[])
  .filter((e) => !e.specimen)
  .flatMap((ex) => specsOf(ex).map((spec, i) => [`${ex.request.slice(0, 60)}${i > 0 ? ` [${i + 1}]` : ""}`, spec] as const))
  .filter(([, spec]) => (spec.elements ?? []).some((e) => (e as { type: string }).type === "cards") || (spec.commands ?? []).some((c) => Array.isArray(c.ask?.others)));

const overlaps = (a: BBox, b: BBox, slack = 1) => a.x < b.x + b.w - slack && b.x < a.x + a.w - slack && a.y < b.y + b.h - slack && b.y < a.y + a.h - slack;
const shift = (b: BBox, dx: number, dy: number): BBox => ({ x: b.x + dx, y: b.y + dy, w: b.w, h: b.h });

function checkCards(authored: Spec): string[] {
  const spec = expandSpec(authored);
  const layout = layoutSpec(spec);
  const bboxes = elementBBoxes(layout);
  const hooks = formulaHooksFor(spec, bboxes, (l) => elementBBoxes(l));
  const problems: string[] = [];
  // A deck's group holds only its top card (the rest wait in the stack).
  const groups = (spec.elements ?? []).filter((e) => e.type === "group" && ((e.members ?? []).includes(`${e.id}_1`) || (e as { deck?: unknown }).deck === true) && (Array.isArray(e.items) || Array.isArray(e.options)));
  if (groups.length === 0) problems.push("no cards element found");
  for (const grp of groups) {
    const g = hooks.cardsOn(grp.id.endsWith("_tiles") ? grp.id.slice(0, -"_tiles".length) : grp.id);
    if (!g) {
      problems.push(`${grp.id}: no geometry`);
      continue;
    }
    // The card's drawn box (outline, not its shadow or text spill) at home.
    const home = g.cards.map((id, i) => bboxes.get(id) ?? { x: g.home[i][0] - g.w / 2, y: g.home[i][1] - g.h / 2, w: g.w, h: g.h });
    const truth = home.map((b, i) => shift(b, g.truth[i][0] - g.home[i][0], g.truth[i][1] - g.home[i][1]));
    const titles = g.bins.map((_, k) => bboxes.get(`${grp.id}_bin_${k + 1}_title`)).filter((b): b is BBox => !!b);
    for (const [when, boxes] of [["home", home], ["truth", truth]] as const) {
      boxes.forEach((b, i) => {
        if (b.x < 0 || b.y < 0 || b.x + b.w > CANVAS.w || b.y + b.h > CANVAS.h) problems.push(`${grp.id} ${when}: ${g.cards[i]} off the canvas (${Math.round(b.x)}, ${Math.round(b.y)}, ${Math.round(b.w)}×${Math.round(b.h)})`);
        // A deck's cards wait in one stack at home, piled on purpose.
        if (when === "home" && (grp as { deck?: unknown }).deck === true) return;
        for (let j = i + 1; j < boxes.length; j++) {
          // fill: the wrong tiles stay in the tray at the truth — only the
          // placed ones move, and they never share a blank.
          if (overlaps(b, boxes[j])) problems.push(`${grp.id} ${when}: ${g.cards[i]} overlaps ${g.cards[j]}`);
        }
        for (const t of titles) if (overlaps(b, t)) problems.push(`${grp.id} ${when}: ${g.cards[i]} overlaps a bin title`);
      });
    }
  }
  return problems;
}

describe("every bundled cards example: no card overlaps a card, a bin title or the canvas edge", () => {
  test("there are bundled cards examples to check", () => {
    expect(cardCases.length).toBeGreaterThanOrEqual(5);
  });
  test.each(cardCases)("%s — as authored (paper)", (_req, spec) => {
    expect(checkCards(spec)).toEqual([]);
  });
  test.each(cardCases)("%s — with an icon on every card", (_req, spec) => {
    expect(checkCards(withIcons(spec))).toEqual([]);
  });
});

// Final review: one resolved icon makes the cards taller; the fullest
// layouts must still fit the canvas — the cards shrink toward 72 when they would not.
describe("the fullest icon layouts stay on the canvas", () => {
  const one = (el: Record<string, unknown>): Spec => ({ elements: [el], commands: [{ draw: [el.id as string] }] }) as unknown as Spec;
  const words = ["Rent", "Flour", "Insurance", "Packaging", "Wages", "Butter", "Lease", "Sugar"];
  const cases: [string, Spec][] = [
    ["sort: 8 items, 2 bins", one({ id: "s", type: "cards", bins: ["Fixed", "Variable"], items: words.map((t, i) => ({ text: t, bin: i % 2 ? "Variable" : "Fixed" })) })],
    ["sort: 8 items, 2 bins, 6 in one", one({ id: "s", type: "cards", bins: ["Fixed", "Variable"], items: words.map((t, i) => ({ text: t, bin: i < 6 ? "Fixed" : "Variable" })) })],
    ["match: 6 pairs", one({ id: "t", type: "cards", items: words.slice(0, 6).map((t, i) => ({ text: t, match: `M${i}` })) })],
    ["rank: 8 in a column", one({ id: "r", type: "cards", arrange: "column", items: words })],
    ["compare: 5 pairs", one({ id: "c", type: "cards", compare: "Which is more?", items: [...words, "A", "B"].map((t, i) => ({ text: t, value: i + 1 })) })],
  ];
  test.each(cases)("%s — with an icon on every card", (_n, spec) => {
    expect(checkCards(withIcons(spec))).toEqual([]);
  });
  // Page frame 2026-10-04: over the caption band (y 160), not the canvas floor — 72 became 60.
  test("they shrink only as far as they must: 60+ for an even sort of 8 and 6 pairs, never under a plain card", () => {
    const h = (spec: Spec) => cardsGeometry(withIcons(spec).elements![0] as unknown as CardsElementLike).h;
    expect(h(cases[0][1])).toBeGreaterThanOrEqual(60);
    expect(h(cases[2][1])).toBeGreaterThanOrEqual(60);
    for (const [, spec] of cases) expect(h(spec)).toBeGreaterThanOrEqual(56);
  });
  test("a layout with room keeps the full icon height", () => {
    expect(cardsGeometry(withIcons(one(sort as unknown as Record<string, unknown>)).elements![0] as unknown as CardsElementLike).h).toBe(96);
  });
});

/** A one-element spec: the rank cards, or an image, with this look. */
function spec2(look: string, type: "cards" | "image"): Spec {
  const el = type === "cards" ? { id: "r", type: "cards", items: ["A", "B", "C"], look } : { id: "r", type: "image", url: "https://example.org/a.png", look };
  return { elements: [el], commands: [{ draw: ["r"] }] } as unknown as Spec;
}
