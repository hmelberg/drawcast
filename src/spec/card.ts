// The `card` verb and the card geometry the playlist title page shares
// (title-below-player design, 2026-09-16). A card is the disappearing
// heading Hans liked: the title sketched in over an underline, the camera
// pushing in a little, then everything un-drawn. The playlist title page
// has drawn exactly this since the player round; `card` makes it a beat an
// author can write inside a single cast — `{"card": {"title": "…"}, "speak":
// "…"}` — and `expandCards` turns it into the same elements and commands
// before layout, so live playback, lint and export all see one thing.

import type { Command, Spec, SpecElement } from "./types";

/** Font size that keeps a one-line title inside the 1000-unit canvas (no word-wrap for plain text). */
export function titleFont(text: string): number {
  return Math.max(34, Math.min(64, Math.round(900 / (0.55 * Math.max(1, text.length)))));
}

/** Seconds the push-in holds — the same as the title page's default. */
export const CARD_HOLD = 1.6;

/**
 * The card's elements: `<prefix>_title` over `<prefix>_line`, and
 * `<prefix>_subtitle` when there is one. Text elements carry explicit
 * sketch draws, so titles FADE in (text reveal is an opacity ramp).
 */
export function cardElements(title: string, subtitle: string | undefined, prefix: string): SpecElement[] {
  const elements: SpecElement[] = [
    { id: `${prefix}_title`, type: "text", text: title, x: 500, y: 430, font_size: titleFont(title), draw: { mode: "sketch", duration: 1.2 } },
    { id: `${prefix}_line`, type: "path", points: [[300, 372], [700, 368]] },
  ];
  if (subtitle) {
    elements.push({ id: `${prefix}_subtitle`, type: "text", text: subtitle, x: 500, y: 315, font_size: 28, style: { opacity: 0.75 }, draw: { mode: "sketch", duration: 0.9 } });
  }
  return elements;
}

/**
 * Replace every `card` command with its elements and beats. The paired
 * narration (speak, voice, delivery, blocking) rides on the draw beat, so a
 * card reads its title aloud exactly when the author put a sentence on it.
 * Returns the same object when there is nothing to expand — callers may
 * compare by identity.
 */
export function expandCards(spec: Spec): Spec {
  const commands = spec.commands ?? [];
  if (!commands.some((c) => c.card !== undefined)) return spec;
  const elements: SpecElement[] = [...(spec.elements ?? [])];
  const out: Command[] = [];
  let n = 0;
  for (const cmd of commands) {
    if (cmd.card === undefined) {
      out.push(cmd);
      continue;
    }
    n++;
    const prefix = `card_${n}`;
    const { card, ...rest } = cmd;
    const els = cardElements(card.title, card.subtitle, prefix);
    elements.push(...els);
    const ids = els.map((e) => e.id);
    out.push({ ...rest, draw: ids.slice(0, 2) });
    if (ids.length > 2) out.push({ draw: ids.slice(2) });
    out.push({ camera: { center: { ref: `${prefix}_title` }, zoom: 1.08, duration: CARD_HOLD } });
    out.push({ erase: ids, parallel: true });
    out.push({ camera: { reset: true, duration: 0.3 } });
  }
  return { ...spec, elements, commands: out };
}
