// Hooking baked narration up to a mount.
//
// One helper for both hosts (the editor's player and the standalone viewer),
// because getting either half wrong is expensive: play through the wrong
// manager and the baked audio is ignored, prefetch the wrong lines and the
// author pays a TTS call for every sentence already sitting in the document.

import { speechKey, type SpeakLine } from "../render/delivery";
import { inlineClipSource } from "../render/inline-clips";
import { PublishedSpeech } from "../render/published-speech";
import type { SpeechManager } from "../render/speech";
import type { Playlist } from "./playlist";

export interface BakedAudio {
  /** The manager to hand to mountPlaylist. */
  speech: SpeechManager;
  /** Of these lines, the ones with no clip — the only ones worth synthesizing. */
  unbaked(lines: SpeakLine[]): SpeakLine[];
  /** Releases the clips' object URLs. Call before mounting another document. */
  destroy(): void;
}

/**
 * Wrap `inner` for a playlist that carries baked narration; pass it straight
 * through for one that does not, so nothing changes for every drawcast that
 * has no audio.
 */
export function bakedAudioFor(inner: SpeechManager, playlist: Playlist): BakedAudio {
  if (!playlist.audio || Object.keys(playlist.audio.lines).length === 0) {
    return { speech: inner, unbaked: (lines) => lines, destroy: () => {} };
  }
  const clips = inlineClipSource(playlist.audio);
  return {
    speech: new PublishedSpeech(inner, clips),
    // Prefetch is what spends the TTS budget, so a line already baked must not
    // be warmed. The filter is exact rather than approximate: an edited line's
    // key no longer matches, so it is correctly synthesized again, and so is a
    // line baked for a different narrator's voice.
    unbaked: (lines) => lines.filter((line) => !clips.has(speechKey(line))),
    destroy: () => clips.destroy(),
  };
}
