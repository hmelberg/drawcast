// The `card` verb and the card geometry the playlist title page shares
// (title-below-player design, 2026-09-16). A card is the disappearing
// heading Hans liked: the title sketched in over an underline, the camera
// pushing in a little, then everything un-drawn. The playlist title page
// has drawn exactly this since the player round; `card` makes it a beat an
// author can write inside a single cast — `{"card": {"title": "…"}, "speak":
// "…"}` — and `expandCards` turns it into the same elements and commands
// before layout, so live playback, lint and export all see one thing.

import type { Command, Spec, SpecElement } from "./types";
import { CONTENT_TOP, HEADING_Y, headingFont } from "../layout/page";
import { effectiveTextStyle } from "../layout/text-style";

export { HEADING_Y, headingFont };

/** Font size that keeps a one-line title inside the 1000-unit canvas (no word-wrap for plain text). */
export function titleFont(text: string): number {
  return Math.max(34, Math.min(64, Math.round(900 / (0.55 * Math.max(1, text.length)))));
}

/** Seconds the push-in holds — the same as the title page's default. */
export const CARD_HOLD = 1.6;


/** How close the heading's push-in starts: 1.8×, or less for a long title,
 *  so the words fill about 92 % of the view instead of running off its sides
 *  (a 34-character title at 1.8× was cut at both ends, 2026-09-25). The
 *  width is estimated like the underline's — about half the font size per
 *  character — never measured. */
export function headingZoom(title: string): number {
  const width = 0.54 * headingFont(title) * Math.max(1, title.length);
  return Math.max(1, Math.min(1.8, Math.floor((920 / width) * 100) / 100));
}

/**
 * The top heading (the default card, Hans 2026-09-24): the title centred at
 * the top of the page over an underline as wide as the words — it STAYS as
 * the page's heading. The underline's width is estimated from the text
 * (about half the font size per character), not measured.
 *
 * `scale` is the cast's text scale (text.font_size / 26), which the player
 * multiplies every text size by: the title is written that much smaller so
 * it is DRAWN at headingFont — a heading sized for the page's width, at any
 * text size, never pushed through the top edge (the page-frame round,
 * 2026-10-04: at font_size 34 a heading ran ~5 units off the canvas). The
 * underline is placed for the drawn size. A viewer's own size setting is
 * capped at the same size when the text is styled (layout/text-style.ts).
 */
export function headingElements(title: string, prefix: string, scale = 1): SpecElement[] {
  const font = headingFont(title);
  // A little narrower than the words (about 0.22 × font per character — the
  // hand face runs narrow) and clear of the descenders.
  const half = Math.min(400, Math.max(70, 0.22 * font * title.length));
  const written = scale === 1 ? font : Math.round((font / scale) * 100) / 100;
  return [
    { id: `${prefix}_title`, type: "text", text: title, x: 500, y: HEADING_Y, font_size: written, draw: { mode: "sketch", duration: 0.35 } },
    { id: `${prefix}_line`, type: "path", points: [[500 - half, HEADING_Y - font * 0.78], [500 + half, HEADING_Y - font * 0.82]], draw: { mode: "sketch", duration: 0.3 } },
  ];
}

/** The cast's own text scale (its text.font_size / 26, clamped as the player clamps it). */
function textScale(spec: Spec): number {
  return effectiveTextStyle(spec).scale;
}

/** The default heading's prefix: `card_0_title` over `card_0_line`. A
 *  `card` command numbers from 1, so the two never meet — and every reader
 *  that knows the card heading by `card_<n>_` (the heading floor, the
 *  heading-intrusion lint, the headline CSS) knows this one too. */
export const DEFAULT_HEADING = "card_0";

/**
 * The heading a page gets without asking (page frame spec 2026-10-04 §2):
 * `spec.heading` when it is a string, else the title — or null when the page
 * gets none. None when:
 *   - `heading: false` (or an empty string), or no title to draw;
 *   - the cast writes its own `card` (either style) — the author has spoken;
 *   - a book part (`book`): the text pane writes the title, as a heading;
 *   - a course's generated end page (`end_page`);
 *   - a page with no commands: nothing plays, so nothing would draw it;
 *   - a page that already carries a card heading (`card_<n>_title`): it
 *     has been expanded already;
 *   - a page whose authored ink already reaches into the heading strip
 *     (usesHeadingStrip), or a template that draws its own `params.title`:
 *     the heading yields rather than collide or repeat.
 * The video title page (playlist makeTitlePage) has no `title` field and so
 * none either. Exported so an expansion that runs BEFORE this one (cards,
 * scales sizing themselves to the content area) can ask whether the page
 * will have a heading.
 */
export function pageHeading(spec: Spec): string | null {
  if (spec.heading === false || spec.book !== undefined || spec.end_page === true) return null;
  const commands = spec.commands ?? [];
  if (commands.length === 0 || commands.some((c) => c.card !== undefined)) return null;
  // Already expanded — a card's heading, or this one (expandSpec runs again
  // on an expanded spec: the layout, the gate, revise).
  if ((spec.elements ?? []).some((e) => /^card_\d+_title$/.test(e.id))) return null;
  if (usesHeadingStrip(spec)) return null;
  // A template that writes its own title (params.title: a pie's, a chart's)
  // has its heading already, at the top where the template puts it.
  const own = (spec.params as { title?: unknown } | undefined)?.title;
  if (spec.template && typeof own === "string" && own.trim() !== "") return null;
  const text = (typeof spec.heading === "string" ? spec.heading : spec.title ?? "").trim();
  return text === "" ? null : text;
}

/** Rough top of an element the author placed in canvas units, or null when
 *  it is placed relative to something, in data units, or has no position. */
function placedTop(e: SpecElement): number | null {
  if (e.data === true) return null;
  const at = e.at as { ref?: unknown; place?: unknown; data?: unknown } | undefined;
  if (at && !Array.isArray(at) && (at.ref !== undefined || at.place !== undefined || at.data !== undefined)) return null;
  const ys: number[] = [];
  if (Array.isArray(e.points)) for (const p of e.points as unknown[]) if (Array.isArray(p) && typeof p[1] === "number") ys.push(p[1]);
  for (const end of [e.from, e.to] as unknown[]) {
    if (end && typeof end === "object" && !Array.isArray(end) && typeof (end as { y?: unknown }).y === "number") ys.push((end as { y: number }).y);
    else if (Array.isArray(end) && typeof end[1] === "number") ys.push(end[1]);
  }
  if (typeof e.y === "number") {
    const half =
      typeof e.height === "number" ? e.height / 2
        : typeof e.radius === "number" ? e.radius
          : typeof e.size === "number" ? e.size / 2
            : typeof e.font_size === "number" ? e.font_size * 0.6
              : e.type === "text" || e.type === "math" || e.type === "label" ? 17 : 0;
    ys.push(e.y + half);
  }
  return ys.length > 0 ? Math.max(...ys) : null;
}

/** The author already drew in the heading strip (above the content area's
 *  top, layout/page.ts CONTENT_TOP): a page made before the default heading
 *  — its own title text at the top, a flask's stopper at y 680 — keeps the
 *  page it was made as, and the heading yields. Positions as written; what
 *  is placed relative to something else is not judged here. */
function usesHeadingStrip(spec: Spec): boolean {
  return (spec.elements ?? []).some((e) => {
    if (e.type === "group" || /^card_\d+_/.test(e.id)) return false;
    const top = placedTop(e);
    return top !== null && top > CONTENT_TOP;
  });
}

/**
 * The default heading, expanded: the same elements a `card` draws, sketched
 * in quickly by one unnarrated beat just before the cast's first ink — no
 * push-in, so the opening line still rides the first strokes a moment
 * later. Returns the same object when the page gets none.
 */
export function expandDefaultHeading(spec: Spec): Spec {
  const text = pageHeading(spec);
  if (text === null) return spec;
  const els = headingElements(text, DEFAULT_HEADING, textScale(spec));
  // Just before the first ink, so an announcement spoken over the empty page
  // stays one; a cast that never draws gets it first.
  const commands = [...(spec.commands ?? [])];
  const first = commands.findIndex((c) => c.draw !== undefined || c.show !== undefined || c.animate !== undefined);
  commands.splice(Math.max(0, first), 0, { draw: els.map((e) => e.id), parallel: true });
  return { ...spec, elements: [...(spec.elements ?? []), ...els], commands };
}

/** The default heading's own beat (expandDefaultHeading): lints that ask
 *  "has anything been drawn yet?" look past it. */
export function isDefaultHeadingBeat(c: Command): boolean {
  return Array.isArray(c.draw) && c.draw.length > 0 && c.draw.every((id) => typeof id === "string" && id.startsWith(`${DEFAULT_HEADING}_`));
}

/** The page without its default heading — for an inset, whose picture is
 *  the source's FIGURE: the heading would only widen the crop and shrink
 *  the drawing inside the thumbnail. Unexpanded specs pass through. */
export function withoutDefaultHeading(spec: Spec): Spec {
  const ids = new Set([`${DEFAULT_HEADING}_title`, `${DEFAULT_HEADING}_line`]);
  if (!(spec.elements ?? []).some((e) => ids.has(e.id))) return { ...spec, heading: false };
  return {
    ...spec,
    heading: false,
    elements: (spec.elements ?? []).filter((e) => !ids.has(e.id)),
    commands: (spec.commands ?? []).filter((c) => !isDefaultHeadingBeat(c)),
  };
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
      const els = headingElements(card.title, prefix, textScale(spec));
      elements.push(...els);
      out.push({ camera: { center: { ref: `${prefix}_title` }, zoom: headingZoom(card.title), duration: 0.01 } });
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
