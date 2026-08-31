// Narration that travelled inside the document: decoding it, and playing it.
//
// The ClipSource for inline delivery. Its counterpart for separate audio files
// would differ only in where the bytes come from — PublishedSpeech cannot tell
// them apart, which is what keeps the fallback chain and the staleness
// guarantee common to both.

import type { AudioTrack } from "../playlist/playlist";
import type { Clip, ClipSource } from "./published-speech";

export function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

/**
 * Chunked, for the reason publish/github.ts documents on its own encoder:
 * `String.fromCharCode(...bytes)` throws on a large spread, and appending byte
 * by byte makes Firefox flatten a rope thousands of levels deep — which it
 * reports as "too much recursion", not as a memory error. Narration runs to
 * hundreds of kilobytes, so this is the normal case, not the edge.
 */
export function bytesToBase64(bytes: Uint8Array): string {
  const CHUNK = 0x8000;
  const parts: string[] = [];
  for (let i = 0; i < bytes.length; i += CHUNK) parts.push(String.fromCharCode(...bytes.subarray(i, i + CHUNK)));
  return btoa(parts.join(""));
}

/**
 * Decode a track into clips. A line whose base64 will not decode is DROPPED
 * rather than fatal: a dropped line falls through to live speech, and one bad
 * clip must not silence the rest of the drawcast.
 */
export function inlineClipIndex(track: AudioTrack): Map<string, Clip> {
  const clips = new Map<string, Clip>();
  for (const [key, line] of Object.entries(track.lines)) {
    try {
      clips.set(key, { bytes: base64ToBytes(line.mp3), ms: line.ms });
    } catch {
      /* not decodable — leave it out and let the line speak live */
    }
  }
  return clips;
}

/**
 * Play clips through an <audio> element rather than a WebAudio buffer source.
 *
 * This is what keeps the speed control honest. `AudioBufferSourceNode`'s
 * playbackRate resamples, so 2× is a chipmunk; an HTMLMediaElement with
 * `preservesPitch` time-stretches instead, which is what podcast players and
 * YouTube do. It also makes speed changes instant, where the live path
 * re-synthesizes the whole line at the new rate.
 */
export function inlineClipSource(track: AudioTrack): ClipSource & { destroy(): void } {
  const clips = inlineClipIndex(track);
  const urls = new Map<string, string>();
  let el: HTMLAudioElement | null = null;
  let muted = false;

  const urlFor = (key: string): string => {
    const hit = urls.get(key);
    if (hit) return hit;
    const url = URL.createObjectURL(new Blob([clips.get(key)!.bytes as unknown as BlobPart], { type: "audio/mpeg" }));
    urls.set(key, url);
    return url;
  };

  const element = (): HTMLAudioElement => {
    el ??= new Audio();
    return el;
  };

  return {
    has: (key) => clips.has(key),

    play(key, speedMultiplier, signal) {
      return new Promise<void>((resolve, reject) => {
        if (signal?.aborted) return resolve();
        const audio = element();
        const done = (): void => {
          audio.removeEventListener("ended", onEnd);
          audio.removeEventListener("error", onError);
          signal?.removeEventListener("abort", onAbort);
        };
        const onEnd = (): void => {
          done();
          resolve();
        };
        // Rejecting hands the line back to live speech (PublishedSpeech), so a
        // clip that will not decode is heard rather than skipped.
        const onError = (): void => {
          done();
          reject(new Error(`clip ${key} would not play`));
        };
        const onAbort = (): void => {
          audio.pause();
          done();
          resolve();
        };
        audio.addEventListener("ended", onEnd);
        audio.addEventListener("error", onError);
        signal?.addEventListener("abort", onAbort);
        audio.src = urlFor(key);
        audio.muted = muted;
        // Time-stretch, not resample. Assigning before play() so the first
        // moments of the line are already at the right speed.
        audio.preservesPitch = true;
        audio.playbackRate = Math.min(4, Math.max(0.25, speedMultiplier));
        audio.play().catch(onError);
      });
    },

    stop() {
      el?.pause();
    },

    setMuted(next) {
      muted = next;
      if (el) el.muted = next;
    },

    /** Object URLs outlive the page unless revoked; a playlist mounts many. */
    destroy() {
      el?.pause();
      for (const url of urls.values()) URL.revokeObjectURL(url);
      urls.clear();
    },
  };
}
