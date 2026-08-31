// Baked audio inside the published document.
//
// It rides as its own document in the multi-document stream, a sibling of the
// {playlist: …} header — never as a field on a spec. That placement is the
// whole safety story: the editor's textarea, the twenty-version history, the
// localStorage library and the prompts sent to the model all carry SPECS, and
// a megabyte of base64 in any of them is a real failure (see the design's
// §15.2). A separate document cannot reach them, because formatPlaylist never
// writes one.
import { describe, expect, test } from "vitest";
import { formatPlaylist, formatPublished, itemsOf, parsePlaylistText } from "../src/playlist/playlist";
import { validateSpec } from "../src/spec/schema";
import type { Spec } from "../src/spec/types";

const SPEC: Spec = {
  title: "Supply and demand",
  elements: [{ id: "a", type: "text", text: "x", x: 1, y: 1 }],
  commands: [{ draw: ["a"], speak: "Supply meets demand." }],
} as Spec;

const AUDIO = {
  lang: "en",
  lines: {
    "|a||Supply meets demand.": { mp3: "SUQzBAAAAAAAI1RTU0UAAAAPAAADTGF2ZjU4Ljc2", ms: 2140 },
  },
};

const playlistOf = (...specs: Spec[]) => ({
  meta: { title: "T", advance: "click" as const, gap: 1, transitions: "auto" as const },
  entries: specs.map((spec) => ({ kind: "item" as const, spec })),
  warnings: [],
});

describe("an {audio: …} document is audio, never a figure", () => {
  const text = formatPublished(playlistOf(SPEC), AUDIO);

  test("it is NOT parsed as a playlist item", () => {
    // classifyDocs' else-branch pushes any unrecognized mapping as a SPEC.
    // Without an explicit branch the audio document becomes a figure with no
    // elements and no commands, which then fails validateSpec and takes the
    // whole drawcast down with it. Loud, but it must not happen at all.
    const playlist = parsePlaylistText(text);
    expect(itemsOf(playlist)).toHaveLength(1);
    expect(itemsOf(playlist)[0].spec.title).toBe("Supply and demand");
  });

  test("every parsed item still validates", () => {
    for (const item of itemsOf(parsePlaylistText(text))) {
      expect(validateSpec(item.spec).errors).toEqual([]);
    }
  });

  test("the audio comes back on the playlist", () => {
    expect(parsePlaylistText(text).audio).toEqual(AUDIO);
  });

  test("a document with no audio simply has none", () => {
    expect(parsePlaylistText(formatPlaylist(playlistOf(SPEC, SPEC), "yaml")).audio).toBeUndefined();
  });

  test("a malformed audio document is ignored with a warning, not a crash", () => {
    const playlist = parsePlaylistText(`{"title":"T","elements":[],"commands":[{"speak":"Hi."}]}\n---\naudio: "not a mapping"\n`);
    expect(playlist.audio).toBeUndefined();
    expect(playlist.warnings.join(" ")).toMatch(/audio/i);
    expect(itemsOf(playlist)).toHaveLength(1);
  });
});

describe("base64 survives the round trip", () => {
  test("byte-identical after dump and load", () => {
    // YAML_OPTS sets lineWidth:-1, so js-yaml will not fold the long scalar
    // across lines. If that ever regressed every payload would be corrupt at
    // once, and silently — the string would still parse, just wrong.
    const long = "A".repeat(300) + "+/=abcXYZ0189" + "B".repeat(300);
    const audio = { lang: "en", lines: { "|a||Long line.": { mp3: long, ms: 9000 } } };
    const back = parsePlaylistText(formatPublished(playlistOf(SPEC), audio));
    expect(back.audio?.lines["|a||Long line."].mp3).toBe(long);
  });

  test("the serialized form really is one unbroken line", () => {
    const long = "Z".repeat(400);
    const text = formatPublished(playlistOf(SPEC), { lang: "en", lines: { k: { mp3: long, ms: 1 } } });
    expect(text).toContain(long);
  });
});

describe("the working document never carries audio", () => {
  test("formatPlaylist emits no audio document even when the playlist has one", () => {
    // This is what makes §15.2 structural rather than a rule to remember: the
    // editor, the history stack and autosave all serialize through here.
    const withAudio = { ...playlistOf(SPEC, SPEC), audio: AUDIO };
    const text = formatPlaylist(withAudio, "yaml");
    expect(text).not.toContain("audio");
    expect(text).not.toContain(AUDIO.lines["|a||Supply meets demand."].mp3);
  });

  test("re-opening a published file drops the audio on the way back out", () => {
    // The repo is meant to be a source you can re-open. Loading keeps the audio
    // for playback; saving must not write it into the library.
    const reopened = parsePlaylistText(formatPublished(playlistOf(SPEC), AUDIO));
    expect(reopened.audio).toBeDefined();
    expect(formatPlaylist(reopened, "yaml")).not.toContain("SUQzBAAA");
  });
});
