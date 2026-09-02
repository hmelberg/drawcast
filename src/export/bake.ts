// Baking narration for publication: synthesize every line once, here, so that
// nobody who later opens the drawcast has to.
//
// Pure orchestration — the synthesizer is injected, so this is testable without
// a network, a key or an AudioContext, and a future recording booth can supply
// the bytes instead of the TTS API without changing anything below.

import { speechKey, type SpeakLine } from "../render/delivery";
import type { AudioTrack } from "../playlist/playlist";

export interface BakeOptions {
  /** Recorded on the track; informational, and useful when a second language arrives. */
  lang: string;
  /** One line to base64 MP3. Rate is the caller's business — bake at 1.0 and
   *  let the player time-stretch (design §7), or every speed is a new render. */
  synthesize(line: SpeakLine): Promise<string>;
  /** Already-baked lines to reuse rather than pay for again. */
  existing?: AudioTrack["lines"];
  /**
   * The cloud voice `synthesize` WILL use for this line (B12) — undefined for
   * the default chain. Reuse compares it against each existing clip's `voice`,
   * so changing the voice re-bakes instead of mixing old-voice lines in; it
   * must mirror what the synthesizer actually does (tts.ts preferredVoice).
   */
  voiceOf?(line: SpeakLine): string | undefined;
  /** Optional: decode for a real duration. Failing is not fatal. */
  durationMs?(base64: string): Promise<number>;
}

/**
 * The distinct lines that still need synthesizing: deduplicated by speechKey,
 * blanks dropped, and anything already in `existing` skipped.
 *
 * Skipping by key is what makes re-publishing cheap AND correct: an edited line
 * has a different key, so it is synthesized again rather than kept as a
 * recording of words the drawcast no longer says.
 */
export function linesToBake(
  lines: SpeakLine[],
  existing: AudioTrack["lines"],
  voiceOf?: (line: SpeakLine) => string | undefined,
): SpeakLine[] {
  const out = new Map<string, SpeakLine>();
  for (const line of lines) {
    if (line.text.trim().length === 0) continue;
    const key = speechKey(line);
    if (out.has(key)) continue;
    // A clip only counts as already-baked if it was spoken by the voice this
    // bake would use — the reuse key carries the voice (B12).
    const clip = existing[key];
    if (clip && (clip.voice ?? "") === (voiceOf?.(line) ?? "")) continue;
    out.set(key, line);
  }
  return [...out.values()];
}

/**
 * Synthesize what is missing and return the whole track.
 *
 * Sequential, like synthesizeAll, to stay far from rate limits. Cancelling
 * throws rather than returning a partial track: a half-baked drawcast would
 * publish silence for the second half, which is worse than not publishing.
 */
export async function bakeNarration(
  lines: SpeakLine[],
  opts: BakeOptions,
  onProgress: (done: number, total: number) => void,
  signal: AbortSignal,
): Promise<AudioTrack> {
  const existing = opts.existing ?? {};
  const todo = linesToBake(lines, existing, opts.voiceOf);
  const track: AudioTrack = { lang: opts.lang, lines: {} };

  // Carry over only what this drawcast still SAYS. A line cut from the script
  // must not keep its audio in the document, or every republish grows and the
  // reader downloads narration for sentences that no longer exist.
  const wanted = new Set(lines.filter((l) => l.text.trim().length > 0).map(speechKey));
  for (const [key, clip] of Object.entries(existing)) {
    if (wanted.has(key)) track.lines[key] = clip;
  }

  for (const [i, line] of todo.entries()) {
    if (signal.aborted) throw new Error("bake cancelled");
    onProgress(i, todo.length);
    const mp3 = await opts.synthesize(line);
    let ms = 0;
    try {
      ms = (await opts.durationMs?.(mp3)) ?? 0;
    } catch {
      // A duration is a nicety; the clip itself is the point.
    }
    const voice = opts.voiceOf?.(line);
    track.lines[speechKey(line)] = voice ? { mp3, ms, voice } : { mp3, ms };
  }
  onProgress(todo.length, todo.length);
  return track;
}

export interface BakeSize {
  lines: number;
  /** Decoded audio, in bytes. */
  bytes: number;
  /** What inlining costs: base64 is four characters per three bytes. */
  inlineBytes: number;
  ms: number;
}

/** What the publish dialog says before anything is committed. */
export function bakeSize(track: AudioTrack): BakeSize {
  let bytes = 0;
  let inlineBytes = 0;
  let ms = 0;
  const entries = Object.values(track.lines);
  for (const clip of entries) {
    inlineBytes += clip.mp3.length;
    // Undo base64: 4 characters carry 3 bytes, less the padding.
    const padding = clip.mp3.endsWith("==") ? 2 : clip.mp3.endsWith("=") ? 1 : 0;
    bytes += Math.max(0, (clip.mp3.length / 4) * 3 - padding);
    ms += clip.ms;
  }
  return { lines: entries.length, bytes: Math.round(bytes), inlineBytes, ms };
}

/**
 * Which lines a bake would re-synthesize ONLY because the voice changed:
 * clip recorded in one voice, current decision another. Aggregated so the
 * publish can say "re-voicing 312 lines: en-US-Studio-Q → X" BEFORE the
 * spend — a silent re-bake reads as a bug to the author who "didn't change
 * the speech" (an audition pick counts as a change, Hans 2026-09-02).
 */
export function voiceChanges(
  lines: SpeakLine[],
  existing: AudioTrack["lines"],
  voiceOf?: (line: SpeakLine) => string | undefined,
): { from: string; to: string; count: number }[] {
  const agg = new Map<string, number>();
  const seen = new Set<string>();
  for (const line of lines) {
    if (line.text.trim().length === 0) continue;
    const key = speechKey(line);
    if (seen.has(key)) continue;
    seen.add(key);
    const clip = existing[key];
    if (!clip) continue;
    const from = clip.voice ?? "";
    const to = voiceOf?.(line) ?? "";
    if (from === to) continue;
    const k = `${from}\u0000${to}`;
    agg.set(k, (agg.get(k) ?? 0) + 1);
  }
  return [...agg.entries()].map(([k, count]) => {
    const [from, to] = k.split("\u0000");
    return { from: from || "(default)", to: to || "(default)", count };
  });
}
