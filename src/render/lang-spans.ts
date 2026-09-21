// A foreign word inside a sentence: `[de:ich]`, `[french:c'est la vie]`.
//
// Hans, 2026-09-21: "It is often the case that we have a sentence in English
// that contains a french, german or norwegian word." Marking one splits the
// line into RUNS, and the marked run is spoken by a voice of that language —
// same gender as the narrator, or the author's own pick for that language if
// Settings has one (export/tts.ts's narrationVoice already resolves per
// language, so this notation is mostly handing it a different argument).
//
// Why a native voice rather than the narrator attempting German: because
// "keep the narrator, pronounce it German" is not reachable on the two paths
// that matter. The Web Speech API has no SSML and no control below the
// utterance, and Google's Chirp 3: HD voices — the ones a Norwegian course is
// baked with — honour only <phoneme>, <p>, <s>, <sub> and <say-as>, SILENTLY
// ignoring <lang>. An unmarked word already gets the narrator reading it with
// its own letter-to-sound rules, so a marker that meant "same voice" would,
// on those voices, mean nothing at all. This one always does something.
//
// Like pronounce.ts, this applies at the AUDIO boundary only: the caption
// shows `ich`, never the brackets (player.ts's setCaption strips them), and
// so does the video export, which burns the caption.

/** One stretch of a line spoken as one utterance / one synthesized clip. */
export interface SpeakRun {
  text: string;
  /** Primary language subtag ("de"), or undefined for the line's own language. */
  lang?: string;
}

/**
 * English names for the languages drawcast can voice, as aliases for their
 * codes — `[german:ich]` reads better than `[de:ich]` when you are writing
 * prose and is just as unambiguous.
 *
 * Deliberately NOT imported from export/tts.ts's LANGUAGES, though it is the
 * same list: tts.ts imports SpeechManager from render/speech.ts, which imports
 * this file, and that cycle would evaluate `class CloudSpeech extends
 * SpeechManager` while SpeechManager was still undefined. A test pins the two
 * lists against each other instead, so drift fails loudly rather than leaving
 * a language nameable in one place and not the other.
 */
const LANG_NAMES: Readonly<Record<string, string>> = {
  english: "en",
  norwegian: "nb",
  danish: "da",
  swedish: "sv",
  finnish: "fi",
  german: "de",
  dutch: "nl",
  french: "fr",
  spanish: "es",
  italian: "it",
  portuguese: "pt",
  polish: "pl",
  russian: "ru",
  turkish: "tr",
  arabic: "ar",
  hindi: "hi",
  japanese: "ja",
  korean: "ko",
  chinese: "zh",
};

/** Every code this notation accepts bare, derived from the names above. */
const LANG_CODES: ReadonlySet<string> = new Set(Object.values(LANG_NAMES));

/**
 * The language a tag names, or null when it names none — and null is the
 * load-bearing half. Ordinary prose has square brackets in it ("[see: figure
 * 3]", "[sic]", a citation), and eating one would be a silent corruption of
 * the narration. Only a tag that resolves to a language drawcast can actually
 * voice is treated as markup; everything else stays literal text.
 */
export function resolveLangTag(tag: string): string | null {
  const t = tag.trim().toLowerCase();
  if (t === "") return null;
  if (LANG_CODES.has(t)) return t;
  if (LANG_NAMES[t]) return LANG_NAMES[t];
  // A full BCP-47 tag is what anyone who has seen Google's voice names will
  // reach for — `[de-DE:ich]`, `[fr-FR:…]` — and rejecting it would fail the
  // silent way: the brackets simply stay in the narration and the word is
  // read by the wrong voice, with nothing anywhere saying why. Reduced to
  // the primary subtag, which is what voiceLang and cloudVoices key on.
  const primary = t.split("-")[0];
  return LANG_CODES.has(primary) ? primary : null;
}

/** `[de:ich]` — the tag, then a colon, then everything up to the first `]`. */
const MARK = /\[([A-Za-z][A-Za-z ()-]*?):\s*([^\][]*)\]/g;

/** Does this run carry anything a voice can say, or is it only punctuation? */
function speakable(text: string): boolean {
  return /[\p{L}\p{N}]/u.test(text);
}

/**
 * The line as runs. A line with no markers returns exactly one run holding
 * the original text — which is what keeps every already-baked clip valid,
 * since speechKey hashes the run's text and nothing else changed.
 */
export function splitLangRuns(text: string): SpeakRun[] {
  MARK.lastIndex = 0;
  const runs: SpeakRun[] = [];
  let at = 0;
  let marked = false;
  const push = (raw: string, lang?: string): void => {
    const t = raw.trim();
    if (t === "") return;
    // Punctuation left stranded by a split — the full stop after `[de:ich]` —
    // joins the run BEFORE it rather than becoming an utterance of its own.
    // It belongs to that run's prosody anyway: "ich." ends the sentence,
    // whereas a clip containing only "." is a sound nobody asked for.
    if (!speakable(t) && runs.length > 0) {
      runs[runs.length - 1].text += t;
      return;
    }
    runs.push(lang === undefined ? { text: t } : { text: t, lang });
  };
  for (let m = MARK.exec(text); m !== null; m = MARK.exec(text)) {
    const lang = resolveLangTag(m[1]);
    if (lang === null) continue; // not markup: "[see: figure 3]" stays put
    marked = true;
    push(text.slice(at, m.index));
    push(m[2], lang);
    at = m.index + m[0].length;
  }
  if (!marked) return [{ text }];
  push(text.slice(at));
  return runs.length > 0 ? runs : [{ text }];
}

/**
 * The line with its markers spent: `[de:ich]` becomes `ich`. What the caption
 * shows, what a subtitle track is keyed on after translation, and what the
 * reading-time estimate must measure — an estimate taken over the raw string
 * counts the brackets and fires every cue in the line late.
 */
export function stripLangMarks(text: string): string {
  MARK.lastIndex = 0;
  return text.replace(MARK, (whole, tag: string, inner: string) => (resolveLangTag(tag) === null ? whole : inner));
}
