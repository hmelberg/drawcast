/**
 * The shape a highlight follows while it is being talked about: three swells,
 * then a hold.
 *
 * The three throbs catch the eye; the hold at full strength is what makes the
 * element readable for the rest of the sentence. The old effect instead
 * repeated a swell until the voice ended — five of them on a median line, ten
 * on a long one — so the element was never plainly on, and since the loop
 * could only stop at a cycle boundary it went on breathing 0.7 s past the
 * voice on average. Here the level is a function of elapsed time alone: the
 * player samples it every frame, so the release starts on the word.
 */

/** One throb. */
export const EMPHASIS_SWELL_MS = 650;
/** When the hold begins — the third throb's own peak, so it never dips back. */
export const EMPHASIS_HOLD_AT_MS = 2.5 * EMPHASIS_SWELL_MS;
/** The fade out, started by the end of the voice. */
export const EMPHASIS_RELEASE_MS = 400;
/** One swell on its own — the answer flash a widget asks for by itself. */
export const EMPHASIS_ONE_SWELL_MS = 1200;
/** The first throb's own peak: the least an emphasis may show before it releases,
 *  so a silent player (or a very short duration) still gets a clean flash at full. */
export const EMPHASIS_FIRST_PEAK_MS = EMPHASIS_SWELL_MS / 2;

/**
 * Intensity 0–1 at `elapsedMs`: three throbs to full whose troughs rise
 * (1/3 after the first, 2/3 after the second), the third running straight on
 * into a hold at full that lasts as long as the voice does.
 *
 * `max` of a ramp and a cosine carrier is the whole trick — the ramp is the
 * floor the throbs never fall back below, which is why the element stays red
 * between them instead of blinking. The hold starts at the third peak rather
 * than at the end of its swell: let the carrier finish and the level would
 * sag to 0.83 and climb back, a fourth little throb nobody asked for.
 */
export function emphasisLevel(elapsedMs: number): number {
  if (elapsedMs >= EMPHASIS_HOLD_AT_MS) return 1;
  const t = Math.max(elapsedMs, 0);
  const ramp = t / (3 * EMPHASIS_SWELL_MS);
  const carrier = 0.5 - 0.5 * Math.cos((2 * Math.PI * t) / EMPHASIS_SWELL_MS);
  return Math.max(ramp, carrier);
}

/** A single swell, 0 → 1 → 0 over `t`, for a one-shot flash with no sentence to hold for. */
export function swellLevel(t: number): number {
  return 0.5 - 0.5 * Math.cos(2 * Math.PI * Math.min(Math.max(t, 0), 1));
}

/** The fade from `from` to nothing, eased, over t 0 → 1. */
export function releaseLevel(from: number, t: number): number {
  const u = Math.min(Math.max(t, 0), 1);
  return from * (0.5 + 0.5 * Math.cos(Math.PI * u));
}

/**
 * glow, circle — everything but pulse: ONE ease-in to full, then the hold.
 * The three throbs read as a tube flickering on (Hans, 2026-09-24: "a cheap
 * neon sign"); pulse keeps them for whoever asks for exactly that.
 */
export const EMPHASIS_EASE_MS = 250;

/** Intensity 0–1 at `elapsedMs` for the eased effects: a cubic ease-out to full, then 1. */
export function easeInLevel(elapsedMs: number): number {
  const u = Math.min(Math.max(elapsedMs / EMPHASIS_EASE_MS, 0), 1);
  return 1 - Math.pow(1 - u, 3);
}

/** How long a glow's band or marker takes to be written on, left to right. */
export const EMPHASIS_WRITE_MS = 700;

/** How much of a band or marker is written at `elapsedMs` — eased, and never more than all of it. */
export function writtenAt(elapsedMs: number): number {
  const u = Math.min(Math.max(elapsedMs / EMPHASIS_WRITE_MS, 0), 1);
  return 1 - Math.pow(1 - u, 3);
}
