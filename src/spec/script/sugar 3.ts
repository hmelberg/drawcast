// The sugar layer: every alias and shorthand as DATA, read by the parser on
// the way in and written by the printer on the way out. One table, two
// readers — a shorthand that cannot be written back breaks the corpus gate,
// which is what keeps sugar from costing fidelity.
import { SIDE_VALUES } from "../types";
import { UNIVERSAL_ANCHORS } from "../../layout/anchors";

/** head → the element type it means, and the fields it implies. */
export const ELEMENT_ALIASES: Record<string, { type: string; fields?: Record<string, unknown> }> = {
  box: { type: "node", fields: { shape: "rect" } },
  circle: { type: "node", fields: { shape: "circle" } },
  person: { type: "node", fields: { shape: "person" } },
  decision: { type: "node", fields: { shape: "decision" } },
  chance: { type: "node", fields: { shape: "chance" } },
  terminal: { type: "node", fields: { shape: "terminal" } },
  note: { type: "text" },
  dot: { type: "point" },
};

/** A bare word that stands for one field and one value. */
export const FLAGS: Record<string, [string, unknown]> = {
  dashed: ["style.dash", true],
  thick: ["style.stroke_width", 3],
  thin: ["style.stroke_width", 1],
  curved: ["curved", true],
  smooth: ["smooth", true],
  closed: ["closed", true],
  rising: ["direction", "increasing"],
  falling: ["direction", "decreasing"],
  flat: ["direction", "flat"],
  convex: ["curvature", "convex"],
  concave: ["curvature", "concave"],
  linear: ["curvature", "linear"],
  gentle: ["steepness", "gentle"],
  medium: ["steepness", "medium"],
  steep: ["steepness", "steep"],
  typed: ["draw.mode", "type"],
  instant: ["draw.mode", "instant"],
};

/** field+value → the bare word, for the printer. Built from FLAGS so the two
 *  directions cannot disagree. */
export const FLAG_FOR = new Map<string, string>(
  Object.entries(FLAGS).map(([word, [path, value]]) => [`${path}=${JSON.stringify(value)}`, word]),
);

/** The colour words a bare token may be. Kept short and unambiguous: every
 *  one of these would otherwise be a perfectly good element id, so the list
 *  is the ones a teacher actually writes. */
export const COLOR_WORDS = new Set([
  "red", "blue", "green", "orange", "purple", "grey", "gray", "black", "brown", "pink", "teal", "yellow",
]);

const HEX_RE = /^#[0-9A-Fa-f]{3,8}$/;

export function isColor(token: string): boolean {
  return HEX_RE.test(token) || COLOR_WORDS.has(token);
}

/** `3s` → 3 seconds. */
export function seconds(token: string): number | null {
  const m = /^(\d+(?:\.\d+)?)s$/.exec(token);
  return m ? Number(m[1]) : null;
}

export const SIDE_WORDS = new Set<string>(SIDE_VALUES);
/** Place names, written with hyphens in a script and underscores in the spec. */
export const PLACE_WORDS = new Map<string, string>(UNIVERSAL_ANCHORS.map((a) => [a.replace(/_/g, "-"), a]));

/** Every word the shorthand grammar owns — what an id must not be (lint §11). */
export const SHORTHAND_WORDS = new Set<string>([
  ...Object.keys(ELEMENT_ALIASES), ...Object.keys(FLAGS), ...COLOR_WORDS, ...SIDE_WORDS, ...PLACE_WORDS.keys(),
]);

/** The element types whose side word means `side` rather than a canvas place. */
export const SIDE_TYPES = new Set(["label", "annotation", "math"]);
