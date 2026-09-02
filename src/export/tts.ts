// BYOK Google Cloud Text-to-Speech for video export: synthesize narration
// lines to AudioBuffers (MP3 → WebAudio), plus a SpeechManager drop-in that
// plays those buffers through a recordable destination instead of the
// browser's speechSynthesis (whose audio cannot be captured).

import { DELIVERY, effectiveGender, speechKey, type SpeakLine, type SpeakOpts } from "../render/delivery";
import { SpeechManager, detectLang } from "../render/speech";
import { sayable } from "../render/pronounce";
import { addTtsChars, ttsBudgetError } from "../store";

export interface TtsConfig {
  apiKey: string;
  /** Narration rate preference, mapped to the API's speakingRate. */
  rate: number;
  /**
   * The spec's declared language. Without it the language is sniffed per line,
   * and detectLang only knows English from Norwegian — so a French narration
   * would be handed to an American voice, fluently mispronounced.
   */
  lang?: string;
  /**
   * B12: the author's per-language cloud-voice preferences (a voice belongs
   * to a language). Applies to the PRIMARY speaker only — dialogue speaker
   * "b" keeps the gender-contrast default, or both voices in an a/b exchange
   * would collapse into one.
   */
  voices?: Record<string, string>;
}

/** The languageCode a Google voice name implies ("nb-NO-Wavenet-C" → "nb-NO"). */
export function voiceLanguageCode(name: string): string {
  return name.split("-").slice(0, 2).join("-");
}

/**
 * The preferred voice NAME for one line, or undefined for the default chain.
 * Exported so the bake's reuse check computes exactly what synthesis will do
 * — the two must never drift, or a republished line keeps the wrong voice.
 */
export function preferredVoice(voices: Record<string, string> | undefined, lang: string, speaker?: string): string | undefined {
  if (!voices || (speaker ?? "a") !== "a") return undefined;
  const name = voices[lang];
  return name && name.length > 0 ? name : undefined;
}

export interface CloudVoiceInfo {
  name: string;
  gender: "female" | "male";
}

/**
 * The cloud catalog for one language, for the pickers (Settings and the CC
 * menu's Voice row). Chirp/Studio/Journey variants are included as they come;
 * the API is the authority on what exists.
 */
export async function listCloudVoices(apiKey: string, languageCode: string): Promise<CloudVoiceInfo[]> {
  const res = await fetch(`https://texttospeech.googleapis.com/v1/voices?languageCode=${encodeURIComponent(languageCode)}&key=${encodeURIComponent(apiKey)}`);
  if (!res.ok) throw await ttsError(res);
  const body = (await res.json()) as { voices?: { name: string; ssmlGender?: string }[] };
  return (body.voices ?? [])
    .map((v) => ({ name: v.name, gender: (v.ssmlGender === "MALE" ? "male" : "female") as "female" | "male" }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** A language drawcast can speak, i.e. one Google has neural voices for. This
 *  list is what the translate picker offers: translating into a language we
 *  cannot narrate would produce a silent video. */
export const LANGUAGES: { code: string; label: string; languageCode: string }[] = [
  { code: "en", label: "English", languageCode: "en-US" },
  { code: "nb", label: "Norwegian", languageCode: "nb-NO" },
  { code: "da", label: "Danish", languageCode: "da-DK" },
  { code: "sv", label: "Swedish", languageCode: "sv-SE" },
  { code: "fi", label: "Finnish", languageCode: "fi-FI" },
  { code: "de", label: "German", languageCode: "de-DE" },
  { code: "nl", label: "Dutch", languageCode: "nl-NL" },
  { code: "fr", label: "French", languageCode: "fr-FR" },
  { code: "es", label: "Spanish", languageCode: "es-ES" },
  { code: "it", label: "Italian", languageCode: "it-IT" },
  { code: "pt", label: "Portuguese", languageCode: "pt-BR" },
  { code: "pl", label: "Polish", languageCode: "pl-PL" },
  { code: "ru", label: "Russian", languageCode: "ru-RU" },
  { code: "tr", label: "Turkish", languageCode: "tr-TR" },
  { code: "ar", label: "Arabic", languageCode: "ar-XA" },
  { code: "hi", label: "Hindi", languageCode: "hi-IN" },
  { code: "ja", label: "Japanese", languageCode: "ja-JP" },
  { code: "ko", label: "Korean", languageCode: "ko-KR" },
  { code: "zh", label: "Chinese (Mandarin)", languageCode: "cmn-CN" },
];

export function languageLabel(code: string): string {
  return LANGUAGES.find((l) => l.code === code)?.label ?? code;
}

export interface VoiceChoice {
  languageCode: string;
  /** A specific catalog voice. Named only where the choice has been listened
   *  to — everywhere else the API picks from languageCode + gender, which is
   *  honest rather than a guessed name that 400s on every call. */
  name?: string;
}

/** Per-language, per-gender voice defaults; if a name drifts out of the catalog, the API picks. */
export const VOICES: Record<string, Record<"female" | "male", VoiceChoice>> = {
  en: { female: { languageCode: "en-US", name: "en-US-Neural2-F" }, male: { languageCode: "en-US", name: "en-US-Neural2-D" } },
  nb: { female: { languageCode: "nb-NO", name: "nb-NO-Wavenet-E" }, male: { languageCode: "nb-NO", name: "nb-NO-Wavenet-B" } },
};

/**
 * The narrator when the spec declares NOTHING — no voice, no gender, no
 * speaker (Hans 2026-09-02: "I want the default voice to be en us studio Q",
 * listened to and chosen by ear). Declared #female/#male and dialogue
 * speakers keep the gendered table above: an authored gender must not be
 * overridden by a default, and a/b contrast survives. NOTE: Studio voices
 * do not support pitch (Google's documented limitation) — synthesizeBase64
 * omits pitch for them.
 */
export const DEFAULT_VOICES: Record<string, VoiceChoice> = {
  en: { languageCode: "en-US", name: "en-US-Studio-Q" },
};

/**
 * The one place that decides which voice speaks a line — the author's
 * per-language pick first, then the undeclared-narrator default, then the
 * gendered table. synthesizeBase64 and the bake's stamp both derive from
 * this, so prediction and synthesis cannot drift.
 */
export function narrationVoice(voices: Record<string, string> | undefined, lang: string, opts?: SpeakOpts): VoiceChoice {
  const pref = preferredVoice(voices, lang, opts?.speaker);
  if (pref) return { languageCode: voiceLanguageCode(pref), name: pref };
  const eff = effectiveGender(opts);
  if (eff === null && DEFAULT_VOICES[lang]) return DEFAULT_VOICES[lang];
  return voiceFor(lang, eff ?? "female");
}

/**
 * What the bake records on a clip (export/bake.ts): the NAMED voice a line
 * is predicted to use, when that name is a deliberate choice (the author's
 * pick, or the undeclared-narrator default) — so changing either re-bakes
 * the affected lines. Gendered-table names stay unstamped, as ever: they
 * are fallback defaults whose drift resolves silently.
 */
export function stampedVoice(voices: Record<string, string> | undefined, lang: string, opts?: SpeakOpts): string | undefined {
  const pref = preferredVoice(voices, lang, opts?.speaker);
  if (pref) return pref;
  return effectiveGender(opts) === null ? DEFAULT_VOICES[lang]?.name : undefined;
}

/** The voice for a language: the listened-to default when there is one, else
 *  the language code alone and let Google choose within the gender. */
export function voiceFor(lang: string, gender: "female" | "male"): VoiceChoice {
  const known = VOICES[lang]?.[gender];
  if (known) return known;
  const entry = LANGUAGES.find((l) => l.code === lang);
  return { languageCode: entry?.languageCode ?? lang };
}

const ENDPOINT = "https://texttospeech.googleapis.com/v1/text:synthesize";

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

async function ttsError(res: Response): Promise<Error> {
  let message = `HTTP ${res.status}`;
  try {
    const body = (await res.json()) as { error?: { message?: string } };
    if (body.error?.message) message = body.error.message;
  } catch {
    /* keep the status text */
  }
  if (res.status === 403 || res.status === 401) {
    message += " — check that the key is valid and the Cloud Text-to-Speech API is enabled for its project.";
  }
  return new Error(message);
}

/**
 * One line, as the base64 MP3 the API itself returns.
 *
 * Split out of synthesizeOne because publishing needs the ENCODED bytes, not a
 * decoded buffer: baking spends this string straight into the document (or a
 * file), and re-encoding a decoded buffer would need an MP3 encoder in the
 * browser to get back what the API already sent.
 */
export async function synthesizeBase64(cfg: TtsConfig, text: string, opts?: SpeakOpts): Promise<string> {
  // Soft monthly cap — applies only when the stored key was vended (shared).
  const budget = ttsBudgetError();
  if (budget) throw new Error(budget);
  const g = effectiveGender(opts) ?? "female";
  const lang = cfg.lang ?? detectLang(text);
  const pref = preferredVoice(cfg.voices, lang, opts?.speaker);
  const voice = narrationVoice(cfg.voices, lang, opts);
  // Studio voices reject pitch (documented); dropping it beats a 400 that
  // would silently swap the voice via the no-name fallback below.
  const pitchOk = !(voice.name ?? "").includes("Studio");
  const delivery = opts?.delivery ? DELIVERY[opts.delivery] : null;
  const call = (withName: boolean) =>
    fetch(`${ENDPOINT}?key=${encodeURIComponent(cfg.apiKey)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        // The SPOKEN form: an acronym said as a word is lowercased here and
        // nowhere else, so the caption (and the movie's burned-in text) keeps
        // its capitals. detectLang and the cache key still see the original.
        input: { text: sayable(text) },
        voice:
          withName && voice.name
            ? { languageCode: voice.languageCode, name: voice.name }
            : { languageCode: voice.languageCode, ssmlGender: g === "male" ? "MALE" : "FEMALE" },
        audioConfig: {
          audioEncoding: "MP3",
          speakingRate: Math.min(4, Math.max(0.25, cfg.rate * (delivery ? delivery.rate : 1))),
          ...(delivery ? { ...(pitchOk ? { pitch: delivery.pitchSt } : {}), volumeGainDb: delivery.gainDb } : {}),
        },
      }),
    });
  let res = await call(true);
  // Voice-name drift on OUR defaults: silently let the API choose. But an
  // explicitly PREFERRED voice must never silently substitute — the bake
  // stamps clips with the predicted voice (export/bake.ts), so a silent
  // fallback would label a default-voice clip with the preferred name and
  // the reuse check would keep the wrong recording on every republish
  // (final review 2026-09-02). Fail loudly; the author re-picks.
  if (res.status === 400 && !pref) res = await call(false);
  else if (res.status === 400 && pref) throw new Error(`the voice "${pref}" was rejected by the API — pick a different ${lang} voice in Settings → Playback`);
  if (!res.ok) throw await ttsError(res);
  const { audioContent } = (await res.json()) as { audioContent?: string };
  if (!audioContent) throw new Error("the TTS response carried no audio");
  addTtsChars(text.length);
  return audioContent;
}

export async function synthesizeOne(cfg: TtsConfig, text: string, audioCtx: AudioContext, opts?: SpeakOpts): Promise<AudioBuffer> {
  const bytes = base64ToBytes(await synthesizeBase64(cfg, text, opts));
  return audioCtx.decodeAudioData(bytes.buffer as ArrayBuffer);
}

/** Synthesize every distinct narration line (keyed by speechKey); sequential to stay far from rate limits. */
export async function synthesizeAll(
  cfg: TtsConfig,
  lines: SpeakLine[],
  audioCtx: AudioContext,
  onProgress: (done: number, total: number) => void,
  signal: AbortSignal,
): Promise<Map<string, AudioBuffer>> {
  const buffers = new Map<string, AudioBuffer>();
  const distinct = new Map<string, SpeakLine>();
  for (const line of lines) if (!distinct.has(speechKey(line))) distinct.set(speechKey(line), line);
  const entries = [...distinct.entries()];
  for (const [i, [key, line]] of entries.entries()) {
    if (signal.aborted) throw new Error("export cancelled");
    onProgress(i, entries.length);
    buffers.set(key, await synthesizeOne(cfg, line.text, audioCtx, line));
  }
  onProgress(entries.length, entries.length);
  return buffers;
}

/**
 * SpeechManager for LIVE playback with cloud voices: synthesizes lines on
 * demand (cached per rate for the session), plays them through WebAudio with
 * live mute and real pause/resume, and falls back to the browser's
 * speechSynthesis whenever no key is set or a cloud call fails.
 */
export class CloudSpeech extends SpeechManager {
  private getKey: () => string;
  /** B12: live per-language voice preferences, read fresh per line so a pick applies at once. */
  private getVoices: () => Record<string, string>;
  private audioCtx: AudioContext | null = null;
  private gain: GainNode | null = null;
  private baseRate = 1;
  private cache = new Map<string, AudioBuffer>();
  private pending = new Map<string, Promise<AudioBuffer>>();
  private active = new Set<AudioBufferSourceNode>();

  constructor(getKey: () => string, getVoices: () => Record<string, string> = () => ({})) {
    super();
    this.getKey = getKey;
    this.getVoices = getVoices;
  }

  override setRate(rate: number): void {
    super.setRate(rate);
    this.baseRate = rate;
  }

  override setMuted(muted: boolean): void {
    super.setMuted(muted);
    if (this.gain) this.gain.gain.value = muted ? 0 : 1; // applies mid-line
  }

  private ensureCtx(): AudioContext {
    if (!this.audioCtx) {
      this.audioCtx = new AudioContext();
      this.gain = this.audioCtx.createGain();
      this.gain.gain.value = this.muted ? 0 : 1;
      this.gain.connect(this.audioCtx.destination);
    }
    return this.audioCtx;
  }

  private effRate(speedMultiplier: number): number {
    return Math.min(4, Math.max(0.25, this.baseRate * speedMultiplier));
  }

  private buffer(text: string, rate: number, audioCtx: AudioContext, opts?: SpeakOpts): Promise<AudioBuffer> {
    const voices = this.getVoices();
    // The pick is part of the cache key: changing the voice mid-session must
    // not replay lines recorded in the old one.
    const pref = preferredVoice(voices, detectLang(text), opts?.speaker) ?? "";
    const key = `${pref}|${rate.toFixed(2)}|${speechKey({ text, speaker: opts?.speaker, delivery: opts?.delivery, gender: opts?.gender })}`;
    const hit = this.cache.get(key);
    if (hit) return Promise.resolve(hit);
    const inFlight = this.pending.get(key);
    if (inFlight) return inFlight;
    const p = synthesizeOne({ apiKey: this.getKey(), rate, voices }, text, audioCtx, opts)
      .then((b) => {
        this.cache.set(key, b);
        this.pending.delete(key);
        return b;
      })
      .catch((err: unknown) => {
        this.pending.delete(key);
        throw err;
      });
    this.pending.set(key, p);
    return p;
  }

  /** Warm the cache for upcoming lines (fire-and-forget; errors surface at speak time). */
  prefetch(lines: SpeakLine[], speedMultiplier: number): void {
    if (this.forceBrowser || !this.getKey()) return;
    const audioCtx = this.ensureCtx();
    const rate = this.effRate(speedMultiplier);
    for (const line of lines) void this.buffer(line.text, rate, audioCtx, line).catch(() => undefined);
  }

  /** The viewer chose a specific browser voice; the cloud is not what they asked for. */
  private forceBrowser = false;

  override preferBrowserVoice(on: boolean): void {
    this.forceBrowser = on;
  }

  override speak(text: string, speedMultiplier: number, signal?: AbortSignal, opts?: SpeakOpts): Promise<void> {
    if (this.forceBrowser || !this.getKey()) return super.speak(text, speedMultiplier, signal, opts);
    const audioCtx = this.ensureCtx();
    // Prefetch may have created the context before any user gesture (autoplay
    // policy leaves it suspended); speak runs inside the play click, so resume.
    if (audioCtx.state === "suspended") void audioCtx.resume();
    return this.buffer(text, this.effRate(speedMultiplier), audioCtx, opts)
      .then(
        (buffer) =>
          new Promise<void>((resolve) => {
            if (signal?.aborted) return resolve();
            const src = audioCtx.createBufferSource();
            src.buffer = buffer;
            src.connect(this.gain!);
            this.active.add(src);
            let settled = false;
            const done = () => {
              if (settled) return;
              settled = true;
              this.active.delete(src);
              resolve();
            };
            src.onended = done;
            signal?.addEventListener("abort", () => {
              try {
                src.stop();
              } catch {
                /* already stopped */
              }
              done();
            });
            src.start();
          }),
      )
      .catch(() => super.speak(text, speedMultiplier, signal, opts)); // cloud hiccup → browser voice
  }

  override cancel(): void {
    super.cancel();
    for (const src of this.active) {
      try {
        src.stop();
      } catch {
        /* already stopped */
      }
    }
    this.active.clear();
    if (this.audioCtx?.state === "suspended") void this.audioCtx.resume();
  }

  override pause(): void {
    super.pause();
    if (this.audioCtx?.state === "running") void this.audioCtx.suspend();
  }

  override resume(): void {
    super.resume();
    if (this.audioCtx?.state === "suspended") void this.audioCtx.resume();
  }
}

/**
 * SpeechManager drop-in for export: `speak` plays the pre-synthesized buffer
 * into the recording destination ONLY — the export records silently, nothing
 * reaches the speakers — and resolves when it ends, so the Player's timing
 * works unchanged.
 */
export class BufferSpeech extends SpeechManager {
  private audioCtx: AudioContext;
  private dest: MediaStreamAudioDestinationNode;
  private buffers: Map<string, AudioBuffer>;
  private active = new Set<AudioBufferSourceNode>();

  constructor(audioCtx: AudioContext, dest: MediaStreamAudioDestinationNode, buffers: Map<string, AudioBuffer>) {
    super();
    this.audioCtx = audioCtx;
    this.dest = dest;
    this.buffers = buffers;
  }

  /** Keeps the Player from touching window.speechSynthesis (pause/resume). */
  override get available(): boolean {
    return false;
  }

  override cancel(): void {
    for (const src of this.active) {
      try {
        src.stop();
      } catch {
        /* already stopped */
      }
    }
    this.active.clear();
  }

  override speak(text: string, _speedMultiplier: number, signal?: AbortSignal, opts?: SpeakOpts): Promise<void> {
    const buffer = this.buffers.get(speechKey({ text, speaker: opts?.speaker, delivery: opts?.delivery, gender: opts?.gender }));
    if (!buffer || signal?.aborted) return Promise.resolve();
    return new Promise((resolve) => {
      const src = this.audioCtx.createBufferSource();
      src.buffer = buffer;
      src.connect(this.dest);
      this.active.add(src);
      let settled = false;
      const done = () => {
        if (settled) return;
        settled = true;
        this.active.delete(src);
        resolve();
      };
      src.onended = done;
      signal?.addEventListener("abort", () => {
        try {
          src.stop();
        } catch {
          /* already stopped */
        }
        done();
      });
      src.start();
    });
  }
}
