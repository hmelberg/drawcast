// The corner list (spec `more`, Hans 2026-09-29): a "Sources" chip in a
// corner of the stage that opens into the cast's sources and links. The DOM
// half (ui/more.ts) needs a document; the model decides everything it shows.
import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { lintCommands } from "../src/lint/lint";
import { validateSpec } from "../src/spec/schema";
import type { Spec } from "../src/spec/types";
import { moreModel, opensUp } from "../src/ui/more-model";
import { CONTROL_SELECTOR } from "../src/ui/gates";

const spec = (over: Partial<Spec> = {}): Spec =>
  ({
    sources: [
      { id: "seattle", title: "Evidence from Seattle", authors: "Jardim et al.", year: 2017, url: "https://www.nber.org/papers/w23532", finding: "Hours fell" },
      { id: "states", title: "The Effect of Minimum Wages on Low-Wage Jobs", doi: "10.1093/qje/qjz014", image: "https://example.org/cover.png" },
    ],
    elements: [{ id: "claim", type: "text", text: "Jobs?", x: 500, y: 600 }],
    commands: [{ draw: ["claim"] }],
    ...over,
  }) as Spec;

describe("moreModel", () => {
  test("a spec with sources gets the list for free: every source, bottom-right, called Sources", () => {
    const m = moreModel(spec())!;
    expect(m.label).toBe("Sources");
    expect(m.corner).toBe("bottom-right");
    expect(m.open).toBe(false);
    expect(m.entries.map((e) => e.sourceId)).toEqual(["seattle", "states"]);
    const [seattle, states] = m.entries;
    expect(seattle).toMatchObject({ title: "Evidence from Seattle", href: "https://www.nber.org/papers/w23532", byline: "Jardim et al. (2017)", text: "Hours fell", hint: "🌐 nber.org" });
    expect(states).toMatchObject({ href: "https://doi.org/10.1093/qje/qjz014", image: "https://example.org/cover.png" });
    // doi.org says nothing the ↗ does not
    expect(states.hint).toBeUndefined();
  });

  test("no sources and no more: nothing; more: false hides it; more: true is the default", () => {
    expect(moreModel(spec({ sources: undefined }))).toBeNull();
    expect(moreModel(spec({ more: false }))).toBeNull();
    expect(moreModel(spec({ more: true }))?.entries).toHaveLength(2);
  });

  test("items pick and order the sources by id, and add entries that are not sources — then the word is More", () => {
    const m = moreModel(
      spec({ more: { corner: "top-left", items: ["states", { title: "A talk", url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ", text: "Ten minutes" }, "nope"] } }),
    )!;
    expect(m.corner).toBe("top-left");
    expect(m.label).toBe("More");
    expect(m.entries.map((e) => e.title)).toEqual(["The Effect of Minimum Wages on Low-Wage Jobs", "A talk"]);
    // A YouTube link brings its own thumbnail and says it is a video.
    expect(m.entries[1]).toMatchObject({ href: "https://www.youtube.com/watch?v=dQw4w9WgXcQ", image: "https://i.ytimg.com/vi/dQw4w9WgXcQ/default.jpg", hint: "📺 Watch", text: "Ten minutes" });
    expect(m.entries[1].sourceId).toBeUndefined();
  });

  test("an author's label wins; only sources keeps Sources; an entry without a url is read, not clicked", () => {
    expect(moreModel(spec({ more: { label: "Read more" } }))?.label).toBe("Read more");
    expect(moreModel(spec({ more: { items: ["seattle"] } }))?.label).toBe("Sources");
    const m = moreModel(spec({ sources: undefined, more: { items: [{ title: "Ask your GP" }], open: true } }))!;
    expect(m.entries[0].href).toBeNull();
    expect(m.open).toBe(true);
  });

  test("a link that is not http(s) never becomes an href or a picture", () => {
    const m = moreModel(spec({ sources: undefined, more: { items: [{ title: "x", url: "javascript:alert(1)", image: "data:image/png;base64,AA" }] } }))!;
    expect(m.entries[0].href).toBeNull();
    expect(m.entries[0].image).toBeUndefined();
  });

  test("items that name nothing show nothing", () => {
    expect(moreModel(spec({ more: { items: [] } }))).toBeNull();
  });

  test("a bottom corner opens upward, a top corner downward", () => {
    expect(opensUp("bottom-right")).toBe(true);
    expect(opensUp("bottom-left")).toBe(true);
    expect(opensUp("top-right")).toBe(false);
  });
});

describe("validation", () => {
  test("a valid more passes", () => {
    const v = validateSpec(spec({ more: { label: "More", corner: "bottom-left", items: ["seattle", { title: "Guideline", url: "https://www.nice.org.uk/" }], open: false } }));
    expect(v.errors).toEqual([]);
  });
  test("an id in more.items that is not a source is an error", () => {
    expect(validateSpec(spec({ more: { items: ["seattle", "ghost"] } })).errors.join("\n")).toMatch(/more\.items: "ghost" is not in sources/);
  });
  test("a bare url or image is an error, on an item and on a source", () => {
    expect(validateSpec(spec({ more: { items: [{ title: "x", url: "www.example.org" }] } })).errors.join("\n")).toMatch(/more\.items\[0\]: url "www\.example\.org" must be a full http/);
    const src = [{ id: "a", title: "A", image: "cover.png" }];
    expect(validateSpec(spec({ sources: src })).errors.join("\n")).toMatch(/sources\.a: image "cover\.png" must be a full http/);
  });
  test("an unknown corner and an unknown field are refused by the schema", () => {
    expect(validateSpec(spec({ more: { corner: "middle" } as never })).ok).toBe(false);
    expect(validateSpec(spec({ more: { colour: "red" } as never })).ok).toBe(false);
  });
});

describe("lint", () => {
  test("items that leave out a source no element cites are flagged; cited or listed ones are not", () => {
    const issues = lintCommands(spec({ more: { items: ["seattle"] } })).filter((i) => i.rule === "more-list");
    expect(issues.map((i) => i.message).join("\n")).toMatch(/leaves out "states"/);
    const cited = spec({ more: { items: ["seattle"] }, elements: [{ id: "claim", type: "text", text: "Jobs?", x: 500, y: 600, cites: ["states"] }] });
    expect(lintCommands(cited).filter((i) => i.rule === "more-list")).toEqual([]);
    expect(lintCommands(spec()).filter((i) => i.rule === "more-list")).toEqual([]);
  });
  test("items that show nothing are flagged", () => {
    expect(lintCommands(spec({ more: { items: [] } })).some((i) => i.rule === "more-list")).toBe(true);
  });
});

describe("wiring", () => {
  const controls = readFileSync(new URL("../src/ui/controls.ts", import.meta.url), "utf8");
  test("every player mount docks it (app, published viewer and each playlist item go through attachPlayerControls)", () => {
    expect(controls).toMatch(/attachMore\(stage, hd\)/);
  });
  test("a press on it is never the stage's play/pause", () => {
    expect(CONTROL_SELECTOR).toContain(".cs-more");
  });
  test("the stage's capture handlers for links and info cards step aside for it", () => {
    for (const f of ["link-host", "infocard", "inset-zoom", "controls-host"]) {
      expect(readFileSync(new URL(`../src/ui/${f}.ts`, import.meta.url), "utf8"), f).toContain(".cs-more");
    }
  });
});
