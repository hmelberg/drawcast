// Subtitle tracks: the caption, in a language the drawcast was not written in.
//
// A track is a map from SOURCE LINE to translated line — the same shape as
// text_map, and the same shape translateSpec already returns. Deliberately not
// a timestamped sidecar: a drawcast has no fixed timeline (speed, click-
// advance, quiz answers and params all move it), so cues keyed to a clock
// would slide out of step with the drawing on any play but the first. Keyed by
// the line instead, the player looks the translation up at the moment it shows
// the line, and there is no clock left to drift.
//
// Tracks are written ONCE, at authoring time, and travel inside the document.
// Nothing here calls a model, and the standalone viewer — which has no API key
// by design — needs none to show a translated caption.

import { languageLabel } from "../export/tts";
import type { Spec } from "./types";

/** Source line → translated line, for one language. */
export type SubtitleTrack = Record<string, string>;

/** What a drawcast was written in when it does not say. */
export const DEFAULT_SOURCE_LANG = "en";

export interface SubtitleLanguage {
  code: string;
  label: string;
}

/**
 * The line to display. A missing entry falls back to the source: the
 * translator skipped a line, and an untranslated caption is worth having where
 * a blank one is a bug the viewer sees. Blank stays blank — that is the
 * caption between beats, not a lookup failure.
 */
export function translateCaption(line: string, track: SubtitleTrack | undefined): string {
  if (!line || !track) return line;
  return track[line] ?? line;
}

/** The track for `code`, or undefined when that language IS the source. */
export function subtitleTrack(spec: Spec, code: string): SubtitleTrack | undefined {
  if ((spec.lang ?? DEFAULT_SOURCE_LANG) === code) return undefined;
  return spec.subtitles?.[code];
}

/** True when this spec can show its caption in `code`, source language included. */
function speaks(spec: Spec, code: string): boolean {
  return (spec.lang ?? DEFAULT_SOURCE_LANG) === code || spec.subtitles?.[code] !== undefined;
}

/**
 * The languages a CC menu may offer for these items — the source language
 * first, then each track alphabetically by code.
 *
 * A language qualifies only when EVERY item can show it. Half a translated
 * playlist is worse than none: the viewer picks Norwegian, watches two
 * figures, and the third reverts to English with no explanation.
 */
export function subtitleLanguages(specs: Spec[]): SubtitleLanguage[] {
  if (specs.length === 0) return [];
  const source = specs[0].lang ?? DEFAULT_SOURCE_LANG;
  const candidates = new Set<string>([source]);
  for (const spec of specs) {
    candidates.add(spec.lang ?? DEFAULT_SOURCE_LANG);
    for (const code of Object.keys(spec.subtitles ?? {})) candidates.add(code);
  }
  const codes = [...candidates].filter((code) => specs.every((spec) => speaks(spec, code)));
  codes.sort((a, b) => (a === source ? -1 : b === source ? 1 : a.localeCompare(b)));
  return codes.map((code) => ({ code, label: languageLabel(code) }));
}
