// Validate and lint every item of a playlist — the check the revise round
// (llm/revise.ts) runs on a model's reply, and the one the viewer's Problems
// box (ui/problems-box.ts) runs on a cast that arrived inside its link. Pure:
// no SDK, no DOM beyond the measure function a caller may pass.

import { itemsOf, type Playlist } from "../playlist/playlist";
import { validateSpec } from "../spec/schema";
import { layoutSpec } from "../layout/layout";
import { expandSpec } from "../spec/expand";
import { heuristicMeasure, type MeasureFn } from "../layout/measure";
import { lintCommands, questionNames, type LintIssue } from "./lint";
import { questionCount } from "../playlist/carry";

/** A lint issue and the playlist item (0-based) it came from. */
export type ItemLintIssue = LintIssue & { item: number };

/**
 * Validate and lint EVERY item. Errors are prefixed with the item number only
 * when there is more than one — a single-spec document should not be told about
 * "item 1".
 */
export function checkPlaylistItems(playlist: Playlist, measure: MeasureFn = heuristicMeasure): { errors: string[]; lintIssues: ItemLintIssue[]; items: number } {
  const items = itemsOf(playlist);
  if (items.length === 0) return { errors: ["the document has no drawable items"], lintIssues: [], items: 0 };
  const errors: string[] = [];
  const lintIssues: ItemLintIssue[] = [];
  // Stored answers survive the cut between items (playlist/carry.ts), so a
  // {name} in item 3 that item 1 stored is not "used before stored".
  const known = new Set<string>();
  let offset = 0;
  for (const item of items) {
    const where = items.length > 1 ? `item ${item.index + 1}: ` : "";
    const v = validateSpec(item.spec);
    if (!v.ok) {
      errors.push(...v.errors.map((e) => `${where}${e}`));
      continue;
    }
    try {
      const expanded = expandSpec(item.spec);
      const found = [...layoutSpec(expanded, measure).issues, ...lintCommands(expanded, { knownVars: known, questionOffset: offset })];
      lintIssues.push(...found.map((i) => ({ ...i, item: item.index })));
      for (const q of questionNames(item.spec)) if (q.store) known.add(q.store.toLowerCase());
      offset += questionCount(item.spec);
    } catch (err) {
      errors.push(`${where}layout failed: ${(err as Error).message}`);
    }
  }
  return { errors, lintIssues, items: items.length };
}

/** checkPlaylistItems without the item numbers — the revise round's shape. */
export function checkPlaylist(playlist: Playlist, measure: MeasureFn = heuristicMeasure): { errors: string[]; lintIssues: LintIssue[] } {
  const { errors, lintIssues } = checkPlaylistItems(playlist, measure);
  return { errors, lintIssues: lintIssues.map(({ item: _item, ...issue }) => issue) };
}
