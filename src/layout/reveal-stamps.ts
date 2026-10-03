// Reveal stamps (spec/reveal-stamps.ts), placed and dressed AS DRAWN: the
// expansion only saw declared x/y; here every thing standing on the page
// when the stamp lands has its real box (measured text, a template's parts,
// the on-canvas buttons where they finally went), so the stamp moves to the
// spot the same rule picks from the real boxes. Then the look: the frame
// rebuilt round the measured words and turned with them, bold words in the
// stamp's colour, and the "stamp" draw mode on both. A pinned stamp
// (reveal.at as a point) stays where the author put it.

import type { BBox } from "./geometry";
import { roundedRectPts } from "./geometry";
import type { Drawable, Pt } from "./model";
import type { MeasureFn } from "./measure";
import { boxOfId } from "./boxes";
import { shiftDrawables, shiftPoints } from "./place";
import { declaredBox } from "../spec/answer-buttons";
import { placeStamp, STAMP_MS, STAMP_TILT, turnedSize, unionOf, type RevealStampHint } from "../spec/reveal-stamps";
import type { SpecElement } from "../spec/types";

export interface StampsCtx {
  groups: Record<string, string[]>;
  pieceGroups: Record<string, string[]>;
  anchors: Record<string, Pt>;
  namedAnchors: Record<string, Record<string, Pt>>;
}

const PAD_X = 18;
const STAMP_RADIUS = 8;
/** Bold words run wider than the measure's regular ones. */
const BOLD = 1.08;

const turn = ([x, y]: Pt, c: Pt, deg: number): Pt => {
  const r = (deg * Math.PI) / 180, cs = Math.cos(r), sn = Math.sin(r);
  const dx = x - c[0], dy = y - c[1];
  return [c[0] + dx * cs - dy * sn, c[1] + dx * sn + dy * cs];
};

/**
 * Every stamp element: placed clear of what stands on the page when it
 * lands (its `near`), beside what it is about; then dressed. `seeds` are the
 * template's drawables (a guessed bar's box), read but never moved.
 */
export function placeRevealStamps(elements: SpecElement[], drawables: Drawable[], ctx: StampsCtx, measure: MeasureFn, seeds: Drawable[] = []): void {
  const byId = new Map(elements.map((e) => [e.id, e]));
  const all = (): Drawable[] => [...seeds, ...drawables];
  for (const el of elements) {
    const hint = (el as { reveal_stamp?: RevealStampHint }).reveal_stamp;
    if (!hint) continue;
    const own = el as { text?: unknown; font_size?: unknown; style?: { color?: unknown } };
    const text = typeof own.text === "string" ? own.text : "";
    const font = typeof own.font_size === "number" ? own.font_size : 48;
    const color = typeof own.style?.color === "string" ? own.style.color : undefined;
    const stamp = hint.style === "stamp";
    const textD = drawables.find((d) => d.kind === "text" && d.id === (stamp ? `${el.id}_text` : el.id));
    const frameD = stamp ? drawables.find((d) => d.kind === "stroke" && d.id === el.id) : undefined;
    if (!textD || textD.kind !== "text") continue;
    const m = measure(text, font);
    const frame = { w: Math.round(m.w * BOLD + 2 * PAD_X), h: Math.round(font * 1.5) };
    const reach = stamp ? turnedSize(frame.w, frame.h, STAMP_TILT) : { w: m.w * BOLD, h: m.h };
    const boxOf = (id: string): BBox | null => boxOfId(all(), id, measure, ctx.groups, ctx.pieceGroups) ?? (byId.has(id) ? declaredBox(byId.get(id)!) : null);
    // Where it goes, from the boxes as drawn.
    const now: Pt = [textD.pos[0], textD.pos[1]];
    let c: Pt = now;
    if (hint.at) c = [hint.at.x, hint.at.y];
    else {
      const obstacles = hint.near.filter((id) => id !== el.id).map(boxOf).filter((b): b is BBox => b !== null);
      const about = unionOf(hint.about.map(boxOf).filter((b): b is BBox => b !== null));
      const spot = placeStamp(obstacles, about, reach);
      c = [spot.x, spot.y];
    }
    const dx = c[0] - now[0], dy = c[1] - now[1];
    if (Math.abs(dx) > 1e-9 || Math.abs(dy) > 1e-9) {
      shiftDrawables(drawables.filter((d) => d.id === el.id || d.id.startsWith(`${el.id}_`)), dx, dy);
      const a = ctx.anchors[el.id];
      if (a) ctx.anchors[el.id] = [a[0] + dx, a[1] + dy];
      shiftPoints(ctx.namedAnchors[el.id], dx, dy);
    }
    // The look.
    const draw = { mode: "stamp" as const, duration: STAMP_MS };
    textD.weight = "bold";
    if (color) textD.style = { ...textD.style, color };
    textD.drawOpts = draw;
    if (stamp) textD.tilt = STAMP_TILT;
    if (frameD && frameD.kind === "stroke") {
      const centre: Pt = [textD.pos[0], textD.pos[1]];
      frameD.pts = roundedRectPts(centre, frame.w, frame.h, STAMP_RADIUS).map((p) => turn(p, centre, STAMP_TILT));
      frameD.closed = true;
      delete frameD.shapeHint;
      frameD.precise = true;
      frameD.style = { ...frameD.style, strokeWidth: 3, fill: undefined };
      frameD.drawOpts = draw;
    }
  }
}
