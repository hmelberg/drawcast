// The viewer's own pan and zoom while the figure is paused (2026-09-27) —
// for a big model (a decision tree, a Markov chain) that does not read at
// one page, and for a template world larger than the page.
//
// Pause is the door: nothing here runs while playing, and the view is the
// player's `viewCamera`, laid OVER the plan's camera and never recorded — an
// exporter drives a player with no UI, so the movie cannot see it. Play
// hands the view back to the plan's camera (smoothly, render/player.ts).
//
// Gestures, and who owns them:
//   - ctrl/⌘ + wheel (a trackpad pinch arrives as this) zooms about the
//     pointer, always. A plain mouse wheel zooms too once the view is off
//     rest or in fullscreen; at rest on a page it stays the page's scroll. A
//     trackpad's two-finger scroll pans a zoomed view.
//   - Two fingers pinch-zoom and pan together.
//   - A drag pans a zoomed view — but only a press nobody else took: this is
//     a BUBBLE listener, so every capture-phase owner (the widget host, a
//     chess drag, the drawn control panel) has already run and marked its
//     press with preventDefault/stopPropagation; a press on a control, the
//     caption, a card or an explore overlay is never a pan; and on a figure
//     with intrinsic interactions (a piano, a sky) a press on a drawn part is
//     the part's. A drag begins only past a few pixels, so a tap still goes
//     to the info card or the play toggle; the click after a real pan is
//     swallowed.
//   - A live widget body's SURFACE (WidgetBody.surface — an equation plot's
//     plot area) is its own: a ctrl/⌘ + wheel or a trackpad pinch there
//     zooms the plot's DOMAIN (the host marks it with preventDefault and
//     this listener stands down), and a press there is the body's drag (its
//     domain pan), so neither ever reaches the camera. Outside the surface,
//     and with a plain wheel, everything above holds; two-finger touch
//     pinches stay the camera's.
//   - + / − / 0 over the figure (or in fullscreen) zoom in, out and back.
//   - A small "fit" pill shows while the view is not at rest.

import { elementBBoxes } from "../layout/layout";
import type { BBox } from "../layout/geometry";
import type { RenderHandle } from "../render";
import { atRest, clampView, looksLikeMouseWheel, panBy, pinchStep, wheelZoomFactor, zoomAbout } from "../render/camera";
import { EASINGS, lerpBox } from "../render/effects";
import { sceneAt } from "../render/plan";
import { makeBrowserMeasure } from "../render/svg-backend";
import { scenes } from "../scenes/registry";
import { overCaption } from "./caption";
import { inControlRegion } from "./control-press";
import { h, logicalPoint } from "./dom";
import { fullscreenElement } from "./fullscreen";
import { CONTROL_SELECTOR, gateIsOpen } from "./gates";
import { hitElement } from "./hit";

/** Pixels a press must travel before it is a pan rather than a tap. */
const DRAG_SLOP = 5;
/** One keyboard step. */
const KEY_ZOOM = 1.4;

export function attachViewPan(stage: HTMLElement, hd: RenderHandle): void {
  const player = hd.timeline;
  if (typeof player.setViewCamera !== "function") return;
  const rest = player.restBox;
  const svg = (): SVGSVGElement | null => stage.querySelector<SVGSVGElement>("svg.cs-svg");

  const fitBtn = h("button", { class: "cs-viewfit", title: "Back to the whole figure (0)", "aria-label": "Fit the whole figure" }, "Fit") as HTMLButtonElement;
  fitBtn.hidden = true;
  stage.appendChild(fitBtn);

  const view = (): BBox => player.viewCamera ?? player.planCamera;
  const enabled = (): boolean => player.state !== "playing" && !gateIsOpen(stage) && svg() !== null;
  const set = (b: BBox): void => {
    const c = clampView(b, rest);
    player.setViewCamera(atRest(c, rest) && atRest(player.planCamera, rest) ? null : c);
  };

  let tween = 0;
  const cancelTween = (): void => {
    if (tween) cancelAnimationFrame(tween);
    tween = 0;
  };
  /** Glide the view back to the plan's camera (the fit pill, the 0 key). */
  const fit = (): void => {
    cancelTween();
    const from = player.viewCamera;
    if (!from) return;
    const to = player.planCamera;
    const start = performance.now();
    const ease = EASINGS["ease-in-out"];
    const step = (now: number): void => {
      const t = Math.min(1, (now - start) / 350);
      if (player.state === "playing") return;
      if (t >= 1) {
        tween = 0;
        player.setViewCamera(null);
        return;
      }
      player.setViewCamera(lerpBox(from, to, ease(t)));
      tween = requestAnimationFrame(step);
    };
    tween = requestAnimationFrame(step);
  };
  fitBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    fit();
  });

  // The view's own state, on the stage: the pill, the cursor, touch-action.
  const unsubscribe = player.onViewChange((b) => {
    const off = b !== null && !atRest(b, player.planCamera);
    fitBtn.hidden = !off;
    stage.classList.toggle("cs-viewzoomed", b !== null && b.w < rest.w - 1e-6);
  });
  const prevOnState = player.callbacks.onState;
  player.callbacks.onState = (s) => {
    prevOnState?.(s);
    if (s === "playing") cancelTween();
    stage.classList.toggle("cs-viewpan", s !== "playing");
  };
  stage.classList.toggle("cs-viewpan", player.state !== "playing");

  /** Client px → logical units at the current view (y-up: screen down is logical down). */
  const unitsPerPx = (): number => {
    const r = svg()?.getBoundingClientRect();
    if (!r || r.width === 0) return 0;
    // The svg letterboxes (meet): the tighter side decides the scale.
    const b = view();
    return Math.max(b.w / r.width, b.h / r.height);
  };

  // ---- wheel: zoom about the pointer, or pan a zoomed view ----
  stage.addEventListener(
    "wheel",
    (e) => {
      // A widget body's own zoom took it (its surface: a plot's domain).
      if (!enabled() || e.defaultPrevented) return;
      if (e.target instanceof Element && e.target.closest(`${CONTROL_SELECTOR}, .cs-infocard, .cs-caption`)) return;
      const zoomed = !atRest(view(), rest);
      const fs = fullscreenElement()?.contains(stage) ?? false;
      const pinchOrCtrl = e.ctrlKey || e.metaKey;
      if (!pinchOrCtrl && !zoomed && !fs) return; // the page's own scroll
      const p = logicalPoint(stage, e);
      if (!p) return;
      e.preventDefault();
      cancelTween();
      if (pinchOrCtrl || looksLikeMouseWheel(e)) {
        set(zoomAbout(view(), wheelZoomFactor(e), p, rest));
      } else {
        const k = unitsPerPx();
        set(panBy(view(), e.deltaX * k, -e.deltaY * k, rest));
      }
    },
    { passive: false },
  );

  // ---- pointers: one drags a zoomed view, two pinch ----
  const measure = makeBrowserMeasure();
  const template = hd.spec.template ? scenes[hd.spec.template] : undefined;
  // A LIVE widget body (supply_demand's curves, a tree's numbers) names its
  // own parts and its host takes a press on one (preventDefault, above):
  // everything else — a branch, a node, the paper — is the pan's, so a big
  // tree can be dragged about by its edges. A click-style body claims every
  // drawn part, as before.
  const liveBody = ((): boolean => {
    try {
      return template?.widget?.().live === true;
    } catch {
      return false;
    }
  })();
  const interactive = !!template && ((!!template.widget && !liveBody) || (template.manifest.interactions?.length ?? 0) > 0);
  /** On an interactive figure, a press on a drawn part is the part's. */
  const onPart = (e: PointerEvent): boolean => {
    if (!interactive) return false;
    const p = logicalPoint(stage, e);
    if (!p) return true;
    const visible = new Set(sceneAt(hd.plan, hd.timeline.position).visible);
    const boxes = new Map<string, BBox>();
    for (const [id, b] of elementBBoxes(hd.timeline.paintedLayout() ?? hd.layout, measure)) if (visible.has(id)) boxes.set(id, b);
    return hitElement(boxes, p) !== null;
  };
  const someoneElses = (e: PointerEvent): boolean => {
    if (e.defaultPrevented) return true;
    const t = e.target instanceof Element ? e.target : null;
    if (t?.closest(`${CONTROL_SELECTOR}, .cs-infocard, .cs-bodyexplore, .cs-spaceexplore, .cs-viewfit`)) return true;
    if (overCaption(t)) return true;
    if (inControlRegion(stage, e)) return true;
    return stage.classList.contains("cs-grabbable") || stage.classList.contains("cs-grabbing");
  };

  /** Touch/pen/mouse pointers down on the stage that a pan may use. */
  const pts = new Map<number, [number, number]>();
  let panning: number | null = null;
  let pressAt: [number, number] | null = null;
  let pinching = false;
  let swallowClick = false;

  stage.addEventListener("pointerdown", (e) => {
    if (!enabled() || someoneElses(e)) return;
    if (e.pointerType === "mouse" && e.button !== 0) return;
    if (e.pointerType !== "touch" && onPart(e)) return;
    pts.set(e.pointerId, [e.clientX, e.clientY]);
    if (pts.size === 2) {
      // The second finger: a pinch, which is nobody else's gesture.
      pinching = true;
      panning = null;
      e.preventDefault();
      for (const id of pts.keys()) {
        try {
          stage.setPointerCapture(id);
        } catch {
          /* synthetic */
        }
      }
      return;
    }
    if (pts.size === 1 && !(e.pointerType === "touch" && onPart(e))) pressAt = [e.clientX, e.clientY];
  });

  const clientToLogical = (c: [number, number]): [number, number] | null => logicalPoint(stage, { clientX: c[0], clientY: c[1] } as MouseEvent);

  stage.addEventListener("pointermove", (e) => {
    const prev = pts.get(e.pointerId);
    if (!prev) return;
    const cur: [number, number] = [e.clientX, e.clientY];
    if (pinching && pts.size >= 2) {
      const ids = [...pts.keys()].slice(0, 2);
      const other = pts.get(ids[0] === e.pointerId ? ids[1] : ids[0])!;
      const a0 = clientToLogical(prev), b0 = clientToLogical(other), a1 = clientToLogical(cur);
      pts.set(e.pointerId, cur);
      if (!a0 || !b0 || !a1) return;
      const mid = (p: [number, number], q: [number, number]): [number, number] => [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
      const spread = (p: [number, number], q: [number, number]): number => Math.hypot(p[0] - q[0], p[1] - q[1]);
      cancelTween();
      set(pinchStep(view(), { mid: mid(a0, b0), spread: spread(a0, b0) }, { mid: mid(a1, b0), spread: spread(a1, b0) }, rest));
      e.preventDefault();
      return;
    }
    pts.set(e.pointerId, cur);
    if (panning === null) {
      if (!pressAt || atRest(view(), rest) || !enabled()) return;
      if (Math.hypot(cur[0] - pressAt[0], cur[1] - pressAt[1]) < DRAG_SLOP) return;
      panning = e.pointerId;
      stage.classList.add("cs-viewpanning");
      window.getSelection()?.removeAllRanges();
      try {
        stage.setPointerCapture(e.pointerId);
      } catch {
        /* synthetic */
      }
    }
    if (panning !== e.pointerId) return;
    const k = unitsPerPx();
    cancelTween();
    // Drag the paper: the view moves against the hand.
    set(panBy(view(), -(cur[0] - prev[0]) * k, (cur[1] - prev[1]) * k, rest));
    e.preventDefault();
  });

  const end = (e: PointerEvent): void => {
    if (!pts.has(e.pointerId)) return;
    pts.delete(e.pointerId);
    if (panning === e.pointerId || pinching) swallowClick = e.type === "pointerup";
    if (panning === e.pointerId) panning = null;
    if (pts.size < 2) pinching = false;
    if (pts.size === 0) {
      pressAt = null;
      stage.classList.remove("cs-viewpanning");
    }
  };
  stage.addEventListener("pointerup", end);
  stage.addEventListener("pointercancel", end);
  stage.addEventListener("lostpointercapture", end);
  // The click after a pan or a pinch is nobody's: not the info card's, not
  // the play toggle's. Capture phase, attached before those listeners.
  stage.addEventListener(
    "click",
    (e) => {
      if (!swallowClick) return;
      swallowClick = false;
      e.stopImmediatePropagation();
      e.preventDefault();
    },
    true,
  );

  // ---- keys: + − 0 while the pointer is over the figure, or in fullscreen ----
  let hovering = false;
  stage.addEventListener("pointerenter", () => (hovering = true));
  stage.addEventListener("pointerleave", () => (hovering = false));
  const onKey = (e: KeyboardEvent): void => {
    if (!stage.isConnected) {
      window.removeEventListener("keydown", onKey);
      unsubscribe();
      return;
    }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const t = e.target instanceof Element ? e.target : null;
    if (t?.closest("input, textarea, select, [contenteditable]")) return;
    if (!(hovering || (fullscreenElement()?.contains(stage) ?? false)) || !enabled()) return;
    const b = view();
    const centre: [number, number] = [b.x + b.w / 2, b.y + b.h / 2];
    if (e.key === "+" || e.key === "=") set(zoomAbout(b, KEY_ZOOM, centre, rest));
    else if (e.key === "-" || e.key === "_") set(zoomAbout(b, 1 / KEY_ZOOM, centre, rest));
    else if (e.key === "0") fit();
    else return;
    e.preventDefault();
  };
  window.addEventListener("keydown", onKey);
}
