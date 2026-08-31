// Speaking from audio baked at publish time.
//
// The engine primitive the whole published-audio design rests on: the player
// can speak from audio it is HANDED, looked up by the sentence. Where the bytes
// came from — inline base64 in the document, or files beside it — lives behind
// ClipSource and is invisible from here.
//
// Looked up by sentence, never by position. A drawcast is not a linear tape: a
// wrong quiz answer can goto back and replay lines, ask/retry repeats until the
// viewer is right, a right answer skips ahead, and skipQuestions drops whole
// steps. An ordered list of clips would desync the moment anyone answered a
// question wrong. speechKey already keys this way, and it is what BufferSpeech
// and synthesizeAll agree on.
//
// The same key carries the safety property for nothing: it contains the text,
// so an edited line simply misses and is spoken live. Audio recorded for old
// words can never be played over new ones.

import { speechKey, type SpeakOpts } from "./delivery";
import { SpeechManager, type SpeechLike } from "./speech";

/** One baked line: the encoded audio, and how long it runs. */
export interface Clip {
  bytes: Uint8Array;
  /** Duration in milliseconds, from the bake. Playback does not need it; the
   *  publish dialog and a corrupt-clip check do. */
  ms: number;
}

/**
 * Where baked clips come from and how they are played. One implementation per
 * delivery mode — inline decodes base64 held in the document; a sidecar one
 * would fetch files — and PublishedSpeech cannot tell them apart.
 */
export interface ClipSource {
  has(key: string): boolean;
  /** Play one clip to completion. Rejecting falls through to live speech. */
  play(key: string, speedMultiplier: number, signal?: AbortSignal): Promise<void>;
  stop(): void;
  setMuted(muted: boolean): void;
}

/**
 * A SpeechManager that plays baked clips and delegates everything else.
 *
 * `inner` is the live chain that already exists — CloudSpeech, which itself
 * falls back to the browser's speechSynthesis. So an unbaked line still speaks,
 * with or without a key, exactly as it does today.
 */
export class PublishedSpeech extends SpeechManager {
  private inner: SpeechLike;
  private clips: ClipSource;

  constructor(inner: SpeechLike, clips: ClipSource) {
    super();
    this.inner = inner;
    this.clips = clips;
  }

  /**
   * False, like BufferSpeech: the Player reads `available` as "the browser
   * synthesizer is what is talking" and pauses/resumes it accordingly. A baked
   * drawcast is not driving it, and saying yes would have the Player pausing
   * something that is not playing.
   */
  override get available(): boolean {
    return false;
  }

  override setMuted(muted: boolean): void {
    super.setMuted(muted);
    this.clips.setMuted(muted);
    // SpeechLike is deliberately minimal (host apps supply their own adapter),
    // so the live chain's mute is forwarded only where it exists.
    (this.inner as Partial<SpeechManager>).setMuted?.(muted);
  }

  override setRate(rate: number): void {
    super.setRate(rate);
    (this.inner as Partial<SpeechManager>).setRate?.(rate);
  }

  override cancel(): void {
    this.clips.stop();
    this.inner.cancel();
  }

  override pause(): void {
    this.inner.pause();
  }

  override resume(): void {
    this.inner.resume();
  }

  /**
   * The viewer picked a specific browser voice, so the baked recording is not
   * what they asked for. Without this, choosing "Samantha" on a drawcast baked
   * in English would keep playing the recording — the clip's key matches,
   * because the TEXT is unchanged — and the pick would look broken.
   */
  private forceBrowser = false;

  override preferBrowserVoice(on: boolean): void {
    this.forceBrowser = on;
    (this.inner as Partial<{ preferBrowserVoice(on: boolean): void }>).preferBrowserVoice?.(on);
  }

  override setVoice(uri: string | null): void {
    super.setVoice(uri);
    // The browser voice is chosen on whichever manager actually reaches
    // speechSynthesis, which is the innermost one.
    (this.inner as Partial<SpeechManager>).setVoice?.(uri);
  }

  override async speak(text: string, speedMultiplier: number, signal?: AbortSignal, opts?: SpeakOpts): Promise<void> {
    if (signal?.aborted) return;
    const key = speechKey({ text, speaker: opts?.speaker, delivery: opts?.delivery, gender: opts?.gender });
    if (!this.forceBrowser && this.clips.has(key)) {
      try {
        await this.clips.play(key, speedMultiplier, signal);
        return;
      } catch {
        // A clip that will not decode or play is a missing clip: fall through
        // and say the line rather than leave a silent gap in the narration.
      }
      if (signal?.aborted) return;
    }
    return this.inner.speak(text, speedMultiplier, signal, opts);
  }
}
