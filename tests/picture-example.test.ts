import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { parsePlaylistText, itemsOf } from "../src/playlist/playlist";
import { validateSpec } from "../src/spec/schema";
import { expandSpec } from "../src/spec/expand";

// The picture-regions example cast (docs/examples) must stay loadable: it goes
// through the same parse + validate path the app uses for a pasted document.
describe("picture regions example cast", () => {
  const text = readFileSync("docs/examples/2026-09-30-picture-regions-microdata.yaml", "utf8");
  const playlist = parsePlaylistText(text);
  const items = itemsOf(playlist);

  test("parses to one page without warnings", () => {
    expect(playlist.warnings).toEqual([]);
    expect(items).toHaveLength(1);
  });

  test("validates, and its places all resolve", () => {
    for (const item of items) {
      const res = validateSpec(expandSpec(item.spec));
      expect(res.errors ?? []).toEqual([]);
    }
  });

  test("uses both pictures and every gesture", () => {
    const json = JSON.stringify(items[0].spec.commands);
    for (const k of ['"highlight"', '"focus"', '"camera"', '"point"', "md:command_line", "tools:support_chat"]) expect(json).toContain(k);
  });
});
