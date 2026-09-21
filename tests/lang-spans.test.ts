// `[de:ich]` — a foreign word inside a sentence (Hans, 2026-09-21).
import { describe, expect, test } from "vitest";
import { resolveLangTag, splitLangRuns, stripLangMarks } from "../src/render/lang-spans";
import { LANGUAGES } from "../src/export/tts";

describe("the tag", () => {
  test("a code or an English name, either case", () => {
    expect(resolveLangTag("de")).toBe("de");
    expect(resolveLangTag("DE")).toBe("de");
    expect(resolveLangTag("german")).toBe("de");
    expect(resolveLangTag("German")).toBe("de");
    expect(resolveLangTag(" french ")).toBe("fr");
  });

  // Anyone who has seen a Google voice name reaches for the full tag. Failing
  // it would fail silently: the brackets stay in the narration and the word is
  // read by the wrong voice, with nothing saying why.
  test("a full BCP-47 tag is reduced to its primary subtag", () => {
    expect(resolveLangTag("de-DE")).toBe("de");
    expect(resolveLangTag("fr-FR")).toBe("fr");
    expect(resolveLangTag("nb-NO")).toBe("nb");
    expect(resolveLangTag("xx-YY")).toBeNull();
  });

  // The whole point of resolving rather than pattern-matching: prose has
  // square brackets in it, and eating one would silently corrupt narration.
  test("anything that is not a language drawcast can voice is not a tag", () => {
    expect(resolveLangTag("see")).toBeNull();
    expect(resolveLangTag("sic")).toBeNull();
    expect(resolveLangTag("1")).toBeNull();
    expect(resolveLangTag("")).toBeNull();
    expect(resolveLangTag("klingon")).toBeNull();
  });

  // LANG_NAMES is a deliberate copy of LANGUAGES (the import would close a
  // cycle through render/speech.ts). This is what keeps the copy honest.
  test("every language the voice picker knows is nameable in the notation", () => {
    for (const { code, label } of LANGUAGES) {
      expect(resolveLangTag(code), code).toBe(code);
      // "Chinese (Mandarin)" — the name before any parenthetical qualifier.
      const name = label.replace(/\s*\(.*$/, "");
      expect(resolveLangTag(name), label).toBe(code);
    }
  });
});

describe("splitting a line into runs", () => {
  // Load-bearing: an unmarked line must come back as ONE run holding the
  // original string, or speechKey changes and every baked clip ever made
  // stops matching the line it was made for.
  test("a line with no marker is one run, byte for byte", () => {
    const line = "Nothing foreign here at all.";
    expect(splitLangRuns(line)).toEqual([{ text: line }]);
  });

  test("a marked word becomes its own run, with the language on it", () => {
    expect(splitLangRuns("Here is a German word: [de:ich] — that is all.")).toEqual([
      { text: "Here is a German word:" },
      { text: "ich", lang: "de" },
      { text: "— that is all." },
    ]);
  });

  test("names work as well as codes, and several marks in one line", () => {
    expect(splitLangRuns("The [french:c'est la vie] and the [norwegian:koselig]")).toEqual([
      { text: "The" },
      { text: "c'est la vie", lang: "fr" },
      { text: "and the" },
      { text: "koselig", lang: "nb" },
    ]);
  });

  // A clip whose whole content is "." is a sound nobody asked for, and the
  // stop belongs to the German word's prosody anyway.
  test("punctuation stranded after a mark joins the run before it", () => {
    expect(splitLangRuns("The word is [de:ich].")).toEqual([
      { text: "The word is" },
      { text: "ich.", lang: "de" },
    ]);
  });

  test("a mark at the very start needs no empty run before it", () => {
    expect(splitLangRuns("[de:Ich] bin hier, said the sign.")).toEqual([
      { text: "Ich", lang: "de" },
      { text: "bin hier, said the sign." },
    ]);
  });

  test("brackets that are not a language are left exactly as written", () => {
    const line = "As shown [see: figure 3], the curve bends.";
    expect(splitLangRuns(line)).toEqual([{ text: line }]);
    expect(stripLangMarks(line)).toBe(line);
  });
});

describe("what the caption shows", () => {
  test("the marks are spent, the words stay", () => {
    expect(stripLangMarks("Here is a German word: [de:ich].")).toBe("Here is a German word: ich.");
    expect(stripLangMarks("[french:C'est la vie], as they say.")).toBe("C'est la vie, as they say.");
  });

  test("an unmarked line is untouched", () => {
    expect(stripLangMarks("Plain as day.")).toBe("Plain as day.");
  });

  // The reading-time estimate measures this string. Taken over the raw one it
  // would count the brackets and the tag, and fire every cue in the line late.
  test("stripping is shorter than the source whenever a mark was spent", () => {
    const raw = "Here is a German word: [german:ich].";
    expect(stripLangMarks(raw).length).toBeLessThan(raw.length);
  });
});
