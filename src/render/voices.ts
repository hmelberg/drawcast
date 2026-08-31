// What the Voice menu offers, as a list.
//
// ONE control for both the language spoken and the voice speaking it, because
// a voice belongs to a language. SpeechManager.speak prefers an explicitly
// chosen voice over the language-matched one, so offering "language" and
// "voice" as two controls makes "English words read with Norwegian phonetics"
// reachable in two clicks. Deriving the language from the voice makes that
// combination not exist.
//
// The languages offered are the ones the drawcast has TEXT for — its own, plus
// every subtitle track — because the track is what the voice would read.

import type { SubtitleLanguage } from "../spec/subtitles";

/** The id of the "follow the default chain" option. */
export const DEFAULT_VOICE = "";

export interface VoiceOption {
  /** `${lang}|${voiceURI}`, or DEFAULT_VOICE. */
  id: string;
  label: string;
  /** Group heading; absent on Default and on the cloud entry. */
  lang?: string;
  /** A placeholder row (no voice installed for this language). */
  disabled?: boolean;
}

/** Just the primary subtag: en-GB, en-AU and en-US are all English. */
function primary(tag: string): string {
  return tag.toLowerCase().split(/[-_]/)[0];
}

export interface VoiceOptionArgs {
  /** Languages the drawcast has text for (source first). */
  languages: SubtitleLanguage[];
  voices: { name: string; lang: string; voiceURI: string }[];
  /** Narration is published inside the drawcast. */
  hasBaked?: boolean;
  /** A cloud TTS key is actually present. */
  hasCloud?: boolean;
}

export function voiceOptions(args: VoiceOptionArgs): VoiceOption[] {
  const { languages, voices, hasBaked = false, hasCloud = false } = args;
  const out: VoiceOption[] = [
    {
      id: DEFAULT_VOICE,
      // Naming what Default actually does, so it is a choice rather than a
      // shrug: with baked narration it is the author's recording.
      label: hasBaked ? "Default (published narration)" : hasCloud ? "Default (cloud voice)" : "Default (browser voice)",
    },
  ];
  // No separate "cloud" entry. A cloud key stays part of the DEFAULT chain
  // (baked -> cloud -> browser) and shows in Default's label, but picking it
  // apart from that chain would need its own bypass mode to answer a question
  // almost nobody has: a viewer who has a TTS key AND baked narration and
  // wants the cloud rather than the recording. The two choices that matter are
  // "the chain" and "this browser voice".

  for (const lang of languages) {
    const mine = voices.filter((v) => primary(v.lang) === primary(lang.code));
    if (mine.length === 0) {
      // Said rather than left blank: an empty group reads as a fault in the
      // drawcast, when the truth is that this machine has no such voice.
      out.push({ id: `none:${lang.code}`, label: `${lang.label} — no voice installed`, lang: lang.code, disabled: true });
      continue;
    }
    for (const v of mine) out.push({ id: `${lang.code}|${v.voiceURI}`, label: v.name, lang: lang.code });
  }
  return out;
}

export interface VoiceChoice {
  lang: string;
  voiceURI: string;
}

/** The language and voice an option id names; null for Default. */
export function parseVoiceId(id: string): VoiceChoice | null {
  if (!id || id === DEFAULT_VOICE || id === "cloud" || id.startsWith("none:")) return null;
  // Split ONCE: Chrome's voiceURIs are URLs and Firefox's contain "|", so
  // splitting on every separator would cut one in half and select a voice that
  // does not exist.
  const at = id.indexOf("|");
  if (at < 0) return null;
  return { lang: id.slice(0, at), voiceURI: id.slice(at + 1) };
}
