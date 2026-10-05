// Cards' named icons (cards round, 2026-10-05): src/card/icons.ts fetches them
// from Iconify in one request per set; src/card/draw.ts draws a named icon
// when its drawing has arrived and leaves it out until then.
import { describe, expect, test } from "vitest";
import { planThumb } from "../netlify/lib/thumb.mts";
import { drawCard, iconNames } from "../src/card/draw";
import { iconsFromJson, loadIcons } from "../src/card/icons";
import type { CompiledCard } from "../src/card/types";
import { parseCatalogueItem } from "../src/catalogue";
import { cardOf, parseFeed } from "../src/home/feed";

const card: CompiledCard = {
  v: 1,
  items: [{ k: "i", x: 500, y: 400, w: 80, h: 80, n: "twemoji:shark" }, { k: "i", x: 700, y: 400, w: 80, h: 80, n: "twemoji:shark" }],
  marks: planThumb(undefined, { title: "Sharks" }),
  corners: ["tr", "br", "tl", "bl"],
};

describe("named icons", () => {
  test("a card lists each name once; the icon is drawn only when its drawing is known", () => {
    expect(iconNames(card)).toEqual(["twemoji:shark"]);
    expect(drawCard(card)).not.toContain("<image");
    expect(drawCard(card, { icons: { "twemoji:shark": '<svg viewBox="0 0 36 36"><path d="M0 0h36"/></svg>' } })).toContain("data:image/svg+xml");
  });
  test("Iconify's JSON as SVG markup by set:name", () => {
    const icons = iconsFromJson({ prefix: "twemoji", width: 36, height: 36, icons: { shark: { body: "<path/>" }, dog: { body: "<g/>", width: 40 } } });
    expect(icons["twemoji:shark"]).toBe('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 36 36"><path/></svg>');
    expect(icons["twemoji:dog"]).toContain('viewBox="0 0 40 36"');
  });
  test("one request per set, invalid names never asked, then remembered", async () => {
    const asked: string[] = [];
    const fake = (async (url: string) => {
      asked.push(url);
      const set = /\/([a-z-]+)\.json/.exec(url)![1];
      const names = new URL(url).searchParams.get("icons")!.split(",");
      return new Response(JSON.stringify({ prefix: set, width: 36, height: 36, icons: Object.fromEntries(names.map((n) => [n, { body: `<path id="${n}"/>` }])) }));
    }) as unknown as typeof fetch;
    const got = await loadIcons(["twemoji:cat-face", "twemoji:horse", "noto:owl", "bad name", "x:../y"], fake);
    expect(Object.keys(got).sort()).toEqual(["noto:owl", "twemoji:cat-face", "twemoji:horse"]);
    expect(asked).toHaveLength(2);
    await loadIcons(["twemoji:horse"], fake);
    expect(asked).toHaveLength(2);
  });
  test("names asked for by many cards in the same moment go out as one request per set", async () => {
    const asked: string[] = [];
    const fake = (async (url: string) => {
      asked.push(url);
      const names = new URL(url).searchParams.get("icons")!.split(",");
      return new Response(JSON.stringify({ prefix: "twemoji", width: 36, height: 36, icons: Object.fromEntries(names.map((n) => [n, { body: "<path/>" }])) }));
    }) as unknown as typeof fetch;
    const all = await Promise.all(["ant", "bee", "cow", "dog"].map((n) => loadIcons([`twemoji:${n}`], fake)));
    expect(asked).toHaveLength(1);
    expect(all.map((o) => Object.keys(o)[0])).toEqual(["twemoji:ant", "twemoji:bee", "twemoji:cow", "twemoji:dog"]);
  });
});

describe("cards in the catalogue and the feed", () => {
  const raw = { kind: "cast", title: "Sharks", name: "sharks", owner: "ann", lectures: 1, updated: "2026-10-05", private: false, tags: [], likes: 0, card };
  test("a card-shaped value is kept, anything else dropped", () => {
    expect(parseCatalogueItem(raw)!.card).toEqual(card);
    expect(parseCatalogueItem({ ...raw, card: { v: 2 } })!.card).toBeUndefined();
  });
  test("the feed remembers each item's card by name", () => {
    parseFeed({ built: 1, items: [raw], ranks: [] });
    expect(cardOf("sharks")).toEqual(card);
  });
});
