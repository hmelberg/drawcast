// The single spec format the LLM ever sees. See BRIEF.md and src/spec/schema.ts.
// All coordinates are logical (1000×750, y-up, origin bottom-left) or domain
// coordinates when a `domain` is declared — never screen pixels.

import type { Instrument, PlayVoice } from "./notation";
export type { Instrument, PlayVoice } from "./notation";

export type ElementType =
  | "axes"
  | "curve"
  | "point"
  | "arrow"
  | "label"
  | "region"
  | "node"
  | "edge"
  | "annotation"
  | "path"
  | "text"
  | "shape"
  | "portrait";

/**
 * Permanent punctuation marks, drawn natively: box the answer, strike the
 * rejected. Transient emphasis belongs to the highlight verb (glow) and the
 * point laser; area emphasis to region shading.
 */
export type AnnotationKind = "box" | "circle" | "strike" | "cross";

/**
 * Canonical list — Side is derived from it (not the reverse) so a ninth
 * side can only ever be added here; every other consumer (e.g. compile.ts's
 * label-side guard) imports SIDE_VALUES instead of hand-copying the union.
 */
export const SIDE_VALUES = ["above", "below", "left", "right", "above-left", "above-right", "below-left", "below-right"] as const;

export type Side = (typeof SIDE_VALUES)[number];

export interface SpecStyle {
  color?: string;
  fill?: string;
  stroke_width?: number;
  dash?: boolean;
  roughness?: number;
  opacity?: number;
}

export interface SpecDraw {
  mode?: "sketch" | "instant";
  /** seconds */
  duration?: number;
}

/** Endpoint of an arrow/edge: either a reference to an element id, or coordinates. */
export interface EndRef {
  ref?: string;
  x?: number;
  y?: number;
}

export interface SpecElement {
  id: string;
  type: ElementType;
  // axes
  x_label?: string;
  y_label?: string;
  // curve (qualitative or explicit expression over the x domain)
  direction?: "increasing" | "decreasing" | "flat" | "vertical";
  curvature?: "linear" | "convex" | "concave";
  steepness?: "gentle" | "medium" | "steep";
  expr?: string;
  x_from?: number;
  x_to?: number;
  // point
  at?: { x?: number; y?: number; intersection_of?: string[] };
  guides?: boolean;
  // arrow / edge
  from?: EndRef;
  to?: EndRef;
  curved?: boolean;
  // label
  text?: string;
  attach_to?: string;
  side?: Side;
  // region
  between?: string[];
  // annotation
  /** Id of the element this annotation marks. */
  target?: string;
  /** Mark style; defaults to box for text targets, circle otherwise. */
  kind?: AnnotationKind;
  // node / tier-3 shape
  shape?: "decision" | "chance" | "terminal" | "rect" | "circle" | "triangle" | "person";
  // tier-3 raw coordinates (logical units)
  points?: [number, number][];
  closed?: boolean;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  radius?: number;
  font_size?: number;
  // portrait (a photo traced into sketch strokes)
  /** Person's name — resolved to a portrait via Wikipedia when url/strokes are absent. */
  of?: string;
  /** Direct image URL (user-provided; CORS-permitting hosts only). */
  url?: string;
  /** Embedded traced strokes (spec/trace.ts encoding); set automatically for dropped files. */
  strokes?: string;
  /** Provenance: where the traced image came from (attribution). */
  source?: string;
  /** Portrait look: photo (faithful framed grayscale, the default), halftone dots, poster regions, or line sketch. */
  look?: "photo" | "halftone" | "poster" | "line";
  /**
   * Cameo presentation: centered, larger, frameless, fast fade — for the
   * appear-at-first-mention-then-erase pattern. Off = the small framed
   * fixture look.
   */
  cameo?: boolean;
  /**
   * How a photo portrait enters (and, reversed, exits): wipe = top-down
   * print (the portrait default), develop = darkroom blur-to-sharp,
   * iris = circle opening, drift = settle-and-fade, fade = plain opacity.
   */
  reveal?: "develop" | "iris" | "wipe" | "drift" | "fade";
  // cross-cutting
  style?: SpecStyle;
  draw?: SpecDraw;
}

export type Easing = "linear" | "ease-in" | "ease-out" | "ease-in-out";
export type HighlightEffect = "pulse" | "circle" | "glow";
export type PointGesture = "tap" | "circle" | "underline";

export interface HighlightArgs {
  target: string[] | string;
  effect?: HighlightEffect;
  /** seconds */
  duration?: number;
  color?: string;
}

export interface PointArgs {
  /** Element id (ref) or coordinates (domain units when a domain is declared). */
  at: EndRef;
  gesture?: PointGesture;
  /** seconds */
  duration?: number;
}

export interface MoveArgs {
  target: string[] | string;
  /** [dx, dy] delta — domain units when a domain is declared, else logical. */
  by?: [number, number];
  /** Waypoint offsets from the element's starting position; the last is the final offset. */
  path?: [number, number][];
  /** seconds */
  duration?: number;
  easing?: Easing;
}

export interface CameraArgs {
  /** Element id (ref) or coordinates to center on. */
  center?: EndRef;
  /** Magnification: 1 = whole canvas, 2 = 2×, … */
  zoom?: number;
  /** Return to the full canvas. */
  reset?: boolean;
  /** seconds */
  duration?: number;
}

export interface FocusArgs {
  /** Element ids that stay at full strength; every other visible element dims. */
  target: string[] | string;
  /** Seconds. Omit with a paired speak to hold the focus for the whole sentence (default 2 otherwise). */
  duration?: number;
}

export interface ClearArgs {
  /** Ids to leave visible (e.g. the axes). */
  keep?: string[] | string;
}

export interface Command {
  speak?: string;
  /** With speak: false = start speaking and continue to the next command immediately. */
  blocking?: boolean;
  /** With speak: which dialogue voice reads the line ("a" = lead/teacher, the default; "b" = second voice). */
  voice?: "a" | "b";
  /** With speak: named prosody nudge — soft (confiding), grave (slow reveal), brisk (light recap). Use sparingly. */
  delivery?: "soft" | "grave" | "brisk";
  draw?: string[] | string;
  /** With draw/erase: animate the listed elements simultaneously. */
  parallel?: boolean;
  /** seconds (the YAML-friendly `pause: click` is normalized to `wait`) */
  pause?: number;
  /** Wait for viewer input before continuing (auto-resolved in export/kiosk). */
  wait?: "click";
  /** Make elements visible instantly (inverse of hide). */
  show?: string[] | string;
  /** Make elements invisible instantly (they can be shown again). */
  hide?: string[] | string;
  /** Remove elements with a reverse hand-drawn animation, then keep them hidden. */
  erase?: string[] | string;
  /** Hide everything currently visible (except clear.keep). */
  clear?: ClearArgs;
  /** Temporary emphasis on visible elements. */
  highlight?: HighlightArgs;
  /** The inverse spotlight: dim everything EXCEPT the targets while the paired sentence lands. */
  focus?: FocusArgs;
  /** Laser pointer: travel to a target and gesture at it. */
  point?: PointArgs;
  /** Translate elements by a delta or along a path of offsets. */
  move?: MoveArgs;
  /** Zoom/pan the view. */
  camera?: CameraArgs;
  /** Smoothly animate numeric template params to target values (dot paths into params). */
  animate?: Record<string, number>;
  /** With animate: seconds the animation takes (default 2). */
  duration?: number;
  /**
   * Play synthesized notes: a notation string ("C4:q E4:q G4:h", chords with
   * +, R for rests), up to four parallel voices [{notes, instrument}], or a
   * whole tune as ABC notation ({abc: "K:G\n..."}).
   */
  play?: string | PlayVoice[] | { abc: string };
  /** With play: beats per minute (default 100). */
  tempo?: number;
  /** With play (string form): the synthesized instrument (default tone). */
  instrument?: Instrument;
  /**
   * With play: element ids revealed IN TIME with the notes and KEPT — id k
   * appears the moment the k-th sounding note of the first voice starts and
   * stays (staff notes accumulating as they play).
   */
  reveal?: string[] | string;
  /**
   * With play: element ids PRESSED in time with the notes — id k appears
   * when the k-th sounding note starts and disappears when it ends, like a
   * piano key going down and back up. Ends hidden.
   */
  press?: string[] | string;
  /** Pose a multiple-choice question (the quiz verb). */
  quiz?: QuizArgs;
  /** Pose a typed-answer question (the ask verb). */
  ask?: AskArgs;
  /** A named position in the storyboard — the target of quiz/ask gotos. */
  label?: string;
  /** Conditional jump on a stored ask answer. Live viewers only; movies stay linear. */
  if?: IfArgs;
}

export interface IfArgs {
  /** The stored variable to test (an earlier ask's store name). */
  var: string;
  /** Exactly ONE comparison: numeric gt/lt/gte/lte, or string eq/ne (trimmed, case-insensitive). */
  gt?: number;
  lt?: number;
  gte?: number;
  lte?: number;
  eq?: string;
  ne?: string;
  /** Label to jump to when the comparison holds. */
  goto: string;
}

export interface AskArgs {
  /** The question, spoken aloud and shown as the caption (a paired speak overrides the spoken line). */
  question: string;
  /** Spoken introduction, prepended to the question line — lives INSIDE the
   *  element so skipping the question skips its introduction with it. */
  intro?: string;
  /** Correct answer (check mode). Compared trimmed, case-insensitively. */
  answer?: string;
  /** Spoken on a correct answer; doubles as the reveal line. */
  right?: string;
  /** Spoken on a wrong attempt (check mode only). */
  wrong?: string;
  /** Check mode: speak the correct answer after a final wrong attempt (default true). */
  reveal?: boolean;
  /** Check mode: clear the field and ask again after a wrong attempt (default false). */
  retry?: boolean;
  /** Store the typed response under this name; later speak lines may use {name}. */
  store?: string;
  /** Stand-in the movie types and the silent/skip paths use. REQUIRED with store. */
  default?: string;
  /** Player mode only: the question cannot be skipped without answering. Movies never wait. */
  required?: boolean;
  /** Jump to this label on a correct viewer answer (movies stay linear). */
  right_goto?: string;
  /** Jump to this label on a wrong viewer answer — the re-watch loop. */
  wrong_goto?: string;
}

export interface QuizArgs {
  /** The question, spoken aloud and shown as the caption (a paired speak overrides the spoken line). */
  question: string;
  /** Spoken introduction, prepended to the question line — lives INSIDE the
   *  element so skipping the question skips its introduction with it. */
  intro?: string;
  /** 2-4 short answer options. */
  choices: string[];
  /** 1-based index of the correct choice. */
  correct: number;
  /** Spoken when the viewer answers correctly (optional). */
  right?: string;
  /** Spoken on a wrong pick, before the answer is revealed (optional). */
  wrong?: string;
  /** Player mode only: the question cannot be skipped without answering. Movies never wait. */
  required?: boolean;
  /** Jump to this label on a correct viewer answer (movies stay linear). */
  right_goto?: string;
  /** Jump to this label on a wrong viewer answer — the re-watch loop. */
  wrong_goto?: string;
}

export interface Spec {
  title?: string;
  /**
   * Playlist transition (on any item after the first): before this item
   * begins, the PREVIOUS figure zooms into this element id of ITS OWN scene
   * and fades there — the semantic-zoom entrance (heart → cell → molecule).
   */
  zoom_from?: string;
  /** Difficulty badge, shown in playlist navigation (stamped from #basic/#advanced). */
  level?: "basic" | "advanced";
  /** Narrator gender preference (stamped from #male/#female). In dialogue this is speaker "a"; "b" gets the contrast. */
  voice?: "male" | "female";
  canvas?: { width: number; height: number };
  template?: string;
  params?: Record<string, unknown>;
  domain?: { x?: [number, number]; y?: [number, number] };
  elements?: SpecElement[];
  commands?: Command[];
}
