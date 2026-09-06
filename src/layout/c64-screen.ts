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
import { C64_BACKGROUND, C64_BOOT_LINES, C64_BORDER, C64_COLS, C64_PALETTE, C64_ROWS, C64_TEXT, isImmediate, type C64Screen } from "../code/c64";
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

  // The renderer paints three layers — areas, strokes, texts — so a field that
  // REPAINTS the screen after lines were typed has to live in the text layer,
  // or the old lines would show through it (Hans saw the output land on top
  // of the commands). The machine's own field stays under everything.
  const field = (sid: string, border: number, background: number, z = Z_AREA): Drawable[] => [
    {
      id: `${sid}__border`,
      kind: "area",
      pts: rectPts(x0, yTop - h, w, h),
      precise: true,
      z,
      style: resolveStyle(undefined, { fill: C64_PALETTE[border & 15], opacity: 1, strokeWidth: 0 }),
      drawOpts: resolveDrawOpts(undefined, { mode: "instant", duration: 0 }),
    },
    {
      id: `${sid}__screen`,
      kind: "area",
      pts: rectPts(screenX, screenTop - C64_ROWS * cell, C64_COLS * cell, C64_ROWS * cell),
      precise: true,
      z,
      style: resolveStyle(undefined, { fill: C64_PALETTE[background & 15], opacity: 1, strokeWidth: 0 }),
      drawOpts: resolveDrawOpts(undefined, { mode: "instant", duration: 0 }),
    },
  ];
  /** A run of text on a screen row, in one colour, set on the cell grid. A
   *  text's pos is its CENTRE (the backend sets dominant-baseline: central),
   *  and the face's em box is exactly the cell, so the centre of the cell it
   *  is — an earlier baseline offset put every row 0.375 cell too low. */
  const rowText = (sid: string, row: number, col: number, text: string, color: number, typed = false): Drawable => ({
    id: sid,
    kind: "text",
    pos: [screenX + col * cell, screenTop - cell * (row + 0.5)],
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
  /** The cursor: a white cell that blinks in the live figure. */
  const cursorCell = (sid: string, at: [number, number] | undefined): Drawable[] => {
    if (!at || at[0] >= C64_ROWS) return [];
    return [
      {
        id: sid,
        kind: "area",
        pts: rectPts(screenX + at[1] * cell, screenTop - cell * (at[0] + 1), cell, cell),
        precise: true,
        blink: true,
        z: Z_TEXT,
        style: resolveStyle(undefined, { fill: C64_PALETTE[C64_TEXT], opacity: 1, strokeWidth: 0 }),
        drawOpts: resolveDrawOpts(undefined, { mode: "instant", duration: 0 }),
      },
    ];
  };
  /** Everything a screen snapshot shows: the field in its colours, every run
   *  of text, the cursor — the machine at one moment. */
  const screenDrawables = (sid: string, screen: C64Screen): Drawable[] => {
    const outList: Drawable[] = [...field(sid, screen.border, screen.background, Z_TEXT)];
    screen.chars.forEach((line, r) => {
      let col = 0;
      while (col < line.length) {
        if (line[col] === " ") {
          col++;
          continue;
        }
        const c = screen.colors[r]?.[col] ?? "1";
        let end = col;
        while (end < line.length && (screen.colors[r]?.[end] ?? "1") === c && !(line[end] === " " && (end + 1 >= line.length || line[end + 1] === " "))) end++;
        outList.push(rowText(`${sid}__scr${r}_${col}`, r, col, line.slice(col, end), parseInt(c, 16)));
        col = end;
      }
    });
    outList.push(...cursorCell(`${sid}__cursor`, screen.cursor));
    return outList;
  };
  /**
   * The machine's menu: a small ≡ in the bottom-right corner of the border,
   * half transparent, the size of a couple of cells — a paused click opens
   * the ⊕ tray, which is what you can do with this Commodore (play a
   * program, write one, pick another from the catalogue or the Archive).
   * On every screen, not only one with a game, and repeated inside every
   * `_out` beat so a repaint never covers it. Ink, so it is in a movie too —
   * tiny and faint there, which is the price of one drawing for both.
   */
  const menuMark = (z = Z_STROKE): Drawable[] => {
    const mw = cell * 2.2;
    const mh = cell * 1.6;
    const mx = x0 + w - rim / 2 - mw / 2;
    const my = yTop - h + rim / 2 - mh / 2; // the band's bottom-right: its centre, then the pill around it
    const line = (k: number): Drawable => ({
      id: `${el.id}__menu_${k + 1}`,
      kind: "stroke",
      pts: [
        [mx + cell * 0.45, my + mh * (0.72 - 0.22 * k)],
        [mx + mw - cell * 0.45, my + mh * (0.72 - 0.22 * k)],
      ],
      z,
      style: resolveStyle(undefined, { color: C64_PALETTE[1], strokeWidth: Math.max(1.5, cell * 0.12), opacity: 0.55 }),
      drawOpts: resolveDrawOpts(undefined, { mode: "instant", duration: 0 }),
    });
    return [
      {
        id: `${el.id}__menu`,
        kind: "area",
        pts: rectPts(mx, my, mw, mh),
        precise: true,
        z,
        style: resolveStyle(undefined, { fill: C64_PALETTE[1], opacity: 0.12, strokeWidth: 0 }),
        drawOpts: resolveDrawOpts(undefined, { mode: "instant", duration: 0 }),
      },
      line(0),
      line(1),
      line(2),
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
    machine.push(...cursorCell(`${el.id}__cursor`, [C64_BOOT_LINES[C64_BOOT_LINES.length - 1][0] + 1, 0]));
  }
  machine.push(...menuMark());
  const out: Drawable[] = [
    { id: el.id, kind: "group", z: Z_STROKE, style: defaultStyle(), drawOpts: resolveDrawOpts(undefined, { mode: "sketch", duration: 0 }), children: machine },
  ];

  // ---- the listing, typed onto the screen ----------------------------------
  // In immediate mode a line is typed wherever the cursor was after the
  // line before — the run says where (lineRows); a program's lines stack from
  // the top. Without a run yet, both stack from the top.
  const immediate = lines.length > 0 && isImmediate(source);
  const blocks: { rows: string[] }[] = [];
  let row = 0;
  lines.forEach((line, i) => {
    const id = `${el.id}_line_${i + 1}`;
    const rowsOf = listingRows(line);
    blocks.push({ rows: rowsOf });
    if (immediate && result?.lineRows?.[i] !== undefined) row = result.lineRows[i];
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
  if (!immediate && row > C64_ROWS - 2) ctx.warnings.push(`code "${el.id}": a ${row}-row listing leaves the machine no room to RUN under it — keep a C64 program short`);

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

  // ---- what the machine shows after the lines ------------------------------
  // A program: `_out` is RUN — the field repainted with the screen the run
  // left. Immediate mode: `_out_k` is the screen after line k (typed, run,
  // answered, READY.), and `_out` is the last of them. Always minted, like a
  // panel's `_out`: an unresolved run keeps the beat.
  const beat = (sid: string, children: Drawable[]): Drawable => ({ id: sid, kind: "group", z: Z_STROKE, style: defaultStyle(), drawOpts: resolveDrawOpts(undefined, { mode: "sketch", duration: 0 }), children });
  const outId = `${el.id}_out`;
  if (immediate) {
    // One beat per line, minted whether or not the run has happened yet —
    // a storyboard written before the run must still find every id.
    lines.forEach((_, k) => {
      const sid = `${el.id}_out_${k + 1}`;
      const screen = result?.screens?.[k];
      ctx.extraOrder.push(sid);
      ctx.anchors[sid] = [cx, cy];
      out.push(beat(sid, screen ? [...screenDrawables(`${el.id}__o${k + 1}`, screen), ...menuMark(Z_TEXT)] : []));
    });
  }
  ctx.extraOrder.push(outId);
  ctx.anchors[outId] = [cx, cy];
  const runChildren: Drawable[] = [];
  if (lines.length > 0) {
    if (result?.screen) runChildren.push(...screenDrawables(`${el.id}__run`, result.screen));
    else runChildren.push(rowText(`${el.id}__runline`, Math.min(C64_ROWS - 1, row), 0, immediate ? "" : "RUN", C64_TEXT)); // not run yet (node, offline)
    runChildren.push(...menuMark(Z_TEXT));
  }
  out.push(beat(outId, runChildren));
  return out;
}
