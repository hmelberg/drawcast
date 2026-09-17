// Pure navigation rules for a multi-item playlist (player-nav round,
// 2026-09-17). A lecture of many items should feel like ONE drawcast: the
// step buttons walk across item borders instead of clamping at them, and
// the replay offered after the last item restarts the whole thing. The
// chapter cards and fades of normal playback are untouched — stepping is a
// scrub, and a scrub is a hard jump.

export interface EdgeState {
  /** Steps completed in the item on screen. */
  completed: number;
  /** Steps in the item on screen. */
  total: number;
  /** Index of the item on screen; -1 on the title page. */
  idx: number;
  /** Number of items in the playlist. */
  count: number;
}

/** Where a step lands when it crosses a border; null = an ordinary step. */
export interface EdgeMove {
  index: number;
  /** "end" = the finished figure (stepping back into it); "start" = a blank stage. */
  at: "start" | "end";
}

export function edgeStep(dir: "back" | "forward", s: EdgeState): EdgeMove | null {
  if (s.count <= 1) return null;
  if (dir === "back") {
    if (s.completed > 0 || s.idx <= 0) return null;
    return { index: s.idx - 1, at: "end" };
  }
  if (s.completed < s.total || s.idx >= s.count - 1) return null;
  return { index: s.idx + 1, at: "start" };
}

/** What a play press restarts once the LAST item has finished: the title page
 *  when the playlist has one, else the first item. A poster the viewer merely
 *  jumped to has not finished — it plays itself (null). */
export function replayTarget(s: { finishedLast: boolean; hasTitle: boolean }): "title" | "first" | null {
  if (!s.finishedLast) return null;
  return s.hasTitle ? "title" : "first";
}
