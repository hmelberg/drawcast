// When a cued action starts — the whole of the arithmetic behind an action
// written inside a sentence, in one pure function so it can be tested without
// a browser and so the player, the export and any future consumer agree.
import { DELIVERY, type Delivery } from "./delivery";
import { SpeechManager } from "./speech";

/**
 * Milliseconds to wait, from the moment the line begins, before starting a
 * cued action.
 *
 * Two corrections over the naive `cue × estimate`:
 *
 * The DELIVERY rate. A line marked `grave` is spoken at 0.88× and therefore
 * runs about 14% longer than the reading estimate. Ignoring
 * that fired every cue in such a line early — by roughly half a second on a
 * six-second sentence, which is exactly the scale a viewer notices.
 *
 * The ANCHOR. `cueEnd` means the cue marks where the action has FINISHED, not
 * where it begins: the reveal lands its last stroke on the word. The engine
 * knows what the action costs, so it starts it that much earlier — and an
 * action that cannot fit starts at once rather than at a negative time.
 */
/** How long a spoken line takes, delivery included — the denominator every
 *  cue is measured against, in the player and in the lint alike. */
export function lineMs(text: string, delivery: Delivery | undefined): number {
  return SpeechManager.estimateMs(text) / (delivery ? DELIVERY[delivery].rate : 1);
}

export function cueStartMs(
  cue: number | undefined,
  cueEnd: boolean | undefined,
  text: string,
  delivery: Delivery | undefined,
  actionMs: number,
): number {
  if (cue === undefined || cue <= 0) return cueEnd === true ? 0 : 0;
  const point = lineMs(text, delivery) * cue;
  return Math.max(0, cueEnd === true ? point - actionMs : point);
}
