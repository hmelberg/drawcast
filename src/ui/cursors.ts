// The pointer's look over a question on the figure — one place for every
// gate's cursor (the gates set these on their own overlay; styles.css keeps
// the plain CSS keywords for the rest of the stage).
//
// Design note (Hans, standing rule: "nice, intuitive and good-looking
// symbols"). The cursor says what a press will DO, in the house's calm,
// hand-drawn voice — never a technical aim:
//
//   pick      the hand (`pointer`): a press chooses something — a point on a
//             number line, a person in a crowd, an option, a card. The
//             number line also shows a faded copy of its own marker under
//             the pointer, with the value it would pick, so the hand needs
//             no help aiming.
//   grab /    the open and the closed hand: a press takes hold of a thing
//   grabbing  and moves it — a bar's top, a pie slice's edge, a curve.
//   pen       a small pencil (steel-blue body, warm-red end, the tip at the
//             hotspot): a press draws — the rest of a line, a link between
//             two stars. Falls back to the hand where a browser shows no
//             image cursors.
//   idle      the plain arrow where a press does nothing.
//
// No crosshair anywhere: it reads as a sniper's sight or a CAD tool, cold
// next to the paper and ink. tests/cursor.test.ts fails if it comes back.

/** The pencil, drawn pointing down-left; its tip is the hotspot (3, 21). */
const PENCIL_SVG =
  "<svg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24'>" +
  "<g transform='rotate(-45 3 21)' stroke='#3d3833' stroke-width='1.1' stroke-linejoin='round'>" +
  // a pale halo so the pencil reads on dark fills too
  "<path d='M2 21 L9 17 L25 17 L25 25 L9 25 Z' fill='none' stroke='#fffdf8' stroke-width='3'/>" +
  "<path d='M9 18 L21 18 L21 24 L9 24 Z' fill='#2f6b8f'/>" +
  "<path d='M21 18 L24 18 L24 24 L21 24 Z' fill='#b5482e'/>" +
  "<path d='M9 18 L3 21 L9 24 Z' fill='#f1dfbf'/>" +
  "<path d='M3 21 L5.4 19.8 L5.4 22.2 Z' fill='#3d3833' stroke='none'/>" +
  "</g></svg>";

export const CURSOR = {
  idle: "default",
  pick: "pointer",
  grab: "grab",
  grabbing: "grabbing",
  pen: `url("data:image/svg+xml,${encodeURIComponent(PENCIL_SVG)}") 3 21, pointer`,
} as const;

export type CursorName = keyof typeof CURSOR;

/** What a guess handle's kind shows: over it (`hover`) and while worked (`drag`). */
export function guessCursor(kind: "height" | "curve" | "angle" | "count" | "point" | "market", state: "hover" | "drag"): string {
  switch (kind) {
    case "height":
    case "angle":
    case "market":
      return state === "drag" ? CURSOR.grabbing : CURSOR.grab;
    case "curve":
      return CURSOR.pen;
    case "count":
    case "point":
      return CURSOR.pick;
  }
}
