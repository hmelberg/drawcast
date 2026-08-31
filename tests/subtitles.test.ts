// Subtitle tracks: what the caption says in a language other than the one the
// drawcast was written in. Source-keyed, exactly like text_map — never
// timestamped, because a drawcast has no fixed timeline (speed, click-advance,
// quiz answers and params all move it). The player looks a line up as it shows
// it, so the track cannot drift out of sync; there is no clock to drift.
import { describe, expect, test } from "vitest";
import { subtitleLanguages, subtitleTrack, translateCaption } from "../src/spec/subtitles";
import type { Spec } from "../src/spec/types";

const spec = (subtitles?: Spec["subtitles"], lang = "en"): Spec =>
  ({ lang, subtitles, elements: [], commands: [] }) as Spec;

describe("translateCaption", () => {
  const track = { "Supply meets demand.": "Tilbud møter etterspørsel." };

  test("returns the translation for a line that has one", () => {
    expect(translateCaption("Supply meets demand.", track)).toBe("Tilbud møter etterspørsel.");
  });

  test("falls back to the source line rather than showing nothing", () => {
    // A missing entry means the translator skipped a line. An English caption
    // is worth having; an empty one is a bug the viewer sees.
    expect(translateCaption("A line nobody translated", track)).toBe("A line nobody translated");
  });

  test("an empty track changes nothing", () => {
    expect(translateCaption("Supply meets demand.", undefined)).toBe("Supply meets demand.");
    expect(translateCaption("Supply meets demand.", {})).toBe("Supply meets demand.");
  });

  test("an empty line stays empty — the caption between beats", () => {
    expect(translateCaption("", track)).toBe("");
  });

  test("matches on the line the player is about to SHOW, after substitution", () => {
    // Captions carry {var} tokens that are interpolated before display. The
    // track is built from the same substituted text, so the key is what the
    // viewer reads, not what the spec stored.
    const t = { "You answered 7.": "Du svarte 7." };
    expect(translateCaption("You answered 7.", t)).toBe("Du svarte 7.");
  });
});

describe("subtitleTrack", () => {
  test("picks the requested language", () => {
    const s = spec({ nb: { Hello: "Hei" }, de: { Hello: "Hallo" } });
    expect(subtitleTrack(s, "de")).toEqual({ Hello: "Hallo" });
  });

  test("the spec's own language has no track — it is the source", () => {
    const s = spec({ nb: { Hello: "Hei" } }, "en");
    expect(subtitleTrack(s, "en")).toBeUndefined();
  });

  test("an unknown language falls through to the source", () => {
    expect(subtitleTrack(spec({ nb: { Hello: "Hei" } }), "fr")).toBeUndefined();
    expect(subtitleTrack(spec(undefined), "nb")).toBeUndefined();
  });
});

describe("subtitleLanguages", () => {
  test("lists the source first, then each track, with labels", () => {
    const s = spec({ nb: { a: "b" }, fr: { a: "c" } }, "en");
    expect(subtitleLanguages([s])).toEqual([
      { code: "en", label: "English" },
      { code: "fr", label: "French" },
      { code: "nb", label: "Norwegian" },
    ]);
  });

  test("a drawcast with no tracks offers only its own language", () => {
    expect(subtitleLanguages([spec(undefined, "nb")])).toEqual([{ code: "nb", label: "Norwegian" }]);
  });

  test("an undeclared source language is called English, the authoring default", () => {
    expect(subtitleLanguages([{ elements: [], commands: [] } as Spec])).toEqual([{ code: "en", label: "English" }]);
  });

  test("a playlist offers a language only when EVERY item can show it", () => {
    // Half a translated playlist is worse than none: the viewer picks Norwegian
    // and the drawcast reverts to English partway through with no explanation.
    const items = [spec({ nb: { a: "b" }, de: { a: "c" } }), spec({ nb: { a: "b" } })];
    expect(subtitleLanguages(items).map((l) => l.code)).toEqual(["en", "nb"]);
  });

  test("items that disagree about the source language offer only what they share", () => {
    const items = [spec({ nb: { a: "b" } }, "en"), spec({ en: { a: "b" } }, "nb")];
    // en: item 1 is the source, item 2 has a track. nb: the mirror image.
    expect(subtitleLanguages(items).map((l) => l.code)).toEqual(["en", "nb"]);
  });
});
