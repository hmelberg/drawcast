// The sugar a spec may carry that expands into ordinary elements and
// commands before layout: `card` beats (spec/card.ts), derivations (math `steps`, spec/derive.ts), a note_sheet's
// `sound: true` (spec/sound.ts), then walked groups (spec/walk.ts). One entry point, so every consumer — render, the
// compile-time lint, revise, the frames harness — expands the same way.

import { expandScratch } from "./scratch";
import { expandCards } from "./card";
import { expandDerivations } from "./derive";
import { expandSound } from "./sound";
import { expandWalks } from "./walk";
import type { Spec } from "./types";

/** Cards, derivations (math `steps`), sound, then walks. The same object back when there is nothing to expand. */
export function expandSpec(spec: Spec): Spec {
  return expandWalks(expandSound(expandDerivations(expandCards(expandScratch(spec)))));
}
