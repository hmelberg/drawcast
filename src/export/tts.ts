// BYOK Google Cloud Text-to-Speech for video export: synthesize narration
// lines to AudioBuffers (MP3 → WebAudio), plus a SpeechManager drop-in that
// plays those buffers through a recordable destination instead of the
// browser's speechSynthesis (whose audio cannot be captured).

import { SpeechManager, detectLang } from "../render/speech";

export interface TtsConfig {
  apiKey: string;
  /** Narration rate preference, mapped to the API's speakingRate. */
  rate: number;
}

/** Per-language voice defaults; if a name drifts out of the catalog, the API picks. */
const VOICES: Record<"en" | "nb", { languageCode: string; name?: string }> = {
  en: { languageCode: "en-US", name: "en-US-Neural2-F" },
  nb: { languageCode: "nb-NO", name: "nb-NO-Wavenet-E" },
};

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

async function synthesizeOne(cfg: TtsConfig, text: string, audioCtx: AudioContext): Promise<AudioBuffer> {
  const voice = VOICES[detectLang(text)];
  const call = (withName: boolean) =>
    fetch(`${ENDPOINT}?key=${encodeURIComponent(cfg.apiKey)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        input: { text },
        voice: withName && voice.name ? { languageCode: voice.languageCode, name: voice.name } : { languageCode: voice.languageCode },
        audioConfig: { audioEncoding: "MP3", speakingRate: Math.min(4, Math.max(0.25, cfg.rate)) },
      }),
    });
  let res = await call(true);
  if (res.status === 400) res = await call(false); // voice-name drift: let the API choose
  if (!res.ok) throw await ttsError(res);
  const { audioContent } = (await res.json()) as { audioContent?: string };
  if (!audioContent) throw new Error("the TTS response carried no audio");
  const bytes = base64ToBytes(audioContent);
  return audioCtx.decodeAudioData(bytes.buffer as ArrayBuffer);
}

/** Synthesize every distinct narration line; sequential to stay far from rate limits. */
export async function synthesizeAll(
  cfg: TtsConfig,
  texts: string[],
  audioCtx: AudioContext,
  onProgress: (done: number, total: number) => void,
  signal: AbortSignal,
): Promise<Map<string, AudioBuffer>> {
  const buffers = new Map<string, AudioBuffer>();
  const distinct = [...new Set(texts)];
  for (const [i, text] of distinct.entries()) {
    if (signal.aborted) throw new Error("export cancelled");
    onProgress(i, distinct.length);
    buffers.set(text, await synthesizeOne(cfg, text, audioCtx));
  }
  onProgress(distinct.length, distinct.length);
  return buffers;
}

/**
 * SpeechManager drop-in for export: `speak` plays the pre-synthesized buffer
 * into the recording destination (and the speakers, so the export is audible)
 * and resolves when it ends — the Player's timing works unchanged.
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

  override speak(text: string, _speedMultiplier: number, signal?: AbortSignal): Promise<void> {
    const buffer = this.buffers.get(text);
    if (!buffer || signal?.aborted) return Promise.resolve();
    return new Promise((resolve) => {
      const src = this.audioCtx.createBufferSource();
      src.buffer = buffer;
      src.connect(this.dest);
      src.connect(this.audioCtx.destination);
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
