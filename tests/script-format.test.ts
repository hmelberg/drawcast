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
