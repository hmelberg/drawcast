// Named prosody deltas for speak commands (spec: delivery hints). One table
// drives BOTH speech backends so live playback and video export sound alike.
// Deterministic by design — no jitter; variation is authored, never random.

export type Delivery = "soft" | "grave" | "brisk";

export interface SpeakOpts {
  /** Dialogue speaker; "a" (default) is the lead voice, "b" the contrast. */
  speaker?: "a" | "b";
  delivery?: Delivery;
  /** Speaker "a"'s gender (from Spec.voice); "b" gets the opposite. */
  gender?: "male" | "female";
}

export interface SpeakLine {
  text: string;
  speaker?: "a" | "b";
  delivery?: Delivery;
  gender?: "male" | "female";
}

export const DELIVERY: Record<Delivery, { rate: number; pitchSt: number; gainDb: number }> = {
  soft: { rate: 0.93, pitchSt: -1.5, gainDb: -3 },
  grave: { rate: 0.88, pitchSt: 0, gainDb: 0 },
  brisk: { rate: 1.07, pitchSt: 0, gainDb: 0 },
};

/** Canonical cache/buffer key for one spoken line across backends. */
export function speechKey(line: SpeakLine): string {
  return `${line.gender ?? ""}|${line.speaker ?? "a"}|${line.delivery ?? ""}|${line.text}`;
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
