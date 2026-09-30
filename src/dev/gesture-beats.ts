// Which beats the dev frames sheet (frames.ts) holds mid-gesture — apart from
// the page so a test can import it without the page's DOM side effects.
import type { PlanStep } from "../render/plan";

const GESTURES = new Set(["highlight", "focus", "point", "flow", "mark"]);

/** The momentary gesture this beat performs, if the frame is a narrated
 *  gesture beat — the step whose after-state would hide it. */
export function gestureAt(plan: { steps: PlanStep[] }, at: number): PlanStep | null {
  const step = plan.steps[at - 1];
  return step && GESTURES.has(step.kind) && step.narration ? step : null;
}

/** The sheet's name for a gesture beat: its kind, a mark by its look ("light mark"). */
export function gestureLabel(step: PlanStep): string {
  return step.kind === "mark" ? `${step.mark} mark` : step.kind;
}
