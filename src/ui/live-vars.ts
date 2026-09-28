// Live math on the figure (design 2026-09-29): while paused, a var's number in
// a `math` formula (layout/live-math.ts, the part `<id>_var_<name>`) is
// scrubbed sideways — a step every STEP_UNITS, from the value at the press
// (number-scrub.ts `scrubbed`) — or tapped to type, exactly as a template's
// live numbers are. The change is a preview through the route a template
// scrub takes (previewParams with `vars.<name>`), so everything that reads
// the var re-lays out; like every widget preview it lasts until play or a
// step. This is a WidgetHost (ui/widget-host.ts), so the stage's one gesture
// router, its press rule (paused, no other gate, not on a control, the
// caption or a card), the number field and the cursors all come for free.
import type { RenderHandle } from "../render";
import type { Pt } from "../layout/model";
import { flattenDrawables, type Drawable } from "../layout/model";
import type { BBox } from "../layout/geometry";
import { sceneAt } from "../render/plan";
import { scrubbed } from "../scenes/number-scrub";
import { parseFieldValue } from "../scenes/widget-effects";
import type { EditField } from "../scenes/widget-types";
import type { SpecElement } from "../spec/types";
import { liveDecimals, varInfos, varScrub, varValues, type VarInfo } from "../spec/vars";
import { texNamesVars } from "../layout/live-math";
import { DRAG_MIN, type WidgetHost } from "./widget-host";

/** How far outside a number's ink a press still takes it (logical units). */
const HIT_PAD = 8;

export interface LiveVarHostDeps {
  /** Paint these var patches (`vars.<name>` → value). The stage merges them
   *  with a template body's own patches when a page has both; alone, it is
   *  the player's previewParams. */
  preview?: (patch: Record<string, unknown>) => void;
  /** A live drag's frame clock (requestAnimationFrame in the app, synchronous in tests). */
  frame?: (fn: () => void) => () => void;
}

/** The math elements that show at least one live var, and those vars. */
export function liveMathOf(spec: { vars?: Record<string, unknown>; elements?: SpecElement[] }): { mathIds: string[]; live: Map<string, VarInfo> } {
  const infos = varInfos(spec.vars as never);
  const live = new Map(infos.filter((v) => !v.fixed).map((v) => [v.name, v]));
  const values = varValues(spec.vars as never);
  const liveOnly = Object.fromEntries([...live.keys()].map((k) => [k, values[k]]));
  const mathIds = (spec.elements ?? [])
    .filter((e) => e.type === "math" && typeof e.tex === "string" && texNamesVars(e.tex, liveOnly))
    .map((e) => e.id);
  // A derivation's later lines (spec/derive.ts: <id>_2, <id>_3 …) are math too.
  return { mathIds, live };
}

/** The var a part id is a number of: `<math>_var_<name>` or `…_<name>_<k>`; a name ending in _<digits> is tried whole first. */
export function varOfPart(partId: string, mathIds: readonly string[], names: ReadonlySet<string>): string | null {
  for (const m of mathIds) {
    const prefix = `${m}_var_`;
    if (!partId.startsWith(prefix)) continue;
    const rest = partId.slice(prefix.length);
    if (names.has(rest)) return rest;
    const base = rest.replace(/_\d+$/, "");
    if (base !== rest && names.has(base)) return base;
  }
  return null;
}

/** Every nested part group under a drawn formula: id → the box of its ink. */
function partBoxes(drawables: readonly Drawable[], mathIds: readonly string[]): Map<string, BBox> {
  const out = new Map<string, BBox>();
  const walk = (d: Drawable, inside: boolean): void => {
    if (d.kind !== "group") return;
    for (const c of d.children) {
      if (c.kind === "group" && inside && c.id.includes("_var_")) {
        let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
        for (const leaf of flattenDrawables([c])) {
          if (leaf.kind !== "area") continue;
          for (const [x, y] of leaf.pts) {
            x0 = Math.min(x0, x);
            x1 = Math.max(x1, x);
            y0 = Math.min(y0, y);
            y1 = Math.max(y1, y);
          }
        }
        if (x1 >= x0) out.set(c.id, { x: x0, y: y0, w: x1 - x0, h: y1 - y0 });
      } else walk(c, inside);
    }
  };
  for (const d of drawables) if (mathIds.some((m) => d.id === m || d.id.startsWith(`${m}_`))) walk(d, true);
  return out;
}

const animationFrame = (fn: () => void): (() => void) => {
  if (typeof requestAnimationFrame === "function") {
    const h = requestAnimationFrame(fn);
    return () => cancelAnimationFrame(h);
  }
  const t = setTimeout(fn, 16);
  return () => clearTimeout(t);
};

/** The host for a page whose formulas show live vars; null when none do. */
export function liveVarHostFor(hd: RenderHandle, deps: LiveVarHostDeps = {}): WidgetHost | null {
  const { mathIds: authored, live } = liveMathOf(hd.spec);
  if (authored.length === 0) return null;
  const names = new Set(live.keys());
  const frame = deps.frame ?? animationFrame;
  const preview = deps.preview ?? ((p: Record<string, unknown>) => hd.timeline.previewParams(p));
  const authoredValues = varValues(hd.spec.vars);

  /** The viewer's own values this pause (name → number). */
  let patches: Record<string, number> = {};
  let gesture: { id: string; name: string; start: Pt; v0: number; moved: boolean; pending: Pt | null; unframe: (() => void) | null; before: Record<string, number> } | null = null;
  let editing: { id: string; name: string; field: EditField; box: BBox } | null = null;

  /** A formula's own id, or a derivation line of it (`eq_2`) that is on screen. */
  const drawnMath = (): string[] => {
    const visible = new Set(sceneAt(hd.plan, hd.timeline.position).visible);
    return [...visible].filter((id) => authored.some((m) => id === m || new RegExp(`^${m}_\\d+$`).test(id)));
  };
  /** Each visible live part: its var and its box on the page (the formula's move offset applied). */
  const parts = (): { id: string; name: string; box: BBox }[] => {
    const ids = drawnMath();
    if (ids.length === 0) return [];
    const layout = hd.timeline.paintedLayout() ?? hd.layout;
    const offsets = sceneAt(hd.plan, hd.timeline.position).offsets;
    const out: { id: string; name: string; box: BBox }[] = [];
    for (const [id, box] of partBoxes(layout.drawables.filter((d) => ids.includes(d.id)), ids)) {
      const name = varOfPart(id, ids, names);
      if (name === null) continue;
      const owner = ids.find((m) => id.startsWith(`${m}_var_`))!;
      const [dx, dy] = offsets[owner] ?? [0, 0];
      out.push({ id, name, box: { x: box.x + dx, y: box.y + dy, w: box.w, h: box.h } });
    }
    return out;
  };
  const partAtPoint = (p: Pt): { id: string; name: string; box: BBox } | null => {
    let best: { id: string; name: string; box: BBox } | null = null;
    let bestD = Infinity;
    for (const part of parts()) {
      const b = part.box;
      const dx = Math.max(b.x - p[0], 0, p[0] - (b.x + b.w));
      const dy = Math.max(b.y - p[1], 0, p[1] - (b.y + b.h));
      const d = Math.hypot(dx, dy);
      if (d <= HIT_PAD && d < bestD) {
        best = part;
        bestD = d;
      }
    }
    return best;
  };
  /** The var's number at this boundary: the viewer's, else the storyboard's animate, else the author's. */
  const valueOf = (name: string): number => {
    if (name in patches) return patches[name];
    const key = `vars.${name}`;
    const scene = sceneAt(hd.plan, hd.timeline.position).params[key];
    if (typeof scene === "number") return hd.timeline.getParamOverrides()[key] ?? scene;
    return authoredValues[name] ?? live.get(name)!.value;
  };
  const paint = (next: Record<string, number>): void => {
    patches = next;
    preview(Object.fromEntries(Object.entries(patches).map(([k, v]) => [`vars.${k}`, v])));
  };
  const scrubTo = (g: NonNullable<typeof gesture>, p: Pt): void => {
    const info = live.get(g.name)!;
    const { step, min, max } = varScrub(info);
    const v = scrubbed(g.v0, p[0] - g.start[0], step, min, max);
    if (v !== patches[g.name]) paint({ ...patches, [g.name]: v });
  };
  const flush = (): void => {
    const g = gesture;
    if (!g) return;
    g.unframe = null;
    const p = g.pending;
    g.pending = null;
    if (p) scrubTo(g, p);
  };

  const host: WidgetHost = {
    keys: Object.freeze([]),
    live: true,
    restLabel: "Reset",
    over: () => false,
    grabbable: () => false,
    scrubbable: (p) => partAtPoint(p) !== null,
    dragging: () => gesture?.moved === true,
    press(p) {
      if (gesture) return false;
      const part = partAtPoint(p);
      if (!part) return false;
      gesture = { id: part.id, name: part.name, start: p, v0: valueOf(part.name), moved: false, pending: null, unframe: null, before: patches };
      return true;
    },
    move(p) {
      if (!gesture) return;
      if (!gesture.moved && Math.hypot(p[0] - gesture.start[0], p[1] - gesture.start[1]) < DRAG_MIN) return;
      gesture.moved = true;
      gesture.pending = p;
      if (!gesture.unframe) {
        let ran = false;
        const cancel = frame(() => {
          ran = true;
          flush();
        });
        if (!ran && gesture) gesture.unframe = cancel;
      }
    },
    release(p) {
      const g = gesture;
      if (!g) return null;
      g.unframe?.();
      gesture = null;
      // A release far from the press is a drag even with no move reported between.
      if (Math.hypot(p[0] - g.start[0], p[1] - g.start[1]) >= DRAG_MIN) g.moved = true;
      if (!g.moved) {
        // A tap types the number: the field opens over it.
        const info = live.get(g.name)!;
        const { step, min, max } = varScrub(info);
        const box = parts().find((x) => x.id === g.id)?.box;
        if (!box) return "pass";
        const d = liveDecimals(info);
        editing = {
          id: g.id,
          name: g.name,
          box,
          field: { value: Number(valueOf(g.name).toFixed(d)), label: g.name, ...(Number.isFinite(min) ? { min } : {}), ...(Number.isFinite(max) ? { max } : {}), step },
        };
        return "edit";
      }
      scrubTo(g, p);
      return "drag";
    },
    cancel() {
      const g = gesture;
      if (!g) return;
      g.unframe?.();
      gesture = null;
      if (g.moved) paint(g.before);
    },
    editField: () => (editing ? { id: editing.id, field: editing.field, box: editing.box } : null),
    commitEdit(text) {
      if (!editing) return { ok: false, error: "no field is open" };
      const r = parseFieldValue(text, editing.field);
      if ("error" in r) return { ok: false, error: r.error };
      const name = editing.name;
      editing = null;
      paint({ ...patches, [name]: r.value });
      return { ok: true };
    },
    cancelEdit() {
      editing = null;
    },
    clickAt(p) {
      return this.press(p) && this.release(p) === "click";
    },
    zoomAt: () => false,
    restPatch: () => null,
    toRest: () => false,
    keyPress: () => false,
    lastAnswer: () => null,
    onAnswer: () => () => {},
    reset() {
      gesture?.unframe?.();
      gesture = null;
      editing = null;
      patches = {};
    },
  };
  return host;
}

/**
 * Two hosts on one stage (a template body and live math on the same page):
 * a press goes to the first that takes it, and that host owns the gesture to
 * its end; an open number field belongs to whichever opened it. `clear`
 * forgets the patches both have painted when the preview goes (play, a step).
 */
export function combineHosts(a: WidgetHost, b: WidgetHost, clear: () => void): WidgetHost {
  let owner: WidgetHost | null = null;
  let editor: WidgetHost | null = null;
  let last: WidgetHost = a;
  const either = <T>(f: (h: WidgetHost) => T | false | null): T | false | null => f(a) || f(b);
  return {
    keys: Object.freeze([...a.keys, ...b.keys.filter((k) => !a.keys.includes(k))]),
    get live() {
      // Read after a release: the host that had the gesture decides whether its tap is its own.
      return last.live;
    },
    restLabel: a.restLabel,
    over: (p) => a.over(p) || b.over(p),
    grabbable: (p) => a.grabbable(p) || b.grabbable(p),
    scrubbable: (p) => a.scrubbable(p) || b.scrubbable(p),
    dragging: () => owner?.dragging() === true,
    press(p) {
      if (owner) return false;
      // Live math's small numbers sit on top of whatever template they label.
      for (const h of [b, a]) {
        if (h.press(p)) {
          owner = h;
          last = h;
          return true;
        }
      }
      return false;
    },
    move: (p) => owner?.move(p),
    release(p) {
      const h = owner;
      owner = null;
      if (!h) return null;
      const r = h.release(p);
      if (r === "edit") editor = h;
      return r;
    },
    cancel() {
      owner?.cancel();
      owner = null;
    },
    zoomAt: (p, f) => a.zoomAt(p, f) || b.zoomAt(p, f),
    restPatch: () => a.restPatch() ?? b.restPatch(),
    toRest: () => a.toRest() || b.toRest(),
    keyPress: (k, ms) => a.keyPress(k, ms) || b.keyPress(k, ms),
    editField: () => editor?.editField() ?? null,
    commitEdit(text) {
      const r = editor ? editor.commitEdit(text) : ({ ok: false, error: "no field is open" } as const);
      if (r.ok) editor = null;
      return r;
    },
    cancelEdit() {
      editor?.cancelEdit();
      editor = null;
    },
    clickAt(p) {
      return this.press(p) && this.release(p) === "click";
    },
    lastAnswer: () => either((h) => h.lastAnswer()) || null,
    onAnswer(fn) {
      const ua = a.onAnswer(fn);
      const ub = b.onAnswer(fn);
      return () => {
        ua();
        ub();
      };
    },
    reset() {
      owner = null;
      editor = null;
      a.reset();
      b.reset();
      clear();
    },
  };
}
