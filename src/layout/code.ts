// The CODE element: a script's code and/or output as a panel of ordinary
// drawables — mono text lines, stdout lines, PNG plots — so line stepping,
// scrubbing, highlight and video export work exactly like any other ink.
// Geometry only: execution happened in the ensure phase (render/code.ts) and
// arrives stamped on el.code_result.
//
// Command-addressable ids minted here (reported via ctx.extraOrder):
//   <id>_line_1..N — one per source line (when the code pane is shown)
//   <id>_out       — the whole output pane. ALWAYS present, like a source's
//                    promised _quote: an unresolved run keeps the beat and
//                    draws ruled placeholder lines instead of nothing.

import { decodeCodeResult } from "../code/run";
import {
  COLORS,
  SKETCH_MS,
  Z_AREA,
  Z_STROKE,
  Z_TEXT,
  defaultStyle,
  type Drawable,
  type Pt,
} from "./model";
import { resolveDrawOpts, resolveStyle } from "./resolve";
import type { SpecElement } from "../spec/types";

/** Mono glyph advance as a fraction of font size — fixed-pitch, so exact
 *  enough to lay out without a browser measurer (deterministic in node). */
const CHAR_W = 0.62;
/** Vertical advance per wrapped row (matches drawLeaf's tspan spacing). */
const ROW_H = 1.25;
/** Extra gap between SOURCE lines, so wrapped continuations read as one. */
const LINE_GAP = 0.35;
const PAD = 16;

export interface CodeCtx {
  anchors: Record<string, Pt>;
  extraOrder: string[];
  warnings: string[];
}

/** Wrap one source line at maxChars with a hanging indent that preserves the
 *  line's own leading whitespace (a wrapped continuation stays visibly inside
 *  its statement). A line indented too deeply to wrap sensibly is returned
 *  unwrapped — it overflows visually, and the narrow-split lint already
 *  warns about the pane that caused it. */
export function wrapCodeLine(line: string, maxChars: number): string[] {
  if (line.length <= maxChars) return [line];
  const lead = /^\s*/.exec(line)![0];
  const indent = `${lead}  `;
  if (indent.length + 4 > maxChars) return [line];
  const rows: string[] = [];
  let rest = line;
  let minCut = lead.length;
  while (rest.length > maxChars) {
    let cut = rest.lastIndexOf(" ", maxChars);
    if (cut <= minCut) cut = maxChars;
    rows.push(rest.slice(0, cut));
    rest = indent + rest.slice(cut).trimStart();
    minCut = indent.length;
  }
  rows.push(rest);
  return rows;
}

interface TextBlock {
  rows: string[];
  /** Center y offset from the pane top, in logical units (positive = down). */
  center: number;
  height: number;
}

/** Stack wrapped lines top-down; returns blocks + total content height. */
function stackLines(lines: string[][], fontSize: number): { blocks: TextBlock[]; height: number } {
  const blocks: TextBlock[] = [];
  let y = 0;
  for (const rows of lines) {
    const height = (1 + (rows.length - 1) * ROW_H) * fontSize;
    blocks.push({ rows, center: y + height / 2, height });
    y += height + fontSize * LINE_GAP;
  }
  return { blocks, height: Math.max(0, y - fontSize * LINE_GAP) };
}

export function codeDrawables(el: SpecElement, ctx: CodeCtx): Drawable[] {
  const show = el.show ?? "output";
  const w = el.width ?? 880;
  const cx = el.x ?? 500;
  const cy = el.y ?? 400;
  const fontSize = el.font_size ?? 17;
  const result = decodeCodeResult(el.code_result);
  const paneGap = 14;
  const codePaneW = show === "split" ? Math.round(w * 0.55) : w;
  const outPaneW = show === "split" ? w - codePaneW - paneGap : w;
  const showCode = show !== "output";
  const showOut = show !== "code";

  // ---- code pane content ---------------------------------------------------
  const sourceLines = (el.code ?? "").replace(/\s+$/, "").split("\n");
  const codeMax = Math.max(8, Math.floor((codePaneW - 2 * PAD) / (fontSize * CHAR_W)));
  const codeStack = showCode ? stackLines(sourceLines.map((l) => wrapCodeLine(l, codeMax)), fontSize) : { blocks: [], height: 0 };

  // ---- output pane content -------------------------------------------------
  const outMax = Math.max(8, Math.floor((outPaneW - 2 * PAD) / (fontSize * CHAR_W)));
  const failed = result !== null && (!result.ok || !!result.error);
  const outTextLines: { text: string; color?: string }[] = [];
  if (failed) {
    for (const row of wrapCodeLine(`✗ ${result!.error ?? result!.stderr}`.replace(/\n/g, " ⏎ "), outMax)) {
      outTextLines.push({ text: row, color: COLORS.regionLoss });
    }
  } else if (result) {
    for (const line of result.stdout === "" ? [] : result.stdout.split("\n")) {
      for (const row of wrapCodeLine(line, outMax)) outTextLines.push({ text: row });
    }
    if (result.stderr.trim() !== "") {
      for (const row of wrapCodeLine(result.stderr.trim(), outMax)) outTextLines.push({ text: row, color: COLORS.guide });
    }
  }
  const figures = failed || !result ? [] : result.figures;
  const figW = outPaneW - 2 * PAD;
  const figHeights = figures.map((f) => (f.w > 0 ? figW * (f.h / f.w) : figW * 0.75));
  const outStack = stackLines(outTextLines.map((l) => [l.text]), fontSize);
  const outContentH = showOut
    ? Math.max(
        3 * fontSize * (1 + LINE_GAP), // placeholder floor
        outStack.height + figHeights.reduce((a, b) => a + b + fontSize * LINE_GAP, 0),
      )
    : 0;

  // ---- panel geometry (y-up: yTop is the LARGER y) -------------------------
  const contentH = Math.max(showCode ? codeStack.height : 0, outContentH);
  const h = Math.max(60, contentH + 2 * PAD);
  if (h > 700) ctx.warnings.push(`code "${el.id}": panel is ${Math.round(h)} logical units tall — trim the script or its output`);
  const x0 = cx - w / 2;
  const yTop = cy + h / 2;
  const rect: Pt[] = [
    [x0, yTop - h],
    [x0 + w, yTop - h],
    [x0 + w, yTop],
    [x0, yTop],
  ];

  const panelChildren: Drawable[] = [
    {
      id: `${el.id}__bg`,
      kind: "area",
      pts: rect,
      precise: true,
      z: Z_AREA,
      style: resolveStyle(undefined, { fill: COLORS.paper, opacity: 1, strokeWidth: 0 }),
      drawOpts: resolveDrawOpts(undefined, { mode: "instant", duration: 0 }),
    },
    {
      id: `${el.id}__frame`,
      kind: "stroke",
      pts: rect,
      closed: true,
      shapeHint: { type: "rect", x: x0, y: yTop - h, w, h },
      z: Z_STROKE,
      style: resolveStyle(el.style, { strokeWidth: 2.5 }),
      drawOpts: resolveDrawOpts(el.draw, { mode: "sketch", duration: SKETCH_MS.node }),
    },
  ];
  if (show === "split") {
    const dx = x0 + codePaneW + paneGap / 2;
    panelChildren.push({
      id: `${el.id}__divider`,
      kind: "stroke",
      pts: [
        [dx, yTop - PAD / 2],
        [dx, yTop - h + PAD / 2],
      ],
      z: Z_STROKE,
      style: resolveStyle(undefined, { color: COLORS.guide, strokeWidth: 2, dash: true }),
      drawOpts: resolveDrawOpts(undefined, { mode: "instant", duration: 0 }),
    });
  }

  const out: Drawable[] = [
    { id: el.id, kind: "group", z: Z_STROKE, style: defaultStyle(), drawOpts: resolveDrawOpts(undefined, { mode: "sketch", duration: 0 }), children: panelChildren },
  ];
  ctx.anchors[el.id] = [cx, cy];

  // ---- code lines: one top-level drawable per SOURCE line ------------------
  if (showCode) {
    codeStack.blocks.forEach((block, i) => {
      const id = `${el.id}_line_${i + 1}`;
      const pos: Pt = [x0 + PAD, yTop - PAD - block.center];
      ctx.extraOrder.push(id);
      ctx.anchors[id] = pos;
      out.push({
        id,
        kind: "text",
        pos,
        text: block.rows.join(" "),
        lines: block.rows.length > 1 ? block.rows : undefined,
        fontSize,
        anchor: "start",
        font: "mono",
        z: Z_TEXT,
        style: resolveStyle(el.style, {}),
        drawOpts: resolveDrawOpts(el.draw, { mode: "sketch", duration: SKETCH_MS.text }),
      });
    });
  }

  // ---- output pane: one group, always minted -------------------------------
  const outX = show === "split" ? x0 + codePaneW + paneGap : x0;
  const outChildren: Drawable[] = [];
  if (showOut) {
    if (!result) {
      // Unresolved (node tests, offline, runtime missing): the source
      // element's ruled-placeholder idiom, so the beat draws SOMETHING.
      for (let i = 0; i < 3; i++) {
        const ly = yTop - PAD - fontSize * (0.8 + i * 1.6);
        outChildren.push({
          id: `${el.id}__rule${i}`,
          kind: "stroke",
          pts: [
            [outX + PAD, ly],
            [outX + outPaneW - PAD * (i === 2 ? 3 : 1), ly],
          ],
          z: Z_STROKE,
          style: resolveStyle(undefined, { color: COLORS.guide, strokeWidth: 2.5 }),
          drawOpts: resolveDrawOpts(undefined, { mode: "instant", duration: 0 }),
        });
      }
    } else {
      outStack.blocks.forEach((block, i) => {
        outChildren.push({
          id: `${el.id}__out${i}`,
          kind: "text",
          pos: [outX + PAD, yTop - PAD - block.center],
          text: block.rows.join(" "),
          fontSize,
          anchor: "start",
          font: "mono",
          z: Z_TEXT,
          style: resolveStyle(el.style, outTextLines[i]?.color ? { color: outTextLines[i].color } : {}),
          drawOpts: resolveDrawOpts(el.draw, { mode: "sketch", duration: SKETCH_MS.text }),
        });
      });
      let figTop = outStack.height + (outStack.height > 0 ? fontSize * LINE_GAP : 0);
      figures.forEach((f, k) => {
        const fh = figHeights[k];
        outChildren.push({
          id: `${el.id}__fig${k}`,
          kind: "image",
          href: f.href,
          pos: [outX + PAD + figW / 2, yTop - PAD - figTop - fh / 2],
          w: figW,
          h: fh,
          z: Z_STROKE,
          style: resolveStyle(undefined, {}),
          reveal: el.reveal ?? "fade",
          drawOpts: resolveDrawOpts(el.draw, { mode: "sketch", duration: 900 }),
        });
        figTop += fh + fontSize * LINE_GAP;
      });
    }
  }
  const outId = `${el.id}_out`;
  ctx.extraOrder.push(outId);
  ctx.anchors[outId] = [outX + outPaneW / 2, cy];
  out.push({ id: outId, kind: "group", z: Z_STROKE, style: defaultStyle(), drawOpts: resolveDrawOpts(undefined, { mode: "sketch", duration: 0 }), children: outChildren });

  return out;
}
