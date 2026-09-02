// One Generate/Revise button, state-determined (B7, roadmap D3). The old
// arrangement was worse than redundant: both buttons read the same prompt
// box and did OPPOSITE things to the document — Generate replaces it, Revise
// edits it — and nothing but the verb said which was which. Pressing the
// wrong one either discarded a drawcast or failed to start the new one.
//
// The mode is DERIVED, never flagged: "generate" exactly when the editor
// holds the blank document (＋ New drawcast) or nothing at all — so a
// hand-edited blank flips to "revise" by itself (the edits become the thing
// to revise), and a restored document greets its author with Revise, which
// is what makes D4's restore-on-open honest. The accepted cost, stated in
// D3: generating something unrelated now takes a ＋ New first — one click,
// and the right friction.
//
// Pure on purpose: main.ts is DOM-bound and untestable in the node suite.

export type AuthoringMode = "generate" | "revise";

/** `blankText` is the serialized blank document ＋ New produces. */
export function authoringMode(editorText: string, blankText: string): AuthoringMode {
  const t = editorText.trim();
  return t === "" || t === blankText.trim() ? "generate" : "revise";
}

/** The placeholder carries the mode too — legible BEFORE you type. */
export function promptPlaceholder(mode: AuthoringMode): string {
  return mode === "generate"
    ? 'Describe a drawcast… e.g. "Show the deadweight loss from a tax, with shaded regions"'
    : "What should change?";
}

/**
 * The button's label. Busy wins (the button that started the call is the one
 * that stops it); viewing an old version wins over the derived mode — you are
 * branching from history, which is always a revise.
 */
export function authorButtonLabel(mode: AuthoringMode, opts: { busy: boolean; viewing: boolean }): string {
  if (opts.busy) return "Cancel";
  if (opts.viewing) return "Revise from here";
  return mode === "generate" ? "Generate with AI" : "Revise with AI";
}
