// field_lines' widget body: while the figure is paused the viewer arranges
// the charges and watches the field answer.
//
//   a charge                drag: moves it (the lines re-trace under the
//                           pointer); tap: flips its sign
//   its label ("+2q")       drag sideways: scrubs the charge, a whole q per
//                           step (−5…5); tap: type it
//   the test charge         drag: moves it — the force arrow and the values
//                           {field_lines.E}… follow
//
// Every gesture is a patch of `charges` or `test_charge` — the movie never
// sees it, and an animate of charges.<i>.x still plays as written. Free play
// only: the manifest carries no `widget` flag.
import type { Pt } from "../../layout/model";
import { STEP_UNITS, clamp, roundTo } from "../number-scrub";
import type { EditField, WidgetBody, WidgetEvent, WidgetScene } from "../widget-types";
import { clampPos, MIN_GAP, Q_MAX, readCharges, type ChargeSpec, type FieldLinesParams } from "./model";

const CHARGE = /^charge_(\d+)$/;
const LABEL = /^charge_label_(\d+)$/;

/** The parts a press can take: every charge, its label, the test charge. */
export function fieldParts(scene: WidgetScene): string[] {
  return scene.ids.filter((id) => CHARGE.test(id) || LABEL.test(id) || id === "test_charge");
}

/** The charges as params, with charge i changed. */
function withCharge(P: FieldLinesParams, i: number, change: Partial<ChargeSpec>): ChargeSpec[] {
  const list = Array.isArray(P.charges) ? P.charges : [];
  return list.map((c, j) => (j === i ? { ...c, ...change } : c));
}

/** Where charge i lands when dragged by (dx, dy) units from where it was: on the page, and never onto another. */
export function movedTo(P: FieldLinesParams, i: number, dx: number, dy: number): Pt | null {
  const cs = readCharges(P);
  const c = cs[i];
  if (!c) return null;
  let [x, y] = clampPos(c.x + dx, c.y + dy);
  for (const o of cs) {
    if (o.index === i) continue;
    const d = Math.hypot(x - o.x, y - o.y);
    const gap = Math.max(MIN_GAP, c.r + o.r + 0.1);
    if (d < gap) {
      // Pushed out to the edge of the other's room, along the line between them.
      const ux = d > 1e-9 ? (x - o.x) / d : 1,
        uy = d > 1e-9 ? (y - o.y) / d : 0;
      [x, y] = clampPos(o.x + ux * gap, o.y + uy * gap);
    }
  }
  return clampPos(roundTo(x, 2), roundTo(y, 2));
}

/** Logical units of sideways travel per whole q: a charge has only ten
 *  values, so a step wants more travel than a number's hundredth does. */
export const CHARGE_STEP_UNITS = 3 * STEP_UNITS;

/** A charge scrubbed `dx` logical units from q0: whole steps of q. */
export function scrubCharge(q0: number, dx: number): number {
  return clamp(roundTo(q0 + Math.trunc(dx / CHARGE_STEP_UNITS), 2), -Q_MAX, Q_MAX);
}

export function fieldLinesWidget(): WidgetBody {
  return {
    live: true,
    parts: fieldParts,
    init: () => null,
    taps: (id: string) => CHARGE.test(id),
    editable(id: string, _point: Pt, scene: WidgetScene): EditField | null {
      const m = LABEL.exec(id);
      if (!m) return null;
      const c = readCharges(scene.params as FieldLinesParams)[Number(m[1])];
      return c ? { value: c.q, label: `Charge ${Number(m[1]) + 1} in units of q`, min: -Q_MAX, max: Q_MAX, step: 1 } : null;
    },
    on(event: WidgetEvent, state: unknown, scene: WidgetScene) {
      const P = scene.params as FieldLinesParams;
      const none = { state, effects: [] };
      if (event.type === "click") {
        const m = CHARGE.exec(event.id);
        const c = m ? readCharges(P)[Number(m[1])] : undefined;
        if (!m || !c) return none;
        return { state, effects: [{ patch: { charges: withCharge(P, Number(m[1]), { q: -c.q }) } }] };
      }
      if (event.type === "input") {
        const m = LABEL.exec(event.id);
        if (!m || !Number.isFinite(event.value)) return none;
        return { state, effects: [{ patch: { charges: withCharge(P, Number(m[1]), { q: clamp(roundTo(event.value, 2), -Q_MAX, Q_MAX) }) } }] };
      }
      if (event.type !== "drag_move" && event.type !== "drag") return none;
      const lm = LABEL.exec(event.id);
      if (lm) {
        const c = readCharges(P)[Number(lm[1])];
        if (!c) return none;
        // Sideways on the page, as every scrub (a figure unit is 80 of them).
        const dxL = event.point[0] - (event.from ?? event.point)[0];
        return { state, effects: [{ patch: { charges: withCharge(P, Number(lm[1]), { q: scrubCharge(c.q, dxL) }) } }] };
      }
      const from = event.fromDomain;
      const to = event.domain;
      if (!from || !to) return none;
      const [dx, dy] = [to[0] - from[0], to[1] - from[1]];
      const cm = CHARGE.exec(event.id);
      if (cm) {
        const at = movedTo(P, Number(cm[1]), dx, dy);
        return at ? { state, effects: [{ patch: { charges: withCharge(P, Number(cm[1]), { x: at[0], y: at[1] }) } }] } : none;
      }
      if (event.id === "test_charge" && P.test_charge) {
        const [x, y] = clampPos(P.test_charge.x + dx, P.test_charge.y + dy);
        const [rx, ry] = clampPos(roundTo(x, 2), roundTo(y, 2));
        return { state, effects: [{ patch: { test_charge: { ...P.test_charge, x: rx, y: ry } } }] };
      }
      return none;
    },
  };
}
