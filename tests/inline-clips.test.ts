// Playing narration that travelled inside the document.
//
// The decodable half is testable in node; the <audio> element is not, so it is
// kept to a thin shell around these.
import { describe, expect, test } from "vitest";
import { base64ToBytes, bytesToBase64, inlineClipIndex } from "../src/render/inline-clips";

describe("base64 round trip", () => {
  test("bytes survive out and back", () => {
    const bytes = new Uint8Array([0, 1, 2, 250, 251, 255, 128, 64]);
    expect([...base64ToBytes(bytesToBase64(bytes))]).toEqual([...bytes]);
  });

  test("every byte value survives — an MP3 uses all 256", () => {
    const all = new Uint8Array(256).map((_, i) => i);
    expect([...base64ToBytes(bytesToBase64(all))]).toEqual([...all]);
  });

  test("lengths that are not multiples of three are padded correctly", () => {
    for (const n of [1, 2, 3, 4, 5, 100, 1001]) {
      const bytes = new Uint8Array(n).map((_, i) => (i * 7) % 256);
      expect(base64ToBytes(bytesToBase64(bytes)).length).toBe(n);
    }
  });

  test("a large payload does not blow the stack", () => {
    // String.fromCharCode(...bytes) throws on a big spread, and building the
    // string byte by byte makes Firefox report "too much recursion" on a rope
    // thousands deep — the same trap publish/github.ts documents. Chunked.
    const big = new Uint8Array(300_000).map((_, i) => i % 256);
    expect(base64ToBytes(bytesToBase64(big)).length).toBe(300_000);
  });
});

describe("inlineClipIndex", () => {
  const track = {
    lang: "en",
    lines: {
      "|a||Supply meets demand.": { mp3: bytesToBase64(new Uint8Array([1, 2, 3])), ms: 2140 },
      "|a||The price settles.": { mp3: bytesToBase64(new Uint8Array([4, 5])), ms: 900 },
    },
  };

  test("decodes each line once, keyed by its speechKey", () => {
    const index = inlineClipIndex(track);
    expect(index.size).toBe(2);
    expect([...index.get("|a||Supply meets demand.")!.bytes]).toEqual([1, 2, 3]);
    expect(index.get("|a||The price settles.")!.ms).toBe(900);
  });

  test("a line whose base64 is corrupt is dropped, not fatal", () => {
    // A dropped line falls through to live speech (PublishedSpeech), which is
    // the whole point of the fallback: one bad clip must not silence the rest.
    const index = inlineClipIndex({ lang: "en", lines: { good: track.lines["|a||The price settles."], bad: { mp3: "!!!not base64!!!", ms: 1 } } });
    expect(index.has("good")).toBe(true);
    expect(index.has("bad")).toBe(false);
  });

  test("an empty track yields an empty index rather than throwing", () => {
    expect(inlineClipIndex({ lang: "en", lines: {} }).size).toBe(0);
  });
});
