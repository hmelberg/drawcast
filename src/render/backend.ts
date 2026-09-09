// Renderer contract: the SVG renderer mounts the layout IR into a container
// and returns per-element handles the Player animates, plus the effects
// primitives that power the gesture verbs (highlight/point/camera). The
// contract stays a seam so alternative renderers remain possible, but drawcast
// ships exactly one: the SVG renderer with a clean/sketchy style toggle.

import type { BBox } from "../layout/geometry";
import type { LayoutResult } from "../layout/layout";
import type { Pt } from "../layout/model";
import type { HighlightEffect, Spec } from "../spec/types";
import type { Turn } from "./pose";

/** The turn-over tween's squash: y ↦ at + Par(y − at) + k·Perp(y − at) about the
 *  line through `at` at `angle` degrees (y-up, counter-clockwise from +x). A
 *  per-frame prefix in CURRENT coordinates — never part of a settled pose. */
export interface Squash { at: Pt; angle: number; k: number }

/** flow's per-frame options — stable across a step, distinct from the frame's `travelled`/`alpha`. */
export interface FlowOpts {
  /** Units between marks. */
  spacing: number;
  marks: "dots" | "dashes";
  /** Default: the stroke's own colour. */
  color?: string;
  /** Stream from the stroke's end to its start. */
  reverse: boolean;
}

export interface RenderedElement {
  id: string;
  /** Intrinsic animation duration in ms (0 = instant). */
  durationMs: number;
  /** 0 = hidden … 1 = fully drawn. Monotonic per animation run. */
  setProgress(t: number): void;
  finish(): void;
  hide(): void;
  /**
   * Persistent translation in logical units (y-up), independent of draw
   * progress. Backends without it show moves only as the planner's warnings
   * suggest — not at all.
   */
  setOffset?(dx: number, dy: number): void;
  /**
   * Persistent pose: translate by (dx, dy) after rotating by `deg`
   * (counter-clockwise, y-up) and uniformly scaling by `scale` (default 1),
   * both about `pivot` in the element's ORIGINAL frame (design §2.1).
   * `mirror` reflects across the vertical line through the pivot before the
   * rotation. `squash` is a per-frame prefix for the flip tween's turn-over
   * half (design §2.3) — never part of a settled pose.
   * setOffset(dx, dy) is setTransform(dx, dy, 0, [0, 0]).
   */
  setTransform?(dx: number, dy: number, deg: number, pivot: Pt, scale?: number, mirror?: boolean, squash?: Squash): void;
  /** Persistent opacity 0–1 (1 clears it). Independent of the focus effect's dimming. */
  setOpacity?(alpha: number): void;
  /** Replace the points of the listed leaves (ORIGINAL-frame, keyed by leaf id) and rebuild them; every leaf NOT listed returns to its layout points. The pose transform stays on the leaf's group. */
  setPoints?(points: Record<string, Pt[]>): void;
  /** Rewrite the listed text leaves' content (keyed by leaf id); unlisted ones return to the layout's text. */
  setText?(texts: Record<string, string>): void;
}

/**
 * Stateless per-frame primitives; the Player owns all timing (so pause and the
 * speed multiplier apply to gestures exactly like they do to drawing).
 */
export interface BackendEffects {
  /**
   * Emphasis at progress t ∈ [0,1] on already-drawn elements. box is the
   * logical-units union box of the targets (for the circle effect).
   * t = 1 must leave the elements back in their normal appearance.
   */
  setHighlight(ids: string[], effect: HighlightEffect, t: number, box: BBox | null, color?: string): void;
  /** Remove any leftover emphasis for these ids (abort/scrub safety). */
  endHighlight(ids: string[]): void;
  /**
   * Dim the listed ids to `alpha` (1 = normal) — the focus verb's inverse
   * spotlight. Optional so embedded/legacy backends keep working.
   */
  setFocus?(dimIds: string[], alpha: number): void;
  /** Restore any leftover dim (abort/scrub safety). */
  endFocus?(dimIds: string[]): void;
  /**
   * Marks streaming along the ids' strokes: `travelled` is the distance
   * covered so far (logical units), `alpha` the ramp (0–1). Stateless per
   * frame; endFlow removes the overlays.
   */
  setFlow?(ids: string[], opts: FlowOpts, frame: { travelled: number; alpha: number }): void;
  /** Remove any leftover flow overlays for these ids (abort/scrub safety). */
  endFlow?(ids: string[]): void;
  /** Show the laser dot at a logical y-up point; null hides it. */
  setPointer(p: Pt | null): void;
  /** Jump the camera to a logical y-up viewBox; null = full canvas. */
  setCamera(box: BBox | null): void;
}

export interface MountResult {
  elements: Map<string, RenderedElement>;
  effects?: BackendEffects;
  destroy(): void;
  /**
   * Per-frame geometry swap for the animate command: rebuild the drawable
   * nodes from a new layout at FULL progress, restricted to `visible` ids,
   * applying the scene's pose (`offsets`, logical y-up, plus `turns`) and
   * `opacities`. The svg element, camera viewBox, and gesture overlay are
   * untouched. Creates NO element handles and does NO measurement — it must
   * stay cheap enough for 30–60 fps.
   *
   * Every piece of per-element state the handles would apply has to be
   * repeated here, because the rebuilt nodes have no handles: an element that
   * was rotated, scaled or faded otherwise snaps back to translate-only for
   * the length of a tween and jumps into place at settle.
   */
  swapGeometry?(
    layout: LayoutResult,
    visible: ReadonlySet<string>,
    offsets: Record<string, Pt>,
    turns?: Record<string, Turn>,
    opacities?: Record<string, number>,
    shapes?: Record<string, Record<string, Pt[]>>,
    texts?: Record<string, Record<string, string>>,
  ): void;
  /**
   * Full re-mount of a new layout into the same svg: rebuilds nodes AND
   * element handles (measurement included; handles start hidden exactly like
   * after mount). Gesture effects stay wired. Returns the new element map.
   */
  remount?(layout: LayoutResult): Map<string, RenderedElement>;
}

export interface BackendModule {
  name: string;
  label: string;
  mount(layout: LayoutResult, spec: Spec, container: HTMLElement): Promise<MountResult>;
}
