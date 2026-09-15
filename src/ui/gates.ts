// Which overlays own every click on the stage.
//
// A gate is a full-stage surface put up by a verb that is waiting for the
// viewer: the wait verb's continue pill, a quiz card, a question asked on the
// figure itself. While one is up, the figure's OWN gestures — info cards, free
// play, the typed-note keyboard — must all stand aside, or they steal the
// click and the drawcast never goes on.
//
// The list lives here rather than in controls.ts (which builds the gates)
// because infocard.ts and chessplay.ts need it too, and controls.ts already
// imports both of them — asking for it there would close a cycle.
//
// It is one constant because it was three: `.cs-waitgate` was missing from
// every guard, so between playlist items — where the continue gate sits on a
// FINISHED figure full of card elements, with the timeline at "done" rather
// than "playing" — a click on any labelled part opened an info card in capture
// phase and stopped the gate's own listener from ever seeing it. Clicking a
// chapter's "go on to …" pill did nothing wherever the drawing had a name on
// it. Guards that name their own subset drift apart; this one cannot.
export const GATE_SELECTOR = ".cs-figgate, .cs-cardgate, .cs-waitgate";

/** True while a verb is waiting on the viewer through a full-stage overlay. */
export function gateIsOpen(stage: ParentNode): boolean {
  return stage.querySelector(GATE_SELECTOR) !== null;
}

// Every live control surface on the stage, for the guards that must let a
// press on one of them alone: the transport buttons and the big play overlay,
// a slider or a field, the param tray, the code card, the control panel's
// transient text input (the drawn panel itself registers a region instead —
// ui/control-press.ts).
//
// It lives here for the same reason GATE_SELECTOR does — controls.ts (the
// stage's click-to-toggle) and widget-host.ts (the widget's press guard) both
// need it, and widget-host.ts cannot import a VALUE from controls.ts without
// closing a cycle (controls.ts imports attachWidgetHost). One constant, so
// the two guards cannot drift into naming different subsets: the widget used
// to name only "button" and swallowed presses that began on a slider.
export const CONTROL_SELECTOR = "input, button, select, textarea, label, .cs-paramtray, .cs-codeedit, .cs-ctlinput";
