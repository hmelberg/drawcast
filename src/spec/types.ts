import type { TemplateDoc } from "../scenes/doc";
// The single spec format the LLM ever sees. See BRIEF.md and src/spec/schema.ts.
// All coordinates are logical (1000×750, y-up, origin bottom-left) or domain
// coordinates when a `domain` is declared — never screen pixels.

import type { SpecText } from "../layout/text-style";
import type { Language } from "../code/languages";
import type { ChartStyle } from "../code/chart-style";
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
  | "portrait"
  | "source"
  | "code"
  | "sector"
  | "arc"
  | "polygon"
  | "pieces"
  | "angle"
  | "measure";

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
  /** sketch = progressive drawing; instant = at once; type = characters at typing speed with a cursor (code lines only; elsewhere sketch). */
  mode?: "sketch" | "instant" | "type";
  /** seconds */
  duration?: number;
}

/** Endpoint of an arrow/edge: either a reference to an element id, or coordinates. */
export interface EndRef {
  ref?: string;
  x?: number;
  y?: number;
  /** A named point on ref (default center) — see PointRef's anchor names. */
  anchor?: string;
}

/** A point a verb takes: [x, y] (domain units when a domain is declared, else logical) or a named point on an element. */
export type PointRef = [number, number] | EndRef;

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
  // point / angle
  at?: { x?: number; y?: number; intersection_of?: string[]; ref?: string; anchor?: string } | [number, number];
  guides?: boolean;
  // arrow / edge / angle / pieces of triangles ("vertex_k")
  from?: EndRef | [number, number] | number | string;
  to?: EndRef | [number, number] | number;
  curved?: boolean;
  // label
  text?: string;
  attach_to?: string;
  side?: Side;
  /** Resource links for this element's info card (player-only add-on; the
   *  movie export ignores them). Canonical form: array of full https URLs
   *  (max 4) — normalizeSpec folds a bare string into a one-element array. */
  link?: string[] | string;
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
  // sector / arc / polygon / pieces (design §2.2) — radius/x/y reused above (tier-3 raw)
  /** sector/arc: start angle in degrees, counter-clockwise from +x (0 = right, 90 = up). */
  start?: number;
  /** sector/arc: end angle in degrees, counter-clockwise from +x. */
  end?: number;
  /** polygon: number of sides of a regular polygon (with radius, x, y). */
  sides?: number;
  /** polygon: rotation of a regular polygon in degrees. */
  rotation?: number;
  /** pieces: how many pieces to cut a shape into (sectors, strips, or the columns of a grid). */
  n?: number;
  /** pieces grid: rows (n is the columns). */
  rows?: number;
  /** angle/measure: the label text — angle default the rounded degrees ("62°"); false hides it. */
  label?: string | boolean;
  /** angle: draw the right-angle square (default: automatically when the angle is within 0.5° of 90). */
  right?: boolean;
  /** measure: what to read — length, width, height, area, or perimeter (default: length for a segment/open outline, area for a closed one). */
  what?: "length" | "width" | "height" | "area" | "perimeter";
  /** measure: appended to the value — "cm". */
  unit?: string;
  /** measure: logical units per unit (default 1) — 50 with unit cm makes a 100-unit side read 2.0 cm. */
  scale?: number;
  /** measure: decimals shown (default 0 when the value is 100 or more, else 1). */
  decimals?: number;
  /** measure: how far the dimension line sits from the segment (default 24). */
  offset?: number;
  // portrait (a photo traced into sketch strokes) / source (a book or paper)
  /** Person's name (portrait), work's title (source) — resolved via Wikipedia when url/strokes are absent — or, on pieces, what to cut: "sectors" (a circle), "strips" or "grid" (a width × height rectangle centred on x, y). measure: the element to measure. */
  of?: string;
  /** Direct image URL (user-provided; CORS-permitting hosts only). */
  url?: string;
  /** Embedded traced strokes (spec/trace.ts encoding); set automatically for dropped files. */
  strokes?: string;
  /** Provenance: where the traced image came from (attribution). */
  source?: string;
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
  // code (a script whose code and/or output is drawn in a panel)
  /** code: the runtime that executes the script — see src/code/languages.ts. */
  language?: Language;
  /** code: the script itself, one newline-separated string. */
  code?: string;
  /** code: where the CODE sits relative to its output — output (just the result; the default), left / right (code pane on that side), above / below (stacked at full width), code (the script alone), or none (nothing drawn: the element only feeds template params through "{id.var}" tokens). */
  show?: "output" | "left" | "right" | "above" | "below" | "code" | "none";
  /** code: show the script through a window this many lines tall (≥ 3); stepping past it scrolls, as an editor does. */
  lines?: number;
  /** code: chrome around the panel — panel (default), window (title bar), screen (bezel on a stand), laptop (bezel + keyboard), none. */
  frame?: "panel" | "window" | "screen" | "laptop" | "crt" | "c64" | "none";
  /** code: number of separate figures the script produces (>= 2) — each becomes its own beat `<id>_fig_N`, all sharing one frame. */
  figures?: number;
  /** code: how a matplotlib chart LOOKS — seaborn (the default: a calm grid),
   *  xkcd (hand-drawn wobble), plain (matplotlib's own). python only. */
  chart?: ChartStyle;
  /** code: an https URL to a C64 program (.prg/.d64/.t64/.zip). The screen
   *  gets a play mark; while the app is paused a click starts it in an
   *  emulator over the figure — app only, never in a movie. */
  game?: string;
  /** code: marker passes over the drawn script, each its own beat
   *  `<id>_mark_1` … — a string highlights it, an object picks the kind. */
  marks?: (string | { text: string; kind?: "mark" | "strike" | "underline" })[];
  /** code: machine-written execution result envelope (JSON — see src/code/run.ts). Never authored. */
  code_result?: string;
  // source (a book cover, a paper's title page, or one page of either)
  /** DOI of a paper — resolved to its open-access PDF via OpenAlex/Unpaywall. */
  doi?: string;
  /** ISBN of a book — resolved to its Open Library cover. */
  isbn?: string;
  /** Internet Archive scan id — resolved to a IIIF page image of that scan. */
  archive?: string;
  /** PDF page (1-based) or, on the archive path, the scan's LEAF index. */
  page?: number;
  /** Passage on `page` to sweep with a highlighter (PDF path only). */
  quote?: string;
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

/** Keep a faded copy of the targets where they are now — true, a list of ids, or {of, opacity}. */
export type GhostOption = boolean | string[] | { of?: string[]; opacity?: number };

export interface MoveArgs {
  target: string[] | string;
  /** [dx, dy] delta — domain units when a domain is declared, else logical. */
  by?: [number, number];
  /** Absolute destination for the element's `anchor` (default its centre); alternative to by/path. */
  to?: PointRef;
  /** Waypoint offsets from the element's starting position; the last is the final offset. */
  path?: [number, number][];
  /** Degrees, counter-clockwise (y-up); the element turns about `pivot`. */
  rotate?: number;
  /** The point to turn or grow about. Either `[x, y]` / `{x, y}` (domain units
   *  when a domain is declared), `{ref, anchor?}` — a named point on another
   *  element, resolved once from where the scene stands BEFORE this move, and
   *  then carried along by the move's own translation — or a bare `{anchor}`,
   *  which names that anchor on each moving element itself.
   *  Default: the element's own centre. */
  pivot?: PointRef;
  /** Which anchor of the moving element lands on `to` (default center). */
  anchor?: string;
  /** Uniform scale factor about pivot (default the element's centre); cumulative across moves. */
  scale?: number;
  /** seconds */
  duration?: number;
  easing?: Easing;
  /** Leave the track of one target's anchor as an element `<id>_trail` — e.g. `true` traces the first target's centre, `{"of": "wheel", "anchor": "bottom"}` traces that point (a rolling wheel's bottom draws the cycloid). */
  trail?: boolean | { of?: string; anchor?: string; color?: string; width?: number };
  /** Keep a faded copy of the targets where they are BEFORE this move. */
  ghost?: GhostOption;
}

export interface ArrangeArgs {
  /** Element ids, or ONE pieces id (all its pieces). */
  target: string[] | string;
  layout: "row" | "zipper" | "grid" | "ring" | "stack" | "fan" | "hex" | "unroll";
  /** Centre of the arrangement (same units as move.by); default: the targets' current centroid (fan: the first sector's apex). */
  at?: PointRef;
  /** fan: the angle (degrees, counter-clockwise from +x) where the first piece begins (default 0). */
  start?: number;
  /** Space between neighbours, logical units (default 6). */
  gap?: number;
  /** grid: pieces per row. */
  columns?: number;
  /** seconds (default 2) */
  duration?: number;
  easing?: Easing;
  /** Keep a faded copy of the targets where they are BEFORE this arrange. */
  ghost?: GhostOption;
}

export interface FadeArgs {
  /** Element ids, or one pieces id (all its pieces). */
  target: string[] | string;
  /** Opacity 0–1 to settle at; 1 restores. Persistent until the next fade. */
  to: number;
  /** seconds (default 1) */
  duration?: number;
  easing?: Easing;
}

export interface FlipArgs {
  /** Element ids, or one pieces id. */
  target: string[] | string;
  /** Mirror axis through `through` (default vertical). */
  axis?: "vertical" | "horizontal";
  /** A point on the axis (default: each target's own current centre). */
  through?: PointRef;
  /** An explicit mirror line (overrides axis/through). */
  line?: { from: PointRef; to: PointRef };
  /** seconds (default 1.2) */
  duration?: number;
  easing?: Easing;
  /** Keep a faded copy of the targets where they are BEFORE this flip. */
  ghost?: GhostOption;
}

export interface MorphArgs {
  /** Element ids, or one pieces id. */
  target: string[] | string;
  /** The new outline in canvas coordinates, or another element's outline. */
  to?: [number, number][] | { ref: string };
  /** Per-axis factors about `pivot` (default the element's centre). */
  stretch?: [number, number];
  pivot?: PointRef;
  /** Back to the layout's points. */
  reset?: boolean;
  /** seconds (default 1.5) */
  duration?: number;
  easing?: Easing;
  /** Keep a faded copy of the targets where they are BEFORE this morph. */
  ghost?: GhostOption;
}

export interface FlowArgs {
  /** Stroke element ids the marks stream along (arrow, edge, path, curve, arc, template strokes). */
  along: string[] | string;
  /** Seconds (default 3; with a paired speak and no duration: until the voice ends). */
  duration?: number;
  /** Logical units per second (default 120). */
  speed?: number;
  /** Units between marks (default 24). */
  spacing?: number;
  kind?: "dots" | "dashes";
  /** Default: the element's own colour. */
  color?: string;
  /** Stream from the stroke's end to its start. */
  reverse?: boolean;
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

export interface KeepArgs {
  /** Element ids, or one pieces id. */
  target: string[] | string;
  /** Opacity of the kept copy (default 0.3). */
  opacity?: number;
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
  /** Lay elements out (row / zipper / fan / grid / ring / hex / stack) and animate them
   *  there — every position and turn computed from the targets' geometry. */
  arrange?: ArrangeArgs;
  /** Persistently dim elements (or restore with to: 1); attached labels fade with them. */
  fade?: FadeArgs;
  /** Reflect elements across a line, played as a turn-over. */
  flip?: FlipArgs;
  /** Tween an outline to new points, another outline, or a stretch. */
  morph?: MorphArgs;
  /** Dots or dashes streaming along strokes while the sentence lands. */
  flow?: FlowArgs;
  /** Keep a faded copy of what is about to be drawn over, in place. */
  keep?: KeepArgs;
  /** Zoom/pan the view. */
  camera?: CameraArgs;
  /** Smoothly animate numeric template params to target values (dot paths
   *  into params). A value may be a "{var}" token: the param glides to the
   *  viewer's stored answer (fallback = that ask's default). */
  animate?: Record<string, number | string>;
  /** With animate: seconds the animation takes (default 2). */
  duration?: number;
  /** With animate: keep a faded copy of the figure at this boundary (true = every visible id). */
  ghost?: GhostOption;
  /** With animate: velocity profile over the whole tween (default: today's
   *  smoothstep — ease in AND out). A long race wants `linear` so the
   *  middle years run at constant speed instead of blurring past. */
  easing?: Easing;
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
  /** Open the explore tray and wait (app only; movies skip the whole beat,
   *  narration included). params restricts which sliders show; `space` opens
   *  the Space section — the solar system's bodies, or a sky map's sky. */
  explore?: { params?: string[]; code?: string; game?: string; anatomy?: boolean; space?: boolean };
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
  /** Answer device: click = click the element on the figure (answer = its id);
   *  piano = press a key on the drawn keyboard (answer = the note, e.g. "C4");
   *  chess = click two squares (answer = the move, e.g. "e2e4");
   *  code = write a script on a code panel (implied by `code`). Requires answer. */
  widget?: "click" | "piano" | "chess" | "code" | "drag" | "connect";
  /** drag widget: what to drag onto the figure — element ids, notes (piano) or
   *  squares (chess), each with an optional label (default: the id humanised).
   *  The answer is implied (all of them); `right` is required. */
  items?: (string | { id: string; label?: string })[];
  /** drag widget: how far outside a target's outline a drop may land and still
   *  count, as a fraction of the target's bbox diagonal (default 0.25; 0 = inside only). */
  tolerance?: number;
  /** code widget: the code element the viewer writes in — normally an empty
   *  or stubbed panel with a frame, which opens with its editor on it. */
  code?: string;
  /** code widget: what the run has to say — "stdout" (what it printed; the
   *  default), "figure" (a plot appeared), or a variable path the data bridge
   *  can harvest ("total", "df.mean"). Compared against `answer`. */
  expect?: string;
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
   * Global text defaults — CSS property names, CSS keyword values: a base
   * `font_size` (every size in the drawing scales by it / 26), a generic
   * `font_family`, a `font_weight`. The viewer can override size and family
   * in Settings → Playback; see layout/text-style.ts for the precedence.
   */
  text?: SpecText;
  /**
   * BCP-47 primary tag for the language the text is WRITTEN in ("en", "nb",
   * "fr"). Absent means the old behaviour: the language is sniffed per line,
   * which can only tell English from Norwegian — so a translated drawcast
   * without this field gets read aloud by an English voice.
   */
  lang?: string;
  /**
   * Drawn text a template computes for itself, and its replacement. A scene
   * supplies its own captions ("Susceptible" for compartment "S"), so those
   * words never appear in the spec and a translation cannot reach them by
   * rewriting fields. Applied in the layout, before labels are placed.
   * Written by the translator; absent on everything else.
   */
  text_map?: Record<string, string>;
  /**
   * Subtitle tracks: language code → (source caption line → translated line).
   * What the CC menu offers. Written once at authoring time and carried in the
   * document, so playback — including the standalone viewer, which has no API
   * key — never calls a model. Source-keyed rather than timestamped: see
   * spec/subtitles.ts for why a drawcast cannot have a cue clock.
   */
  subtitles?: Record<string, Record<string, string>>;
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
  /**
   * Template documents this drawcast carries with it (template-on-demand):
   * registered on load by every render path, never shadowing a built-in,
   * so a published cast renders for a viewer who has none of the author's
   * My templates. The compiler never writes this field; the app does.
   */
  templates?: TemplateDoc[];
  domain?: { x?: [number, number]; y?: [number, number] };
  elements?: SpecElement[];
  commands?: Command[];
}
