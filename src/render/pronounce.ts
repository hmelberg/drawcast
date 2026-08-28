// How the narrator SAYS a line, which is not always how the caption spells it.
//
// The one case that matters: an acronym is either spelled out ("UN" is "U N",
// "GDP" is "G D P") or said as a word ("QALY", "ICER"), and a speech engine
// has to guess which. Capitals are the signal it guesses from — so the spelled
// kind already comes out right and needs nothing, and only the WORD-LIKE ones
// need marking. Lowercasing them is the whole mechanism: "qaly" is a nonsense
// word, so the engine falls back to letter-to-sound rules and says it.
//
// Chosen over SSML (`<say-as interpret-as="characters">`) for three reasons:
// it needs no format change and so cannot break on an ampersand in the
// narration; it works for the BROWSER voice too, which ignores SSML; and the
// default already handles the larger half of the problem.
//
// This applies at the audio boundary ONLY. The caption keeps its capitals, and
// since the video export burns the caption rather than this string, a viewer
// always READS "QALY" however it is said.

/**
 * Acronyms pronounced as words. Write the base form in capitals; a trailing
 * plural "s" is handled. Everything NOT listed here is left alone, which is
 * the correct treatment for UN, GDP, DNA, ICD, RCT and the rest.
 *
 * Seeded from the health-economics vocabulary this app leans on. A domain
 * pack could contribute its own once this is known to help.
 */
export const SAID_AS_WORD: readonly string[] = ["QALY", "DALY", "ICER", "NICE", "SEIR", "SIR", "PICO", "GRADE"];

const WORDS = SAID_AS_WORD.map((w) => w.toUpperCase());

/**
 * The line as it should be SPOKEN. Pure, so the table can be tested without
 * ever synthesizing a sound.
 */
export function sayable(text: string, words: readonly string[] = WORDS): string {
  if (text === "") return text;
  let out = text;
  for (const w of words) {
    // Whole word only, optional plural s: "QALYs gained" → "qalys gained",
    // but "QALYX" is left alone — it is not the term.
    out = out.replace(new RegExp(`\\b${w}(s?)\\b`, "g"), (_m, s: string) => w.toLowerCase() + s);
  }
  return out;
}
