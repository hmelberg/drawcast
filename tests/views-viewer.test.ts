// The viewer's counting hook. runViewer itself cannot run under the node
// suite (no DOM: h() needs document, and mini-dom has no classList or
// addEventListener), so this guards the wiring by source text — the same
// technique as tests/viewer-packs.test.ts and tests/fullscreen-frame.test.ts.
import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { formatPlaylist, isSingle, parsePlaylistText } from "../src/playlist/playlist";

const viewer = readFileSync(new URL("../src/viewer.ts", import.meta.url), "utf8");
const withoutComments = viewer.replace(/^\s*\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");

describe("the viewer counts views", () => {
  test("it asks the client, rather than growing its own copy of the rules", () => {
    expect(withoutComments).toMatch(/from "\.\/views"/);
    expect(withoutComments).toMatch(/countingEnabled\(playlist\.meta\)/);
  });

  test("counting is gated on the published flag AND on being a GitHub cast", () => {
    // A local file or a Drive link has no published identity to count.
    expect(withoutComments).toMatch(/countingEnabled\(playlist\.meta\)\s*&&\s*req\.gh/);
  });

  test("the count fires before mountPlaylist, not after it", () => {
    // Anchored on the CALL SITE, not the bare identifier: "countingEnabled"
    // alone also matches the import statement at the top of the file, which
    // always precedes everything and would keep this test green even if the
    // call itself were moved after the mount — a false guard on the one
    // ordering property this task exists to get right.
    const counted = withoutComments.indexOf("countingEnabled(playlist.meta)");
    const mounted = withoutComments.indexOf("await mountPlaylist");
    expect(counted).toBeGreaterThan(0);
    expect(counted).toBeLessThan(mounted);
  });

  test("it is never awaited, so a slow endpoint cannot delay the drawing", () => {
    expect(withoutComments).not.toMatch(/await\s+(recordView|readViewCount|showViewCount)/);
  });

  test("the badge lives in a meta row under the figure, not in the title", () => {
    expect(withoutComments).toMatch(/class: "viewer-meta"/);
    const wrap = /h\("div", \{ class: "viewer-wrap" \}([^)]*)\)/.exec(withoutComments);
    expect(wrap).not.toBeNull();
    const order = wrap![1];
    expect(order.indexOf("figureHost")).toBeLessThan(order.indexOf("metaEl"));
  });
});

// The flag has to survive the round trip the published file actually makes:
// set → formatPlaylist → committed YAML → parsePlaylistText in a stranger's
// browser. tests/comments-meta.test.ts is the model; meta.comments needed
// exactly these three guarantees.
describe("meta.views in the playlist header", () => {
  test("round-trips through serialize and parse", () => {
    const p = parsePlaylistText("title: T\nelements: []\ncommands: []");
    p.meta.views = false;
    expect(parsePlaylistText(formatPlaylist(p, "yaml")).meta.views).toBe(false);
  });

  test("a doc that opted out always keeps its header — isSingle is false", () => {
    const p = parsePlaylistText("title: T\nelements: []\ncommands: []");
    expect(isSingle(p)).toBe(true);
    p.meta.views = false;
    // Without this the header is dropped on serialize and the opt-out is lost.
    expect(isSingle(p)).toBe(false);
  });

  test("absent means counting, which is what an old published file has", () => {
    expect(parsePlaylistText("title: T\nelements: []\ncommands: []").meta.views).toBeUndefined();
  });

  test("a non-boolean is ignored with a warning rather than being fatal", () => {
    const p = parsePlaylistText('playlist: {views: "no"}\n---\ntitle: T\nelements: []\ncommands: []');
    expect(p.meta.views).toBeUndefined();
    expect(p.warnings.some((w) => w.includes("views"))).toBe(true);
  });
});

describe("the badge styles", () => {
  const css = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");

  test("the meta row and the count both have rules", () => {
    expect(css).toMatch(/\.viewer-meta\s*\{/);
    expect(css).toMatch(/\.viewer-views\s*\{/);
  });
});
