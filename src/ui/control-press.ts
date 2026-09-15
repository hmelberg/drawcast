// Who owns a press on the stage. The stage's click-to-toggle-play gesture
// (controls.ts) must not fire for a press that began on a control — and the
// drawn control panel (layout/code-controls-pane.ts, live through
// ui/controls-host.ts) is a control with no DOM node to match a CSS
// selector against. So the gesture asks a registry: any module that owns a
// region of the stage registers a predicate here, and controls.ts never
// learns who they are (no import in either direction — the tray imports
// controls.ts already, and the host is the tray's).
//
// The same registry carries the Continue hook: while an explore beat holds
// the run with the tray shut (spec 2026-09-15 §3.3), the play gesture — a
// click on the figure, the bar's ▶ — must resolve the gate rather than
// toggle the timeline, and only the tray knows whether a gate is open.
// Keyed on the stage element so two mounted sessions never share state.

const regions = new WeakMap<HTMLElement, Set<(e: MouseEvent) => boolean>>();
const continues = new WeakMap<HTMLElement, Set<() => boolean>>();

function add<T>(map: WeakMap<HTMLElement, Set<T>>, stage: HTMLElement, fn: T): () => void {
  let set = map.get(stage);
  if (!set) {
    set = new Set<T>();
    map.set(stage, set);
  }
  set.add(fn);
  return () => {
    set!.delete(fn);
  };
}

/** Register a predicate: true when the press belongs to a control. */
export function registerControlRegion(stage: HTMLElement, fn: (e: MouseEvent) => boolean): () => void {
  return add(regions, stage, fn);
}

/** True when any registered region claims the press. */
export function inControlRegion(stage: HTMLElement, e: MouseEvent): boolean {
  const set = regions.get(stage);
  if (!set) return false;
  for (const fn of set) if (fn(e)) return true;
  return false;
}

/** Register a Continue hook: return true to consume the play gesture. */
export function registerContinue(stage: HTMLElement, fn: () => boolean): () => void {
  return add(continues, stage, fn);
}

/** Offer the play gesture to the hooks; true when one consumed it. */
export function tryContinue(stage: HTMLElement): boolean {
  const set = continues.get(stage);
  if (!set) return false;
  for (const fn of set) if (fn()) return true;
  return false;
}
