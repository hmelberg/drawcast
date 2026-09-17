// src/playlist/inset-ref.ts
// Which playlist item an inset's `of` names (spec 2026-09-17-inset §3): the
// item's title (case-insensitive, trimmed), its 1-based number among the
// items (chapter markers excluded), or "previous". Items have no ids
// (PlaylistItem = spec + chapter + index), so this is the whole naming. Pure,
// so the playlist parser (compile time) and the render resolver (play time)
// agree by construction.
import type { Spec } from "../spec/types";

export function resolveSibling(of: string, siblings: readonly Spec[], self: number): { index: number } | { error: string } {
  const key = of.trim();
  let index: number;
  if (/^\d+$/.test(key)) {
    const n = Number(key);
    if (n < 1 || n > siblings.length) return { error: `no item ${n} (the playlist has ${siblings.length} item${siblings.length === 1 ? "" : "s"})` };
    index = n - 1;
  } else if (key.toLowerCase() === "previous") {
    if (self <= 0) return { error: self < 0 ? 'no "previous" item: this page is not in a playlist' : 'no "previous" item: this is the first item' };
    index = self - 1;
  } else {
    const want = key.toLowerCase();
    index = siblings.findIndex((s) => (s.title ?? "").trim().toLowerCase() === want);
    if (index < 0) return { error: `no item titled "${key}"` };
  }
  if (index === self) return { error: "an inset cannot show its own page" };
  return { index };
}
