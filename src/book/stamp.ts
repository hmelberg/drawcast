// Stamp a book's layout on every part a #column / #row generation made
// (spec 2026-10-01-book-layout §4.1): the model never writes `book` — the
// app does, from the tag, so every part of one book agrees.
import type { BookSettings, Spec } from "../spec/types";

export function stampBook(specs: Spec[], layout: "columns" | "rows" | null): void {
  if (!layout) return;
  const book: BookSettings = { layout, look: "mixed" };
  for (const spec of specs) spec.book = { ...book, ...(spec.book ?? {}) };
}
