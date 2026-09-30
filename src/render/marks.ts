// Marks on picture places (spec §13): one mark per picture — a soft light, a
// hand-drawn ring or box, an arrow or a glow — that travels through the
// places a sentence names and glides from step to step. The planner
// (plan.ts) computes every box; drawing and playing them come later.

import type { BBox } from "../layout/geometry";

export type MarkKind = "light" | "ring" | "box" | "arrow" | "glow";

/** One stop of a mark: its box (canvas, y-up) and when it is reached, as a fraction of the step. */
export interface MarkStop {
  box: BBox;
  at: number;
}
