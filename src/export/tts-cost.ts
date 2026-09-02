// Narration cost estimates (Hans 2026-09-02: "an estimate for the narration
// costs (especially for courses) before we press generate"). Money is spent
// per CHARACTER at Google's per-family rates, decided per line by the same
// narrationVoice() the synthesizer uses — so the estimate prices exactly the
// voices a bake would buy. Estimates only: prices are Google's listed rates
// as of 2026-09, and a republish pays only for lines not already baked.

import { narrationVoice } from "./tts";
import { detectLang } from "../render/speech";
import type { SpeakLine } from "../render/delivery";

/** Google's listed $ per 1M characters, by voice family. */
export const TTS_PRICE_PER_MILLION: Record<string, number> = {
  studio: 160,
  chirp: 30,
  neural2: 16,
  wavenet: 16,
  standard: 4,
};

export function voiceTier(name: string | undefined): string {
  // A gendered fallback with no name lets Google choose — neural-class in
  // practice, so price it as such rather than pretending it is free.
  if (!name) return "neural2";
  const n = name.toLowerCase();
  for (const tier of ["studio", "chirp", "neural2", "wavenet", "standard"]) {
    if (n.includes(tier)) return tier;
  }
  return "neural2";
}

export interface BakeCost {
  chars: number;
  usd: number;
}

/** Price the given (already deduplicated) lines with the current voice picks. */
export function bakeCost(lines: SpeakLine[], voices: Record<string, string> | undefined): BakeCost {
  let chars = 0;
  let usd = 0;
  for (const line of lines) {
    if (line.text.trim().length === 0) continue;
    const tier = voiceTier(narrationVoice(voices, detectLang(line.text), line).name);
    chars += line.text.length;
    usd += (line.text.length * (TTS_PRICE_PER_MILLION[tier] ?? TTS_PRICE_PER_MILLION.neural2)) / 1_000_000;
  }
  return { chars, usd };
}

export function addCosts(costs: BakeCost[]): BakeCost {
  return costs.reduce((a, c) => ({ chars: a.chars + c.chars, usd: a.usd + c.usd }), { chars: 0, usd: 0 });
}

/** "12k characters ≈ $1.83", or "" when there is nothing to speak. */
export function costLabel(c: BakeCost): string {
  if (c.chars === 0) return "";
  const k = c.chars < 1000 ? `${c.chars}` : `${Math.round(c.chars / 1000)}k`;
  const usd = c.usd < 0.005 ? "<$0.01" : `$${c.usd.toFixed(2)}`;
  return `${k} characters ≈ ${usd}`;
}

/**
 * Projected narration for a WHOLE course before it exists: the measured cost
 * of the lectures generated so far, extrapolated to every lecture. With
 * nothing generated yet, a measured typical lecture stands in (11.4k
 * characters — Hans's live 5-part cast, 2026-09-02).
 */
export const TYPICAL_LECTURE_CHARS = 11_400;

export function courseNarrationProjection(doneCosts: BakeCost[], totalLectures: number, voices: Record<string, string> | undefined): BakeCost {
  if (totalLectures <= 0) return { chars: 0, usd: 0 };
  if (doneCosts.length === 0) {
    const sample = "The typical lecture narrates about this many characters of English. ";
    const typical: SpeakLine[] = [{ text: sample.repeat(Math.ceil(TYPICAL_LECTURE_CHARS / sample.length)).slice(0, TYPICAL_LECTURE_CHARS) }];
    const per = bakeCost(typical, voices);
    return { chars: per.chars * totalLectures, usd: per.usd * totalLectures };
  }
  const done = addCosts(doneCosts);
  const scale = totalLectures / doneCosts.length;
  return { chars: Math.round(done.chars * scale), usd: done.usd * scale };
}
