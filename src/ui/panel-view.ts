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
import { bboxOfPts, type BBox } from "../layout/geometry";
import { leafDrawables, type Drawable } from "../layout/model";
import { INITIAL_STATE } from "../render/plan";
import { clientPointFor, h, logicalPoint } from "./dom";
import { gateIsOpen } from "./gates";
import { hitElement } from "./hit";

/** How dark the picture gets, cycling: bright → dim → dimmer → bright. */
const DIM_STEPS = [0, 0.3, 0.55] as const;

export type SwitchKind = "power" | "code" | "output" | "dim";

export interface SwitchState {
  on: boolean;
  dim: number;
  code: boolean;
  output: boolean;
}

export const SWITCHES_ON: SwitchState = { on: true, dim: 0, code: true, output: true };

/** What one press does. Pure, so the behaviour is testable without a DOM. */
export function pressSwitch(state: SwitchState, kind: SwitchKind): SwitchState {
  switch (kind) {
    case "power":
      return { ...state, on: !state.on };
    case "code":
      return { ...state, code: !state.code };
    case "output":
      return { ...state, output: !state.output };
    case "dim":
      // A dark screen has no brightness to set; power is the way back.
      return state.on ? { ...state, dim: (state.dim + 1) % DIM_STEPS.length } : state;
  }
}

/** The overlay's opacity for a state: an off monitor is OFF (the picture must
 *  not ghost through it), a dimmed one is a wash. */
export function veilOpacity(state: SwitchState): number {
  return state.on ? DIM_STEPS[state.dim] : 1;
}

/** The drawable ids a state hides: the code lines, the output pane, or neither. */
export function hiddenIds(state: SwitchState, ids: { lines: string[]; out: string[] }): string[] {
  return [...(state.code ? [] : ids.lines), ...(state.output ? [] : ids.out)];
}

/**
 * The bbox of one drawable id (a chin button, the glass), or null. Searched
 * across ALL leaves, not through drawablesForId: a chin button is a CHILD of
 * the panel group, and drawablesForId only ever looks at top-level ids.
 */
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
  /** Re-assert the current state after something else repainted the figure. */
  apply(): void;
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
  ["__btn_1", "code", "Show / hide the code"],
  ["__btn_2", "output", "Show / hide the output"],
  ["__btn_3", "dim", "Brightness"],
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
  const leaves = leafDrawables(hd.layout.drawables);

  const switches = new Map<string, { el: string; kind: SwitchKind; label: string }>();
  const glass = new Map<string, BBox>();
  /** Per panel, the ids each half owns — the code lines and the output. */
  const parts = new Map<string, { lines: string[]; out: string[] }>();
  const mounted: string[] = hd.layout.order;
  for (const el of crts) {
    const g = boxOf(leaves, `${el.id}__glass`);
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
    const map = new Map<string, BBox>();
    for (const [id, sw] of switches) {
      if (!visible.some((v) => v === sw.el || v.startsWith(`${sw.el}_`))) continue;
      const b = boxOf(leaves, id);
      if (b) map.set(id, b);
    }
    return map;
  };

  const paintVeil = (elId: string): void => {
    const st = state.get(elId);
    const box = glass.get(elId);
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

  /** Everything the switches currently hide, across every panel. */
  const applyHidden = (): void => {
    const ids = new Set<string>();
    for (const [elId, st] of state) {
      const p = parts.get(elId);
      if (p) for (const id of hiddenIds(st, p)) ids.add(id);
    }
    hd.timeline.previewHidden(ids);
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
    paintVeil(elId);
    applyHidden();
    for (const cb of listeners) cb();
  };

  views.set(stage, {
    panels: crts.map((e) => e.id),
    hasScreen: (id) => glass.has(id),
    state: (id) => state.get(id) ?? SWITCHES_ON,
    press,
    apply: () => {
      applyHidden();
      for (const id of state.keys()) paintVeil(id);
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
  window.addEventListener("resize", () => {
    for (const id of state.keys()) paintVeil(id);
  });
}
