/**
 * Whether the editor's text is ahead of what was last drawn. A plain string
 * comparison on purpose: trimming would call a re-indent "no change", and in
 * YAML indentation IS the structure.
 */
export function needsRender(current: string, lastRendered: string | null): boolean {
  return lastRendered === null || current !== lastRendered;
}
