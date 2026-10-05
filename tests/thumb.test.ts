// The listing picture (thumbnail round, 2026-10-04): one line of plain words, drawn by the site.
import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { castCardText } from "../netlify/lib/share-card.mts";
import { characterArt, cornerBusyness, fitText, KID_FIGURES, kidsByTags, parseThumbLine, planThumb, printThumbLine, readThumb, thumbSvg, thumbTitle } from "../netlify/lib/thumb.mts";
import { posterBusyness, renderThumb } from "../netlify/lib/thumb-render.mts";
import { handleCardRequest, type CardDeps } from "../netlify/functions/card.mts";

describe("the line", () => {
  test("plain words in any order, quoted words where a word takes them", () => {
    const { parts, unknown } = parseThumbLine('stamp "MYTH?" band "It\'s not the shark" star eyes bang glitter');
    expect(parts).toEqual({ words: "band", headline: "It's not the shark", figure: "eyes", marks: [{ kind: "stamp", words: "MYTH?" }, { kind: "star" }, { kind: "bang" }] });
    expect(unknown).toEqual(["glitter"]);
  });
  test("note and stamp together; a star's own words; a listing title; curly quotes", () => {
    const { parts } = parseThumbLine('band “Hey” note "wait, what?" stamp "FACT" star "?" title "Sharks are innocent"');
    expect(parts.marks).toEqual([{ kind: "note", words: "wait, what?" }, { kind: "stamp", words: "FACT" }, { kind: "star", words: "?" }]);
    expect(parts.title).toBe("Sharks are innocent");
    expect(parts.headline).toBe("Hey");
  });
  test("bare words become the headline; question takes its own", () => {
    expect(parseThumbLine('"It\'s falling right now" note').parts.headline).toBe("It's falling right now");
    expect(parseThumbLine('question "Are you ill?" eyes').parts).toEqual({ words: "question", question: "Are you ill?", figure: "eyes", marks: [] });
  });
  test("printed back canonically; the first round's block still reads", () => {
    expect(printThumbLine(parseThumbLine('star  BAND "Hey"  surprised').parts)).toBe('band "Hey" surprised star');
    expect(readThumb({ style: "loud", headline: "Hey", character: "aha" })).toBe('burst "Hey" aha seal arrow');
    expect(readThumb("   ")).toBeUndefined();
    expect(thumbTitle('band "x" title "T"')).toBe("T");
  });
});

describe("planThumb", () => {
  test("a headline alone means the band; nothing means the poster as it is", () => {
    expect(planThumb('"Hey"').words).toBe("band");
    expect(planThumb(undefined)).toEqual({ words: "none", figure: "none", marks: [] });
  });
  test("band and burst need words; question needs a question or a title that is one", () => {
    expect(planThumb("burst").words).toBe("none");
    expect(planThumb("question", { title: "The deadliest animal" }).words).toBe("none");
    expect(planThumb("question", { title: "Is a tomato a fruit?" }).question).toBe("Is a tomato a fruit?");
  });
  test("the figure: a cartoon thinker only on a children's quiz band; eyes need the band; noface wins", () => {
    expect(planThumb('"h"', { format: "quiz", kids: true }).figure).toBe("thinking");
    expect(planThumb('"h"', { format: "quiz" }).figure).toBe("none");
    expect(planThumb('"h" noface', { format: "quiz", kids: true }).figure).toBe("none");
    expect(planThumb('burst "h" eyes').figure).toBe("none");
    expect(kidsByTags(["biology", "Children"])).toBe(true);
  });
  test("marks keep the author's words or say their own", () => {
    expect(planThumb('"h" stamp star note "x"').marks).toEqual([{ kind: "stamp", words: "PLOT TWIST" }, { kind: "star", words: "?!" }, { kind: "note", words: "x" }]);
  });
});

describe("drawing", () => {
  test("text fits: a long headline wraps to two lines at a smaller size", () => {
    expect(fitText("IT'S NOT THE SHARK", "marker", 860, 2, 70, 38).lines).toHaveLength(1);
    const long = fitText("THE SMALLEST ANIMAL ON YOUR LIST KILLS THE MOST", "marker", 860, 2, 70, 38);
    expect(long.lines.length).toBe(2);
  });
  test("cartoons are flat colours (no CSS variables); the author's words are escaped", () => {
    for (const c of KID_FIGURES) expect(characterArt(c)).not.toMatch(/var\(/);
    const svg = thumbSvg(planThumb('band "<b>&" stamp "<i>"'), "data:image/png;base64,AA");
    expect(svg).toContain("&lt;B&gt;&amp;");
    expect(svg).not.toContain("<B>");
  });
  test("the emptiest free corner gets the first item", () => {
    const busyLeftEmpty = { tl: 0, tr: 0.5, bl: 0, br: 0.5 };
    const svg = thumbSvg(planThumb('band "h" stamp'), "data:,", busyLeftEmpty);
    expect(svg).toMatch(/<g transform="translate\(24 20\)">/);
    const svg2 = thumbSvg(planThumb('band "h" stamp'), "data:,", { tl: 0.5, tr: 0, bl: 0, br: 0 });
    expect(svg2).toMatch(/<g transform="translate\(696 20\)">/);
  });
  test("corner busyness reads ink against paper", () => {
    const w = 100, h = 75, px = new Uint8Array(w * h * 4).fill(255);
    for (let y = 0; y < 30; y++) for (let x = 0; x < 30; x++) px.set([0, 0, 0, 255], (y * w + x) * 4);
    const b = cornerBusyness(px, w, h);
    expect(b.tl).toBeGreaterThan(0.5);
    expect(b.br).toBe(0);
  });
  test("resvg renders a 1000×750 PNG with the bundled faces; the poster's corners are read", () => {
    const poster = readFileSync("public/share-card.png");
    expect(posterBusyness(poster)).toBeDefined();
    const png = renderThumb(planThumb('band "It\'s not the shark" note stamp star bang thinking'), poster);
    const dv = new DataView(png.buffer, png.byteOffset);
    expect([dv.getUint32(16), dv.getUint32(20)]).toEqual([1000, 750]);
  });
});

describe("the cast's header", () => {
  test("a .cast's thumb line, tags and format", () => {
    const text = '# The deadliest animal\nsubtitle: "Guess."\ntags: biology, children\nformat: quiz\nthumb: band "It\'s not the shark" stamp "MYTH?"\n\n## The deadliest animal\nuse: bar_chart\n';
    expect(castCardText(text)).toEqual({ title: "The deadliest animal", subtitle: "Guess.", tags: ["biology", "children"], format: "quiz", thumb: 'band "It\'s not the shark" stamp "MYTH?"' });
  });
  test("the first round's block still reads", () => {
    const text = '# T\nthumb:\n    style: strip\n    headline: "Hey"\n\n## T\n';
    expect(castCardText(text).thumb).toBe('band "Hey"');
  });
  test("a YAML playlist's thumb", () => {
    expect(castCardText("playlist:\n  title: T\n  thumb: 'band \"H\" bang'\n---\nelements: []\n").thumb).toBe('band "H" bang');
  });
});

describe("/card/ draws the line", () => {
  const POSTER = new Uint8Array([137, 80, 78, 71]);
  const deps = (castText: string, drawn: string[]): CardDeps => ({
    resolve: async () => ({ kind: "cast", target: "ann/casts/c.cast" }),
    fetchText: async () => castText,
    fetchImage: async () => new Response(POSTER, { headers: { "content-type": "image/png" } }),
    draw: (plan) => (drawn.push(plan.words), new Uint8Array([1, 2, 3])),
  });
  const get = (p: string) => new Request(`https://drawcast.app${p}`);
  test("a line: drawn; none: the poster as published", async () => {
    const drawn: string[] = [];
    const a = await handleCardRequest(get("/card/c.png"), deps('# T\nthumb: band "Hey"\n\n## T\n', drawn));
    expect(new Uint8Array(await a.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));
    const b = await handleCardRequest(get("/card/c.png"), deps("# T\n\n## T\n", drawn));
    expect(new Uint8Array(await b.arrayBuffer())).toEqual(POSTER);
    expect(drawn).toEqual(["band"]);
  });
  test("a drawing that fails serves the poster", async () => {
    const d = { ...deps('# T\nthumb: band "Hey"\n\n## T\n', []), draw: () => { throw new Error("no"); } };
    expect(new Uint8Array(await (await handleCardRequest(get("/card/c.png"), d)).arrayBuffer())).toEqual(POSTER);
  });
});

test("the line as the app's printer writes it (a quoted YAML string) reads the same", () => {
  const text = '# T\nthumb: "band \\"Twice the odds is not twice the risk\\""\n\n## T\nuse: bar_chart\n';
  expect(castCardText(text).thumb).toBe('band "Twice the odds is not twice the risk"');
});
