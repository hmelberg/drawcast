import { describe, expect, test } from "vitest";
import { formatPlaylist, isSingle, parsePlaylistText } from "../src/playlist/playlist";
import { giscusAttributes, giscusContainerAttrs } from "../src/viewer";

// C1: the published file carries the giscus wiring — the viewer runs in a
// stranger's browser and can reach nothing else of the author's.
const COMMENTS = { repoId: "R_kgDOtest", category: "Announcements", categoryId: "DIC_kwDOtest" };

describe("comments in the playlist header", () => {
  test("round-trips through serialize and parse", () => {
    const p = parsePlaylistText("title: T\nelements: []\ncommands: []");
    p.meta.comments = COMMENTS;
    const text = formatPlaylist(p, "yaml");
    expect(parsePlaylistText(text).meta.comments).toEqual(COMMENTS);
  });

  test("a doc with comments always keeps its header — isSingle is false", () => {
    const p = parsePlaylistText("title: T\nelements: []\ncommands: []");
    expect(isSingle(p)).toBe(true);
    p.meta.comments = COMMENTS;
    expect(isSingle(p)).toBe(false);
  });

  test("a malformed comments mapping is ignored with a warning, not fatal", () => {
    const text = 'playlist: {comments: {repoId: 1}}\n---\ntitle: T\nelements: []\ncommands: []';
    const p = parsePlaylistText(text);
    expect(p.meta.comments).toBeUndefined();
    expect(p.warnings.some((w) => w.includes("comments"))).toBe(true);
  });
});

describe("giscusAttributes", () => {
  test("repo from the viewer URL, ids from the file, thread keyed to the file path", () => {
    const attrs = giscusAttributes({ owner: "hmelberg", repo: "kurs", path: "casts/did.yaml" }, COMMENTS);
    expect(attrs["data-repo"]).toBe("hmelberg/kurs");
    expect(attrs["data-repo-id"]).toBe("R_kgDOtest");
    expect(attrs["data-category-id"]).toBe("DIC_kwDOtest");
    expect(attrs["data-mapping"]).toBe("specific");
    expect(attrs["data-term"]).toBe("casts/did.yaml");
    expect(attrs["data-theme"]).toBe("preferred_color_scheme");
  });

  test("an empty category is omitted rather than sent as an empty string", () => {
    const attrs = giscusAttributes({ owner: "o", repo: "r", path: "p.yaml" }, { ...COMMENTS, category: "" });
    expect("data-category" in attrs).toBe(false);
  });
});

describe("giscusContainerAttrs", () => {
  test("the cast's own hash becomes the container id, so a login comes back to it", () => {
    const attrs = giscusContainerAttrs("#gh=hmelberg/dcast/kurs/lecture.yaml");
    expect(attrs.id).toBe("gh=hmelberg/dcast/kurs/lecture.yaml");
    // giscus only reads the id of an element it finds by CLASS.
    expect(attrs.class.split(/\s+/)).toContain("giscus");
    expect(attrs.class.split(/\s+/)).toContain("viewer-comments");
  });

  test("a named cast comes back to its name", () => {
    expect(giscusContainerAttrs("#registerdata-i-praksis").id).toBe("registerdata-i-praksis");
  });

  test("no hash means no id to hand giscus — and then no empty id either", () => {
    const attrs = giscusContainerAttrs("");
    expect("id" in attrs).toBe(false);
    expect(attrs.class).toBe("viewer-comments");
  });
});
