// The space an animate glides a template param through (scenes/types.ts
// TweenSpace, 2026-09-29): linear by default; "log" for a param whose
// meaning is a distance from an origin that shrinks by factors — a log_ago
// timeline's view zooming from 4.5 billion years ago toward the present.
import type { TweenSpace } from "../scenes/types";

/** The value at eased progress e between start s and target t. */
export function tweenValue(s: number, t: number, e: number, space?: TweenSpace | null): number {
  if (space?.kind === "log") {
    const ds = space.sign * (s - space.origin);
    const dt = space.sign * (t - space.origin);
    if (ds > 0 && dt > 0) return space.origin + space.sign * Math.exp(Math.log(ds) + (Math.log(dt) - Math.log(ds)) * e);
  }
  return s + (t - s) * e;
}
