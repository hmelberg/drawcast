// How the narrator SAYS a line, which is not always how the caption spells it.
//
// The one case that matters: an acronym is either spelled out ("UN" is "U N",
// "GDP" is "G D P") or said as a word ("QALY"), and a speech engine guesses
// which from the capitals. It guesses the SPELLED kind right, so that half
// needs nothing — this table is only the exceptions, and only the ones
// actually listened to.
//
// The respelling, not merely lowercasing, is the point. Measured by Hans on
// 2026-08-29 against Google's neural voices: "qaly" is not it, "qualy" — with
// the u the initialism drops — is the accurate one, and ICER wants a doubled
// e. So an entry is a PHONETIC SPELLING for the engine's letter-to-sound
// rules, arrived at by ear, not a case transform.
//
// Chosen over SSML (`<say-as>`, `<phoneme>`) for three reasons: it needs no
// format change and so cannot break on an ampersand in the narration; it
// works for the BROWSER voice too, which ignores SSML; and the default
// already handles the larger half of the problem.
//
// This applies at the audio boundary ONLY — inside `synthesizeOne` and at
// `new SpeechSynthesisUtterance`. The caption keeps its capitals, and since
// the video export burns the CAPTION rather than this string, a viewer always
// READS "QALY" however it is said.

/**
 * Written form → how to spell it FOR THE ENGINE. A trailing plural "s" rides
 * along on its own ("QALYs" → "qualys"), so list the base form only.
 *
 * Add an entry only after LISTENING to it. Everything absent follows the
 * default, which is correct for UN, GDP, DNA, ICD, RCT — and for the SIR
 * model, whose letters really are spelled out. Candidates worth an ear when
 * they next come up: DALY, NICE, PICO.
 */
export const SAID_AS: Readonly<Record<string, string>> = {
  QALY: "qualy",
  ICER: "iceer",
};

/**
 * The line as it should be SPOKEN. Pure, so the table can be tested — and
 * revised by ear — without ever synthesizing a sound.
 */
export function sayable(text: string, table: Readonly<Record<string, string>> = SAID_AS): string {
  if (text === "") return text;
  let out = text;
  for (const [written, spoken] of Object.entries(table)) {
    // Whole word, optional plural s. Case-sensitive on purpose: the table is
    // about what an ALL-CAPS acronym does, and a respelling already applied
    // must never match again.
    out = out.replace(new RegExp(`\\b${written}(s?)\\b`, "g"), (_m, s: string) => spoken + s);
  }
  return out;
}
