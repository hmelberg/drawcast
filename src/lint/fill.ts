// The fill advisory (page frame spec 2026-10-04 §6): a figure that uses a
// small corner of an otherwise empty page — the quiz reviewers' most common
// complaint, small figures on a mostly white page. It is ADVISORY: never an
// error, never part of layoutSpec's issues (so the examples gate and the
// generation loop do not read it); `cast.mjs check` and the frames harness
// print it. Crowding (lint/crowding.ts) is the opposite question and keeps
// its own rules.

import { contentBox } from "../layout/page";
import type { BBox } from "../layout/geometry";
import type { LintIssue } from "./lint";

/** Under this share of the content area's width AND height is a small figure. */
export const FILL_MIN = 0.4;

export const FILL_MESSAGE = "small figure on an empty page — let it grow (cards size, template box) or draw it larger";

/** The page's own frame, never its figure: the heading (a card's or the default one). */
const isFrame = (id: string): boolean => /^card_\d+_/.test(id);

/** The union of the figure's ink on one page state, or null with none. */
export function figureUnion(boxes: Iterable<[string, BBox]>, visible?: (id: string) => boolean): BBox | null {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [id, b] of boxes) {
    if (isFrame(id) || (visible && !visible(id))) continue;
    if (!(b.w >= 0 && b.h >= 0) || !Number.isFinite(b.x + b.y + b.w + b.h)) continue;
    x0 = Math.min(x0, b.x);
    y0 = Math.min(y0, b.y);
    x1 = Math.max(x1, b.x + b.w);
    y1 = Math.max(y1, b.y + b.h);
  }
  return Number.isFinite(x0) ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : null;
}

/**
 * The fill issue for one page state, or null: the union of what is drawn
 * (heading excluded; captions are HTML and never ink) covers under FILL_MIN
 * of the content box in both directions. An empty page is not judged.
 */
export function fillIssue(boxes: Iterable<[string, BBox]>, opts: { heading: boolean; visible?: (id: string) => boolean }): LintIssue | null {
  const u = figureUnion(boxes, opts.visible);
  if (!u) return null;
  const c = contentBox({ heading: opts.heading });
  const fw = u.w / c.w, fh = u.h / c.h;
  if (fw >= FILL_MIN || fh >= FILL_MIN) return null;
  return {
    rule: "fill",
    ids: [],
    message: `${FILL_MESSAGE} (the figure spans ${Math.round(fw * 100)} % of the content area's width, ${Math.round(fh * 100)} % of its height)`,
    severity: "warn",
  };
}

/**
 * Which resting frames to judge: a page at its fullest — the frame before
 * something is taken away (an erase, a clear) and the last one. Judging every
 * frame would flag the first strokes of every cast that builds up its figure.
 * `areas[i]` is the union area at frame i.
 */
export function fullestFrames(areas: number[]): number[] {
  const out: number[] = [];
  for (let i = 0; i < areas.length; i++) if (i === areas.length - 1 || areas[i + 1] < areas[i]) out.push(i);
  return out;
}

/** Whether a laid-out page has a top heading (a card's or the default one). */
export function hasHeadingInk(ids: Iterable<string>): boolean {
  for (const id of ids) if (/^card_\d+_title$/.test(id)) return true;
  return false;
}
