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

/** The top heading's text size: a one-line title across the top, 26–36. */
export function headingFont(text: string): number {
  return Math.max(26, Math.min(36, Math.round(880 / (0.55 * Math.max(1, text.length)))));
}

/** Where the top heading sits: in the strip above a plot's top labels (a
 *  y-axis name at about y 690–705) and above the band figures are fitted
 *  into (y 95–655), just under the canvas edge (750). */
export const HEADING_Y = 726;

/**
 * The top heading (the default card, Hans 2026-09-24): the title centred at
 * the top of the page over an underline as wide as the words — it STAYS as
 * the page's heading. The underline's width is estimated from the text
 * (about half the font size per character), not measured.
 */
export function headingElements(title: string, prefix: string): SpecElement[] {
  const font = headingFont(title);
  // A little narrower than the words (about 0.22 × font per character — the
  // hand face runs narrow) and clear of the descenders.
  const half = Math.min(400, Math.max(70, 0.22 * font * title.length));
  return [
    { id: `${prefix}_title`, type: "text", text: title, x: 500, y: HEADING_Y, font_size: font, draw: { mode: "sketch", duration: 0.35 } },
    { id: `${prefix}_line`, type: "path", points: [[500 - half, HEADING_Y - font * 0.78], [500 + half, HEADING_Y - font * 0.82]], draw: { mode: "sketch", duration: 0.3 } },
  ];
}

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
    if (card.style !== "center") {
      // The heading: the camera starts close on the title (the page is still
      // empty), the title and its line are drawn, and the view pulls back to
      // the whole page — the heading shrinks from large to its place in about
      // half a second, the beat's words (if any) riding the pull-back. Then
      // the cast gets straight to its first drawing.
      const els = headingElements(card.title, prefix);
      elements.push(...els);
      out.push({ camera: { center: { ref: `${prefix}_title` }, zoom: 1.8, duration: 0.01 } });
      out.push({ draw: els.map((e) => e.id), parallel: true });
      out.push({ ...rest, camera: { reset: true, duration: 0.6 } });
      continue;
    }
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
