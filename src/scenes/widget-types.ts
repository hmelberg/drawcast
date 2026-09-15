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
  | { type: "key"; key: string; ms: number };

export interface WidgetScene {
  /** The widget's parts: the template layout's top-level ids at these params. */
  ids: string[];
  boxes: Map<string, BBox>;
  rings: Map<string, Pt[][]>;
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
}
