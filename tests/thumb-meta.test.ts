// The cast header's `thumb:` line survives open and save (thumbnail round, 2026-10-04).
import { expect, test } from "vitest";
import { formatPlaylist, parsePlaylistText } from "../src/playlist/playlist";

const TEXT = '# The deadliest animal\nsubtitle: "Guess."\nformat: quiz\nthumb: band "It\'s not the shark" stamp "MYTH?" star\n\n## The deadliest animal\n    text t "Hi" x 500 y 400\n\nHello there.\n    draw t\n';
const LINE = 'band "It\'s not the shark" stamp "MYTH?" star';

test("a .cast's thumb line is read and written back, in both formats", () => {
  const pl = parsePlaylistText(TEXT);
  expect(pl.meta.thumb).toBe(LINE);
  expect(parsePlaylistText(formatPlaylist(pl, "script")).meta.thumb).toBe(LINE);
  expect(parsePlaylistText(formatPlaylist(pl, "yaml")).meta.thumb).toBe(LINE);
});

test("the first round's block reads as a line", () => {
  const pl = parsePlaylistText(TEXT.replace(`thumb: ${LINE}`, 'thumb:\n    style: strip\n    headline: "Hey"\n    character: surprised'));
  expect(pl.meta.thumb).toBe('band "Hey" surprised');
});

test("cast.mjs pack writes the line into the header", async () => {
  const { packedCastText } = await import("../scripts/cast-account.mjs");
  const { singlePlaylist } = await import("../src/playlist/playlist");
  const { formatSpec } = await import("../src/spec/text");
  const spec = { title: "T", elements: [{ id: "t", type: "text", text: "Hi", x: 500, y: 400 }], commands: [{ draw: ["t"], speak: "Hello there." }] };
  const out = packedCastText({ spec, thumb: 'band "Hey" star' }, "script", { singlePlaylist, formatPlaylist, formatSpec } as never);
  expect(parsePlaylistText(out).meta.thumb).toBe('band "Hey" star');
});
