// The front page's two header fields (2026-10-03): `tags:` and `format:`.
import { describe, expect, test } from "vitest";
import { formatPublished, parsePlaylistText, readTags } from "../src/playlist/playlist";

const script = '# Herd\nsubtitle: "Why"\ntags: health, Epidemiology\nformat: quiz\n\n## A\n    text t "Hi" x 100 y 100\n\nHello there.\n    draw t\n';

describe("tags and format in the header", () => {
  test("read from a script header, tags as a clean list", () => {
    const m = parsePlaylistText(script).meta;
    expect(m.tags).toEqual(["health", "epidemiology"]);
    expect(m.format).toBe("quiz");
  });
  test("survive a round trip through script and through YAML", () => {
    const p = parsePlaylistText(script);
    for (const fmt of ["script", "yaml"] as const) {
      const back = parsePlaylistText(formatPublished(p, null, fmt)).meta;
      expect([back.tags, back.format]).toEqual([["health", "epidemiology"], "quiz"]);
    }
  });
  test("a format that is not one of the three is dropped, not kept", () => {
    expect(parsePlaylistText(script.replace("format: quiz", "format: video")).meta.format).toBeUndefined();
  });
  test("readTags: list or comma text; trimmed, lower-cased, deduplicated, at most eight", () => {
    expect(readTags(" A, b ,a,, ")).toEqual(["a", "b"]);
    expect(readTags(["X", 3, "y"])).toEqual(["x", "y"]);
    expect(readTags("1,2,3,4,5,6,7,8,9,10")).toHaveLength(8);
    expect(readTags("")).toBeUndefined();
    expect(readTags(undefined)).toBeUndefined();
  });
});
