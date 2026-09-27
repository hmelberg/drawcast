// Where the big ▶/↻ sits while the figure is paused.
//
// On an ordinary cast it is centred on the figure: pause is a still, and the
// button is the one thing to do. On a figure the viewer works with their hands
// while paused — a live widget body (supply_demand's curves, a decision tree,
// the unit circle's point), a template's own free play (piano keys, a chess
// board, a staff) — the centre is exactly where the parts are: it covered the
// unit circle's origin and a tree's middle branch label, and a press there
// played the cast instead of taking the part. There it docks small in the
// top-left corner (styles.css, `.cs-handson`), still a button, still in the
// tab order, still labelled.
//
// Two more cases hide or dock it without this module: a drawn control panel
// (`.cs-ctl-live`, set by ui/controls-host.ts — it mounts with the tray, after
// the controls) docks it by the same CSS rule, and an explore beat holding the
// run (`.cs-gated`) or an open explore (`.cs-exploring`) hides it outright.

import type { InteractionKind } from "../scenes/types";

/** Template interactions played ON the figure while paused (the tray-launched
 *  explore sections — periodic, space, sky — hide the button by themselves). */
const ON_FIGURE: readonly InteractionKind[] = ["piano", "chess", "staff"];

/** Class on the stage while the paused figure is something to handle. */
export const HANDS_ON_CLASS = "cs-handson";

/** True when the paused figure invites presses on its own parts. */
export function figureIsHandsOn(o: { widget: boolean; interactions: readonly InteractionKind[] }): boolean {
  return o.widget || o.interactions.some((k) => ON_FIGURE.includes(k));
}
