// The ids a cards element generates (spec/cards.ts cardsElements, spec/steps.ts):
// its cards "<id>_1 …", a match's partners "<id>_m_1 …", a compare's values
// "<id>_v_1 …", a sort's boxes "<id>_bin_1" (with "_box", "_title"), steps'
// slots "<id>_slot_1" and arrows "<id>_arrow_1", rank/steps ends "<id>_end_1|2",
// and the title "<id>_title" — each with its own drawables after a further "_".
// Membership is by these patterns, never by a bare "<id>_" prefix: an author's
// "land_w" next to cards "land" is not one of them (bug 2026-10-07).

const PIECE = /^(?:\d+|m_\d+|v_\d+|bin_\d+|slot_\d+|arrow_\d+|end_[12]|title)(?:_|$)/;

/** Is `id` a piece (or a drawable of a piece) that cards `cardsId` generates? The group itself is not. */
export function isCardsPart(cardsId: string, id: string): boolean {
  const prefix = `${cardsId}_`;
  return id.startsWith(prefix) && PIECE.test(id.slice(prefix.length));
}

/** The cards element itself or one of its generated pieces. */
export function ownedByCards(cardsId: string, id: string): boolean {
  return id === cardsId || isCardsPart(cardsId, id);
}
