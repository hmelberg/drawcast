import { describe, expect, test } from "vitest";
import { captionsMultipart, chunkRanges, contentRange, videoResource } from "../src/google/youtube";

describe("chunkRanges", () => {
  test("a file smaller than one chunk is a single range covering all of it", () => {
    expect(chunkRanges(100, 1000)).toEqual([{ start: 0, end: 100 }]);
  });

  test("a file exactly one chunk long is ONE range, not two", () => {
    expect(chunkRanges(1000, 1000)).toEqual([{ start: 0, end: 1000 }]);
  });

  test("one byte over a chunk produces a second, one-byte range", () => {
    expect(chunkRanges(1001, 1000)).toEqual([
      { start: 0, end: 1000 },
      { start: 1000, end: 1001 },
    ]);
  });

  test("three chunks with a partial tail", () => {
    expect(chunkRanges(2500, 1000)).toEqual([
      { start: 0, end: 1000 },
      { start: 1000, end: 2000 },
      { start: 2000, end: 2500 },
    ]);
  });

  test("an empty blob yields no ranges rather than a zero-length request", () => {
    expect(chunkRanges(0, 1000)).toEqual([]);
  });
});

describe("contentRange", () => {
  test("is inclusive of the last byte, as the HTTP header requires", () => {
    // end is EXCLUSIVE in our ranges but INCLUSIVE in the header — off by one
    // here means every upload fails on the first chunk.
    expect(contentRange(0, 1000, 2500)).toBe("bytes 0-999/2500");
    expect(contentRange(2000, 2500, 2500)).toBe("bytes 2000-2499/2500");
  });
});

describe("videoResource", () => {
  test("declares the narration language, which is what lets YouTube translate the caption track", () => {
    expect(videoResource({ title: "Kurven", description: "Laget med drawcast.", privacyStatus: "public", language: "nb" })).toEqual({
      snippet: { title: "Kurven", description: "Laget med drawcast.", defaultLanguage: "nb", defaultAudioLanguage: "nb" },
      status: { privacyStatus: "public" },
    });
  });
});

describe("captionsMultipart", () => {
  const part = captionsMultipart({ videoId: "abc123", language: "nb", name: "drawcast" }, "WEBVTT\n\n00:00:00.000 --> 00:00:01.000\nHei.\n", "BOUND");

  test("declares the boundary it actually uses, so the request and the body agree", () => {
    expect(part.contentType).toBe("multipart/related; boundary=BOUND");
    expect(part.body.startsWith("--BOUND\r\n")).toBe(true);
    expect(part.body.endsWith("\r\n--BOUND--\r\n")).toBe(true);
  });

  test("sends the snippet as JSON and the caption file as its own part, verbatim", () => {
    expect(part.body).toContain('{"snippet":{"videoId":"abc123","language":"nb","name":"drawcast"}}');
    expect(part.body).toContain("Content-Type: text/vtt");
    expect(part.body).toContain("WEBVTT\n\n00:00:00.000 --> 00:00:01.000\nHei.\n");
  });
});
