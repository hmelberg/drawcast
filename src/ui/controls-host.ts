// The drawn control panel, live (spec 2026-09-15 §3.1): a `pane: controls`
// panel's knobs, chips, pills and boxes take the pointer directly, so a
// control has ONE look — the drawn one — instead of a picture with an HTML
// twin lying on it (the deleted ui/controls-card.ts, whose two copies of
// one state could drift). Same shape as ui/widget-host.ts: a DOM-free core
// (controlsHostFor) that tests drive from a real layout, and a stage
// listener (attachControlsHost, below) that is source-pinned.
//
// Geometry is READ, never computed here: the row children the layout mints
// (`<id>_ctl_<name>__track`, `__chip_<k>`, `__pill`, `__box`) are found by
// id in the painted layout's leaves, so a knob that moved because the
// script was rewritten is hit where it is drawn now. Nothing here runs
// code: a hit becomes `commit` — the tray's own closure over its values,
// its debounce and its run path — exactly as a tray row's input event does.
import type { SpecElement } from "../spec/types";
import type { ControlSpec } from "../code/controls";
import type { LayoutResult } from "../layout/layout";
import type { BBox } from "../layout/geometry";
import { bboxOfPts } from "../layout/geometry";
import { leafDrawables, type Pt } from "../layout/model";
import { RUN_ROW_ID } from "../layout/code-controls-pane";

export interface ControlsPanel {
  el: SpecElement;
  /** The ORIGINAL-parse controls (kinds, ranges, options) — a rewritten
   *  slider is a bare number and no longer carries them. */
  controls: ControlSpec[];
}

export interface ControlsHostDeps {
  panels: () => ControlsPanel[];
  layout: () => LayoutResult;
  visible: (id: string) => boolean;
  /** False while the tray is open: its rows are the live copy then, and one
   *  live copy at a time is what keeps the two from drifting. */
  enabled: () => boolean;
  commit: (el: SpecElement, c: ControlSpec, raw: string | boolean, immediate: boolean) => void;
  run: (el: SpecElement) => void;
  editText: (el: SpecElement, c: ControlSpec, box: BBox) => void;
}

export interface SliderGesture {
  el: SpecElement;
  control: ControlSpec;
  x0: number;
  x1: number;
}

export interface ControlsHost {
  /** The `pane: controls` element whose pane rectangle contains p. */
  panelAt(p: Pt): string | null;
  /** A press: performs a click control's effect; returns a gesture for a slider. */
  press(p: Pt): SliderGesture | null;
  drag(g: SliderGesture, p: Pt): void;
  release(g: SliderGesture, p: Pt): void;
  /** True over a live row (the cursor rule; no side effects). */
  over(p: Pt): boolean;
}

/** Vertical slack around a row's ink, logical units — a finger-sized band. */
const BAND_PAD = 8;

/** The slider value at a fraction of its track: linear, snapped, clamped. */
export function sliderValueAt(c: ControlSpec, frac: number): number {
  const min = c.min ?? 0;
  const max = c.max ?? 1;
  const f = Math.min(1, Math.max(0, frac));
  let v = min + f * (max - min);
  if (c.step && c.step > 0) v = min + Math.round((v - min) / c.step) * c.step;
  if (c.integer) v = Math.round(v);
  v = Math.min(max, Math.max(min, v));
  return Number(v.toFixed(c.decimals ?? 6));
}

const inBox = (b: BBox, p: Pt, pad = 0): boolean => p[0] >= b.x - pad && p[0] <= b.x + b.w + pad && p[1] >= b.y - pad && p[1] <= b.y + b.h + pad;

export function controlsHostFor(deps: ControlsHostDeps): ControlsHost {
  type Leaf = ReturnType<typeof leafDrawables>[number];
  const leavesById = (): Map<string, Leaf> => {
    const m = new Map<string, Leaf>();
    for (const d of leafDrawables(deps.layout().drawables)) m.set(d.id, d);
    return m;
  };
  const ptsBox = (d: Leaf | undefined): BBox | null => (d && (d.kind === "stroke" || d.kind === "area") && d.pts.length > 0 ? bboxOfPts(d.pts) : null);

  const panelAt = (p: Pt): string | null => {
    const panes = deps.layout().panes ?? {};
    for (const { el } of deps.panels()) {
      const b = panes[el.id];
      if (b && deps.visible(el.id) && inBox(b, p)) return el.id;
    }
    return null;
  };

  /** The row under p, with the leaves the hit test needs. */
  type Hit = { el: SpecElement; c: ControlSpec | null; rowId: string; leaves: Map<string, Leaf>; box: BBox };
  const rowAt = (p: Pt): Hit | null => {
    if (!deps.enabled()) return null;
    const id = panelAt(p);
    if (id === null) return null;
    const panel = deps.panels().find((x) => x.el.id === id);
    if (!panel) return null;
    const leaves = leavesById();
    const rowIds: [string, ControlSpec | null][] = panel.controls.map((c) => [`${id}_ctl_${c.name}`, c]);
    if (panel.el.autorun === false) rowIds.push([`${id}_ctl_${RUN_ROW_ID}`, null]);
    for (const [rowId, c] of rowIds) {
      const pts: Pt[] = [];
      for (const [lid, d] of leaves) {
        if (!lid.startsWith(`${rowId}__`)) continue;
        if (d.kind === "stroke" || d.kind === "area") pts.push(...d.pts);
      }
      if (pts.length === 0) continue;
      const box = bboxOfPts(pts);
      if (inBox(box, p, BAND_PAD)) return { el: panel.el, c, rowId, leaves, box };
    }
    return null;
  };

  const trackOf = (h: Hit): { x0: number; x1: number } | null => {
    const t = ptsBox(h.leaves.get(`${h.rowId}__track`));
    return t ? { x0: t.x, x1: t.x + t.w } : null;
  };
  const sliderCommit = (g: SliderGesture, p: Pt, immediate: boolean): void => {
    const frac = g.x1 > g.x0 ? (p[0] - g.x0) / (g.x1 - g.x0) : 0;
    deps.commit(g.el, g.control, String(sliderValueAt(g.control, frac)), immediate);
  };

  return {
    panelAt,
    over: (p) => rowAt(p) !== null,
    press: (p) => {
      const h = rowAt(p);
      if (!h) return null;
      if (h.c === null) {
        deps.run(h.el); // the drawn Run ▶ row
        return null;
      }
      const c = h.c;
      switch (c.kind) {
        case "slider": {
          const t = trackOf(h);
          if (!t) return null;
          const g: SliderGesture = { el: h.el, control: c, x0: t.x0, x1: t.x1 };
          sliderCommit(g, p, false);
          return g;
        }
        case "choice": {
          const options = c.options ?? [];
          for (let k = 0; k < options.length; k++) {
            const b = ptsBox(h.leaves.get(`${h.rowId}__chip_${k}`));
            if (b && inBox(b, p, 2)) {
              deps.commit(h.el, c, options[k], true);
              return null;
            }
          }
          return null;
        }
        case "toggle": {
          const valueText = h.leaves.get(`${h.rowId}__value`);
          const on = valueText?.kind === "text" && valueText.text === "on";
          deps.commit(h.el, c, !on, true);
          return null;
        }
        case "text":
        case "number": {
          const b = ptsBox(h.leaves.get(`${h.rowId}__box`)) ?? h.box;
          deps.editText(h.el, c, b);
          return null;
        }
        case "button":
          deps.commit(h.el, c, true, true);
          return null;
        default:
          return null;
      }
    },
    drag: (g, p) => sliderCommit(g, p, false),
    release: (g, p) => sliderCommit(g, p, true),
  };
}
