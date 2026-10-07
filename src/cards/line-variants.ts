// Every way a cards ask's right/wrong lines can read once its count tokens
// are filled ("{f} of {f.total} on the first try."): one per score the viewer
// can reach, 0 … count. The count is small (a few cards), so all of them can
// be known ahead — the player prefetches them while the viewer sorts
// (render/player.ts prefetchCardLines), and a bake records them
// (export/live-lines.ts), so a published cast says "4 of 6" in its recorded
// voice and not the browser's. One function for both, so the words can never
// drift from what the player stores (player.ts cardsAsk: `{store}`,
// `.within`, `.count`, `.total`).
import { initialArrangement, rightCards } from "./model";
import { subVars } from "../spec/answers";
import type { CardsGeometry } from "../spec/cards";

/** Above this many scored answers, the variants are not worth recording. */
export const MAX_CARD_VARIANTS = 8;

/**
 * The texts the ask's `right`/`wrong` can be spoken as, deduped, for every
 * score 0 … count — `vars` holding whatever else is known (the player's live
 * values; a bake passes none), `translate` the spoken track. Empty for a
 * decide (one choice, no count) or more than MAX_CARD_VARIANTS answers.
 */
export function cardsLineVariants(
  ask: { store?: string; right?: string; wrong?: string },
  g: CardsGeometry,
  vars: ReadonlyMap<string, string>,
  translate: (source: string) => string,
): string[] {
  if (g.mode === "decide") return [];
  const sources = [ask.right, ask.wrong].filter((l): l is string => typeof l === "string" && l.trim() !== "");
  if (sources.length === 0) return [];
  const count = rightCards(g, initialArrangement(g)).length;
  if (count > MAX_CARD_VARIANTS) return [];
  const checked = g.mode === "sort" && g.each === true;
  const out = new Set<string>();
  for (let within = 0; within <= count; within++) {
    const v = new Map(vars);
    if (ask.store) {
      const base = ask.store.toLowerCase();
      v.set(base, checked ? String(within) : `${within} of ${count}`);
      v.set(`${base}.within`, String(within));
      v.set(`${base}.count`, String(count));
      v.set(`${base}.total`, String(count));
    }
    for (const src of sources) out.add(subVars(translate(src), v));
  }
  return [...out];
}
