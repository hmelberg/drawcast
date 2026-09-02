// Baking narration for publication: what gets synthesized, what gets reused,
// and what a cancelled bake leaves behind.
import { describe, expect, test, vi } from "vitest";
import { bakeNarration, bakeSize, linesToBake, voiceChanges } from "../src/export/bake";
import { speechKey, type SpeakLine } from "../src/render/delivery";

const LINES: SpeakLine[] = [
  { text: "Supply meets demand." },
  { text: "The price settles." },
  { text: "Supply meets demand." }, // a repeat
];

const key = (text: string, extra: Partial<SpeakLine> = {}) => speechKey({ text, ...extra });

/** base64 of n bytes, so sizes in the tests are real. */
const b64 = (n: number) => btoa("x".repeat(n));

describe("linesToBake", () => {
  test("one entry per distinct line — a sentence said twice is synthesized once", () => {
    expect(linesToBake(LINES, {})).toHaveLength(2);
  });

  test("lines already in the existing track are skipped", () => {
    const existing = { [key("Supply meets demand.")]: { mp3: b64(10), ms: 1000 } };
    expect(linesToBake(LINES, existing).map((l) => l.text)).toEqual(["The price settles."]);
  });

  test("an edited line is NOT considered already baked", () => {
    const existing = { [key("Supply meets demand.")]: { mp3: b64(10), ms: 1000 } };
    expect(linesToBake([{ text: "Supply meets demand, roughly." }], existing)).toHaveLength(1);
  });

  test("the same sentence in another voice is its own line", () => {
    const existing = { [key("Supply meets demand.")]: { mp3: b64(10), ms: 1000 } };
    const male: SpeakLine = { text: "Supply meets demand.", gender: "male" };
    expect(linesToBake([male], existing)).toEqual([male]);
  });

  test("a blank line is never sent to the synthesizer", () => {
    expect(linesToBake([{ text: "  " }, { text: "" }], {})).toEqual([]);
  });
});

describe("bakeNarration", () => {
  const synth = (bytes = 30) => vi.fn(async (line: SpeakLine) => b64(bytes + line.text.length));

  test("returns a track keyed by speechKey", async () => {
    const track = await bakeNarration(LINES, { lang: "en", synthesize: synth() }, () => {}, new AbortController().signal);
    expect(Object.keys(track.lines).sort()).toEqual([key("Supply meets demand."), key("The price settles.")].sort());
    expect(track.lang).toBe("en");
  });

  test("the synthesizer is called once per distinct line", async () => {
    const s = synth();
    await bakeNarration(LINES, { lang: "en", synthesize: s }, () => {}, new AbortController().signal);
    expect(s).toHaveBeenCalledTimes(2);
  });

  test("lines already baked are carried over, not re-synthesized", async () => {
    const s = synth();
    const existing = { [key("Supply meets demand.")]: { mp3: b64(99), ms: 4242 } };
    const track = await bakeNarration(LINES, { lang: "en", synthesize: s, existing }, () => {}, new AbortController().signal);
    expect(s).toHaveBeenCalledTimes(1);
    expect(track.lines[key("Supply meets demand.")]).toEqual({ mp3: b64(99), ms: 4242 });
  });

  test("a line dropped from the drawcast does not survive in the track", async () => {
    // Otherwise a document keeps growing with audio for sentences it no longer
    // says, and the reader downloads all of it.
    const existing = { [key("Cut long ago.")]: { mp3: b64(500), ms: 9000 } };
    const track = await bakeNarration(LINES, { lang: "en", synthesize: synth(), existing }, () => {}, new AbortController().signal);
    expect(track.lines[key("Cut long ago.")]).toBeUndefined();
  });

  test("progress is reported per line and ends complete", async () => {
    const seen: [number, number][] = [];
    await bakeNarration(LINES, { lang: "en", synthesize: synth() }, (d, t) => seen.push([d, t]), new AbortController().signal);
    expect(seen[0]).toEqual([0, 2]);
    expect(seen[seen.length - 1]).toEqual([2, 2]);
  });

  test("durations are recorded when a decoder is supplied", async () => {
    const track = await bakeNarration(
      [{ text: "One line." }],
      { lang: "en", synthesize: synth(), durationMs: async () => 1234 },
      () => {},
      new AbortController().signal,
    );
    expect(track.lines[key("One line.")].ms).toBe(1234);
  });

  test("without a decoder the duration is 0 rather than a guess", async () => {
    const track = await bakeNarration([{ text: "One line." }], { lang: "en", synthesize: synth() }, () => {}, new AbortController().signal);
    expect(track.lines[key("One line.")].ms).toBe(0);
  });

  test("a decoder that throws does not lose the clip", async () => {
    const track = await bakeNarration(
      [{ text: "One line." }],
      { lang: "en", synthesize: synth(), durationMs: async () => { throw new Error("bad mp3"); } },
      () => {},
      new AbortController().signal,
    );
    expect(track.lines[key("One line.")].ms).toBe(0);
    expect(track.lines[key("One line.")].mp3.length).toBeGreaterThan(0);
  });

  test("cancelling stops the synthesizer and throws", async () => {
    const ac = new AbortController();
    const s = vi.fn(async (line: SpeakLine) => {
      ac.abort();
      return b64(10 + line.text.length);
    });
    await expect(bakeNarration(LINES, { lang: "en", synthesize: s }, () => {}, ac.signal)).rejects.toThrow(/cancel/i);
    expect(s).toHaveBeenCalledTimes(1);
  });

  test("a drawcast with nothing to say bakes an empty track", async () => {
    const s = synth();
    const track = await bakeNarration([], { lang: "en", synthesize: s }, () => {}, new AbortController().signal);
    expect(track.lines).toEqual({});
    expect(s).not.toHaveBeenCalled();
  });
});

describe("bakeSize", () => {
  test("reports the decoded byte total and the inline cost", () => {
    // What the publish dialog shows before spending anything: base64 is four
    // characters per three bytes, so inlining costs about a third more.
    const track = { lang: "en", lines: { a: { mp3: b64(300), ms: 1 }, b: { mp3: b64(600), ms: 1 } } };
    const size = bakeSize(track);
    expect(size.lines).toBe(2);
    expect(size.bytes).toBe(900);
    expect(size.inlineBytes).toBeGreaterThan(1150);
    expect(size.inlineBytes).toBeLessThan(1250);
  });

  test("an empty track is zero, not NaN", () => {
    expect(bakeSize({ lang: "en", lines: {} })).toEqual({ lines: 0, bytes: 0, inlineBytes: 0, ms: 0 });
  });
});

describe("voice-aware reuse (B12)", () => {
  test("a clip baked in another voice (or before voices existed) is re-baked", () => {
    const line = { text: "The price settles." };
    const key = "|a||The price settles.";
    // Old bake: no voice recorded. New bake wants a named voice → re-synthesize.
    expect(linesToBake([line], { [key]: { mp3: "x", ms: 1 } }, () => "nb-NO-Wavenet-C")).toHaveLength(1);
    // Same voice → reuse.
    expect(linesToBake([line], { [key]: { mp3: "x", ms: 1, voice: "nb-NO-Wavenet-C" } }, () => "nb-NO-Wavenet-C")).toHaveLength(0);
    // Preference removed → the default chain differs from the named clip → re-bake.
    expect(linesToBake([line], { [key]: { mp3: "x", ms: 1, voice: "nb-NO-Wavenet-C" } }, () => undefined)).toHaveLength(1);
    // No voices anywhere (every pre-B12 publish): reuse as before.
    expect(linesToBake([line], { [key]: { mp3: "x", ms: 1 } })).toHaveLength(0);
  });

  test("bakeNarration stamps the voice onto new clips and replaces stale-voiced carryovers", async () => {
    const line = { text: "The price settles." };
    const key = "|a||The price settles.";
    const track = await bakeNarration(
      [line],
      {
        lang: "en",
        existing: { [key]: { mp3: "OLDVOICE", ms: 5, voice: "en-US-Neural2-D" } },
        synthesize: async () => "NEWVOICE",
        voiceOf: () => "en-GB-Neural2-A",
      },
      () => {},
      new AbortController().signal,
    );
    expect(track.lines[key]).toEqual({ mp3: "NEWVOICE", ms: 0, voice: "en-GB-Neural2-A" });
  });
});

describe("voiceChanges — the publish names why it re-buys (2026-09-02)", () => {
  const key = "|a||The price settles.";
  const line = { text: "The price settles." };

  test("a clip in another voice is reported as a re-voicing, aggregated", () => {
    const existing = { [key]: { mp3: "x", ms: 1, voice: "en-US-Studio-Q" } };
    expect(voiceChanges([line, line], existing, () => "en-US-Chirp3-HD-Charon")).toEqual([
      { from: "en-US-Studio-Q", to: "en-US-Chirp3-HD-Charon", count: 1 },
    ]);
  });

  test("matching voices, missing clips, and blank lines report nothing", () => {
    expect(voiceChanges([line], { [key]: { mp3: "x", ms: 1, voice: "v" } }, () => "v")).toEqual([]);
    expect(voiceChanges([line], {}, () => "v")).toEqual([]);
    expect(voiceChanges([{ text: " " }], {}, () => "v")).toEqual([]);
  });

  test("an unstamped clip against a named decision reads as (default) → name", () => {
    expect(voiceChanges([line], { [key]: { mp3: "x", ms: 1 } }, () => "en-US-Studio-Q")).toEqual([
      { from: "(default)", to: "en-US-Studio-Q", count: 1 },
    ]);
  });
});
