// The Commodore 64 as a SCREEN — not a drawn monitor with a screen in it.
// Hans, 2026-09-06: "commodore bare bør bestå av den blå skjermen, ikke
// tegningen av monitor og keyboard. Og den blå skjermen bør ligne mye mer på
// den ekte" — fonts, colours, border.
//
// So a code element that is a C64 (`language: "basic"`, or a `game` with
// nothing to run) is laid out here instead of as a paper panel: one field of
// 40 × 25 character cells inside a border four cells wide, in the machine's
// own colours, set in the machine's own face (C64 Pro Mono, whose cell is
// exactly one em square — src/render/svg-backend.ts). Nothing is on paper:
// the listing is typed ONTO the screen, RUN is typed under it, and the
// output is what the run left behind — as the real machine shows it. All of
// it ink, so it scrubs, exports, takes the marker pen and can be asked for.
//
// What a storyboard addresses: `<id>` switches the machine on (the field,
// and the boot screen when there is nothing to run); `<id>_line_k` types
// line k of the listing; `<id>_mark_k` a marker pass; `<id>_out` is RUN —
// it repaints the field with the screen the program left. A game's play mark
// sits on the screen and comes back with `_out`, so it is never painted over.

import { decodeCodeResult } from "../code/envelope";
import { C64_BACKGROUND, C64_BOOT_LINES, C64_BORDER, C64_COLS, C64_PALETTE, C64_ROWS, C64_TEXT, type C64Screen } from "../code/c64";
import { CANVAS } from "./canvas";
import { chromeDrawables, findMarkRow, frameSpace, normalizeMarks, rectPts, TYPE_CPS, type CodeCtx, type CodeFrame } from "./code";
import { COLORS, SKETCH_MS, Z_AREA, Z_STROKE, Z_TEXT, defaultStyle, type Drawable } from "./model";
import { resolveDrawOpts, resolveStyle } from "./resolve";
import type { SpecElement } from "../spec/types";

/** The border, in character cells — the PAL machine's is about four wide. */
export const BORDER_CELLS = 4;

/** Whether this element is a C64 screen rather than a paper panel. */
export function isC64Screen(el: SpecElement): boolean {
  return el.type === "code" && (el.language === "basic" || (el.game !== undefined && (el.code ?? "").trim() === ""));
}

/** A listing line as the machine shows it: wrapped at the screen's edge,
 *  no indent, uppercase outside quotes (the machine has one case). */
export function listingRows(line: string): string[] {
  const shown = line.replace(/"[^"]*"|[^"]+/g, (m) => (m.startsWith('"') ? m : m.toUpperCase()));
  const rows: string[] = [];
  for (let i = 0; i < Math.max(1, shown.length); i += C64_COLS) rows.push(shown.slice(i, i + C64_COLS));
  return rows;
}

export function c64ScreenDrawables(el: SpecElement, ctx: CodeCtx): Drawable[] {
  const frame: CodeFrame = el.frame ?? "none";
  const chrome = frameSpace(frame);
  const cx = el.x ?? 500;
  const cy = el.y ?? 400;
  // The field's shape is the machine's: 40 + 8 cells wide, 25 + 8 tall.
  const cols = C64_COLS + 2 * BORDER_CELLS;
  const rows = C64_ROWS + 2 * BORDER_CELLS;
  const maxH = CANVAS.h - 40 - chrome.above - chrome.below;
  let cell = (el.width ?? 880) / cols;
  if (cell * rows > maxH) cell = maxH / rows; // too tall for the canvas: the whole screen shrinks, its shape kept
  const w = cell * cols;
  const h = cell * rows;
  const rim = cell * BORDER_CELLS;
  const x0 = cx - w / 2;
  let yTop = cy + h / 2;
  const overTop = yTop + chrome.above - (CANVAS.h - 8);
  if (overTop > 0) yTop -= overTop;
  const underBottom = 64 - (yTop - h - chrome.below);
  if (underBottom > 0) yTop += Math.max(0, Math.min(underBottom, CANVAS.h - 8 - (yTop + chrome.above)));
  const screenX = x0 + rim;
  const screenTop = yTop - rim;
  const font = cell;
  ctx.anchors[el.id] = [cx, cy];
  ctx.panes[el.id] = { x: screenX, y: screenTop - C64_ROWS * cell, w: C64_COLS * cell, h: C64_ROWS * cell };

  const field = (sid: string, border: number, background: number): Drawable[] => [
    {
      id: `${sid}__border`,
      kind: "area",
      pts: rectPts(x0, yTop - h, w, h),
      precise: true,
      z: Z_AREA,
      style: resolveStyle(undefined, { fill: C64_PALETTE[border & 15], opacity: 1, strokeWidth: 0 }),
      drawOpts: resolveDrawOpts(undefined, { mode: "instant", duration: 0 }),
    },
    {
      id: `${sid}__screen`,
      kind: "area",
      pts: rectPts(screenX, screenTop - C64_ROWS * cell, C64_COLS * cell, C64_ROWS * cell),
      precise: true,
      z: Z_AREA,
      style: resolveStyle(undefined, { fill: C64_PALETTE[background & 15], opacity: 1, strokeWidth: 0 }),
      drawOpts: resolveDrawOpts(undefined, { mode: "instant", duration: 0 }),
    },
  ];
  /** A run of text on a screen row, in one colour, set on the cell grid: the
   *  face's cell is one em square, its baseline 0.875 em under the cell's top. */
  const rowText = (sid: string, row: number, col: number, text: string, color: number, typed = false): Drawable => ({
    id: sid,
    kind: "text",
    pos: [screenX + col * cell, screenTop - cell * (row + 0.875)],
    text,
    fontSize: font,
    anchor: "start",
    font: "c64",
    z: Z_TEXT,
    style: resolveStyle(undefined, { color: C64_PALETTE[color & 15] }),
    drawOpts: typed
      ? { mode: "type", duration: Math.max(400, Math.round((text.length / TYPE_CPS) * 1000)) }
      : resolveDrawOpts(el.draw, { mode: "sketch", duration: SKETCH_MS.text }),
  });
  const playMark = (): Drawable[] => {
    if (el.game === undefined) return [];
    const pcx = screenX + (C64_COLS * cell) / 2;
    const pcy = screenTop - (C64_ROWS * cell) / 2;
    const r = Math.max(16, C64_COLS * cell * 0.1);
    return [
      {
        id: `${el.id}__play`,
        kind: "stroke",
        pts: [[pcx, pcy]],
        shapeHint: { type: "circle", c: [pcx, pcy], r },
        z: Z_STROKE,
        style: resolveStyle(undefined, { color: C64_PALETTE[1], strokeWidth: 3 }),
        drawOpts: resolveDrawOpts(el.draw, { mode: "sketch", duration: 420 }),
      },
      {
        id: `${el.id}__playtri`,
        kind: "area",
        pts: [
          [pcx - r * 0.3, pcy + r * 0.45],
          [pcx + r * 0.55, pcy],
          [pcx - r * 0.3, pcy - r * 0.45],
        ],
        precise: true,
        z: Z_STROKE,
        style: resolveStyle(undefined, { fill: C64_PALETTE[1], opacity: 1, strokeWidth: 0 }),
        drawOpts: resolveDrawOpts(el.draw, { mode: "sketch", duration: 260 }),
      },
    ];
  };

  // ---- the machine, switched on --------------------------------------------
  const source = (el.code ?? "").replace(/\s+$/, "");
  const lines = source === "" ? [] : source.split("\n");
  const result = decodeCodeResult(el.code_result);
  const machine: Drawable[] = [...chromeDrawables(el.id, frame, x0, yTop, w, h, el.style, el.draw), ...field(el.id, C64_BORDER, C64_BACKGROUND)];
  if (lines.length === 0) {
    // Nothing to run: the boot screen, and the mark that starts the game.
    C64_BOOT_LINES.forEach(([row, text], i) => machine.push(rowText(`${el.id}__boot${i}`, row, 0, text, C64_TEXT)));
  }
  machine.push(...playMark());
  const out: Drawable[] = [
    { id: el.id, kind: "group", z: Z_STROKE, style: defaultStyle(), drawOpts: resolveDrawOpts(undefined, { mode: "sketch", duration: 0 }), children: machine },
  ];

  // ---- the listing, typed onto the screen ----------------------------------
  const blocks: { rows: string[] }[] = [];
  let row = 0;
  lines.forEach((line, i) => {
    const id = `${el.id}_line_${i + 1}`;
    const rowsOf = listingRows(line);
    blocks.push({ rows: rowsOf });
    ctx.extraOrder.push(id);
    ctx.anchors[id] = [screenX, screenTop - cell * (row + 0.5)];
    const typed = el.draw?.mode === "type";
    if (rowsOf.length === 1) out.push(rowText(id, row, 0, rowsOf[0], C64_TEXT, typed));
    else {
      out.push({
        id,
        kind: "group",
        z: Z_TEXT,
        style: defaultStyle(),
        drawOpts: resolveDrawOpts(el.draw, { mode: "sketch", duration: 0 }),
        children: rowsOf.map((r, k) => rowText(`${id}__r${k}`, row + k, 0, r, C64_TEXT, typed)),
      });
    }
    row += rowsOf.length;
  });
  if (row > C64_ROWS - 2) ctx.warnings.push(`code "${el.id}": a ${row}-row listing leaves the machine no room to RUN under it — keep a C64 program short`);

  // ---- marks: the marker pen, on the cell grid -----------------------------
  normalizeMarks(el.marks).forEach((m, k) => {
    const id = `${el.id}_mark_${k + 1}`;
    ctx.extraOrder.push(id);
    const hit = findMarkRow(blocks, m.text.replace(/"[^"]*"|[^"]+/g, (s) => (s.startsWith('"') ? s : s.toUpperCase())));
    if (!hit) {
      ctx.warnings.push(`code "${el.id}": mark ${k + 1} — "${m.text}" is not on any listed line as one piece`);
      ctx.anchors[id] = [screenX, screenTop];
      out.push({ id, kind: "stroke", pts: [], z: Z_STROKE, style: resolveStyle(el.style, { color: COLORS.region1, opacity: 0.42 }), drawOpts: resolveDrawOpts(el.draw, { mode: "sketch", duration: 400 }) });
      return;
    }
    const screenRow = blocks.slice(0, hit.block).reduce((n, b) => n + b.rows.length, 0) + hit.row;
    const yMid = screenTop - cell * (screenRow + 0.5);
    const x0m = screenX + hit.col * cell - cell * 0.15;
    const x1m = screenX + (hit.col + m.text.length) * cell + cell * 0.15;
    const geom =
      m.kind === "underline"
        ? { y: screenTop - cell * (screenRow + 0.95), width: 2.5, color: C64_PALETTE[7], opacity: 1 }
        : m.kind === "strike"
          ? { y: yMid, width: 2.5, color: C64_PALETTE[2], opacity: 1 }
          : { y: yMid, width: cell * 0.95, color: C64_PALETTE[7], opacity: 0.45 };
    ctx.anchors[id] = [(x0m + x1m) / 2, geom.y];
    out.push({
      id,
      kind: "stroke",
      pts: [
        [x0m, geom.y],
        [x1m, geom.y],
      ],
      z: m.kind === "mark" ? Z_AREA : Z_STROKE,
      style: resolveStyle(el.style, { color: geom.color, strokeWidth: geom.width, opacity: geom.opacity, roughness: 0.6 }),
      drawOpts: resolveDrawOpts(el.draw, { mode: "sketch", duration: Math.max(320, Math.min(1500, (x1m - x0m) * 7)) }),
    });
  });

  // ---- RUN: the screen the program left ------------------------------------
  // Always minted, like a panel's `_out`: an unresolved run keeps the beat.
  const outId = `${el.id}_out`;
  ctx.extraOrder.push(outId);
  ctx.anchors[outId] = [cx, cy];
  const runChildren: Drawable[] = [];
  if (lines.length > 0) {
    const screen: C64Screen | undefined = result?.ok ? result.screen : undefined;
    if (screen) {
      runChildren.push(...field(`${el.id}__run`, screen.border, screen.background));
      screen.chars.forEach((line, r) => {
        let col = 0;
        while (col < line.length) {
          if (line[col] === " ") {
            col++;
            continue;
          }
          const c = screen.colors[r]?.[col] ?? "e";
          let end = col;
          while (end < line.length && (screen.colors[r]?.[end] ?? "e") === c && !(line[end] === " " && (end + 1 >= line.length || line[end + 1] === " "))) end++;
          runChildren.push(rowText(`${el.id}__scr${r}_${col}`, r, col, line.slice(col, end), parseInt(c, 16)));
          col = end;
        }
      });
    } else if (result && !result.ok) {
      // The error, as the machine prints it, under the listing.
      runChildren.push(rowText(`${el.id}__err`, Math.min(C64_ROWS - 2, row + 1), 0, (result.error ?? "?ERROR").split(" (")[0].slice(0, C64_COLS), C64_TEXT));
      runChildren.push(rowText(`${el.id}__ready`, Math.min(C64_ROWS - 1, row + 2), 0, "READY.", C64_TEXT));
    } else {
      // Not run yet (node, offline): RUN typed, and the machine waiting.
      runChildren.push(rowText(`${el.id}__runline`, Math.min(C64_ROWS - 1, row), 0, "RUN", C64_TEXT));
    }
    runChildren.push(...playMark());
  }
  out.push({ id: outId, kind: "group", z: Z_STROKE, style: defaultStyle(), drawOpts: resolveDrawOpts(undefined, { mode: "sketch", duration: 0 }), children: runChildren });
  return out;
}
