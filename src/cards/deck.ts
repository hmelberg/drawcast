// A deck of cards to sort (spec 2026-10-03-round6 §7): one card at a time,
// dealt large in the middle and flown small into its box. Pure timing and
// motion, shared by the gate (ui/cards-gate.ts) and the movie
// (render/player.ts cardsAsk).

/** The movie's whole deck takes about this long, however many cards. */
const DECK_MOVIE_MS = 6000;

/** The movie: each card's time — the deck takes ~6 s, a card 180–600 ms. */
export function deckCardMs(n: number): number {
  return Math.max(180, Math.min(600, DECK_MOVIE_MS / Math.max(1, n)));
}

/** The share of a card's time spent growing on the stack before it flies. */
export const DEAL_GROW = 0.3;

const ease = (t: number): number => t * t * (3 - 2 * t);

/**
 * A dealt card at `t` (0..1) of its time: it grows from 1 to `scale` on the
 * stack, then flies (`along`, 0 = the stack, 1 = its slot) and shrinks back.
 */
export function deckFlight(t: number, scale: number): { along: number; scale: number } {
  const u = Math.max(0, Math.min(1, t));
  if (u < DEAL_GROW) return { along: 0, scale: 1 + (scale - 1) * ease(u / DEAL_GROW) };
  const f = ease((u - DEAL_GROW) / (1 - DEAL_GROW));
  return { along: f, scale: scale + (1 - scale) * f };
}
