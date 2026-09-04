// What the VIEWER has switched off on a code panel: the code, the output, the
// picture itself, its brightness. One state per panel, two doors into it —
// the buttons drawn on a machine's chin (Hans, 2026-09-04: "OM vi hadde noen
// brytere på monitoren som virket … litt subtle") and the ⊕ tray's own row,
// because the capability belongs to the PANEL, not to a CRT's cosmetics: a
// script on bare paper can be hidden too, and it has no chin to press.
//
// Nothing drawn is labelled: the drawing IS the label, the cursor and a
// tooltip are the only hints, and a switch answers only while the player is
// paused, like every other stage interaction. Mute is deliberately absent —
// the control bar two centimetres below already owns it, and a second control
// for one thing is how two truths start.
//
// Turning the picture off is an HTML overlay, never a drawable, so a movie or
// an embed can never show a screen someone switched off; hiding the code or
// the output is a viewer preview through the player, exactly like a slider's.
// Playing on restores everything — free play is an excursion (§13).

import type { RenderHandle } from "../render";
import type { SpecElement } from "../spec/types";
import { bboxOfPts, type BBox } from "../layout/geometry";
import { leafDrawables, type Drawable } from "../layout/model";
import { INITIAL_STATE } from "../render/plan";
import { clientPointFor, h, logicalPoint } from "./dom";
import { gateIsOpen } from "./gates";
import { hitElement } from "./hit";

export type SwitchKind = "power" | "code" | "output";

export interface SwitchState {
  on: boolean;
  code: boolean;
  output: boolean;
}

export const SWITCHES_ON: SwitchState = { on: true, code: true, output: true };

/** What one press does. Pure, so the behaviour is testable without a DOM. */
export function pressSwitch(state: SwitchState, kind: SwitchKind): SwitchState {
  switch (kind) {
    case "power":
      return { ...state, on: !state.on };
    case "code":
      return { ...state, code: !state.code };
    case "output":
      return { ...state, output: !state.output };
  }
}

/** The overlay's opacity: an off monitor is OFF — the picture must not ghost. */
export function veilOpacity(state: SwitchState): number {
  return state.on ? 0 : 1;
}

/**
 * What the panel should SHOW for a state, given what its author asked for.
 * Turning one half off hands the whole screen to the other — the layout does
 * that already when `show` names one pane, so the switch just says so and the
 * panel re-lays out. With both off the authored value stays and the halves are
 * hidden instead, so the screen keeps its size and simply holds nothing.
 */
export function shownFor(state: SwitchState, authored: string | undefined): string | undefined {
  if (state.code && state.output) return authored;
  if (!state.code && !state.output) return authored;
  if (!state.code) return "output";
  return "code";
}

/** The drawable ids a state hides — only when NEITHER half is shown; a single
 *  half off is expressed by re-laying out through shownFor instead. */
export function hiddenIds(state: SwitchState, ids: { lines: string[]; out: string[] }): string[] {
  return state.code || state.output ? [] : [...ids.lines, ...ids.out];
}

/**
 * The bbox of one drawable id (a chin button, the glass), or null. Searched
 * across ALL leaves, not through drawablesForId: a chin button is a CHILD of
 * the panel group, and drawablesForId only ever looks at top-level ids.
 */
function bgBoxOf(leaves: Drawable[], id: string): BBox | null {
  for (const d of leaves) {
    if (d.id === id && d.kind === "area" && d.pts.length > 0) return bboxOfPts(d.pts);
  }
  return null;
}

function boxOf(leaves: Drawable[], id: string): BBox | null {
  for (const d of leaves) {
    if (d.id === id && d.kind === "stroke" && d.pts.length > 0) return bboxOfPts(d.pts);
  }
  return null;
}

/** One figure's panel-view state, shared by the drawn switches and the tray. */
export interface PanelView {
  /** Ids of the code panels this figure draws. */
  panels: string[];
  /** True when this panel is drawn on a machine (a glass to darken). */
  hasScreen(id: string): boolean;
  state(id: string): SwitchState;
  press(id: string, kind: SwitchKind): void;
  /** The element list with each panel's `show` set to what the switches say —
   *  the tray composes this with its own patches so neither overwrites the
   *  other. */
  patch(elements: SpecElement[]): SpecElement[];
  /** Ids to subtract from the boundary's visible set (only a fully dark panel). */
  hidden(): Set<string>;
  /** True when nothing is switched off — the caller can take the cheap path. */
  idle(): boolean;
  /** Re-assert the current state after something else repainted the figure. */
  apply(): void;
  /** Everything back on, and the figure repainted honestly. */
  reset(): void;
  /** The tray's repaint, when there is a tray: one composed preview call. */
  setComposer(fn: (() => void) | null): void;
  /** Called whenever a press changes anything, so a tray row can re-render. */
  onChange(cb: () => void): void;
}

const views = new WeakMap<HTMLElement, PanelView>();

/** The panel-view controller for a mounted figure, if it has any code panel. */
export function panelViewFor(stage: HTMLElement | null | undefined): PanelView | null {
  return (stage && views.get(stage)) || null;
}

/** The chin, left to right: what each drawn button actually does. */
const CHIN: readonly (readonly [string, SwitchKind, string])[] = [
  ["__power", "power", "Picture off / on"],
  ["__btn_code", "code", "Show / hide the code"],
  ["__btn_out", "output", "Show / hide the output"],
] as const;

/**
 * Wires every CRT panel in the mounted figure. A no-op for any other frame:
 * a switch exists because it is DRAWN, so nothing invisible is ever clickable.
 */
export function attachPanelView(stage: HTMLElement, hd: RenderHandle): void {
  // EVERY drawn code panel gets the state; only the ones on a machine get the
  // drawn buttons, because a button you cannot see is not an affordance.
  const crts = (hd.spec.elements ?? []).filter((e) => e.type === "code" && e.show !== "none");
  if (crts.length === 0) return;
  // What is PAINTED, not what was planned: switching a half off re-lays the
  // panel out, and a hit box or a veil computed from the plan-time layout
  // would then be aiming at where the buttons used to be.
  const live = (): Drawable[] => leafDrawables((hd.timeline.paintedLayout() ?? hd.layout).drawables);
  const leaves = live();

  const switches = new Map<string, { el: string; kind: SwitchKind; label: string }>();
  const glass = new Map<string, BBox>();
  /** Per panel, the ids each half owns — the code lines and the output. */
  const parts = new Map<string, { lines: string[]; out: string[] }>();
  const mounted: string[] = hd.layout.order;
  for (const el of crts) {
    // A tube has glass; a flat display's screen IS the panel's paper. Bare
    // paper has neither, and so has no picture to switch off.
    const g = boxOf(leaves, `${el.id}__glass`) ?? boxOf(leaves, `${el.id}__frame`) ?? bgBoxOf(leaves, `${el.id}__bg`);
    if (g) glass.set(el.id, g);
    for (const [suffix, kind, label] of CHIN) {
      if (boxOf(leaves, `${el.id}${suffix}`)) switches.set(`${el.id}${suffix}`, { el: el.id, kind, label });
    }
    parts.set(el.id, {
      lines: mounted.filter((id) => new RegExp(`^${el.id}_line_\\d+$`).test(id)),
      out: mounted.filter((id) => id === `${el.id}_out` || new RegExp(`^${el.id}_fig_\\d+$`).test(id)),
    });
  }
  const state = new Map<string, SwitchState>();
  const veils = new Map<string, HTMLElement>();
  const listeners: (() => void)[] = [];

  /** Hit boxes for the switches on screen at this boundary. */
  const boxes = (): Map<string, BBox> => {
    const n = hd.timeline.position;
    const visible = n > 0 ? hd.plan.states[n - 1].visible : INITIAL_STATE.visible;
    const now = live();
    const map = new Map<string, BBox>();
    for (const [id, sw] of switches) {
      if (!visible.some((v) => v === sw.el || v.startsWith(`${sw.el}_`))) continue;
      const b = boxOf(now, id);
      if (b) map.set(id, b);
    }
    return map;
  };

  const screenBox = (elId: string): BBox | null => {
    const now = live();
    return boxOf(now, `${elId}__glass`) ?? boxOf(now, `${elId}__frame`) ?? bgBoxOf(now, `${elId}__bg`) ?? glass.get(elId) ?? null;
  };

  const paintVeil = (elId: string): void => {
    const st = state.get(elId);
    const box = screenBox(elId);
    if (!box) return;
    const opacity = st ? veilOpacity(st) : 0;
    let veil = veils.get(elId);
    if (opacity === 0) {
      veil?.remove();
      veils.delete(elId);
      return;
    }
    if (!veil) {
      veil = h("div", { class: "cs-screen-veil" });
      stage.appendChild(veil);
      veils.set(elId, veil);
    }
    // clientPointFor already answers in STAGE-relative pixels (it subtracts the
    // stage's own rect), so subtracting it again is what put the dark square a
    // stage-width to the left, half of it clipped away. Use the points as they
    // come; they survive zoom, resize and theater mode.
    const tl = clientPointFor(stage, [box.x, box.y + box.h]);
    const br = clientPointFor(stage, [box.x + box.w, box.y]);
    if (!tl || !br) return;
    veil.style.left = `${tl[0]}px`;
    veil.style.top = `${tl[1]}px`;
    veil.style.width = `${br[0] - tl[0]}px`;
    veil.style.height = `${br[1] - tl[1]}px`;
    veil.style.opacity = String(opacity);
  };

  /** Everything a fully dark panel hides, across every panel. */
  const hidden = (): Set<string> => {
    const ids = new Set<string>();
    for (const [elId, st] of state) {
      const p = parts.get(elId);
      if (p) for (const id of hiddenIds(st, p)) ids.add(id);
    }
    return ids;
  };

  /** Each panel's `show` as the switches leave it. */
  const patch = (elements: SpecElement[]): SpecElement[] =>
    state.size === 0
      ? elements
      : elements.map((e) => {
          const st = state.get(e.id);
          if (!st) return e;
          const show = shownFor(st, e.show);
          return show === e.show ? e : { ...e, show: show as SpecElement["show"] };
        });

  const idle = (): boolean => [...state.values()].every((st) => st.on && st.code && st.output);

  /** One composed preview: the tray's when there is one, ours otherwise. */
  let composer: (() => void) | null = null;
  const applyView = (): void => {
    if (composer) composer();
    else hd.timeline.previewSpec({ elements: patch(hd.spec.elements ?? []), hide: hidden() });
  };

  const clearAll = (): void => {
    if (state.size === 0) return;
    state.clear();
    for (const v of veils.values()) v.remove();
    veils.clear();
    for (const cb of listeners) cb();
  };

  /** One press, from a drawn button or from the tray's row. */
  const press = (elId: string, kind: SwitchKind): void => {
    state.set(elId, pressSwitch(state.get(elId) ?? SWITCHES_ON, kind));
    applyView();
    paintVeil(elId); // after the repaint: the glass may have moved under it
    for (const cb of listeners) cb();
  };

  views.set(stage, {
    panels: crts.map((e) => e.id),
    hasScreen: (id) => glass.has(id),
    state: (id) => state.get(id) ?? SWITCHES_ON,
    press,
    patch,
    hidden,
    idle,
    apply: () => {
      for (const id of state.keys()) paintVeil(id);
    },
    reset: () => {
      const had = state.size > 0;
      clearAll();
      if (had) applyView();
    },
    setComposer: (fn) => {
      composer = fn;
    },
    onChange: (cb) => listeners.push(cb),
  });
  if (switches.size === 0) return; // no chin to press: the tray is the only door

  const switchAt = (e: MouseEvent): { el: string; kind: SwitchKind; label: string } | null => {
    if (gateIsOpen(stage)) return null;
    const p = logicalPoint(stage, e);
    if (!p) return null;
    const id = hitElement(boxes(), p, 10); // fat-finger slop on a small button
    return (id !== null && switches.get(id)) || null;
  };

  stage.addEventListener(
    "click",
    (e) => {
      if (hd.timeline.state === "playing") return; // the first click still only pauses
      const sw = switchAt(e);
      if (!sw) return;
      // stopImmediate, not stopPropagation: the tray's own paused-click
      // handler sits on this same node, and the chin is INSIDE the panel's
      // box — a press on a button must never also open the script editor.
      e.stopImmediatePropagation();
      press(sw.el, sw.kind);
    },
    true,
  );

  // Quiet affordance: the cursor and a tooltip. Nothing drawn, nothing written.
  stage.addEventListener("pointermove", (e) => {
    const sw = hd.timeline.state !== "playing" ? switchAt(e) : null;
    stage.classList.toggle("cs-switchable", sw !== null);
    if (sw) stage.title = sw.label;
    else if (stage.title) stage.removeAttribute("title");
  });

  // The picture comes back when the lesson moves on — an excursion, not a state.
  const prevState = hd.timeline.callbacks.onState;
  hd.timeline.callbacks.onState = (s) => {
    prevState?.(s);
    if (s === "playing") clearAll();
  };
  const prevStep = hd.timeline.callbacks.onStep;
  hd.timeline.callbacks.onStep = (completed, total) => {
    prevStep?.(completed, total);
    clearAll();
  };
  // The stage changes size when the tray opens under it, not only when the
  // window does — a veil pinned in pixels must follow both.
  const repaintVeils = (): void => {
    for (const id of state.keys()) paintVeil(id);
  };
  window.addEventListener("resize", repaintVeils);
  if (typeof ResizeObserver !== "undefined") new ResizeObserver(repaintVeils).observe(stage);
}
