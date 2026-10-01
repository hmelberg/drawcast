// What a book's text pane holds, part by part (spec 2026-10-01-book-layout
// §4.3, §12): the pane is a pure function of (part, step), so seeking can
// rebuild it from this list. Pure — tested without a DOM.
//
// Each part contributes a PRELUDE the book writes for itself before the
// part's first step, then its own text steps:
//   - the book's title, `#`, before the first part (unless that part opens
//     with its own `#` heading);
//   - a chapter change: the pane empties (TV), then `## Chapter`;
//   - the part's title — `###` under a chapter, `##` otherwise, `#` when
//     there is neither a book title nor a chapter — unless the part's first
//     block is itself a heading: the card a part would show over its figure
//     is written here instead.

import { planCommands, type TextOp } from "../render/plan";
import { expandSpec } from "../spec/expand";
import type { Spec } from "../spec/types";
import type { PlaylistItem } from "../playlist/playlist";
import { startsWithHeading } from "./markdown";

/** A part's text steps in plan order — the same ops the live plan carries.
 *  Planned without a layout: an id the planner cannot see (a template's own
 *  part) may be taken for a text block, and a mark on a block that does not
 *  exist is a no-op in the pane, so nothing is lost by it. */
export function partTextOps(spec: Spec): TextOp[] {
  const expanded = expandSpec(spec);
  const ids = (expanded.elements ?? []).map((e) => e.id);
  return planCommands(expanded.commands, ids, { book: true }).steps.flatMap((s) => (s.kind === "text" ? [s.op] : []));
}

/** The first block a part writes, if any. */
function firstWrite(spec: Spec): string | undefined {
  for (const c of spec.commands ?? []) if (c.write !== undefined) return typeof c.write === "string" ? c.write : c.write.text;
  return undefined;
}

/** What the book writes itself before part `i`'s first step. */
export function prelude(items: PlaylistItem[], i: number, bookTitle?: string): TextOp[] {
  const item = items[i];
  const out: TextOp[] = [];
  const opener = firstWrite(item.spec);
  const opensWithHeading = opener !== undefined && startsWithHeading(opener);
  const newChapter = item.chapter !== undefined && (i === 0 || items[i - 1].chapter !== item.chapter);
  if (i === 0 && bookTitle && !(opener !== undefined && /^\s*#\s/.test(opener))) {
    out.push({ op: "write", id: "book_title", text: `# ${bookTitle}`, temp: false });
  }
  if (newChapter) {
    if (i > 0) out.push({ op: "clear" });
    out.push({ op: "write", id: `chapter_${i + 1}`, text: `## ${item.chapter}`, temp: false });
  }
  const title = item.spec.title?.trim();
  if (title && !opensWithHeading) {
    const level = item.chapter !== undefined ? "###" : !bookTitle && i === 0 ? "#" : "##";
    out.push({ op: "write", id: `part_${i + 1}`, text: `${level} ${title}`, temp: false });
  }
  return out;
}

/** Whether the change from part `from` to part `to` crosses a chapter. */
export function crossesChapter(items: PlaylistItem[], from: number, to: number): boolean {
  return items[to]?.chapter !== undefined && items[to].chapter !== items[from]?.chapter;
}

/** Everything the pane holds when part `i` begins: every earlier part whole,
 *  then part i's prelude. */
export function opsBeforePart(items: PlaylistItem[], i: number, bookTitle?: string, own: (k: number) => TextOp[] = (k) => partTextOps(items[k].spec)): TextOp[] {
  const out: TextOp[] = [];
  for (let k = 0; k < i; k++) out.push(...prelude(items, k, bookTitle), ...own(k));
  out.push(...prelude(items, i, bookTitle));
  return out;
}
