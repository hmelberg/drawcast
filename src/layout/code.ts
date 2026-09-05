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
import { C64_BOOT_LINES, C64_BACKGROUND, C64_BORDER, C64_COLS, C64_PALETTE, C64_SCREEN_ASPECT, C64_TEXT } from "../code/c64";
import { stylable } from "../code/chart-style";
import { decodeCodeResult, type CodeTable } from "../code/envelope";
import { FIGURE_GROUND } from "./ink";
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
import type { BBox } from "./geometry";
import { resolveDrawOpts, resolveStyle } from "./resolve";
import type { SpecElement } from "../spec/types";

/** Mono glyph advance as a fraction of font size — fixed-pitch, so exact
 *  enough to lay out without a browser measurer (deterministic in node). */
/** Monospace advance as a fraction of the font size — the wrapper measures
 *  with it, and so does the figure split when it sizes a panel to its script. */
export const CHAR_W = 0.62;
/** Vertical advance per wrapped row (matches drawLeaf's tspan spacing). */
const ROW_H = 1.25;
/** Layout's own cap on drawn table rows (the harvest already caps at 30). */
const TABLE_MAX_ROWS = 24;
/** Extra gap between SOURCE lines, so wrapped continuations read as one. */
const LINE_GAP = 0.35;
/** Baseline-to-baseline distance between two unwrapped source lines, in em —
 *  the pitch the in-place editor's text area copies so its rows land on the
 *  drawn ones. */
export const LINE_PITCH = ROW_H + LINE_GAP;
export const PAD = 16;
/** Typing speed of the `type` draw mode, characters per second. */
const TYPE_CPS = 28;

/** One highlighter pass over the code: the drawn text to cover, and how. */
export interface CodeMark {
  text: string;
  kind: "mark" | "strike" | "underline";
}

/** An author writes a string (the marker) or names a kind. Normalised here so
 *  the rule is one place and node-testable. */
export function normalizeMarks(marks: SpecElement["marks"]): CodeMark[] {
  return (marks ?? []).map((m) => (typeof m === "string" ? { text: m, kind: "mark" as const } : { text: m.text, kind: m.kind ?? "mark" }));
}

/**
 * Where a mark's text sits in the DRAWN rows — block, row within it, and
 * column. The rows, not the source lines: a wrapped line is two rows on
 * screen, and a marker draws over what the reader can see. First hit wins;
 * null when the text is not on screen as one piece (wrapping split it, or it
 * is simply not there), which the caller reports rather than guessing.
 */
export function findMarkRow(blocks: { rows: string[] }[], text: string): { block: number; row: number; col: number } | null {
  if (text === "") return null;
  for (let b = 0; b < blocks.length; b++) {
    for (let r = 0; r < blocks[b].rows.length; r++) {
      const col = blocks[b].rows[r].indexOf(text);
      if (col >= 0) return { block: b, row: r, col };
    }
  }
  return null;
}

/** A windowed code pane, published for the plan: its line ids in order, each
 *  line's bottom edge as a distance from the pane's content top (logical
 *  units, positive down), and the window's content height. The plan scrolls
 *  so the highest visible line's bottom sits at the window's bottom. */
export interface CodeWindow {
  ids: string[];
  bottoms: number[];
  height: number;
  /** Ids that ride the same scroll without deciding it — the marks, which
   *  belong to a line and must travel with it, but whose own extent must not
   *  count as "the lowest thing on screen". */
  follow?: string[];
}

export interface CodeCtx {
  anchors: Record<string, Pt>;
  extraOrder: string[];
  warnings: string[];
  windows: Record<string, CodeWindow>;
  panes: Record<string, BBox>;
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
  keep: "head" | "tail" = "head",
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
  // "tail" is the terminal's view — the newest rows stay, the oldest have
  // scrolled away behind a leading ellipsis.
  if (keep === "tail") {
    return {
      rows: [{ text: "…", color: COLORS.guide }, ...rows.slice(rows.length - kept)],
      dropped: rows.length - kept,
    };
  }
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
  const sideBySide = show === "left" || show === "right";
  const stacked = show === "above" || show === "below";
  const codePaneW = sideBySide ? Math.round(w * 0.55) : w;
  const outPaneW = sideBySide ? w - codePaneW - paneGap : w;
  const showCode = show !== "output";
  const showOut = show !== "code";
  // The window (el.lines): the code pane is this many rows tall; lines beyond
  // it sit below the pane, clipped, until the plan's scroll offsets slide
  // them up as the storyboard steps past the window.
  const windowRows = typeof el.lines === "number" && el.lines >= 3 ? Math.floor(el.lines) : 0;

  // ---- code pane content ---------------------------------------------------
  const sourceLines = (el.code ?? "").replace(/\s+$/, "").split("\n");
  const codeMax = Math.max(8, Math.floor((codePaneW - 2 * PAD) / (fontSize * CHAR_W)));
  const codeStack = showCode ? stackLines(sourceLines.map((l) => wrapCodeLine(l, codeMax)), fontSize) : { blocks: [], height: 0 };
  const windowH = windowRows > 0 ? windowRows * fontSize * ROW_H + (windowRows - 1) * fontSize * LINE_GAP : codeStack.height;
  const codeContentH = showCode ? Math.min(codeStack.height, windowH) : 0;

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
  if (el.chart !== undefined && el.language !== undefined && !stylable(el.language)) {
    ctx.warnings.push(
      `code "${el.id}": chart: "${el.chart}" needs language: "python" — ${el.language} draws its charts through an emulation with no matplotlib styles`,
    );
  }
  if (result && declaredFigs >= 2 && rawFigures.length !== declaredFigs && !failed) {
    ctx.warnings.push(
      `code "${el.id}": figures declares ${declaredFigs} but the script produced ${rawFigures.length} — beats for the missing ones stay empty`,
    );
  }

  // ---- clamp output content to the canvas ----------------------------------
  // A chatty stdout (an unsuppressed plot-call echo, say) or one full-width
  // figure used to grow the panel unbounded, pushing its TOP — the code
  // lines — off the 750-unit canvas. Cap the panel and fit everything inside.
  // The screen's chrome claims its space from the same budget as the panel:
  // the whole assembly (bar or bezel, panel, stand or keyboard) stays
  // centred on the element's y and inside the canvas. Bare paper is the
  // DEFAULT (Hans, 2026-09-04): the drawing carries the figure, and chrome
  // is something a lesson asks for — `frame: "screen"` when the story is
  // "this happened on a computer".
  const frame: CodeFrame = el.frame ?? "none";
  const chrome = frameSpace(frame);
  const maxH = CANVAS.h - 40 - chrome.above - chrome.below; // breathing room top+bottom
  // Stacked panes share the height: the code pane (or its window) is fixed
  // and the output gets what remains. Side by side, each pane has it all.
  const outBudget = showOut ? Math.max(0, maxH - 2 * PAD - (stacked ? codeContentH + paneGap : 0)) : 0;
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
    // A windowed panel reads like a terminal: the newest rows stay, the
    // oldest scroll away behind an ellipsis.
    const fit = truncateRows(outTextLines, stdoutBudget, fontSize, windowRows > 0 ? "tail" : "head");
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
  // A game with nothing run yet IS a screen: the C64's own boot screen, 40 × 25
  // characters at 8 × 8, so the pane takes that shape rather than the three
  // ruled placeholder lines an unresolved run would get.
  // …and a BASIC run's screen is the same shape: the envelope carries the 40 × 25
  // grid a run left behind, and it is drawn in place of stdout.
  const runScreen = showOut && !failed && result?.screen !== undefined ? result.screen : null;
  const gameScreen = showOut && ((el.game !== undefined && !result && (el.code ?? "").trim() === "") || runScreen !== null);
  const outContentH = !showOut
    ? 0
    : gameScreen
      ? Math.min(outBudget, (outPaneW - 2 * PAD) / C64_SCREEN_ASPECT)
      : Math.max(
        3 * fontSize * (1 + LINE_GAP), // placeholder floor
        outStack.height +
          (tablesH > 0 ? tablesH + (outStack.height > 0 ? fontSize * LINE_GAP : 0) : 0) +
          (multiFig
            ? slotH > 0
              ? slotH + fontSize * LINE_GAP
              : 0
            : figHeights.reduce((a, b) => a + b + fontSize * LINE_GAP, 0)),
        );

  // ---- panel geometry (y-up: yTop is the LARGER y) -------------------------
  const contentH = stacked ? codeContentH + paneGap + outContentH : Math.max(codeContentH, outContentH);
  const h = Math.min(maxH, Math.max(60, contentH + 2 * PAD));
  if (truncated || contentH + 2 * PAD > maxH) {
    ctx.warnings.push(`code "${el.id}": output was truncated/scaled to fit the panel within the canvas`);
  }
  const x0 = cx - w / 2;
  // The assembly (chrome included) centres on the element's y, then is nudged
  // to stay ON the canvas — a tall panel on a deep frame used to push its own
  // top off the top edge — and, when there is slack, to clear the narration
  // band at the bottom rather than stand its foot behind it.
  let yTop = cy + (h + chrome.above + chrome.below) / 2 - chrome.above;
  const CAPTION_H = 64;
  const overTop = yTop + chrome.above - (CANVAS.h - 8);
  if (overTop > 0) yTop -= overTop;
  const underBottom = CAPTION_H - (yTop - h - chrome.below);
  if (underBottom > 0) yTop += Math.max(0, Math.min(underBottom, CANVAS.h - 8 - (yTop + chrome.above)));
  const rect: Pt[] = [
    [x0, yTop - h],
    [x0 + w, yTop - h],
    [x0 + w, yTop],
    [x0, yTop],
  ];

  // Chrome first (it sits behind and around), then the panel's own paper
  // and frame — none of it for frame: none, bare paper.
  const panelChildren: Drawable[] = [...chromeDrawables(el.id, frame, x0, yTop, w, h, el.style, el.draw)];
  const shelled = frame !== "panel" && frame !== "window" && frame !== "none"; // a display's outline IS its frame
  if (frame !== "none") {
    panelChildren.push(
      {
        id: `${el.id}__bg`,
        kind: "area",
        pts: rect,
        precise: true,
        z: Z_AREA,
        // The figure's own sheet, not a second near-white: a panel is a
        // region of the paper, and two whites a value apart were one of the
        // near-identical fields that made the screen read as clutter
        // (2026-09-05). COLORS.paper stays what its docstring says it is — a
        // knock-out white for shapes over a TINTED ground.
        style: resolveStyle(undefined, { fill: FIGURE_GROUND, opacity: 1, strokeWidth: 0 }),
        drawOpts: resolveDrawOpts(undefined, { mode: "instant", duration: 0 }),
      },
    );
    if (!shelled) {
      panelChildren.push({
        id: `${el.id}__frame`,
        kind: "stroke",
        pts: rect,
        closed: true,
        shapeHint: { type: "rect", x: x0, y: yTop - h, w, h },
        z: Z_STROKE,
        style: resolveStyle(el.style, { strokeWidth: 2.5 }),
        drawOpts: resolveDrawOpts(el.draw, { mode: "sketch", duration: SKETCH_MS.node }),
      });
    }
  }
  // Pane origins (y-up). Side by side the code pane sits left or right;
  // stacked, above or below — the divider runs between the two either way.
  const codeX = show === "right" ? x0 + outPaneW + paneGap : x0;
  const outX = show === "left" ? x0 + codePaneW + paneGap : x0;
  const codeTop = show === "below" ? yTop - PAD - outContentH - paneGap : yTop - PAD;
  const outTop = show === "above" ? yTop - PAD - codeContentH - paneGap : yTop - PAD;
  // The rectangle the source lines actually occupy — what the in-place editor
  // lays itself over (spec §7's `__pane_tl`/`__pane_br`, published as one box
  // rather than two anchors because LayoutResult carries boxes, not anchors).
  // The CONTENT rect, not the pane's paper: it is the drawn text an overlay
  // must cover exactly, and a windowed pane's box is the window, so the
  // editor sits where the lines are even when the column has scrolled.
  // Nothing when the code is not drawn (`show: "output"`) — there is no pane
  // to type on, and the tray's editor is the door there.
  if (showCode) ctx.panes[el.id] = { x: codeX + PAD, y: codeTop - codeContentH, w: codePaneW - 2 * PAD, h: codeContentH };
  if (sideBySide) {
    const dx = (show === "left" ? x0 + codePaneW : x0 + outPaneW) + paneGap / 2;
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
  } else if (stacked) {
    const dy = (show === "above" ? codeTop - codeContentH : outTop - outContentH) - paneGap / 2;
    panelChildren.push({
      id: `${el.id}__divider`,
      kind: "stroke",
      pts: [
        [x0 + PAD / 2, dy],
        [x0 + w - PAD / 2, dy],
      ],
      z: Z_STROKE,
      style: resolveStyle(undefined, { color: COLORS.guide, strokeWidth: 2, dash: true }),
      drawOpts: resolveDrawOpts(undefined, { mode: "instant", duration: 0 }),
    });
  }

  // ---- a game's screen: the boot screen, and the mark that starts it ------
  // In the PANEL's group, not the output beat's: `draw: [id]` is "switch the
  // machine on", and a C64 switched on shows its blue screen at once. Every
  // part is ink (the export shows exactly this); only the click that starts
  // the emulator is the player's (ui/tray.ts). The colours are the machine's
  // own — a light-blue border, blue paper, light-blue type — because this
  // screen is the one drawing in the app that is NOT on paper.
  if (gameScreen) {
    const fieldTop = yTop;
    const fieldH = h;
    const rim = Math.min(PAD * 0.75, outPaneW * 0.05);
    const field = (sid: string, x: number, y: number, ww: number, hh: number, color: string): Drawable => ({
      id: sid,
      kind: "area",
      pts: rectPts(x, y - hh, ww, hh),
      precise: true,
      z: Z_AREA,
      style: resolveStyle(undefined, { fill: color, opacity: 1, strokeWidth: 0 }),
      drawOpts: resolveDrawOpts(undefined, { mode: "instant", duration: 0 }),
    });
    panelChildren.push(field(`${el.id}__border`, outX, fieldTop, outPaneW, fieldH, C64_PALETTE[C64_BORDER]));
    panelChildren.push(field(`${el.id}__screen`, outX + rim, fieldTop - rim, outPaneW - 2 * rim, fieldH - 2 * rim, C64_PALETTE[C64_BACKGROUND]));
    const screenFont = (outPaneW - 2 * rim) / (C64_COLS * CHAR_W);
    const rowH = screenFont * ROW_H;
    const rowText = (sid: string, row: number, col: number, text: string, color: string): Drawable => ({
      id: sid,
      kind: "text",
      pos: [outX + rim + col * screenFont * CHAR_W, fieldTop - rim - rowH * (row + 0.75)],
      text,
      fontSize: screenFont,
      anchor: "start",
      font: "mono",
      z: Z_TEXT,
      style: resolveStyle(undefined, { color }),
      drawOpts: resolveDrawOpts(el.draw, { mode: "sketch", duration: SKETCH_MS.text }),
    });
    if (runScreen) {
      // What the program left on the screen: one text per run of one colour
      // on a row, so a POKEd cell in another colour is its own ink. The
      // machine's paper follows the program too (POKE 53281).
      panelChildren[panelChildren.length - 2].style.fill = C64_PALETTE[runScreen.border & 15];
      panelChildren[panelChildren.length - 1].style.fill = C64_PALETTE[runScreen.background & 15];
      runScreen.chars.forEach((line, row) => {
        let col = 0;
        while (col < line.length) {
          if (line[col] === " ") {
            col++;
            continue;
          }
          const c = runScreen.colors[row]?.[col] ?? "e";
          let end = col;
          while (end < line.length && (runScreen.colors[row]?.[end] ?? "e") === c && !(line[end] === " " && (end + 1 >= line.length || line[end + 1] === " "))) end++;
          panelChildren.push(rowText(`${el.id}__scr${row}_${col}`, row, col, line.slice(col, end), C64_PALETTE[parseInt(c, 16) & 15]));
          col = end;
        }
      });
    } else {
      C64_BOOT_LINES.forEach(([row, text], i) => panelChildren.push(rowText(`${el.id}__boot${i}`, row, 0, text, C64_PALETTE[C64_TEXT])));
    }
    // The play mark: the source element's, in white, on the screen's centre —
    // only on a machine with a game to start.
    if (el.game !== undefined) {
    const pcx = outX + outPaneW / 2;
    const pcy = fieldTop - fieldH / 2;
    const r = Math.max(16, outPaneW * 0.1);
    panelChildren.push({
      id: `${el.id}__play`,
      kind: "stroke",
      pts: [[pcx, pcy]],
      shapeHint: { type: "circle", c: [pcx, pcy], r },
      z: Z_STROKE,
      style: resolveStyle(undefined, { color: C64_PALETTE[1], strokeWidth: 3 }),
      drawOpts: resolveDrawOpts(el.draw, { mode: "sketch", duration: 420 }),
    });
    panelChildren.push({
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
    });
    }
  }

  const out: Drawable[] = [
    { id: el.id, kind: "group", z: Z_STROKE, style: defaultStyle(), drawOpts: resolveDrawOpts(undefined, { mode: "sketch", duration: 0 }), children: panelChildren },
  ];
  ctx.anchors[el.id] = [cx, cy];

  // ---- code lines: one top-level drawable per SOURCE line ------------------
  if (showCode) {
    // Every line at its natural row, even past the window: the plan scrolls
    // the whole column by offsetting each line, and the clip (the pane's
    // rectangle, fixed in canvas space) hides what has left the window.
    // A hair of bleed at the BOTTOM only: the row box is exactly 1.25 em, so a
    // flush edge shaves the descenders of the last visible row (an underscore
    // vanishes entirely). The top edge stays exact, or a scrolled-away line
    // would peek back in.
    const bleed = fontSize * 0.18;
    const clip = windowRows > 0 ? { x: codeX, y: codeTop - windowH - bleed, w: codePaneW, h: windowH + bleed } : undefined;
    const bottoms: number[] = [];
    const lineIds: string[] = [];
    codeStack.blocks.forEach((block, i) => {
      const id = `${el.id}_line_${i + 1}`;
      const pos: Pt = [codeX + PAD, codeTop - block.center];
      ctx.extraOrder.push(id);
      ctx.anchors[id] = pos;
      lineIds.push(id);
      bottoms.push(block.center + block.height / 2);
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
        // Typed lines take as long as their characters at 28 per second (a
        // 400 ms floor), the same order as a sketch stroke.
        drawOpts:
          el.draw?.mode === "type"
            ? { mode: "type", duration: Math.max(400, Math.round((block.rows.join("").length / TYPE_CPS) * 1000)) }
            : resolveDrawOpts(el.draw, { mode: "sketch", duration: SKETCH_MS.text }),
        ...(clip ? { clip } : {}),
      });
    });
    // ---- marks: the marker pen over the drawn text ------------------------
    // A beat of its own per mark (`<id>_mark_1` …), so a storyboard can say
    // "and THIS is the seed" while the pen travels — ordinary ink, so it
    // scrubs, erases and exports like every other stroke. Geometry is exact
    // because the pane is monospace: column × CHAR_W is the x, and the row's
    // own centre is the y (tspans sit ROW_H apart around the block's centre,
    // svg-backend.ts). A hair of padding each side absorbs the difference
    // between CHAR_W and the real font's advance — and a marker overshoots
    // anyway, which is what makes it read as a hand.
    const markIds: string[] = [];
    normalizeMarks(el.marks).forEach((m, k) => {
      const id = `${el.id}_mark_${k + 1}`;
      ctx.extraOrder.push(id);
      markIds.push(id);
      const hit = findMarkRow(codeStack.blocks, m.text);
      if (!hit) {
        // The quote idiom: keep the beat and its narration, draw nothing, say
        // why. A wrapped line that split the phrase lands here too.
        ctx.warnings.push(`code "${el.id}": mark ${k + 1} — "${m.text}" is not on any drawn line as one piece`);
        ctx.anchors[id] = [codeX + PAD, codeTop];
        out.push({
          id,
          kind: "stroke",
          pts: [],
          z: Z_STROKE,
          style: resolveStyle(el.style, { color: COLORS.region1, opacity: 0.42 }),
          drawOpts: resolveDrawOpts(el.draw, { mode: "sketch", duration: 400 }),
        });
        return;
      }
      const block = codeStack.blocks[hit.block];
      const rows = block.rows.length;
      const rowY = codeTop - block.center + ((rows - 1) / 2 - hit.row) * ROW_H * fontSize;
      const pad = fontSize * 0.15;
      const x0m = codeX + PAD + hit.col * CHAR_W * fontSize - pad;
      const x1m = x0m + m.text.length * CHAR_W * fontSize + 2 * pad;
      // The band sits on the glyph body: a baseline is the FOOT of the text.
      const midY = rowY + fontSize * 0.28;
      const geom =
        m.kind === "underline"
          ? { y: rowY - fontSize * 0.12, width: 2.5, color: COLORS.demand, opacity: 1 }
          : m.kind === "strike"
            ? { y: midY, width: 2.5, color: COLORS.regionLoss, opacity: 1 }
            : { y: midY, width: fontSize * 0.95, color: COLORS.region1, opacity: 0.42 };
      ctx.anchors[id] = [(x0m + x1m) / 2, geom.y];
      out.push({
        id,
        kind: "stroke",
        pts: [
          [x0m, geom.y],
          [x1m, geom.y],
        ],
        z: m.kind === "mark" ? Z_AREA : Z_STROKE, // a marker goes UNDER the letters
        style: resolveStyle(el.style, { color: geom.color, strokeWidth: geom.width, opacity: geom.opacity, roughness: 0.6 }),
        // The reveal IS the pen travelling left to right (the source element's
        // highlighter, same dash-offset trick).
        drawOpts: resolveDrawOpts(el.draw, { mode: "sketch", duration: Math.max(320, Math.min(1500, (x1m - x0m) * 7)) }),
        ...(clip ? { clip } : {}),
      });
    });
    if (windowRows > 0) ctx.windows[el.id] = { ids: lineIds, bottoms, height: windowH, follow: markIds };
  }

  // ---- output pane: one group, always minted -------------------------------
  const outChildren: Drawable[] = [];
  if (showOut && !gameScreen) {
    if (!result) {
      // Unresolved (node tests, offline, runtime missing): the source
      // element's ruled-placeholder idiom, so the beat draws SOMETHING.
      for (let i = 0; i < 3; i++) {
        const ly = outTop - fontSize * (0.8 + i * 1.6);
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
          pos: [outX + PAD, outTop - block.center],
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
        const grid = tableDrawables(t, `${el.id}__tbl${k}`, outX, outTop - contentTop, outPaneW, tableHeights[k], fontSize);
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
            pos: [outX + PAD + figW / 2, outTop - figTop - fh / 2],
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
    const slotCenter: Pt = [outX + PAD + figW / 2, outTop - slotTop - slotH / 2];
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

// ---- the screen: chrome around the panel (spec §5) --------------------------

const BAR_H = 28;
/** The display's bezel: thin at the sides and top, deeper at the chin — a
 *  Studio-Display shape rather than a box on a foot. A stand would only steal
 *  vertical canvas from the very content it holds (Hans, 2026-09-04). */
const BEZEL = 14;
const CHIN = 30;
const SCREEN_R = 24;
const KEYS_H = 128;
/** The home computer's case: a wedge deep enough to be the monitor's table. */
const BOARD_H = 106;
/** The CRT: a chunky plastic shell, a bulging glass inset in it, a chin with
 *  small controls, and a short neck on a flat foot. Drawn flat-on — the
 *  engine is a 2D line renderer and a three-quarter view would have to skew
 *  the content plane with it — with one thin band down the right edge for
 *  depth. Its space is opt-in: nothing defaults to a CRT. */
const CRT = Object.freeze({ side: 34, above: 28, chin: 46, r: 26, depth: 13 });

export type CodeFrame = "panel" | "window" | "screen" | "laptop" | "crt" | "c64" | "none";

/** Space the chrome claims outside the panel rectangle, logical units. */
export function frameSpace(frame: CodeFrame): { above: number; below: number; side: number } {
  switch (frame) {
    case "window":
      return { above: BAR_H, below: 0, side: 0 };
    case "screen":
      return { above: BEZEL, below: CHIN, side: BEZEL };
    case "laptop":
      return { above: BEZEL, below: CHIN + KEYS_H, side: BEZEL };
    case "crt":
      // No foot: a tube standing on nothing reads better than one on a plinth,
      // and it hands the picture back the height a base would have taken.
      return { above: CRT.above, below: CRT.chin, side: CRT.side };
    case "c64":
      // No foot: the monitor stands ON the keyboard, the way it did in 1982.
      return { above: CRT.above, below: CRT.chin + BOARD_H, side: CRT.side };
    default:
      return { above: 0, below: 0, side: 0 };
  }
}

function rectPts(x: number, y: number, w: number, h: number): Pt[] {
  return [
    [x, y],
    [x + w, y],
    [x + w, y + h],
    [x, y + h],
  ];
}

/** A rounded rectangle as a closed point list — the display's outline. Drawn
 *  as a path (no rect shapeHint), so rough.js sketches the curves. */
function roundRectPts(x: number, y: number, w: number, h: number, r: number, per = 4): Pt[] {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  const arc = (cx: number, cy: number, a0: number, a1: number): Pt[] =>
    Array.from({ length: per + 1 }, (_, i) => {
      const a = a0 + (a1 - a0) * (i / per);
      return [cx + rr * Math.cos(a), cy + rr * Math.sin(a)] as Pt;
    });
  return [
    ...arc(x + w - rr, y + rr, -Math.PI / 2, 0),
    ...arc(x + w - rr, y + h - rr, 0, Math.PI / 2),
    ...arc(x + rr, y + h - rr, Math.PI / 2, Math.PI),
    ...arc(x + rr, y + rr, Math.PI, 1.5 * Math.PI),
  ];
}

function circlePts(c: Pt, r: number, n = 14): Pt[] {
  return ellipsePts(c, r, r, n);
}

function ellipsePts(c: Pt, rx: number, ry: number, n = 18): Pt[] {
  const pts: Pt[] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    pts.push([c[0] + rx * Math.cos(a), c[1] + ry * Math.sin(a)]);
  }
  return pts;
}

/**
 * A monitor's three buttons, right-aligned on its chin: the large power
 * circle, then the two that turn the CODE and the OUTPUT off. Ids are what
 * the UI hit-tests, so they name their meaning rather than their position.
 */
function chinButtons(
  id: string,
  right: number,
  cy: number,
  ink: (extra: Parameters<typeof resolveStyle>[1]) => ReturnType<typeof resolveStyle>,
  instant: ReturnType<typeof resolveDrawOpts>,
  r = 5.5,
): Drawable[] {
  const small = resolveStyle(undefined, { color: COLORS.guide, strokeWidth: 2 });
  const stroke = (sid: string, pts: Pt[], st: ReturnType<typeof resolveStyle>): Drawable => ({
    id: sid,
    kind: "stroke",
    pts,
    closed: true,
    z: Z_STROKE,
    style: st,
    drawOpts: instant,
  });
  const gap = r * 3.2;
  return [
    stroke(`${id}__power`, circlePts([right - gap, cy], r), ink({ strokeWidth: 2.5 })),
    stroke(`${id}__btn_code`, circlePts([right - 2.2 * gap, cy], r * 0.72), small),
    stroke(`${id}__btn_out`, circlePts([right - 3.2 * gap, cy], r * 0.72), small),
  ];
}

/** Chrome drawables for one panel, given its inner rectangle (x0, yTop − h .. yTop). */
function chromeDrawables(id: string, frame: CodeFrame, x0: number, yTop: number, w: number, h: number, style: SpecElement["style"], draw: SpecElement["draw"]): Drawable[] {
  const out: Drawable[] = [];
  const ink = (extra: Parameters<typeof resolveStyle>[1]) => resolveStyle(style, extra);
  const sketch = (ms: number) => resolveDrawOpts(draw, { mode: "sketch", duration: ms });
  const instant = resolveDrawOpts(undefined, { mode: "instant", duration: 0 });
  const stroke = (sid: string, pts: Pt[], closed: boolean, st: ReturnType<typeof resolveStyle>, drawOpts: ReturnType<typeof resolveDrawOpts>, hint?: { x: number; y: number; w: number; h: number }): Drawable => ({
    id: sid,
    kind: "stroke",
    pts,
    closed,
    ...(hint ? { shapeHint: { type: "rect" as const, ...hint } } : {}),
    z: Z_STROKE,
    style: st,
    drawOpts,
  });
  if (frame === "window") {
    out.push(stroke(`${id}__bar`, rectPts(x0, yTop, w, BAR_H), true, ink({ strokeWidth: 2.5 }), sketch(SKETCH_MS.node), { x: x0, y: yTop, w, h: BAR_H }));
    for (let i = 0; i < 3; i++) {
      out.push(stroke(`${id}__bar_dot_${i + 1}`, circlePts([x0 + 18 + i * 18, yTop + BAR_H / 2], 5), true, resolveStyle(undefined, { color: COLORS.guide, strokeWidth: 2 }), instant));
    }
  }
  if (frame === "screen" || frame === "laptop") {
    // ONE outline, not two: the display's rounded shell IS the panel's frame,
    // so the inner rectangle is suppressed (see codeDrawables). The chin sits
    // under the screen the way a Studio Display's does.
    const bx = x0 - BEZEL;
    const by = yTop - h - CHIN;
    const bw = w + 2 * BEZEL;
    const bh = h + CHIN + BEZEL;
    const shell = roundRectPts(bx, by, bw, bh, SCREEN_R);
    // No wash under a flat display: at figure size the bezel is a ~8-pixel
    // ring, so a third near-white tone there read as a second border rather
    // than as plastic (2026-09-05). One ink outline, the chin and its buttons
    // say "monitor" on their own. The CRT keeps its wash — that case is a
    // large box, where a tone reads as an object instead of an edge.
    out.push(stroke(`${id}__bezel`, shell, true, ink({ strokeWidth: 3.5 }), sketch(SKETCH_MS.node)));
    // A monitor's chin carries its three buttons — power, and the two that
    // say what the screen shows. The laptop is deliberately bare: a MacBook
    // has no buttons on its chin, and drawing some would be a lie.
    if (frame === "screen") out.push(...chinButtons(id, bx + bw, by + CHIN / 2, ink, instant));
  }
  if (frame === "laptop" || frame === "c64") {
    const wedge = frame === "c64";
    // The base, drawn once for both machines. The laptop's is a thin deck
    // with a trackpad under the keys and a scoop at the front lip; the home
    // computer's is a deeper wedge whose keys fill it, with function keys down
    // the right — and it is the table the monitor stands on.
    const sx = x0 - (wedge ? CRT.side : BEZEL);
    const sw = w + 2 * (wedge ? CRT.side : BEZEL);
    const slabTop = yTop - h - (wedge ? CRT.chin : CHIN);
    const slabH = wedge ? BOARD_H : KEYS_H;
    const slabBottom = slabTop - slabH;
    const keys: Drawable[] = [
      stroke(`${id}__keys_slab`, roundRectPts(sx, slabBottom, sw, slabH, wedge ? 10 : 8), true, ink({ strokeWidth: 3 }), sketch(SKETCH_MS.node), undefined),
    ];
    const hairline = resolveStyle(undefined, { color: COLORS.guide, strokeWidth: 2 });
    if (wedge) {
      // The case's front lip: the wedge that makes it a breadbox, not a tray.
      keys.push(stroke(`${id}__keys_lip`, [[sx + 8, slabBottom + 13], [sx + sw - 8, slabBottom + 13]], false, hairline, instant));
    } else {
      // The hinge bar: a short line inside the deck's top edge, which is what
      // makes a deck read as the lid's other half rather than as a tray.
      keys.push(stroke(`${id}__hinge`, [[sx + sw * 0.3, slabTop - 7], [sx + sw * 0.7, slabTop - 7]], false, hairline, instant));
    }
    // Four rows of small keys with the stagger a real board has, a wide space
    // bar on the bottom row, and — on the home computer — a column of function
    // keys down the right. Keys are drawn instantly: a keyboard is furniture,
    // and sixty sketched rectangles would be the slowest thing on the canvas.
    const fnW = wedge ? 42 : 0;
    const pad = 34;
    const gap = 4;
    const rows = 4;
    const cols = 16;
    const boardW = sw - 2 * pad - (fnW > 0 ? fnW + 12 : 0);
    const keyW = (boardW - (cols - 1) * gap) / cols;
    // The laptop keeps a band at the bottom of the deck for the trackpad.
    const padBand = wedge ? 0 : 34;
    const keyH = (slabH - 26 - padBand - (rows - 1) * gap) / rows;
    const keyStyle = resolveStyle(undefined, { color: COLORS.guide, strokeWidth: 1.5 });
    const top0 = slabTop - 14;
    for (let r = 0; r < rows - 1; r++) {
      const rowTop = top0 - r * (keyH + gap);
      const stagger = r * keyW * 0.3;
      for (let k = 0; k < cols; k++) {
        const kx = sx + pad + stagger + k * (keyW + gap);
        if (kx + keyW > sx + pad + boardW) continue;
        keys.push(stroke(`${id}__key_${r}_${k}`, roundRectPts(kx, rowTop - keyH, keyW, keyH, 2.5), true, keyStyle, instant));
      }
    }
    // The bottom row: two modifiers, the space bar, two more.
    const bottomTop = top0 - (rows - 1) * (keyH + gap);
    const spaceW = boardW * 0.46;
    const sideW = (boardW - spaceW - 4 * gap) / 4;
    let bx = sx + pad;
    for (let i = 0; i < 5; i++) {
      const kw = i === 2 ? spaceW : sideW;
      keys.push(stroke(i === 2 ? `${id}__key_space` : `${id}__key_mod_${i}`, roundRectPts(bx, bottomTop - keyH, kw, keyH, 2.5), true, keyStyle, instant));
      bx += kw + gap;
    }
    for (let f = 0; f < rows && fnW > 0; f++) {
      const fy = top0 - f * (keyH + gap);
      keys.push(stroke(`${id}__key_fn_${f + 1}`, roundRectPts(sx + sw - pad - fnW, fy - keyH, fnW, keyH, 2.5), true, keyStyle, instant));
    }
    if (padBand > 0) {
      const tpW = sw * 0.2;
      const tpH = padBand - 12;
      keys.push(stroke(`${id}__trackpad`, roundRectPts(sx + (sw - tpW) / 2, slabBottom + 10, tpW, tpH, 5), true, keyStyle, instant));
    }
    out.push({ id: `${id}__keys`, kind: "group", z: Z_STROKE, style: defaultStyle(), drawOpts: sketch(SKETCH_MS.node), children: keys });
  }
  if (frame === "crt" || frame === "c64") {
    const sx = x0 - CRT.side;
    const sy = yTop - h - CRT.chin;
    const sw = w + 2 * CRT.side;
    const sh = h + CRT.chin + CRT.above;
    const shell = roundRectPts(sx, sy, sw, sh, CRT.r);
    out.push({
      id: `${id}__shell_wash`,
      kind: "area",
      pts: shell,
      precise: true,
      z: Z_AREA,
      style: resolveStyle(undefined, { fill: COLORS.guide, opacity: 0.1, strokeWidth: 0 }),
      drawOpts: instant,
    });
    out.push(stroke(`${id}__shell`, shell, true, ink({ strokeWidth: 3.5 }), sketch(SKETCH_MS.node)));
    // The glass: a bulging pane inset in the plastic, its corners rounder
    // than the shell's — the one line that says "tube", not "flat panel".
    out.push(stroke(`${id}__glass`, roundRectPts(x0 - 6, yTop - h - 6, w + 12, h + 12, 34), true, ink({ strokeWidth: 2 }), sketch(SKETCH_MS.node)));
    // A thin band down the right edge: depth, without skewing the picture.
    const d = CRT.depth;
    out.push(
      stroke(
        `${id}__depth`,
        [[sx + sw, sy + CRT.r], [sx + sw + d, sy + CRT.r + d], [sx + sw + d, sy + sh - CRT.r], [sx + sw, sy + sh - CRT.r]],
        false,
        resolveStyle(undefined, { color: COLORS.guide, strokeWidth: 2 }),
        instant,
      ),
    );
    // The chin's controls, small and unlabelled: power, and the two that say
    // what the screen shows. Three, not five — more buttons than meanings is
    // how a monitor becomes a puzzle (Hans, 2026-09-04).
    const chinY = sy + CRT.chin / 2;
    out.push(...chinButtons(id, sx + sw, chinY, ink, instant, 7));
    out.push(stroke(`${id}__vent`, roundRectPts(sx + 30, chinY - 5, 96, 10, 5), true, resolveStyle(undefined, { color: COLORS.guide, strokeWidth: 1.5 }), instant));
  }
  return out;
}
