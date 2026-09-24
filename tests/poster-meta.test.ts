import { describe, expect, it } from "vitest";
import { formatPlaylist, parsePlaylistText } from "../src/playlist/playlist";
import { buildCastPlan, emptyCastIndex, posterPathFor } from "../src/publish/cast";

// The loading poster (2026-09-24): an author's `poster:` survives every
// format, and publish commits the poster PNG beside the cast.
describe("poster", () => {
  it("the poster: setting round-trips through yaml and script", () => {
    const text = "playlist:\n  title: Bridges\n  poster: https://example.org/b.png\n---\ntitle: One\nelements: []\ncommands: []\n";
    const pl = parsePlaylistText(text);
    expect(pl.meta.poster).toBe("https://example.org/b.png");
    expect(parsePlaylistText(formatPlaylist(pl, "yaml")).meta.poster).toBe("https://example.org/b.png");
    expect(parsePlaylistText(formatPlaylist(pl, "script")).meta.poster).toBe("https://example.org/b.png");
  });

  it("publish puts <slug>.png beside <slug>.yaml, as bytes", () => {
    expect(posterPathFor("casts/bridges.yaml")).toBe("casts/bridges.png");
    const args = { title: "Bridges", text: "x", repo: { owner: "o", repo: "r" }, castsDir: "casts", viewerBase: "https://v", index: emptyCastIndex() };
    const bytes = new Uint8Array([137, 80, 78, 71]);
    const png = buildCastPlan({ ...args, poster: bytes }).files.find((f) => f.path === "casts/bridges.png");
    expect(png?.bytes).toBe(bytes);
    expect(buildCastPlan(args).files.some((f) => f.path.endsWith(".png"))).toBe(false);
  });
});
