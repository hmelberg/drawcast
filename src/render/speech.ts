// Web Speech wrapper. Utterance-granularity sync via onend; graceful fallback
// to a reading-time estimate when speech is unavailable or errors. Voices load
// asynchronously (voiceschanged).
//
// Browsers default to poor voices (Firefox/macOS famously lands on a metallic
// one). Unless the user picked a voice explicitly, we score the available
// voices and choose the best match for the utterance's language.

import { DELIVERY, dbToGain, effectiveGender, type SpeakOpts } from "./delivery";

// Gender is not exposed by the Web Speech API — infer it from well-known
// voice names ("Samantha (Enhanced)" matches by prefix). Unknown names stay
// ungendered and only win when no gendered match exists.
const FEMALE_NAMES = ["Samantha", "Karen", "Victoria", "Moira", "Fiona", "Tessa", "Kate", "Serena", "Allison", "Ava", "Susan", "Zoe", "Nora", "Nicky", "Joana", "Martha"];
const MALE_NAMES = ["Daniel", "Alex", "Oliver", "Thomas", "Fred", "Aaron", "Arthur", "Gordon", "Lee", "Rishi", "Jamie", "Henrik"];

function voiceGenderOf(v: SpeechSynthesisVoice): "male" | "female" | null {
  const name = v.name;
  if (FEMALE_NAMES.some((n) => name.startsWith(n))) return "female";
  if (MALE_NAMES.some((n) => name.startsWith(n))) return "male";
  return null;
}

const PREFERRED_NAMES = [
  "Samantha", "Ava", "Allison", "Susan", "Zoe", "Evan", "Nathan", "Joelle", "Aaron",
  "Karen", "Daniel", "Serena", "Moira", "Tessa", "Fiona", "Kate", "Oliver",
  "Nora", "Henrik", // Norwegian system voices
];

// Novelty and legacy voices that sound robotic — never auto-pick these.
const AVOID_NAMES =
  /fred|albert|zarvox|trinoids|whisper|wobble|deranged|hysterical|bad news|bells|boing|bubbles|cellos|jester|organ|superstar|good news|bahh|junior|ralph|kathy|eddy|flo|grandma|grandpa|reed|rocko|sandy|shelley|compact|espeak|eloquence/i;

function scoreVoice(v: SpeechSynthesisVoice, lang: string): number {
  const vLang = v.lang.toLowerCase();
  // Lower-cased on BOTH sides. It never mattered while every language reaching
  // here was a bare primary subtag, already lower case — but a `[cs-CZ:…]` run
  // arrives as a whole locale (render/lang-spans.ts), and "cs-cz" does not
  // start with "cs-CZ", so every voice would have scored -1 and the word would
  // have been read by the narrator with no sign anything was asked for.
  lang = lang.toLowerCase();
  // Norwegian is the one family whose tags genuinely disagree (nb/no/nn all
  // mean the same shelf of voices); every other language matches its own tag.
  const langFamily = lang === "nb" ? ["nb", "no", "nn"] : [lang];
  if (!langFamily.some((l) => vLang.startsWith(l))) return -1;
  let s = 10;
  if (AVOID_NAMES.test(v.name)) return 0; // last resort only
  if (/enhanced|premium|natural|neural|siri/i.test(v.name)) s += 40;
  if (PREFERRED_NAMES.some((n) => v.name.startsWith(n))) s += 25;
  if (/google|microsoft/i.test(v.name)) s += 15;
  if (lang === "en" && vLang.startsWith("en-us")) s += 4;
  if (lang === "nb" && (vLang.startsWith("nb") || vLang.startsWith("no"))) s += 4;
  return s;
}

/**
 * Cheap utterance-language sniff, by weight of evidence: Norwegian function
 * words and words written with æ/ø/å against English function words, English
 * unless Norwegian clearly wins. It used to answer "nb" for ANY æøå, so one
 * Norwegian name — "Bjørn falls ill at 76 and dies at 78." — put an English
 * line in a Norwegian voice (Hans 2026-09-26). A name is one word; a sentence
 * of its language has several function words.
 */
export function detectLang(text: string): "en" | "nb" {
  const words = text.toLowerCase().match(/[a-zæøåéèêóòôü']+/g) ?? [];
  const NB = new Set(["og", "er", "ikke", "det", "som", "en", "et", "ei", "på", "til", "av", "vi", "når", "hvor", "med", "jeg", "du", "han", "hun", "den", "de", "har", "var", "kan", "skal", "vil", "må", "fra", "om", "men", "så", "hva", "hvordan", "hvorfor", "også", "eller", "blir", "ble", "seg", "sin", "mer", "enn", "bare", "nå"]);
  const EN = new Set(["the", "and", "is", "of", "with", "as", "a", "to", "in", "it", "that", "are", "was", "for", "on", "this", "what", "how", "why", "he", "she", "they", "you", "not", "but", "or", "from", "by", "be", "has", "have", "at", "his", "her", "its", "who", "which", "more", "than", "into", "each"]);
  let nb = 0;
  let en = 0;
  for (const w of words) {
    if (NB.has(w)) nb++;
    else if (/[æøå]/.test(w)) nb += 0.5; // a Norwegian spelling: evidence, not proof (names)
    if (EN.has(w)) en++;
  }
  return nb > en ? "nb" : "en";
}

/**
 * The structural contract the Player needs from narration (speak/cancel/
 * pause/resume). SpeechManager and its subclasses satisfy it; host apps
 * embedding the engine (xplainer) pass their own adapter so exactly one TTS
 * pipeline is authoritative.
 */
import { sayable } from "./pronounce";
import { splitLangRuns } from "./lang-spans";

export interface SpeechLike {
  /** Speak one utterance; resolves when it ends (or its fallback wait does). */
  speak(text: string, speedMultiplier: number, signal?: AbortSignal, opts?: SpeakOpts): Promise<void>;
  cancel(): void;
  pause(): void;
  resume(): void;
}

export class SpeechManager {
  private synth: SpeechSynthesis | null;
  private voiceURI: string | null = null;
  /** Protected: CloudSpeech (export/tts.ts) picks its cloud voice by the
   *  same declared language the browser-voice path below uses. */
  protected langHint: string | null = null;
  private rate = 1;
  private mutedFlag = false;
  private listeners: (() => void)[] = [];

  constructor() {
    this.synth = typeof window !== "undefined" && "speechSynthesis" in window ? window.speechSynthesis : null;
    this.synth?.addEventListener?.("voiceschanged", () => {
      this.listeners.forEach((cb) => cb());
    });
  }

  get available(): boolean {
    return this.synth !== null;
  }

  voices(): SpeechSynthesisVoice[] {
    return this.synth?.getVoices() ?? [];
  }

  onVoicesChanged(cb: () => void): void {
    this.listeners.push(cb);
  }

  setVoice(uri: string | null): void {
    this.voiceURI = uri;
  }

  /** What the host configured, so a player-level pick can be undone: choosing
   *  Default must restore the viewer's own Settings voice, not clear it. */
  get voice(): string | null {
    return this.voiceURI;
  }

  /**
   * The viewer picked a specific browser voice, so any richer path — a baked
   * recording, a cloud voice — is not what they asked for and must stand
   * aside. A no-op here because this class IS the browser path; the wrappers
   * that add those paths override it.
   */
  preferBrowserVoice(_on: boolean): void {
    /* nothing richer to stand aside */
  }

  /** The spec's declared language, when it has one; null goes back to sniffing. */
  setLangHint(lang: string | null): void {
    this.langHint = lang;
  }

  /**
   * Highest-scoring voice for a language; null lets the browser default.
   * With a gender, scores only name-matched voices first and falls back to
   * the ungendered scan when none match — no gender is byte-identical to
   * before.
   */
  bestVoice(lang: string, gender?: "male" | "female" | null): SpeechSynthesisVoice | null {
    const voices = this.voices();
    const scan = (pool: SpeechSynthesisVoice[]): SpeechSynthesisVoice | null => {
      let best: SpeechSynthesisVoice | null = null;
      let bestScore = 0;
      for (const v of pool) {
        const s = scoreVoice(v, lang);
        if (s > bestScore) {
          best = v;
          bestScore = s;
        }
      }
      return best;
    };
    if (gender) {
      const gendered = scan(voices.filter((v) => voiceGenderOf(v) === gender));
      if (gendered) return gendered;
    }
    return scan(voices);
  }

  setRate(rate: number): void {
    this.rate = rate;
  }

  /** Muted narration keeps its exact timing (volume 0), unlike silent mode which skips it. */
  setMuted(muted: boolean): void {
    this.mutedFlag = muted;
  }

  get muted(): boolean {
    return this.mutedFlag;
  }

  /** Reading-time estimate (~170 wpm), used for captions when speech can't run. */
  static estimateMs(text: string): number {
    const words = text.trim().split(/\s+/).length;
    return Math.min(15000, Math.max(900, (words / 170) * 60000));
  }

  cancel(): void {
    this.synth?.cancel();
  }

  pause(): void {
    this.synth?.pause();
  }

  resume(): void {
    this.synth?.resume();
  }

  /**
   * Speak one line, run by run.
   *
   * A line is usually one run and this is one call, exactly as before. A line
   * carrying a `[de:ich]` mark is several (render/lang-spans.ts), spoken back
   * to back — the ONLY way to voice a foreign word on either backend, since
   * the Web Speech API has nothing below the utterance and Chirp 3: HD
   * silently drops <lang>. Every layer of the chain inherits this, so the
   * split is written once: subclasses override `speakOne` and receive runs.
   */
  async speak(text: string, speedMultiplier: number, signal?: AbortSignal, opts?: SpeakOpts): Promise<void> {
    // A run already carries its language — re-splitting it would be a no-op,
    // but PublishedSpeech delegates run by run to CloudSpeech, so saying so
    // here keeps that chain from walking the regex three times a line.
    const runs = opts?.lang !== undefined ? [{ text }] : splitLangRuns(text);
    if (runs.length === 1 && runs[0].lang === undefined) return this.speakOne(runs[0].text, speedMultiplier, signal, opts);
    // Several runs: the line starts with the first, and no one run's length is the line's.
    let onStart = opts?.onStart ? () => opts.onStart!(null) : undefined;
    for (const run of runs) {
      if (signal?.aborted) return;
      const first = onStart;
      onStart = undefined;
      await this.speakOne(run.text, speedMultiplier, signal, { ...opts, ...(run.lang !== undefined && { lang: run.lang }), onStart: first && (() => first()) });
    }
  }

  /**
   * Speak ONE run; resolves when it ends. speedMultiplier scales the
   * configured rate. Falls back to a timed wait on error/unavailability.
   */
  protected speakOne(text: string, speedMultiplier: number, signal?: AbortSignal, opts?: SpeakOpts): Promise<void> {
    const d = opts?.delivery ? DELIVERY[opts.delivery] : null;
    const deliveryRate = d?.rate ?? 1;
    const estimate = SpeechManager.estimateMs(text) / (speedMultiplier * deliveryRate);
    if (!this.synth || signal?.aborted) {
      if (!signal?.aborted) opts?.onStart?.(estimate);
      return abortableWait(estimate, signal);
    }
    const synth = this.synth;
    return new Promise<void>((resolve) => {
      let settled = false;
      const done = () => {
        if (settled) return;
        settled = true;
        clearTimeout(watchdog);
        signal?.removeEventListener("abort", onAbort);
        resolve();
      };
      const onAbort = () => {
        synth.cancel();
        done();
      };
      signal?.addEventListener("abort", onAbort);

      // Spoken form only — the caption keeps its capitals (see pronounce.ts).
      const utterance = new SpeechSynthesisUtterance(sayable(text));
      // A run's own `[de:…]` language beats both; a declared language beats a
      // sniff (detectLang can only tell en from nb, so a translated drawcast
      // would otherwise be read by an English voice).
      const lang = opts?.lang ?? this.langHint ?? detectLang(text);
      // …and a foreign run must NOT keep the viewer's explicitly chosen voice:
      // that voice speaks one language, and it is not this run's. Asking for
      // the best voice of the run's language, at the narrator's gender, is the
      // whole feature — a German word said by a German voice of the same sex.
      const explicit = opts?.lang !== undefined ? undefined : this.voices().find((v) => v.voiceURI === this.voiceURI);
      const g = effectiveGender(opts);
      const voice = explicit ?? this.bestVoice(lang, g);
      if (voice) utterance.voice = voice;
      utterance.lang = voice?.lang ?? (lang === "nb" ? "nb-NO" : lang === "en" ? "en-US" : lang);
      utterance.rate = Math.min(4, Math.max(0.25, this.rate * speedMultiplier * deliveryRate));
      utterance.pitch = Math.min(2, Math.max(0, 1 + (d?.pitchSt ?? 0) * 0.06));
      utterance.volume = this.mutedFlag ? 0 : dbToGain(d?.gainDb ?? 0);
      utterance.onend = done;
      utterance.onstart = () => opts?.onStart?.(null);
      utterance.onerror = () => {
        // fall back to the remaining reading-time estimate
        setTimeout(done, estimate);
      };
      // Watchdog: some browsers silently never start; fall back after a grace period.
      let watchdog = setTimeout(() => {
        if (!synth.speaking && !synth.pending) {
          setTimeout(done, estimate);
        } else {
          watchdog = setTimeout(() => done(), estimate * 2.5);
        }
      }, 2500);

      try {
        synth.speak(utterance);
      } catch {
        setTimeout(done, estimate);
      }
    });
  }
}

export function abortableWait(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve();
    const t = setTimeout(() => resolve(), ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(t);
      resolve();
    });
  });
}
