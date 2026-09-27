// field_lines: one to four point charges and the electric field they make —
// field lines traced from the positive charges (as many as the charge is
// big), an arrow along each, optionally the equipotentials, and a test
// charge with the force on it. Every line is computed, so a moved or flipped
// charge (an animate frame, a drag) redraws the whole field.
//
// Words on the canvas are the charges' own ("+2q", or the author's label)
// and "F". Field lines are cut where a word stands, so it reads clean.
import type { BBox } from "../../layout/geometry";
import { simplifyPolyline } from "../../layout/geometry";
import { heuristicMeasure } from "../../layout/measure";
import { COLORS, SKETCH_MS, type Drawable, type Pt } from "../../layout/model";
import { kit } from "../kit";
import type { SceneLayout } from "../types";
import { contours, FRAME, potentialLevels, probe, PX, readCharges, toPx, traceField, DEFAULT_DENSITY, type FieldLinesParams } from "./model";

export type { FieldLinesParams } from "./model";

export const POS_COLOR = COLORS.demand;
export const NEG_COLOR = COLORS.supply;
const LINE_COLOR = COLORS.ink;
const LABEL_FONT = 26;
/** The whole field sketches in about this long, however many lines it has. */
const FIELD_MS = 2600;

/** What a charge's label says: the author's, else its value in q ("+2q", "−q", "0"). */
export function chargeText(c: { q: number; label?: string }): string {
  if (c.label) return c.label;
  if (c.q === 0) return "0";
  const a = Math.abs(c.q);
  const mag = a === 1 ? "" : kit.num(Number(a.toFixed(2)));
  return `${c.q > 0 ? "+" : "−"}${mag}q`;
}

const inBox = (p: Pt, b: BBox): boolean => p[0] >= b.x && p[0] <= b.x + b.w && p[1] >= b.y && p[1] <= b.y + b.h;
const overlaps = (a: BBox, b: BBox): boolean => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const pad = (b: BBox, p: number): BBox => ({ x: b.x - p, y: b.y - p, w: b.w + 2 * p, h: b.h + 2 * p });

/** Runs of a polyline's points outside every box, as index ranges [i0, i1]. */
function runsOutside(pts: Pt[], boxes: BBox[]): [number, number][] {
  const out: [number, number][] = [];
  let start = -1;
  for (let i = 0; i < pts.length; i++) {
    const inside = boxes.some((b) => inBox(pts[i], b));
    if (!inside && start < 0) start = i;
    if (inside && start >= 0) {
      if (i - 1 > start) out.push([start, i - 1]);
      start = -1;
    }
  }
  if (start >= 0 && pts.length - 1 > start) out.push([start, pts.length - 1]);
  return out;
}

/** The point index at arc length `s` along pts. */
function indexAt(pts: Pt[], s: number): number {
  let acc = 0;
  for (let i = 1; i < pts.length; i++) {
    acc += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    if (acc >= s) return i;
  }
  return pts.length - 1;
}
function lengthOf(pts: Pt[]): number {
  let acc = 0;
  for (let i = 1; i < pts.length; i++) acc += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  return acc;
}

export function layoutFieldLines(P: FieldLinesParams): SceneLayout {
  const cs = readCharges(P);
  const drawables: Drawable[] = [];
  const order: string[] = [];
  const anchors: Record<string, Pt> = {};
  const attached: Record<string, string[]> = {};
  const groups: Record<string, string[]> = { lines: [], charges: [] };
  const values: Record<string, number> = {};
  const push = (d: Drawable, anchor?: Pt, group?: string): void => {
    drawables.push(d);
    order.push(d.id);
    if (anchor) anchors[d.id] = anchor;
    if (group) groups[group].push(d.id);
  };
  const density = typeof P.density === "number" && Number.isFinite(P.density) ? P.density : DEFAULT_DENSITY;
  const lines = traceField(cs, density).map((l) => ({ ...l, px: l.pts.map(toPx) }));
  const frameBox: BBox = { x: FRAME.box.x0, y: FRAME.box.y0, w: FRAME.box.x1 - FRAME.box.x0, h: FRAME.box.y1 - FRAME.box.y0 };

  // ---- the words first: where they stand, the lines give way -----------------
  const knock: BBox[] = [];
  const discs: BBox[] = cs.map((c) => {
    const [x, y] = toPx([c.x, c.y]);
    const r = c.r * PX;
    return { x: x - r, y: y - r, w: 2 * r, h: 2 * r };
  });
  const words: BBox[] = [];
  const labelAt: Pt[] = [];
  for (const c of cs) {
    const s = chargeText(c);
    const { w, h } = heuristicMeasure(s, LABEL_FONT);
    const [cx, cy] = toPx([c.x, c.y]);
    const r = c.r * PX;
    let best: { pos: Pt; score: number } | null = null;
    for (let k = 0; k < 8; k++) {
      // Up-right first: the eye expects a charge's name there.
      const a = Math.PI / 4 + (k * Math.PI) / 4;
      const pos: Pt = [cx + Math.cos(a) * (r + 8 + w / 2), cy + Math.sin(a) * (r + 6 + h / 2)];
      const box = { x: pos[0] - w / 2, y: pos[1] - h / 2, w, h };
      let score = k * 0.5;
      for (const l of lines) for (const p of l.px) if (inBox(p, box)) score += 1;
      if (!(box.x >= frameBox.x && box.x + box.w <= frameBox.x + frameBox.w && box.y >= frameBox.y && box.y + box.h <= frameBox.y + frameBox.h + 40)) score += 1000;
      for (const d of discs) if (overlaps(pad(d, 2), box)) score += 500;
      for (const o of words) if (overlaps(pad(o, 3), box)) score += 500;
      if (!best || score < best.score) best = { pos, score };
    }
    const pos = best!.pos;
    const box = { x: pos[0] - w / 2, y: pos[1] - h / 2, w, h };
    words.push(box);
    labelAt.push(pos);
    knock.push(pad(box, 3));
  }
  for (const d of discs) knock.push(pad(d, 1));

  // The test charge and the force on it.
  const t = P.test_charge && typeof P.test_charge === "object" && Number.isFinite(P.test_charge.x) && Number.isFinite(P.test_charge.y) ? P.test_charge : null;
  let force: { from: Pt; to: Pt; label: Pt } | null = null;
  if (t) {
    const qt = typeof t.q === "number" && Number.isFinite(t.q) && t.q !== 0 ? t.q : 1;
    const tx = Math.max(FRAME.x[0] + 0.2, Math.min(FRAME.x[1] - 0.2, t.x));
    const ty = Math.max(FRAME.y[0] + 0.2, Math.min(FRAME.y[1] - 0.2, t.y));
    const pr = probe(cs, tx, ty);
    const F = Math.abs(qt) * pr.E;
    values.E = Math.round(pr.E * 1000) / 1000;
    values.E_angle = Math.round(pr.angle * 10) / 10;
    values.Ex = Math.round(pr.ex * 1000) / 1000;
    values.Ey = Math.round(pr.ey * 1000) / 1000;
    values.V = Math.round(pr.V * 1000) / 1000;
    values.F = Math.round(F * 1000) / 1000;
    const c = toPx([tx, ty]);
    knock.push({ x: c[0] - 13, y: c[1] - 13, w: 26, h: 26 });
    if (F > 1e-4) {
      const ux = (Math.sign(qt) * pr.ex) / pr.E,
        uy = (Math.sign(qt) * pr.ey) / pr.E;
      let L = 28 + (110 * F) / (F + 0.25);
      // Short of any charge's disc: the arrow says where the force points, it does not run over a charge.
      for (let s = 13; s <= 13 + L; s += 3) {
        const q: Pt = [c[0] + ux * s, c[1] + uy * s];
        if (cs.some((o) => Math.hypot(q[0] - toPx([o.x, o.y])[0], q[1] - toPx([o.x, o.y])[1]) < o.r * PX + 26)) {
          L = Math.max(14, s - 13);
          break;
        }
      }
      const from: Pt = [c[0] + ux * 13, c[1] + uy * 13];
      const to: Pt = [c[0] + ux * (13 + L), c[1] + uy * (13 + L)];
      const { w, h } = heuristicMeasure("F", LABEL_FONT);
      // Past the tip, else beside it: clear of every disc and every word.
      const cands: Pt[] = [
        [to[0] + ux * (w / 2 + 12), to[1] + uy * (h / 2 + 6)],
        [to[0] - uy * (w / 2 + 12), to[1] + ux * (h / 2 + 6)],
        [to[0] + uy * (w / 2 + 12), to[1] - ux * (h / 2 + 6)],
        [(from[0] + to[0]) / 2 - uy * (w / 2 + 12), (from[1] + to[1]) / 2 + ux * (h / 2 + 6)],
        [(from[0] + to[0]) / 2 + uy * (w / 2 + 12), (from[1] + to[1]) / 2 - ux * (h / 2 + 6)],
      ];
      const free = (p: Pt): boolean => {
        const b = { x: p[0] - w / 2, y: p[1] - h / 2, w, h };
        return !discs.some((d) => overlaps(pad(d, 3), b)) && !words.some((o) => overlaps(pad(o, 3), b));
      };
      const label = cands.find(free) ?? cands[0];
      force = { from, to, label };
      knock.push(pad({ x: label[0] - w / 2, y: label[1] - h / 2, w, h }, 3));
    }
  }

  // ---- the field lines, cut where a word or a disc stands ------------------------
  const arrows = P.arrows !== false;
  const byCharge = new Map<number, Drawable[]>();
  const pieces: { from: number; pts: Pt[]; head: boolean }[] = [];
  for (const l of lines) {
    const pts = l.px;
    const L = lengthOf(pts);
    // The arrow: halfway along a line between charges; near the charge on one
    // that runs off the page (so it is seen before the line leaves).
    const s = l.end.kind === "charge" && !l.inward ? L / 2 : l.inward ? Math.max(L / 2, L - 120) : Math.min(L / 2, 120);
    const k = arrows && L > 40 ? indexAt(pts, s) : -1;
    for (const [i0, i1] of runsOutside(pts, knock)) {
      if (k > i0 && k < i1) {
        pieces.push({ from: l.from, pts: pts.slice(i0, k + 1), head: true });
        pieces.push({ from: l.from, pts: pts.slice(k, i1 + 1), head: false });
      } else pieces.push({ from: l.from, pts: pts.slice(i0, i1 + 1), head: false });
    }
  }
  const ms = Math.max(8, Math.round(FIELD_MS / Math.max(1, pieces.length)));
  pieces.forEach((p, n) => {
    const simple = simplifyPolyline(p.pts, 0.7);
    if (simple.length < 2) return;
    const d = kit.stroke(`lines__${n}`, simple, { color: LINE_COLOR, strokeWidth: 2.2, roughness: 0.8, ms, ...(p.head ? { arrowhead: "end" as const } : {}) });
    if (p.head) (d as { headSize?: number }).headSize = 11;
    const list = byCharge.get(p.from) ?? [];
    list.push(d);
    byCharge.set(p.from, list);
  });
  const sketch = kit.stroke("_", [], { ms: SKETCH_MS.stroke });
  for (const c of cs) {
    const kids = byCharge.get(c.index);
    if (!kids || kids.length === 0) continue;
    const [x, y] = toPx([c.x, c.y]);
    push({ id: `lines_${c.index}`, kind: "group", z: 1, style: sketch.style, drawOpts: sketch.drawOpts, children: kids.map((k, j) => ({ ...k, id: `lines_${c.index}__${j}` })) }, [x, y], "lines");
  }

  // ---- equipotentials, dashed, cut round the words too ----------------------------
  if (P.equipotentials === true && cs.length > 0) {
    const kids: Drawable[] = [];
    for (const line of contours(cs, potentialLevels(cs))) {
      const px = line.map(toPx);
      for (const [i0, i1] of runsOutside(px, knock)) {
        const simple = simplifyPolyline(px.slice(i0, i1 + 1), 0.7);
        if (simple.length >= 2 && lengthOf(simple) > 12) kids.push(kit.stroke(`equipotentials__${kids.length}`, simple, { color: COLORS.accent, strokeWidth: 2, dash: true, roughness: 0.6 }));
      }
    }
    const each = Math.max(8, Math.round(1800 / Math.max(1, kids.length)));
    for (const k of kids) k.drawOpts = { ...k.drawOpts, duration: each };
    if (kids.length > 0) push({ id: "equipotentials", kind: "group", z: 1, style: sketch.style, drawOpts: sketch.drawOpts, children: kids }, toPx([0, 0]));
  }

  // ---- the charges ---------------------------------------------------------------------
  cs.forEach((c, i) => {
    const center = toPx([c.x, c.y]);
    const r = c.r * PX;
    const color = c.q > 0 ? POS_COLOR : c.q < 0 ? NEG_COLOR : COLORS.guide;
    const ring = kit.circle(center, r, 28);
    const kids: Drawable[] = [kit.area(`charge_${i}__fill`, ring, color, { precise: true, opacity: 0.9 }), kit.stroke(`charge_${i}__disc`, ring, { closed: true, color, strokeWidth: 3, roughness: 0.8 })];
    // The sign in paper on the charge's colour, with no halo (a paper halo on paper-coloured text is a blot).
    if (c.q !== 0) kids.push({ ...kit.text(`charge_${i}__sign`, [center[0], center[1] + 1], c.q > 0 ? "+" : "−", { fontSize: Math.round(r * 1.4), color: COLORS.paper }), halo: false });
    push({ id: `charge_${i}`, kind: "group", z: 1, style: sketch.style, drawOpts: kit.stroke("_", [], { ms: SKETCH_MS.node }).drawOpts, children: kids }, center, "charges");
    const lab = kit.text(`charge_label_${i}`, labelAt[i], chargeText(c), { fontSize: LABEL_FONT, color });
    push(lab, labelAt[i], "charges");
    attached[`charge_${i}`] = [`charge_label_${i}`];
  });
  values.lines = lines.length;
  values.net_charge = Math.round(cs.reduce((a, c) => a + c.q, 0) * 100) / 100;

  if (t) {
    const c = toPx([Math.max(FRAME.x[0] + 0.2, Math.min(FRAME.x[1] - 0.2, t.x)), Math.max(FRAME.y[0] + 0.2, Math.min(FRAME.y[1] - 0.2, t.y))]);
    const qt = typeof t.q === "number" && Number.isFinite(t.q) && t.q !== 0 ? t.q : 1;
    const kids: Drawable[] = [
      kit.area("test_charge__fill", kit.circle(c, 11, 18), COLORS.paper, { precise: true, opacity: 1 }),
      kit.stroke("test_charge__disc", kit.circle(c, 11, 18), { closed: true, color: COLORS.accent, strokeWidth: 3, roughness: 0.6 }),
      kit.text("test_charge__sign", [c[0], c[1] + 1], qt > 0 ? "+" : "−", { fontSize: 18, color: COLORS.accent }),
    ];
    push({ id: "test_charge", kind: "group", z: 1, style: sketch.style, drawOpts: kit.stroke("_", [], { ms: SKETCH_MS.node }).drawOpts, children: kids }, c);
    if (force) {
      push(kit.stroke("test_force", [force.from, force.to], { arrowhead: "end", color: COLORS.accent, strokeWidth: 4, ms: SKETCH_MS.arrow }), force.to);
      push(kit.text("test_force_label", force.label, "F", { fontSize: LABEL_FONT, color: COLORS.accent }), force.label);
      attached.test_force = ["test_force_label"];
      attached.test_charge = ["test_force", "test_force_label"];
    }
  }

  if (typeof P.title === "string" && P.title.trim()) {
    const pos: Pt = [500, 700];
    push(kit.text("title", pos, P.title.trim(), { fontSize: 32 }), pos);
  }

  for (const k of Object.keys(groups)) if (groups[k].length === 0) delete groups[k];
  return {
    drawables,
    labels: [],
    anchors,
    order,
    attached,
    groups,
    values,
    frame: { x: [...FRAME.x] as [number, number], y: [...FRAME.y] as [number, number], box: { ...FRAME.box } },
  };
}
