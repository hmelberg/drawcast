// Pure character math for the `type` draw mode's per-frame reveal — the code
// pane's typed effect (svg-backend.ts, leaf.drawOpts.mode === "type"). No
// DOM: the caller reads a leaf's rows (and, for a coloured source line, each
// row's runs) from the SVG once, and this module says how many characters of
// each are visible at reveal progress n. A pure function of n, so scrub,
// erase (n runs from total back to 0) and the exporter's fixed frame clock
// all agree without needing direction state — and it is testable without a
// browser, which the DOM glue around it (svg-backend's makeLeafHandle) is
// not: this repo carries no jsdom.

/** One row's ordered runs, texts concatenating to the row's full text (the
 *  invariant layout/model.ts's TextDrawable.runs documents; a row with no
 *  colour info is one run covering the whole row). Only `.text.length`
 *  matters here — colour lives on the DOM node already and this module
 *  never touches it. */
export interface TypeRun {
  text: string;
}

/**
 * The visible slice of each run in ONE row once `take` characters of the
 * row are shown, and which run the cut falls in — the run a caret belongs
 * after. A run beyond the cut is emptied, not dropped, so a caller with one
 * DOM node per run keeps writing to the same nodes every frame instead of
 * adding/removing them. `cutIndex` defaults to the row's last run when the
 * whole row is already shown (take >= the row's total length) — the
 * fallback computeTypeFrame uses to still place a mid-typing cursor at the
 * end of a fully-revealed row.
 */
export function revealRow(runs: readonly TypeRun[], take: number): { shown: string[]; cutIndex: number } {
  let left = Math.max(0, take);
  const shown: string[] = [];
  let cutIndex = Math.max(0, runs.length - 1);
  let cutSet = false;
  runs.forEach((r, j) => {
    const t = Math.max(0, Math.min(r.text.length, left));
    left -= t;
    shown.push(r.text.slice(0, t));
    if (!cutSet && t < r.text.length) {
      cutIndex = j;
      cutSet = true;
    }
  });
  return { shown, cutIndex };
}

/**
 * The whole typed reveal, in reading order across rows: at total progress
 * `n` characters shown, which characters of each row's runs are visible,
 * and where the cursor glyph belongs (the [row, run] pair, or null when not
 * typing — at rest, n = 0, or once fully revealed, mirroring the caller's
 * `t > 0 && t < 1` guard). Mirrors the legacy row-level rule — the cursor
 * sits on the first row that is not yet fully shown, or the last row as a
 * fallback — one level down, at run granularity, so a coloured run keeps
 * its own fill while it types instead of the whole row flattening to a
 * single string.
 */
export function computeTypeFrame(
  rows: readonly (readonly TypeRun[])[],
  n: number,
  typing: boolean,
): { shown: string[][]; cursorAt: [row: number, run: number] | null } {
  let left = n;
  let cursorPlaced = false;
  let cursorAt: [number, number] | null = null;
  const shown = rows.map((runs, i) => {
    const rowLen = runs.reduce((a, r) => a + r.text.length, 0);
    const take = Math.max(0, Math.min(rowLen, left));
    left -= take;
    const row = revealRow(runs, take);
    if (typing && !cursorPlaced && (take < rowLen || i === rows.length - 1)) {
      cursorPlaced = true;
      cursorAt = [i, runs.length > 0 ? row.cutIndex : 0];
    }
    return row.shown;
  });
  return { shown, cursorAt };
}

/** Total visible characters across every row/run — the reveal's n domain
 *  (0..total), matching the legacy `full.reduce((a, s) => a + s.length, 0)`. */
export function totalChars(rows: readonly (readonly TypeRun[])[]): number {
  return rows.reduce((a, runs) => a + runs.reduce((b, r) => b + r.text.length, 0), 0);
}
