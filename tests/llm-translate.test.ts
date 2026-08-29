// The model answers with a map, and the map is the only thing we take from it.
// Anything it invents cannot reach the spec, because a key we never sent is a
// key applyTranslations will never look up — the structure is ours, only the
// words are its.

import { describe, expect, test } from "vitest";
import { verifyTranslation } from "../src/llm/translate";
import type { Translatable } from "../src/spec/i18n";

const sent: Translatable[] = [
  { text: "Cost", role: "axis label" },
  { text: "Here is the plane.", role: "narration" },
  { text: "Effect", role: "axis label" },
];

describe("verifyTranslation", () => {
  test("keeps the translations for strings we actually sent", () => {
    const check = verifyTranslation(sent, { Cost: "Kostnad", "Here is the plane.": "Her er planet.", Effect: "Effekt" });
    expect(check.map).toEqual({ Cost: "Kostnad", "Here is the plane.": "Her er planet.", Effect: "Effekt" });
    expect(check.missing).toEqual([]);
    expect(check.unknown).toEqual([]);
  });

  test("drops a key we never sent — an invented string cannot reach the figure", () => {
    const check = verifyTranslation(sent, { Cost: "Kostnad", "Total cost": "Totalkostnad" });
    expect(check.map).toEqual({ Cost: "Kostnad" });
    expect(check.unknown).toEqual(["Total cost"]);
  });

  test("a blank translation counts as missing, never as an instruction to erase the label", () => {
    const check = verifyTranslation(sent, { Cost: "", "Here is the plane.": "   ", Effect: "Effekt" });
    expect(check.map).toEqual({ Effect: "Effekt" });
    expect(check.missing).toEqual(["Cost", "Here is the plane."]);
  });

  test("non-string values are ignored rather than stringified into the figure", () => {
    const check = verifyTranslation(sent, { Cost: 42, Effect: null, "Here is the plane.": "Her er planet." });
    expect(check.map).toEqual({ "Here is the plane.": "Her er planet." });
    expect(check.missing).toEqual(["Cost", "Effect"]);
  });

  test("a reply that is not a map at all leaves everything untranslated instead of throwing", () => {
    const check = verifyTranslation(sent, "sorry, I cannot do that");
    expect(check.map).toEqual({});
    expect(check.missing).toEqual(["Cost", "Here is the plane.", "Effect"]);
  });
});
