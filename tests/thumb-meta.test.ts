// The cast header's `thumb:` block survives open and save (thumbnail round, 2026-10-04).
import { expect, test } from "vitest";
import { formatPlaylist, parsePlaylistText as parsePlaylist } from "../src/playlist/playlist";

const TEXT = '# The deadliest animal\nsubtitle: "Guess."\nformat: quiz\nthumb:\n    style: strip\n    headline: "It\'s not the shark"\n    character: surprised\n\n## The deadliest animal\n    text t "Hi" x 500 y 400\n\nHello there.\n    draw t\n';

test("a .cast's thumb block is read and written back", () => {
  const pl = parsePlaylist(TEXT);
  expect(pl.meta.thumb).toEqual({ style: "strip", headline: "It's not the shark", character: "surprised" });
  const again = parsePlaylist(formatPlaylist(pl, "script"));
  expect(again.meta.thumb).toEqual(pl.meta.thumb);
  const yaml = parsePlaylist(formatPlaylist(pl, "yaml"));
  expect(yaml.meta.thumb).toEqual(pl.meta.thumb);
});

test("a bad thumb block is dropped, never a broken document", () => {
  const pl = parsePlaylist(TEXT.replace("style: strip", "style: glitter").replace("character: surprised", "character: clown"));
  expect(pl.meta.thumb).toEqual({ headline: "It's not the shark" });
});
