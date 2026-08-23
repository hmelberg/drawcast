// Renderer contract: the SVG renderer mounts the layout IR into a container
// and returns per-element handles the Player animates, plus the effects
// primitives that power the gesture verbs (highlight/point/camera). The
// contract stays a seam so alternative renderers remain possible, but drawcast
// ships exactly one: the SVG renderer with a clean/sketchy style toggle.

import type { BBox } from "../layout/geometry";
import type { LayoutResult } from "../layout/layout";
import type { Pt } from "../layout/model";
import type { HighlightEffect, Spec } from "../spec/types";

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
   * applying `offsets` (logical y-up). The svg element, camera viewBox, and
   * gesture overlay are untouched. Creates NO element handles and does NO
   * measurement — it must stay cheap enough for 30–60 fps.
   */
  swapGeometry?(layout: LayoutResult, visible: ReadonlySet<string>, offsets: Record<string, Pt>): void;
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
