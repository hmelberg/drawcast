// Books (spec 2026-10-01-book-layout): the pure parts of the player — the
// text pane's Markdown, the layout arithmetic, the text-step list a seek
// rebuilds from, and the scroll rule. The DOM side is checked by eye in the
// app (the bundled "Price elasticity — a book").
import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { renderMarkdown, startsWithHeading } from "../src/book/markdown";
import { bookLayout, defaultShare } from "../src/book/layout";
import { crossesChapter, opsBeforePart, partTextOps, prelude } from "../src/book/ops";
import { fillScroll, markPath, wipeMs } from "../src/book/pane";
import { itemsOf, parsePlaylistText } from "../src/playlist/playlist";
import { validateSpec } from "../src/spec/schema";
import type { Spec } from "../src/spec/types";

const tex = (t: string, display: boolean): string => `[${display ? "D" : "I"}:${t}]`;

describe("the text pane's Markdown", () => {
  test("headings, paragraphs, lists, quotes, emphasis", () => {
    const html = renderMarkdown("# Title\n## Part\n### Sub\nA **key** word and *an aside*\n- one\n- two\n> Substitutes decide it.", tex);
    expect(html).toBe(
      "<h1>Title</h1><h2>Part</h2><h3>Sub</h3><p>A <strong>key</strong> word and <em>an aside</em></p><ul><li>one</li><li>two</li></ul><blockquote>Substitutes decide it.</blockquote>",
    );
  });

  test("math: inline in prose, display on its own line", () => {
    expect(renderMarkdown("Bus rides: $x+1$ done", tex)).toBe('<p>Bus rides: <span class="bk-math">[I:x+1]</span> done</p>');
    expect(renderMarkdown("$$\\varepsilon = 1$$", tex)).toBe('<div class="bk-display">[D:\\varepsilon = 1]</div>');
  });

  test("tables: numeric columns right-aligned", () => {
    const html = renderMarkdown("| Good | 5 years |\n|---|---|\n| Petrol | 0.6 |\n| Bus | 0.9 |", tex);
    expect(html).toContain('<th class="num">5 years</th>');
    expect(html).toContain('<td class="num">0.6</td>');
    expect(html).toContain("<td>Petrol</td>");
  });

  test("a code listing and its output; keywords coloured, strings left alone", () => {
    const html = renderMarkdown('```python\nprint("def") # note\n```\n```output\n-2.6\n```', tex);
    expect(html).toContain('<span class="k">print</span>');
    expect(html).toContain('<span class="s">&quot;def&quot;</span>');
    expect(html).toContain('<span class="c"># note</span>');
    expect(html).toContain('<pre class="bk-listing bk-output">-2.6</pre>');
  });

  test("raw HTML is escaped, never passed through", () => {
    expect(renderMarkdown("<script>x</script> & <b>", tex)).toBe("<p>&lt;script&gt;x&lt;/script&gt; &amp; &lt;b&gt;</p>");
  });

  test("startsWithHeading", () => {
    expect(startsWithHeading("## Two extremes")).toBe(true);
    expect(startsWithHeading("**Elasticity**")).toBe(false);
  });
});

describe("the layout follows the screen height", () => {
  const room = { w: 2400, h: 900, barH: 60 };

  test("columns: the figure as tall as the book, the text 40 % beside it, centred with room to spare", () => {
    const b = bookLayout(room, { layout: "columns" });
    expect(b.dir).toBe("row");
    expect(b.figure.w).toBeCloseTo(((900 - 60) * 4) / 3);
    expect(b.text.w / (b.text.w + b.figure.w)).toBeCloseTo(0.4);
    expect(b.w).toBeLessThan(room.w); // a wide screen gets margins
  });

  test("columns too wide for the room shrink together", () => {
    const b = bookLayout({ w: 1000, h: 900, barH: 60 }, { layout: "columns" });
    expect(b.w).toBeCloseTo(1000);
    expect(b.text.w / b.w).toBeCloseTo(0.4);
  });

  test("rows: the column is exactly as wide as the figure; the text gets the height left", () => {
    const b = bookLayout(room, { layout: "rows" });
    expect(b.dir).toBe("column");
    expect(b.text.w).toBe(b.figure.w);
    expect(b.text.h + b.figure.h).toBeCloseTo(900);
    expect(defaultShare("rows")).toBe(28);
  });

  test("view: figure gives it the book; view: text gives the text the book", () => {
    expect(bookLayout(room, {}, "figure").text.w).toBe(0);
    const t = bookLayout(room, {}, "text");
    expect(t.figure.w).toBe(0);
    expect(t.text.w).toBeGreaterThan(0);
  });

  test("the font follows the height, and a narrow column's width, 14–26 px", () => {
    expect(bookLayout({ w: 2000, h: 400, barH: 60 }, {}).fontPx).toBe(14);
    expect(bookLayout({ w: 4000, h: 2000, barH: 60 }, {}).fontPx).toBe(26);
    expect(bookLayout({ w: 560, h: 900, barH: 60 }, {}).fontPx).toBeLessThan(bookLayout({ w: 2400, h: 900, barH: 60 }, {}).fontPx);
  });
});

describe("the text steps a seek rebuilds from", () => {
  const book = parsePlaylistText(readFileSync("docs/examples/books/price-elasticity.yaml", "utf8"));
  const items = itemsOf(book);

  test("the bundled book: every part valid, two chapters", () => {
    for (const it of items) expect(validateSpec(it.spec).errors).toEqual([]);
    expect(new Set(items.map((i) => i.chapter)).size).toBe(2);
  });

  test("the book writes its title, its chapters and its parts' titles", () => {
    expect(prelude(items, 0, "Price elasticity").map((o) => (o.op === "write" ? o.text : o.op))).toEqual([
      "# Price elasticity",
      "## What elasticity is",
      "### What elasticity measures",
    ]);
    // a new chapter: the pane empties first
    expect(prelude(items, 2, "Price elasticity").map((o) => (o.op === "write" ? o.text : o.op))).toEqual(["clear", "## Measuring and using it", "### The midpoint method"]);
    expect(crossesChapter(items, 1, 2)).toBe(true);
    expect(crossesChapter(items, 0, 1)).toBe(false);
  });

  test("a part that opens with its own heading gets no automatic one", () => {
    const spec = { title: "Ignored", commands: [{ write: "## My own" }] } as unknown as Spec;
    expect(prelude([{ spec, index: 0 }], 0)).toEqual([]);
  });

  test("everything before a part: earlier parts whole, then its prelude", () => {
    const ops = opsBeforePart(items, 1, "Price elasticity");
    const ids = ops.flatMap((o) => (o.op === "write" ? [o.id] : []));
    expect(ids.slice(0, 3)).toEqual(["book_title", "chapter_1", "part_1"]);
    expect(ids).toContain("formula");
    expect(ids[ids.length - 1]).toBe("part_2");
    expect(partTextOps(items[1].spec).some((o) => o.op === "view")).toBe(true);
  });
});

describe("the pane's rules", () => {
  test("fill scroll: nothing while the block fits; past 85 %, the block lands at 45 %", () => {
    expect(fillScroll(0, 1000, 600)).toBe(0);
    expect(fillScroll(0, 1000, 900)).toBe(450);
    expect(fillScroll(300, 1000, 1000)).toBe(300);
  });

  test("a block writes on in 0.35–1.4 s by its length", () => {
    expect(wipeMs("a")).toBe(350);
    expect(wipeMs("x".repeat(500))).toBe(1400);
  });

  test("circles and boxes leave room around the ink", () => {
    const box = [{ x: 100, y: 100, w: 200, h: 40 }];
    const xs = markPath("box", box).match(/[\d.]+/g)!.map(Number);
    expect(Math.min(...xs)).toBeLessThan(100);
    const circle = markPath("circle", box).match(/-?[\d.]+/g)!.map(Number);
    const cxs = circle.filter((_, i) => i % 2 === 0);
    expect(Math.min(...cxs)).toBeLessThan(100 - 10);
    expect(Math.max(...cxs)).toBeGreaterThan(300 + 10);
  });
});

describe("book lint (spec §9)", async () => {
  const { lintCommands } = await import("../src/lint/lint");
  const rules = (spec: unknown): string[] => lintCommands(spec as Spec).map((i) => i.rule).filter((r) => r.startsWith("book-"));

  test("a block that writes out the spoken sentence is flagged; a quote may run long", () => {
    const long = "This is the whole spoken sentence written out word for word, " + "and then some more words again ".repeat(6);
    expect(rules({ book: {}, commands: [{ write: long }] })).toEqual(["book-block-long"]);
    expect(rules({ book: {}, commands: [{ write: `> ${long}` }] })).toEqual([]);
  });

  test("a mark aimed at an automatic id is flagged — it moves when a block is added", () => {
    expect(rules({ book: {}, commands: [{ write: "a" }, { highlight: { target: "w1" } }] })).toEqual(["book-auto-id"]);
    expect(rules({ book: {}, commands: [{ write: { id: "a", text: "a" } }, { highlight: { target: "a" } }] })).toEqual([]);
  });

  test("more than three marks in a part", () => {
    const marks = [1, 2, 3, 4].map(() => ({ highlight: { target: "a" } }));
    expect(rules({ book: {}, commands: [{ write: { id: "a", text: "a" } }, ...marks] })).toEqual(["book-marks"]);
  });

  test("marks on a template's own parts are figure marks, not text marks (2026-10-05)", () => {
    // bar_chart's bar_1 and two_by_two_table's cell_0_0 are not in spec.elements,
    // but they are on the figure — only marks on written blocks count.
    const figure = ["bar_1", "bar_2", "cell_0_0", "cell_1_1"].map((t) => ({ highlight: { target: t } }));
    expect(rules({ book: {}, template: "bar_chart", commands: [{ write: { id: "a", text: "a" } }, ...figure, { highlight: { target: "a" } }] })).toEqual([]);
  });

  test("not a book: no book rules", () => {
    expect(rules({ commands: [{ write: "x ".repeat(80) }] })).toEqual([]);
  });

  test("the bundled book lints clean", () => {
    const pl = parsePlaylistText(readFileSync("docs/examples/books/price-elasticity.yaml", "utf8"));
    for (const it of itemsOf(pl)) expect(rules(it.spec)).toEqual([]);
  });
});


// The controls under the whole book (2026-10-01): no jsdom here, so the
// wiring whose absence would fail silently is pinned on the source, as the
// repo's other wiring tests do; the behaviour was checked in the app
// (fullscreen holds text, figure and bar; the bar fades only there).
describe("one control bar under the whole book", () => {
  const src = readFileSync("src/book/shell.ts", "utf8");
  const css = readFileSync("src/book/css.ts", "utf8");

  test("fullscreen takes the book, not the figure; no theater button in a book", () => {
    expect(src).toMatch(/controls: \{ \.\.\.opts\.controls, fullscreenEl: bookEl, onTheater: undefined \}/);
  });

  test("each part's bar (and its docked tray) moves into the footer, replacing the last", () => {
    expect(src).toMatch(/footer\.replaceChildren\(bar, \.\.\.\(tray \? \[tray\] : \[\]\)\)/);
    // after the host's own onItemMounted — the 3D button and the tray attach to the bar first
    expect(src.indexOf("opts.onItemMounted?.(hd, item);")).toBeLessThan(src.indexOf("    adoptBar();"));
  });

  test("movement over the footer counts as movement over the controls; the fade is fullscreen-only", () => {
    expect(src).toMatch(/footer\.addEventListener\("pointermove", forward\("pointermove"\)\)/);
    expect(css).toMatch(/\.bk-book:is\(:fullscreen, \.cs-faux-fs\):has\(\.cs-figure\.cs-idle\) \.bk-footer \{ opacity: 0;/);
  });

  test("into and out of fullscreen, real or faux, the book lays itself out again", () => {
    expect(src).toMatch(/document\.addEventListener\("fullscreenchange", onResize\)/);
    expect(src).toMatch(/fauxWatch\.observe\(bookEl, \{ attributes: true, attributeFilter: \["class"\] \}\)/);
  });
});
