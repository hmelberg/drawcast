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
//   <id>_fig_1..K  — multi-figure mode (el.figures >= 2, or a run that
//                    produced several figures): each figure is its own beat,
//                    all sharing ONE slot in the output pane — slides in a
//                    frame. Drawing the next covers the previous (later
//                    drawables paint on top), erase plays an exit; with the
//                    axes limits held fixed across stages the swap reads as
//                    the chart itself changing. Declared but unresolved
//                    figures are empty-stroke promises (the quote pattern),
//                    so storyboard beats survive node tests and offline.

// Envelope types come from the dependency-free code/envelope module, not
// code/run — layout is a pure geometry layer and must never transitively
// pull render/portrait (IndexedDB) in through the execution facade.
import { decodeCodeResult, type CodeTable } from "../code/envelope";
import { CANVAS } from "./canvas";
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
/** Layout's own cap on drawn table rows (the harvest already caps at 30). */
const TABLE_MAX_ROWS = 24;
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
    // Row height matches the renderer's/lint's 1.25 line box (ROW_H), so adjacent lines clear the overlap lint's 2-unit pad.
    const height = rows.length * ROW_H * fontSize;
    blocks.push({ rows, center: y + height / 2, height });
    y += height + fontSize * LINE_GAP;
  }
  return { blocks, height: Math.max(0, y - fontSize * LINE_GAP) };
}

/** Keep as many leading rows as fit within `budget`; if any must drop, drop
 *  one extra too and replace it with a "N more lines" marker row in
 *  `COLORS.guide`, so the cut is visible instead of silently clipping off
 *  the canvas. Deterministic: the same input always drops the same rows. */
function truncateRows(
  rows: { text: string; color?: string }[],
  budget: number,
  fontSize: number,
): { rows: { text: string; color?: string }[]; dropped: number } {
  if (rows.length === 0) return { rows, dropped: 0 };
  const rowH = fontSize * ROW_H;
  const gap = fontSize * LINE_GAP;
  let used = 0;
  let fit = 0;
  for (let i = 0; i < rows.length; i++) {
    const next = used + (i === 0 ? rowH : gap + rowH);
    if (next > budget) break;
    used = next;
    fit = i + 1;
  }
  if (fit >= rows.length) return { rows, dropped: 0 };
  const kept = Math.max(0, fit - 1);
  return {
    rows: [...rows.slice(0, kept), { text: `… (${rows.length - kept} more lines)`, color: COLORS.guide }],
    dropped: rows.length - kept,
  };
}

/** A DataFrame as a ruled grid: header row in guide color over an ink rule,
 *  then data rows, all mono. Columns are sized to their widest cell (clamped
 *  to the pane), rows capped to the height budget. Pure geometry — every cell
 *  was already stringified in Python. Returns drawables + the grid's height. */
function tableDrawables(
  table: CodeTable,
  idPrefix: string,
  x0: number,
  yTop: number,
  paneW: number,
  budget: number,
  fontSize: number,
): { drawables: Drawable[]; height: number } {
  const cellPad = fontSize * 0.5;
  const rowH = fontSize * 1.55;
  const usableW = paneW - 2 * PAD;
  const nCols = Math.max(1, table.columns.length);

  // Column widths ∝ widest cell (header included), clamped to the pane.
  const rawW = table.columns.map((c, i) => {
    let max = c.length;
    for (const r of table.rows) max = Math.max(max, (r[i] ?? "").length);
    return max * fontSize * CHAR_W + 2 * cellPad;
  });
  const totalRaw = rawW.reduce((a, b) => a + b, 0) || 1;
  const colW = rawW.map((wv) => (wv / totalRaw) * usableW);
  const colX = (i: number) => x0 + PAD + colW.slice(0, i).reduce((a, b) => a + b, 0);

  // Cap rows to the budget (leave the header row and one for a truncation note).
  const headerRows = 1;
  const maxDataRows = Math.max(1, Math.floor(budget / rowH) - headerRows);
  const shownRows = table.rows.slice(0, maxDataRows);
  const droppedInLayout = table.rows.length - shownRows.length;
  const totalDropped = (table.truncated ?? 0) + droppedInLayout;
  const nRows = headerRows + shownRows.length + (totalDropped > 0 ? 1 : 0);
  const gridH = nRows * rowH;

  const rowTop = (r: number) => yTop - r * rowH; // r=0 header top edge
  const clip = (text: string, wv: number) => {
    const max = Math.max(1, Math.floor((wv - 2 * cellPad) / (fontSize * CHAR_W)));
    return text.length > max ? `${text.slice(0, Math.max(1, max - 1))}…` : text;
  };
  const drawables: Drawable[] = [];

  // Header cells.
  table.columns.forEach((c, i) => {
    drawables.push({
      id: `${idPrefix}__th${i}`,
      kind: "text",
      pos: [colX(i) + cellPad, rowTop(0) - rowH / 2],
      text: clip(c, colW[i]),
      fontSize,
      anchor: "start",
      font: "mono",
      z: Z_TEXT,
      style: resolveStyle(undefined, { color: COLORS.ink }),
      drawOpts: resolveDrawOpts(undefined, { mode: "sketch", duration: SKETCH_MS.text }),
    });
  });
  // Data cells.
  shownRows.forEach((row, r) => {
    row.forEach((cell, i) => {
      if (i >= nCols) return;
      drawables.push({
        id: `${idPrefix}__td${r}_${i}`,
        kind: "text",
        pos: [colX(i) + cellPad, rowTop(headerRows + r) - rowH / 2],
        text: clip(cell ?? "", colW[i]),
        fontSize,
        anchor: "start",
        font: "mono",
        z: Z_TEXT,
        style: resolveStyle(undefined, {}),
        drawOpts: resolveDrawOpts(undefined, { mode: "sketch", duration: SKETCH_MS.text }),
      });
    });
  });
  if (totalDropped > 0) {
    drawables.push({
      id: `${idPrefix}__tmore`,
      kind: "text",
      pos: [x0 + PAD + cellPad, rowTop(nRows - 1) - rowH / 2],
      text: `… ${totalDropped} more rows`,
      fontSize,
      anchor: "start",
      font: "mono",
      z: Z_TEXT,
      style: resolveStyle(undefined, { color: COLORS.guide }),
      drawOpts: resolveDrawOpts(undefined, { mode: "sketch", duration: SKETCH_MS.text }),
    });
  }
  // Rules: the header underline in ink, the rest in guide.
  for (let r = 1; r < nRows; r++) {
    const yy = rowTop(r);
    drawables.push({
      id: `${idPrefix}__tr${r}`,
      kind: "stroke",
      pts: [[x0 + PAD, yy], [x0 + PAD + usableW, yy]],
      z: Z_STROKE,
      style: resolveStyle(undefined, { color: r === 1 ? COLORS.ink : COLORS.guide, strokeWidth: r === 1 ? 2 : 1 }),
      drawOpts: resolveDrawOpts(undefined, { mode: "instant", duration: 0 }),
    });
  }
  return { drawables, height: gridH };
}

export function codeDrawables(el: SpecElement, ctx: CodeCtx): Drawable[] {
  const show = el.show ?? "output";
  // A pure data source draws nothing, mints no ids and has no anchors, so the
  // only thing it can still contribute is a harvest warning. This function
  // re-runs on EVERY animate tick, and the envelope it would parse carries
  // figure PNGs — so look for the warning key in the raw string first and skip
  // the JSON.parse entirely when there is none (spec §10).
  if (show === "none" && !(el.code_result ?? "").includes('"dataErrors"')) return [];
  const result = decodeCodeResult(el.code_result);
  // Harvest failures (a "{sim.df.gdp}" the script could not serve) reach the
  // lint chip through here: the resolver stamped them on the envelope, and
  // this is the one place resolve-time trouble becomes a LayoutResult warning.
  for (const [path, msg] of Object.entries(result?.dataErrors ?? {})) {
    ctx.warnings.push(`code "${el.id}": {${el.id}.${path}} — ${msg}`);
  }
  if (show === "none") return [];
  const w = el.width ?? 880;
  const cx = el.x ?? 500;
  const cy = el.y ?? 400;
  const fontSize = el.font_size ?? 17;
  const paneGap = 14;
  const codePaneW = show === "left" ? Math.round(w * 0.55) : w;
  const outPaneW = show === "left" ? w - codePaneW - paneGap : w;
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
  const rawFigures = failed || !result ? [] : result.figures;
  const rawTables = failed || !result ? [] : result.tables ?? [];
  const figW = outPaneW - 2 * PAD;

  // Multi-figure mode: several figures share ONE slot as replaceable slides
  // (<id>_fig_N beats). Entered by declaration (el.figures — the promise that
  // keeps beats alive before the script has run) or by a run that actually
  // produced several figures.
  const declaredFigs = typeof el.figures === "number" && el.figures >= 2 ? Math.floor(el.figures) : 0;
  const multiFig = declaredFigs >= 2 || rawFigures.length >= 2;
  const figCount = multiFig ? Math.max(declaredFigs, rawFigures.length) : rawFigures.length;
  if (result && declaredFigs >= 2 && rawFigures.length !== declaredFigs && !failed) {
    ctx.warnings.push(
      `code "${el.id}": figures declares ${declaredFigs} but the script produced ${rawFigures.length} — beats for the missing ones stay empty`,
    );
  }

  // ---- clamp output content to the canvas ----------------------------------
  // A chatty stdout (an unsuppressed plot-call echo, say) or one full-width
  // figure used to grow the panel unbounded, pushing its TOP — the code
  // lines — off the 750-unit canvas. Cap the panel and fit everything inside.
  const maxH = CANVAS.h - 40; // breathing room top+bottom
  const outBudget = showOut ? maxH - 2 * PAD : 0;
  // Figures matter more than a wall of print() text: stdout gets at most
  // half the budget when a figure is present, all of it when there is none.
  const stdoutBudget = rawFigures.length > 0 ? outBudget / 2 : outBudget;
  let truncated = false;
  let outRows: { text: string; color?: string }[] = [];
  let outStack: { blocks: TextBlock[]; height: number } = { blocks: [], height: 0 };
  const figHeights: number[] = [];
  const figWidths: number[] = [];
  // Tables' height estimate (a header + capped rows), so the panel sizes to
  // include them; the real grid is drawn in the output children below with
  // the same row metric.
  const tableRowH = fontSize * 1.55;
  const tableHeights = showOut
    ? rawTables.map((t) => (1 + Math.min(t.rows.length, TABLE_MAX_ROWS) + ((t.truncated ?? 0) > 0 ? 1 : 0)) * tableRowH)
    : [];
  const tablesH = tableHeights.reduce((a, b) => a + b + fontSize * LINE_GAP, 0);

  if (showOut) {
    const fit = truncateRows(outTextLines, stdoutBudget, fontSize);
    outRows = fit.rows;
    if (fit.dropped > 0) truncated = true;
    outStack = stackLines(outRows.map((l) => [l.text]), fontSize);

    if (multiFig) {
      // One shared slot: every figure is fitted into the SAME space after the
      // stdout block (preserving aspect), because they are slides meant to
      // replace one another, not a stack meant to coexist.
      const slotAvail = Math.max(
        0,
        outBudget - outStack.height - (outStack.height > 0 ? fontSize * LINE_GAP : 0),
      );
      rawFigures.forEach((f) => {
        const naturalH = f.w > 0 ? figW * (f.h / f.w) : figW * 0.75;
        const fh = Math.min(naturalH, slotAvail);
        if (fh < naturalH) truncated = true;
        figHeights.push(fh);
        figWidths.push(f.h > 0 ? fh * (f.w / f.h) : figW);
      });
    } else {
      // Figures share whatever is left after stdout, top to bottom; each is
      // scaled down (preserving aspect, so its width shrinks too) to fit the
      // space actually left for it — a figure never renders taller than that.
      let remaining = Math.max(0, outBudget - outStack.height - (outStack.height > 0 ? fontSize * LINE_GAP : 0));
      rawFigures.forEach((f, i) => {
        const naturalH = f.w > 0 ? figW * (f.h / f.w) : figW * 0.75;
        const gapBefore = i > 0 || outStack.height > 0 ? fontSize * LINE_GAP : 0;
        const avail = Math.max(0, remaining - gapBefore);
        const fh = Math.min(naturalH, avail);
        if (fh < naturalH) truncated = true;
        figHeights.push(fh);
        figWidths.push(f.h > 0 ? fh * (f.w / f.h) : figW);
        remaining = Math.max(0, remaining - gapBefore - fh);
      });
    }
  }
  const slotH = multiFig ? figHeights.reduce((a, b) => Math.max(a, b), 0) : 0;
  const outContentH = showOut
    ? Math.max(
        3 * fontSize * (1 + LINE_GAP), // placeholder floor
        outStack.height +
          (tablesH > 0 ? tablesH + (outStack.height > 0 ? fontSize * LINE_GAP : 0) : 0) +
          (multiFig
            ? slotH > 0
              ? slotH + fontSize * LINE_GAP
              : 0
            : figHeights.reduce((a, b) => a + b + fontSize * LINE_GAP, 0)),
      )
    : 0;

  // ---- panel geometry (y-up: yTop is the LARGER y) -------------------------
  const contentH = Math.max(showCode ? codeStack.height : 0, outContentH);
  const h = Math.min(maxH, Math.max(60, contentH + 2 * PAD));
  if (truncated || contentH + 2 * PAD > maxH) {
    ctx.warnings.push(`code "${el.id}": output was truncated/scaled to fit the panel within the canvas`);
  }
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
  if (show === "left") {
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
  const outX = show === "left" ? x0 + codePaneW + paneGap : x0;
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
          style: resolveStyle(el.style, outRows[i]?.color ? { color: outRows[i].color } : {}),
          drawOpts: resolveDrawOpts(el.draw, { mode: "sketch", duration: SKETCH_MS.text }),
        });
      });
      // Tables sit below stdout, above figures — a ruled grid per DataFrame.
      let contentTop = outStack.height + (outStack.height > 0 ? fontSize * LINE_GAP : 0);
      rawTables.forEach((t, k) => {
        const grid = tableDrawables(t, `${el.id}__tbl${k}`, outX, yTop - PAD - contentTop, outPaneW, tableHeights[k], fontSize);
        outChildren.push(...grid.drawables);
        contentTop += grid.height + fontSize * LINE_GAP;
      });
      if (!multiFig) {
        let figTop = contentTop;
        rawFigures.forEach((f, k) => {
          const fh = figHeights[k];
          const fw = figWidths[k];
          outChildren.push({
            id: `${el.id}__fig${k}`,
            kind: "image",
            href: f.href,
            pos: [outX + PAD + figW / 2, yTop - PAD - figTop - fh / 2],
            w: fw,
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
  }
  const outId = `${el.id}_out`;
  ctx.extraOrder.push(outId);
  ctx.anchors[outId] = [outX + outPaneW / 2, cy];
  out.push({ id: outId, kind: "group", z: Z_STROKE, style: defaultStyle(), drawOpts: resolveDrawOpts(undefined, { mode: "sketch", duration: 0 }), children: outChildren });

  // ---- multi-figure beats: slides sharing one slot -------------------------
  // Top-level (never children of <id>_out) so each is its own storyboard
  // beat; minted in order, so a later slide paints OVER an earlier one — a
  // plain draw replaces, an erase-first plays the exit too. When the run has
  // not happened (node tests, offline) declared beats are empty-stroke
  // promises, the source element's _quote idiom.
  if (multiFig) {
    const slotTop = outStack.height + (outStack.height > 0 ? fontSize * LINE_GAP : 0);
    const slotCenter: Pt = [outX + PAD + figW / 2, yTop - PAD - slotTop - slotH / 2];
    for (let k = 0; k < figCount; k++) {
      const id = `${el.id}_fig_${k + 1}`;
      ctx.extraOrder.push(id);
      ctx.anchors[id] = slotCenter;
      const f = showOut ? rawFigures[k] : undefined;
      if (f) {
        out.push({
          id,
          kind: "image",
          href: f.href,
          pos: slotCenter,
          w: figWidths[k],
          h: figHeights[k],
          z: Z_STROKE,
          style: resolveStyle(undefined, {}),
          reveal: el.reveal ?? "fade",
          drawOpts: resolveDrawOpts(el.draw, { mode: "sketch", duration: 900 }),
        });
      } else {
        out.push({
          id,
          kind: "stroke",
          pts: [],
          z: Z_STROKE,
          style: resolveStyle(el.style, {}),
          drawOpts: resolveDrawOpts(el.draw, { mode: "sketch", duration: 600 }),
        });
      }
    }
  }

  return out;
}
