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
  | { type: "drag_move"; id: string; from: Pt; fromDomain: Pt | null; point: Pt; domain: Pt | null };

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
  parts?: string[];
  /** Drags are the body's gesture, delivered live (`drag_move` per frame)
   *  and applied live — the figure recomputes under the pointer, no ghost.
   *  A TAP on a live body's part is not its gesture: the click goes on to
   *  the info card or the play toggle as if the widget were not there. */
  live?: true;
}
