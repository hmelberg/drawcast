import { describe, expect, test } from "vitest";
import { formatSpec, parseSpecText } from "../src/spec/text";
import { formatPlaylist, parsePlaylistText, itemsOf } from "../src/playlist/playlist";

describe("format detection", () => {
  test("a YAML spec is still read as YAML", () => {
    const parsed = parseSpecText("elements:\n  - id: a\n    type: text\n    text: hei\n    x: 1\n    'y': 2\ncommands:\n  - draw: [a]\n");
    expect(parsed.format).toBe("yaml");
  });

  test("a spoken line with a colon does not make a script file read as YAML", () => {
    const parsed = parseSpecText("To slags aktører: husholdninger og bedrifter.\n    camera zoom 2\n");
    expect(parsed.format).toBe("script");
  });

  test("JSON is still JSON", () => {
    expect(parseSpecText('{"commands": [{"speak": "hei"}]}').format).toBe("json");
  });

  test("a script round-trips through formatSpec and parseSpecText", () => {
    const text = "# Tittel\n\nHei.\n    camera zoom 2\n";
    const spec = parseSpecText(text).value;
    expect(formatSpec(spec, "script")).toBe(text);
  });
});

describe("playlists in script", () => {
  test("## pages become playlist items", () => {
    const playlist = parsePlaylistText("# Serien\n\n## Første\nHei.\n\n## Andre\nDa.\n");
    expect(itemsOf(playlist)).toHaveLength(2);
  });

  test("formatPlaylist prints them back", () => {
    const text = "# Serien\n\n## Første\nHei.\n\n## Andre\nDa.\n";
    expect(formatPlaylist(parsePlaylistText(text), "script")).toBe(text);
  });

  test("a YAML playlist still parses as before", () => {
    const playlist = parsePlaylistText("playlist:\n  title: Serien\n---\ntitle: Ett\ncommands:\n  - speak: hei\n---\ntitle: To\ncommands:\n  - speak: da\n");
    expect(itemsOf(playlist)).toHaveLength(2);
  });
});

// A lecture's chapters used to be a one-way street: `chapter:` was a line the
// parser understood and the printer never wrote, so the editor — which always
// shows the script form — dropped every chapter the first time a document was
// rendered into it, and a revise then worked from a document that no longer
// had any (Hans, 2026-09-21).
describe("chapters in script", () => {
  const LECTURE = '# Lecture\n\nchapter: Opening\n\n## One\nHei.\n    camera zoom 2\n\nchapter: "Middle: the turn"\n\n## Two\nDa.\n    camera zoom 2\n';

  test("a chapter prints above the page it opens, and comes back where it was", () => {
    const playlist = parsePlaylistText(LECTURE);
    expect(playlist.entries.map((e) => (e.kind === "chapter" ? `chapter:${e.title}` : `item:${e.spec.title}`))).toEqual([
      "chapter:Opening",
      "item:One",
      "chapter:Middle: the turn",
      "item:Two",
    ]);
    expect(formatPlaylist(playlist, "script")).toBe(LECTURE);
  });

  test("a chapter after the last page is not lost either", () => {
    const playlist = parsePlaylistText('## One\nHei.\n    camera zoom 2\n\n## Two\nDa.\n    camera zoom 2\n\nchapter: Coda\n');
    expect(playlist.entries[playlist.entries.length - 1]).toEqual({ kind: "chapter", title: "Coda" });
    expect(parsePlaylistText(formatPlaylist(playlist, "script")).entries).toEqual(playlist.entries);
  });
});
