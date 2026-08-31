/**
 * Whether the editor's text is ahead of what was last drawn. A plain string
 * comparison on purpose: trimming would call a re-indent "no change", and in
 * YAML indentation IS the structure.
 */
export function needsRender(current: string, lastRendered: string | null): boolean {
  return lastRendered === null || current !== lastRendered;
}

/**
 * Whether now is a valid moment to commit a render — separate from whether
 * one is needed (needsRender). Two things veto it, matching what the old
 * disabled ↻ button used to prevent for free:
 *  - viewingHistory: the pane is showing an old version. There is nowhere
 *    for a render to land — committing one would silently jump the cursor
 *    to newest out from under whoever is browsing.
 *  - aiBusy: an AI call is streaming its own partial output into the same
 *    textarea. That text is the model's, not the author's, until the call
 *    resolves — rendering mid-stream would push the model's half-formed
 *    draft as a manual edit.
 */
export function canRender(viewingHistory: boolean, aiBusy: boolean): boolean {
  return !viewingHistory && !aiBusy;
}
