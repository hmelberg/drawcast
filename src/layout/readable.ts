// Readable text sizes for what templates draw (spec 2026-10-04-page-frame
// §4 and W30). Logical units at text scale 1 — the cast's `text.font_size`
// and the viewer's setting multiply them later, as they do every size.
//
// Two lines, not one: the lint's FONT_FLOOR (14) is "unreadable" and warns;
// TEXT_MIN is the least a template draws by default for words a viewer reads
// in passing (ticks, dates, values, notes, matrix cells); TEXT_LABEL is the
// default for the names a viewer must read to follow the figure (categories,
// node and state names, axis captions). W25 set forest_plot at 26/22 and
// causal_dag at 26–20; W4 set the charts at 20–22. A template that is short
// of room thins, wraps or truncates before it goes under TEXT_MIN.

/** The least a template draws text a viewer reads (ticks, dates, values, notes). */
export const TEXT_MIN = 18;
/** The default for names a viewer must read to follow the figure. */
export const TEXT_LABEL = 22;

/** `fontSize`, raised to `floor` (TEXT_MIN by default). */
export function readable(fontSize: number, floor: number = TEXT_MIN): number {
  return Math.max(fontSize, floor);
}
