import { describe, expect, test } from "vitest";
import { formatPlaylist, isSingle, parsePlaylistText } from "../src/playlist/playlist";

const ITEM = "title: One\nelements: []\ncommands: []\n";

describe("meta.enroll", () => {
  test("reads, keeps a single item from being single, and writes back", () => {
    const text = `playlist:\n  enroll: https://drawcast.anvil.app\n---\n${ITEM}`;
    const p = parsePlaylistText(text);
    expect(p.meta.enroll).toBe("https://drawcast.anvil.app");
    expect(isSingle(p)).toBe(false);
    expect(formatPlaylist(p, "yaml")).toMatch(/enroll: https:\/\/drawcast\.anvil\.app/);
  });
  test("a non-string is ignored", () => {
    const p = parsePlaylistText(`playlist:\n  enroll: 5\n---\n${ITEM}`);
    expect(p.meta.enroll).toBeUndefined();
  });
});
