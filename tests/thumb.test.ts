// The listing picture (thumbnail round, 2026-10-04): the cast's words, the site's style.
import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { castCardText } from "../netlify/lib/share-card.mts";
import { accentArt, ADULT_ACCENTS, characterArt, fitText, KID_CHARACTERS, kidsByTags, planThumb, readThumb, thumbSvg } from "../netlify/lib/thumb.mts";
import { renderThumb } from "../netlify/lib/thumb-render.mts";
import { handleCardRequest, type CardDeps } from "../netlify/functions/card.mts";

describe("readThumb", () => {
  test("keeps known values, drops the rest, trims and caps words", () => {
    expect(readThumb({ style: "loud", character: "aha", headline: "  It's   not the shark ", junk: 1 })).toEqual({ style: "loud", character: "aha", headline: "It's not the shark" });
    expect(readThumb({ style: "glitter", character: "clown" })).toBeUndefined();
    expect(readThumb("strip")).toBeUndefined();
    expect(readThumb({ headline: "x".repeat(200) })!.headline!.length).toBe(60);
  });
});

describe("planThumb: the defaults Hans chose", () => {
  test("a headline means B; nothing means A", () => {
    expect(planThumb({ headline: "It's not the shark" }).style).toBe("strip");
    expect(planThumb(undefined).style).toBe("plain");
    expect(planThumb({ character: "surprised" }).style).toBe("plain");
  });
  test("B and D need a headline, E a question or a title that is one", () => {
    expect(planThumb({ style: "loud" }).style).toBe("plain");
    expect(planThumb({ style: "question" }, { title: "The deadliest animal" }).style).toBe("plain");
    expect(planThumb({ style: "question" }, { title: "Is a tomato a fruit?" })).toEqual({ style: "question", character: "none", question: "Is a tomato a fruit?" });
  });
  test("automatic figures: a cartoon only for a children's cast; grown-ups get none on B, the skeptic on D", () => {
    expect(planThumb({ headline: "h" }, { format: "quiz", kids: true }).character).toBe("thinking");
    expect(planThumb({ headline: "h" }, { format: "quiz" }).character).toBe("none");
    expect(planThumb({ headline: "h", style: "loud" }, { kids: true }).character).toBe("surprised");
    expect(planThumb({ headline: "h", style: "loud" }).character).toBe("skeptic");
    expect(kidsByTags(["biology", "Children"])).toBe(true);
    expect(kidsByTags(["biology"])).toBe(false);
  });
  test("a note, stamp or bubble says the author's words, or its own", () => {
    expect(planThumb({ headline: "h", character: "stamp" }).words).toBe("PLOT TWIST");
    expect(planThumb({ headline: "h", character: "stamp", words: "Myth?" }).words).toBe("Myth?");
    expect(planThumb({ headline: "h", character: "reader", words: "x" }).words).toBeUndefined();
    expect(planThumb({ headline: "h", character: "eyes", style: "loud" }).character).toBe("none");
  });
  test("the author's pick wins, and A and E carry none", () => {
    expect(planThumb({ headline: "h", character: "aha" }).character).toBe("aha");
    expect(planThumb({ style: "question", question: "q?", character: "aha" }).character).toBe("none");
  });
});

describe("drawing", () => {
  test("text fits: a long headline wraps to two lines at a smaller size", () => {
    expect(fitText("IT'S NOT THE SHARK", "marker", 860, 2, 70, 38).lines).toHaveLength(1);
    const long = fitText("THE SMALLEST ANIMAL ON YOUR LIST KILLS THE MOST", "marker", 860, 2, 70, 38);
    expect(long.lines.length).toBe(2);
    expect(long.size).toBeLessThan(70);
  });
  test("every character is drawn with flat colours (no CSS variables)", () => {
    for (const c of KID_CHARACTERS) expect(characterArt(c)).not.toMatch(/var\(/);
    for (const c of ADULT_ACCENTS) expect(accentArt(c, "x")).not.toMatch(/var\(/);
  });
  test("the SVG escapes the author's words", () => {
    const svg = thumbSvg({ style: "strip", character: "none", headline: "<b>&" }, "data:image/png;base64,AA");
    expect(svg).toContain("&lt;B&gt;&amp;");
    expect(svg).not.toContain("<B>");
  });
  test("resvg renders a 1000×750 PNG with the bundled faces", () => {
    const poster = readFileSync("public/share-card.png");
    const png = renderThumb({ style: "strip", character: "thinking", headline: "It's not the shark" }, poster);
    expect([...png.slice(1, 4)].map((b) => String.fromCharCode(b)).join("")).toBe("PNG");
    const dv = new DataView(png.buffer, png.byteOffset);
    expect([dv.getUint32(16), dv.getUint32(20)]).toEqual([1000, 750]);
  });
});

describe("the cast's header", () => {
  test("a .cast's thumb block and format", () => {
    const text = '# The deadliest animal\nsubtitle: "Guess."\nformat: quiz\nthumb:\n    style: strip\n    headline: "It\'s not the shark"\n    character: surprised\n\n## The deadliest animal\nuse: bar_chart\n';
    expect(castCardText(text)).toEqual({ title: "The deadliest animal", subtitle: "Guess.", format: "quiz", thumb: { style: "strip", headline: "It's not the shark", character: "surprised" } });
  });
  test("a YAML playlist's thumb", () => {
    expect(castCardText("playlist:\n  title: T\n  thumb:\n    headline: H\n---\nelements: []\n").thumb).toEqual({ headline: "H" });
  });
});

describe("/card/ draws the style", () => {
  const POSTER = new Uint8Array([137, 80, 78, 71]);
  const deps = (castText: string, drawn: string[]): CardDeps => ({
    resolve: async () => ({ kind: "cast", target: "ann/casts/c.cast" }),
    fetchText: async () => castText,
    fetchImage: async () => new Response(POSTER, { headers: { "content-type": "image/png" } }),
    draw: (plan) => (drawn.push(plan.style), new Uint8Array([1, 2, 3])),
  });
  const get = (p: string) => new Request(`https://drawcast.app${p}`);
  test("a headline: drawn; none: the poster as published", async () => {
    const drawn: string[] = [];
    const a = await handleCardRequest(get("/card/c.png"), deps("# T\nthumb:\n    headline: Hey\n\n## T\n", drawn));
    expect(new Uint8Array(await a.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));
    expect(drawn).toEqual(["strip"]);
    const b = await handleCardRequest(get("/card/c.png"), deps("# T\n\n## T\n", drawn));
    expect(new Uint8Array(await b.arrayBuffer())).toEqual(POSTER);
    expect(drawn).toEqual(["strip"]);
  });
  test("a drawing that fails serves the poster", async () => {
    const d = { ...deps("# T\nthumb:\n    headline: Hey\n\n## T\n", []), draw: () => { throw new Error("no"); } };
    expect(new Uint8Array(await (await handleCardRequest(get("/card/c.png"), d)).arrayBuffer())).toEqual(POSTER);
  });
});
