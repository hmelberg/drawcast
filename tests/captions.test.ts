import { describe, expect, test } from "vitest";
import { CaptionTape, splitLongCues, toVtt } from "../src/export/captions";

describe("CaptionTape", () => {
  test("a caption spanning a paused stretch is timed by recorded time, not wall clock", () => {
    const tape = new CaptionTape();
    tape.tick(1000, true, "Hello");
    tape.tick(2000, true, "Hello");
    tape.tick(9000, false, "Hello"); // tab hidden: the recorder is paused, wall clock is not
    tape.tick(10000, false, "Bye");
    tape.tick(11000, true, "Bye");
    expect(tape.finish()).toEqual([
      { text: "Hello", startMs: 0, endMs: 1000 },
      { text: "Bye", startMs: 1000, endMs: 2000 },
    ]);
  });

  test("stretches with no caption are gaps in the track, not empty cues", () => {
    const tape = new CaptionTape();
    tape.tick(0, true, "");
    tape.tick(500, true, "A line.");
    tape.tick(1500, true, "");
    tape.tick(3000, true, "Another.");
    tape.tick(4000, true, "");
    expect(tape.finish()).toEqual([
      { text: "A line.", startMs: 500, endMs: 1500 },
      { text: "Another.", startMs: 3000, endMs: 4000 },
    ]);
  });
});

describe("splitLongCues", () => {
  test("a cue past the limit is split at word boundaries, each part timed by its share of the text", () => {
    expect(splitLongCues([{ text: "aa bb cc dd ee ff gg hh", startMs: 0, endMs: 12000 }], 6000)).toEqual([
      { text: "aa bb cc dd", startMs: 0, endMs: 6000 },
      { text: "ee ff gg hh", startMs: 6000, endMs: 12000 },
    ]);
  });
});

describe("splitLongCues (properties)", () => {
  const long = {
    text: "The area under the curve is the total cost, and that is the number the committee actually argues about.",
    startMs: 4000,
    endMs: 17000,
  };

  test("a cue inside the limit is passed through untouched", () => {
    const short = { text: "A short line.", startMs: 0, endMs: 3000 };
    expect(splitLongCues([short], 6000)).toEqual([short]);
  });

  test("splitting loses no words and keeps the parts contiguous across the original span", () => {
    const parts = splitLongCues([long], 6000);
    expect(parts.map((c) => c.text).join(" ")).toBe(long.text);
    expect(parts[0].startMs).toBe(long.startMs);
    expect(parts[parts.length - 1].endMs).toBe(long.endMs);
    expect(parts.slice(1).map((c) => c.startMs)).toEqual(parts.slice(0, -1).map((c) => c.endMs));
  });

  test("every part of a split cue lands inside the limit", () => {
    for (const cue of splitLongCues([long], 6000)) {
      expect(cue.endMs - cue.startMs).toBeLessThanOrEqual(6000);
    }
  });

  test("a short part gets a short slice: the split is timed by text, not by part count", () => {
    // "aa bb" is 4 characters of 21, so it earns 4/21 of the span — not half of it.
    expect(splitLongCues([{ text: "aa bb ccccccccccccccccc", startMs: 0, endMs: 12000 }], 6000)).toEqual([
      { text: "aa bb", startMs: 0, endMs: 2286 },
      { text: "ccccccccccccccccc", startMs: 2286, endMs: 12000 },
    ]);
  });
});

describe("toVtt", () => {
  test("writes a WEBVTT file with one timed block per cue", () => {
    expect(
      toVtt([
        { text: "A line.", startMs: 500, endMs: 1500 },
        { text: "Another.", startMs: 3000, endMs: 3661500 },
      ]),
    ).toBe(["WEBVTT", "", "00:00:00.500 --> 00:00:01.500", "A line.", "", "00:00:03.000 --> 01:01:01.500", "Another.", ""].join("\n"));
  });

  test("markup characters and stray newlines cannot break the cue structure", () => {
    expect(toVtt([{ text: "cost < 5 & risk\nstays", startMs: 0, endMs: 1000 }])).toContain("cost &lt; 5 &amp; risk stays");
  });
});
