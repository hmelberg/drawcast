// On-canvas answer buttons (spec/answer-buttons.ts), placed again AS DRAWN:
// the expansion only saw the declared x/y of what stands on the page at the
// quiz; here every one of those has its real box (measured text, a template's
// parts, things placed by `at`), so the buttons move — each one, so a row may
// become a column — to the spot the same rule picks from the real boxes.
// Pinned buttons (buttons_at) stay where the author put them.

import type { BBox } from "./geometry";
import type { Drawable, Pt } from "./model";
import type { MeasureFn } from "./measure";
import { boxOfId } from "./boxes";
import { shiftDrawables, shiftPoints } from "./place";
import { declaredBox, placeButtons, type AnswerButtonsHint } from "../spec/answer-buttons";
import type { SpecElement } from "../spec/types";

export interface ButtonsCtx {
  groups: Record<string, string[]>;
  pieceGroups: Record<string, string[]>;
  anchors: Record<string, Pt>;
  namedAnchors: Record<string, Record<string, Pt>>;
  groupBoxes: Record<string, BBox>;
}

const num = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

export function placeAnswerButtons(elements: SpecElement[], drawables: Drawable[], ctx: ButtonsCtx, measure: MeasureFn): void {
  const byId = new Map(elements.map((e) => [e.id, e]));
  for (const el of elements) {
    const hint = (el as { answer_buttons?: AnswerButtonsHint }).answer_buttons;
    if (el.type !== "group" || !hint || hint.at || hint.buttons.length === 0) continue;
    const mine = new Set(hint.buttons);
    // A thing with no ink yet (an icon whose artwork has not arrived) keeps
    // its declared room: the buttons must not take its place.
    const obstacles = hint.near
      .filter((id) => !mine.has(id))
      .map((id) => boxOfId(drawables, id, measure, ctx.groups, ctx.pieceGroups) ?? (byId.has(id) ? declaredBox(byId.get(id)!) : null))
      .filter((b): b is BBox => b !== null);
    const first = byId.get(hint.buttons[0]) as { width?: unknown; height?: unknown } | undefined;
    if (!first || !num(first.width) || !num(first.height)) continue;
    const { centres } = placeButtons(obstacles, hint.buttons.length, { w: first.width, h: first.height }, hint.layout ? { layout: hint.layout } : {});
    hint.buttons.forEach((id, j) => {
      const own = byId.get(id) as { x?: unknown; y?: unknown } | undefined;
      const box = boxOfId(drawables, id, measure);
      // Where it is now: its declared centre (its box has the shadow on one side).
      const now = own && num(own.x) && num(own.y) ? { x: own.x, y: own.y } : box ? { x: box.x + box.w / 2, y: box.y + box.h / 2 } : null;
      if (!now) return;
      const dx = centres[j].x - now.x, dy = centres[j].y - now.y;
      if (Math.abs(dx) < 1e-9 && Math.abs(dy) < 1e-9) return;
      shiftDrawables(drawables.filter((d) => d.id === id || d.id.startsWith(`${id}_`)), dx, dy);
      const a = ctx.anchors[id];
      if (a) ctx.anchors[id] = [a[0] + dx, a[1] + dy];
      shiftPoints(ctx.namedAnchors[id], dx, dy);
    });
    const gb = hint.buttons.map((id) => boxOfId(drawables, id, measure)).filter((b): b is BBox => b !== null);
    if (gb.length > 0) {
      const x0 = Math.min(...gb.map((b) => b.x)), y0 = Math.min(...gb.map((b) => b.y));
      ctx.groupBoxes[el.id] = { x: x0, y: y0, w: Math.max(...gb.map((b) => b.x + b.w)) - x0, h: Math.max(...gb.map((b) => b.y + b.h)) - y0 };
    }
  }
}
