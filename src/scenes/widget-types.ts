// The widget contract (spec 2026-09-14-widget-bodies-design §2.2): a pure
// function of (event, state, scene) → (state, effects). The host performs
// effects; the body never sees the DOM, timers or the player.
import type { BBox } from "../layout/geometry";
import type { Pt } from "../layout/model";

export type WidgetEvent =
  | {
      type: "click";
      /** The part hit (a top-level id of the template layout). */
      id: string;
      /** Logical, y-up. */
      point: Pt;
      /** Spec-domain units when the spec declares a domain, else null. */
      domain: Pt | null;
    }
  /** A key the body declared, on release (spec §2.2 addendum 2026-09-15):
   *  `key` is the DOM KeyboardEvent.key, `ms` how long it was held — one
   *  key can be both a dot and a dash. */
  | { type: "key"; key: string; ms: number }
  /** A press that moved ≥ DRAG_MIN before release (spec §2.2 addendum
   *  2026-09-15b): `id` is the part pressed, `to` the part under the release
   *  point — null on blank paper, and it may equal `id`. `point`/`domain` are
   *  where it was let go. */
  | {
      type: "drag";
      id: string;
      to: string | null;
      point: Pt;
      domain: Pt | null;
      /** Where the press began (logical, and in domain units) — the host
       *  always fills these; a hand-built event may leave them out. */
      from?: Pt;
      fromDomain?: Pt | null;
    }
  /** A LIVE body's drag in flight (`live: true`, 2026-09-26): delivered at
   *  most once per animation frame while the pointer moves, each against the
   *  scene AS IT WAS PRESSED — so a body maps (press point → pointer) onto
   *  the press-time params and needs no state to be exact. The release still
   *  delivers the usual `drag`, against that same scene. */
  | { type: "drag_move"; id: string; from: Pt; fromDomain: Pt | null; point: Pt; domain: Pt | null }
  /** A number the viewer TYPED into a part the body declared `editable`
   *  (2026-09-27): the host showed the field, parsed the text and checked it
   *  against the field's own min/max — the body gets a finite number only.
   *  `point` is where the tap that opened the field landed (a part holding
   *  two numbers tells them apart by it). */
  | { type: "input"; id: string; value: number; point: Pt }
  /** A zoom over the body's `surface` (2026-09-27): ctrl/⌘ + wheel or a
   *  trackpad pinch while paused. `factor` > 1 zooms in, about `point`. */
  | { type: "zoom"; point: Pt; domain: Pt | null; factor: number };

/** The part id a press on the body's `surface` (blank paper there) carries. */
export const SURFACE_PART = "__surface";

/** What a tap on an editable part opens (WidgetBody.editable): a number
 *  field laid over the number it edits. Validated by the host
 *  (widget-effects.ts validateEditField). */
export interface EditField {
  /** The number as it stands: the field's starting text. */
  value: number;
  /** What the field edits, for its aria-label ("Probability of Success"). */
  label: string;
  /** Inclusive bounds; a typed number outside them is rejected, not clamped. */
  min?: number;
  max?: number;
  /** The input's step (the browser's spinner), not a rounding rule. */
  step?: number;
  /** Where to lay the field, logical y-up; absent = the part's box. A part
   *  that holds two numbers ("9.5, £300") gives the half the tap chose. */
  box?: BBox;
}

export interface WidgetScene {
  /** The widget's parts: the template layout's top-level ids at these params. */
  ids: string[];
  boxes: Map<string, BBox>;
  rings: Map<string, Pt[][]>;
  /** Open strokes per part, in logical units (layout.ts elementLines): what a
   *  body that grabs curves measures against. */
  lines: Map<string, Pt[][]>;
  /** Template params as painted, the widget's own patches included. */
  params: Record<string, unknown>;
  vars: Record<string, string>;
  toDomain(p: Pt): Pt | null;
  toLogical(p: Pt): Pt;
}

/** What a compiled widget body returns. `effects` is validated by the host
 *  (widget-effects.ts) — a body may return anything, nothing escapes. */
export interface WidgetBody {
  init(scene: WidgetScene): unknown;
  on(event: WidgetEvent, state: unknown, scene: WidgetScene): { state: unknown; effects: unknown };
  demo?(scene: WidgetScene, answer: string): unknown;
  judge?(given: string, answer: string): boolean;
  /** Keys the widget wants (DOM KeyboardEvent.key values); the host swallows
   *  them while paused and delivers one `key` event per release, with the held ms. */
  keys?: string[];
  /** The parts that are the widget's, when not every closed outline is: each
   *  is hit by its outline if it has one, else by DISTANCE to its strokes (a
   *  curve has no inside). Earlier ids win a tie. Absent = the whole surface
   *  (widget-run.ts partAt). */
  parts?: string[] | ((scene: WidgetScene) => string[]);
  /** Tap to type (2026-09-27): a TAP on this part, at this point, opens a
   *  number field over it — or passes through (null) as a live tap always
   *  did. The typed number comes back as an `input` event. Pure, like on():
   *  the host may ask on hover to choose the cursor. A named part with no
   *  outline and no strokes (a number's text) is hit by its box
   *  (widget-run.ts partAmong). */
  editable?(id: string, point: Pt, scene: WidgetScene): EditField | null;
  /** A live body's own TAP (2026-09-28, field_lines: a tap on a charge flips
   *  its sign): true and a tap on this part is delivered as a `click` event
   *  instead of passing through to the card. Asked after `editable` (a
   *  number field wins). Pure, like on(). */
  taps?(id: string, scene: WidgetScene): boolean;
  /** Drags are the body's gesture, delivered live (`drag_move` per frame)
   *  and applied live — the figure recomputes under the pointer, no ghost.
   *  A TAP on a live body's part is not its gesture: the click goes on to
   *  the info card or the play toggle as if the widget were not there —
   *  unless the body calls that part `editable`: then the tap opens its
   *  number field — or `taps` it: then the tap is a `click`. */
  live?: true;
  /**
   * Blank paper the body owns (2026-09-27, equation_plot's plot area): a
   * press there that lands on no part is the body's live drag, delivered
   * with id SURFACE_PART (a tap still passes through), and a ctrl/⌘ + wheel
   * (a trackpad pinch) there is a `zoom` event instead of the camera's.
   * Logical y-up; null = none right now.
   */
  surface?(scene: WidgetScene): BBox | null;
  /**
   * The patch that puts the body's view back where the author had it (a
   * zoomed domain back to its authored range), or null when it is there.
   * While it is not null the host shows a "Reset" pill beside the camera's
   * Fit; a click applies it. Pure, like on().
   */
  rest?(scene: WidgetScene, state: unknown): Record<string, unknown> | null;
  /** What the Reset pill says (default "Reset axes" — a plot's domain; a 3D
   *  plot's camera is "Reset view"). */
  restLabel?: string;
}
