// Revising an existing drawcast: the whole editor document goes out, a whole
// replacement document comes back. Text in, text out — so a single spec and a
// multi-document playlist are ONE path, hand-edits in the textarea ride along,
// and the model can add, drop, reorder and retitle parts rather than only edit
// the ones already there.
//
// Deliberately not a continued conversation: a stateless call also works on a
// document loaded from the library, a bundled example, or a #gdoc= share, and
// its cost does not grow every round.

import { itemsOf, parsePlaylistText, type Playlist } from "../playlist/playlist";
import { stripFence } from "./prompt";
import { validateSpec } from "../spec/schema";
import { layoutSpec } from "../layout/layout";
import { heuristicMeasure, type MeasureFn } from "../layout/measure";
import type { LintIssue } from "../lint/lint";

export function buildReviseUser(docText: string, instruction: string): string {
  return [
    "Here is the current drawcast document:",
    "```yaml",
    docText,
    "```",
    "",
    `Apply this change: ${instruction}`,
    "",
    "Return the COMPLETE document in the same shape it came in — one document, or a `---` separated multi-document stream if it already is one.",
    "Change only what the instruction asks for and leave everything else as it is.",
    "Return the document only, with no commentary before or after it.",
  ].join("\n");
}

export function parseReviseReply(text: string): { playlist: Playlist | null; error?: string } {
  try {
    return { playlist: parsePlaylistText(stripFence(text)) };
  } catch (err) {
    return { playlist: null, error: `the reply is not a readable document: ${(err as Error).message}` };
  }
}

/**
 * Validate and lint EVERY item. Errors are prefixed with the item number only
 * when there is more than one — a single-spec document should not be told about
 * "item 1".
 */
export function checkPlaylist(playlist: Playlist, measure: MeasureFn = heuristicMeasure): { errors: string[]; lintIssues: LintIssue[] } {
  const items = itemsOf(playlist);
  if (items.length === 0) return { errors: ["the document has no drawable items"], lintIssues: [] };
  const errors: string[] = [];
  const lintIssues: LintIssue[] = [];
  for (const item of items) {
    const where = items.length > 1 ? `item ${item.index + 1}: ` : "";
    const v = validateSpec(item.spec);
    if (!v.ok) {
      errors.push(...v.errors.map((e) => `${where}${e}`));
      continue;
    }
    try {
      lintIssues.push(...layoutSpec(item.spec, measure).issues);
    } catch (err) {
      errors.push(`${where}layout failed: ${(err as Error).message}`);
    }
  }
  return { errors, lintIssues };
}
