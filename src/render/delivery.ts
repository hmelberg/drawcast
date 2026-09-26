// Named prosody deltas for speak commands (spec: delivery hints). One table
// drives BOTH speech backends so live playback and video export sound alike.
// Deterministic by design — no jitter; variation is authored, never random.

export type Delivery = "grave" | "brisk";

export interface SpeakOpts {
  /** Dialogue speaker; "a" (default) is the lead voice, "b" the contrast. */
  speaker?: "a" | "b";
  delivery?: Delivery;
  /** Speaker "a"'s gender (from Spec.voice); "b" gets the opposite. */
  gender?: "male" | "female";
  /**
   * This RUN's language, when a `[de:ich]` mark put it in one of its own
   * (render/lang-spans.ts) — a primary subtag, "de". Absent means the line
   * speaks the document's language, which is every line that carries no mark.
   */
  lang?: string;
  /**
   * Called once, when the voice actually starts, with how long it will speak
   * (ms) when the backend knows — a synthesized buffer, a published clip —
   * or null (a browser voice). The caption pages its chunks against it.
   */
  onStart?: (durationMs: number | null) => void;
}

export interface SpeakLine {
  text: string;
  speaker?: "a" | "b";
  delivery?: Delivery;
  gender?: "male" | "female";
  /** See SpeakOpts.lang — a run split out of the line by a `[de:…]` mark. */
  lang?: string;
}

export const DELIVERY: Record<Delivery, { rate: number; pitchSt: number; gainDb: number }> = {
  grave: { rate: 0.88, pitchSt: 0, gainDb: 0 },
  brisk: { rate: 1.07, pitchSt: 0, gainDb: 0 },
};

/**
 * Canonical cache/buffer key for one spoken line across backends.
 *
 * A language PREFIXES the key rather than joining the fields, and only when
 * there is one. The text is the last field and may itself contain "|", so
 * there is no room to append; and a line with no `[de:…]` mark — which is
 * every line written before 2026-09-21 — must hash to the byte-identical
 * string it always did, or every clip ever baked stops matching its line.
 */
export function speechKey(line: SpeakLine): string {
  const base = `${line.gender ?? ""}|${line.speaker ?? "a"}|${line.delivery ?? ""}|${line.text}`;
  return line.lang ? `@${line.lang}|${base}` : base;
}

export function dbToGain(db: number): number {
  return Math.pow(10, db / 20);
}

/**
 * The gender this line should be voiced in, or null when the caller asked for
 * nothing (legacy path — must keep today's voice pick byte-identical).
 */
export function effectiveGender(opts?: SpeakOpts): "male" | "female" | null {
  if (!opts || (opts.gender === undefined && opts.speaker === undefined)) return null;
  const a = opts.gender ?? "female";
  return (opts.speaker ?? "a") === "a" ? a : a === "male" ? "female" : "male";
}
