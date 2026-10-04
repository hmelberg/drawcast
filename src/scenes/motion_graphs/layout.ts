// motion_graphs: the kinematics graphs of one motion, stacked on a shared
// time axis — position x(t), velocity v(t), acceleration a(t), whichever the
// author picks — with the moving object on a track above them, a time cursor
// through every panel (a dot on each graph, the slope of x and of v drawn as
// tangents there, the values read out beside each panel), the area under
// v(t) shaded as the displacement, and the motion's numbers written in a
// header the paused viewer can scrub. Every number is live: the layout
// re-runs on each animate frame (`animate: {t: …}` sweeps the cursor, the
// object and the shading) and each widget patch, and `values` carries them
// for {motion.<key>} tokens.
import { AXIS_OVERHANG } from "../../layout/axes";
import { COLORS, SKETCH_MS, Z_STROKE, defaultDrawOpts, defaultStyle, type Drawable, type Pt } from "../../layout/model";
import { heuristicMeasure } from "../../layout/measure";
import { kit } from "../kit";
import type { SceneLayout } from "../types";
import { PARAM_COLOR } from "../params-ui/equation";
import { framePanel, geometry, numbersOf, sampleX, shadeOf, stateAt, ticksIn, travelTo, type Geometry, type MotionParams, type NumberKey, type PanelBox, type PanelKey } from "./model";
import { TEXT_MIN } from "../../layout/readable";

export type { MotionParams } from "./model";

/** Each graph's ink: position blue, velocity red, acceleration sage. */
export const PANEL_COLORS: Record<PanelKey, string> = { x: COLORS.supply, v: COLORS.demand, a: "#5d8a4f" };
const TANGENT_COLOR = COLORS.shifted;
const CURSOR_COLOR = COLORS.ink;
const TICK_FONT = 19;
const READOUT_FONT = 21;
const CAPTION_FONT = 30;

/** The drawn symbol and unit of each panel. */
export function captionsOf(P: MotionParams): { sym: Record<PanelKey | "t", string>; unit: Record<PanelKey | "t", string> } {
  const L = P.labels ?? {};
  const s = (v: unknown, d: string): string => (typeof v === "string" && v.trim() ? v : d);
  const ux = s(P.units?.x, "m");
  const ut = s(P.units?.t, "s");
  return {
    sym: { x: s(L.x, "x"), v: s(L.v, "v"), a: s(L.a, "a"), t: s(L.t, "t") },
    unit: { x: ux, v: `${ux}/${ut}`, a: `${ux}/${ut}²`, t: ut },
  };
}

/** Decimals a readout needs for a range (a span of 4 → 1, of 0.4 → 2). */
function decimalsFor(span: number): number {
  return span >= 2 ? 1 : span >= 0.2 ? 2 : 3;
}

const fmt = (v: number, d: number): string => {
  const s = kit.num(Number(v.toFixed(d)), d);
  return /^-0([.,]0*)?$/.test(s) ? s.slice(1) : s.replace(/^-/, "−");
};

/** A number as the header writes it: no trailing zeros ("3", "−0.5"). */
export const writeNumber = (v: number): string => {
  const s = kit.num(Number(v.toFixed(3)));
  return s === "-0" ? "0" : s.replace(/^-/, "−");
};

export function layoutMotionGraphs(P: MotionParams): SceneLayout {
  const g = geometry(P);
  const m = g.motion;
  const { sym, unit } = captionsOf(P);
  const drawables: Drawable[] = [];
  const anchors: Record<string, Pt> = {};
  const order: string[] = [];
  const attached: Record<string, string[]> = {};
  const drawnWith: Record<string, string[]> = {};
  const groups: Record<string, string[]> = {};
  const push = (d: Drawable, anchor?: Pt): void => {
    drawables.push(d);
    order.push(d.id);
    if (anchor) anchors[d.id] = anchor;
  };
  const follow = (owner: string, ...ids: string[]): void => {
    (attached[owner] ??= []).push(...ids);
  };

  const cursorOn = P.cursor !== false;
  const now = stateAt(m, typeof P.t === "number" ? P.t : 0);
  const travel = travelTo(m, now.t);
  const T = m.T;

  // ---- title and the header numbers -------------------------------------
  if (g.titleY !== null) push(kit.text("title", [500, g.titleY], P.title!, { fontSize: 30 }), [500, g.titleY]);
  const numbers = numbersOf(P, m);
  if (g.numbersY !== null) {
    const y = g.numbersY;
    const NAME: Record<NumberKey, string> = { x0: `${sym.x}₀ =`, v0: `${sym.v}₀ =`, a: `${sym.a} =` };
    const UNIT: Record<NumberKey, string> = { x0: unit.x, v0: unit.v, a: unit.a };
    const VAL: Record<NumberKey, number> = { x0: m.x0, v0: m.segs[0].v0, a: m.segs[0].a };
    let X = g.plotX0;
    const F = 24;
    const w = (s: string): number => heuristicMeasure(s, F).w;
    for (const k of numbers) {
      const name = NAME[k];
      const digits = writeNumber(VAL[k]);
      push(kit.text(`name_${k}`, [X, y], name, { fontSize: F, anchor: "start" }), [X, y]);
      X += w(name) + 8;
      push(kit.text(`num_${k}`, [X, y], digits, { fontSize: F, anchor: "start", color: PARAM_COLOR }), [X + w(digits) / 2, y]);
      X += w(digits) + 8;
      push(kit.text(`unit_${k}`, [X, y], UNIT[k], { fontSize: F, anchor: "start" }), [X, y]);
      X += w(UNIT[k]) + 40;
      follow(`num_${k}`, `name_${k}`, `unit_${k}`);
      drawnWith[`num_${k}`] = [`name_${k}`, `unit_${k}`];
    }
    groups.numbers = numbers.flatMap((k) => [`name_${k}`, `num_${k}`, `unit_${k}`]);
  }

  // ---- the track and the object --------------------------------------------
  if (g.track) {
    const tr = g.track;
    const [lo, hi] = g.ranges.x;
    const trackStyle = defaultStyle({ strokeWidth: 3, color: COLORS.ink });
    const tk = ticksIn([lo, hi], 6);
    const tickKids: Drawable[] = [];
    tk.ticks.forEach((v, i) => {
      const X = tr.sx(v);
      tickKids.push(kit.stroke(`track__m${i}`, [[X, tr.y - 5], [X, tr.y + 5]], { color: COLORS.guide, strokeWidth: 2, instant: true }));
      tickKids.push({ ...kit.text(`track__t${i}`, [X, tr.y - 20], fmt(v, Math.max(0, -Math.floor(Math.log10(tk.step) + 1e-9))), { fontSize: TEXT_MIN, color: COLORS.guide }) }); // W30: was 17
    });
    push(
      {
        id: "track",
        kind: "group",
        z: Z_STROKE,
        style: trackStyle,
        drawOpts: defaultDrawOpts("sketch"),
        children: [{ id: "track__line", kind: "stroke", pts: [[g.plotX0 - 10, tr.y], [g.plotX1 + AXIS_OVERHANG, tr.y]], arrowhead: "end", z: Z_STROKE, style: trackStyle, drawOpts: defaultDrawOpts("sketch", SKETCH_MS.axis) }, ...tickKids],
      },
      [g.plotX1, tr.y],
    );
    const capPos: Pt = [g.plotX1 + AXIS_OVERHANG + 10, tr.y];
    push(kit.text("track_label", capPos, `${sym.x} (${unit.x})`, { fontSize: 22, anchor: "start", color: COLORS.guide }), capPos);
    follow("track", "track_label");
    drawnWith.track = ["track_label"];
    const R = 13;
    const c: Pt = [tr.sx(now.x), tr.y + R + 3];
    push(kit.ball("object", c, R, { fill: "#6b635a", color: COLORS.ink, ms: SKETCH_MS.dot }), c);
    if (tr.labelY !== null) {
      const lp: Pt = [c[0], tr.labelY];
      push(kit.text("object_label", lp, P.labels!.object!, { fontSize: 22 }), lp);
      follow("object", "object_label");
    }
    // The velocity arrow on the object: its length is v on the v panel's own scale.
    const vmax = Math.max(Math.abs(g.ranges.v[0]), Math.abs(g.ranges.v[1]), 1e-9);
    const len = (now.v / vmax) * 110;
    if (Math.abs(len) > 6) {
      const s0: Pt = [c[0] + Math.sign(len) * (R + 3), c[1]];
      const e0: Pt = [s0[0] + len, c[1]];
      push(kit.stroke("object_arrow", [s0, e0], { arrowhead: "end", color: PANEL_COLORS.v, strokeWidth: 3.5, ms: SKETCH_MS.arrow }), e0);
      follow("object", "object_arrow");
    }
  }

  if (attached.object) drawnWith.object = attached.object.slice();

  // ---- the phases' names -------------------------------------------------
  if (g.phaseY !== null) {
    const ids: string[] = [];
    for (const s of m.segs) {
      if (!s.label) continue;
      const p: Pt = [(g.sx(s.t0) + g.sx(s.t1)) / 2, g.phaseY];
      const id = `phase_${s.index}`;
      push(kit.text(id, p, s.label, { fontSize: 20, color: COLORS.guide }), p);
      ids.push(id);
    }
    if (ids.length > 0) groups.phases = ids;
  }

  // ---- the panels --------------------------------------------------------
  const tTicks = ticksIn([0, T], 6);
  const tDec = Math.max(0, -Math.floor(Math.log10(tTicks.step) + 1e-9));
  const bottomPanel = g.panels[g.panels.length - 1];
  const shade = shadeOf(P);
  const vSegIds: string[] = [];
  const aSegIds: string[] = [];
  for (const pb of g.panels) drawPanelAxes(pb);

  function drawPanelAxes(pb: PanelBox): void {
    const k = pb.key;
    const [lo, hi] = pb.range;
    const zero = lo <= 0 && hi >= 0 ? g.sy(k, 0) : pb.y0;
    const axisStyle = defaultStyle({ strokeWidth: 3, roughness: 1 });
    const kids: Drawable[] = [
      { id: `axes_${k}__y`, kind: "stroke", pts: [[pb.x0, pb.y0 - 4], [pb.x0, pb.y1 + 6]], z: Z_STROKE, style: axisStyle, drawOpts: defaultDrawOpts("sketch", SKETCH_MS.axis) },
      { id: `axes_${k}__t`, kind: "stroke", pts: [[pb.x0 - 4, zero], [pb.x1 + AXIS_OVERHANG, zero]], arrowhead: "end", z: Z_STROKE, style: axisStyle, drawOpts: defaultDrawOpts("sketch", SKETCH_MS.axis) },
    ];
    tTicks.ticks.forEach((v, i) => {
      if (v <= 0) return;
      const X = g.sx(v);
      kids.push(kit.stroke(`axes_${k}__m${i}`, [[X, zero - 5], [X, zero + 5]], { color: COLORS.guide, strokeWidth: 2, instant: true }));
    });
    push({ id: `axes_${k}`, kind: "group", z: Z_STROKE, style: axisStyle, drawOpts: defaultDrawOpts("sketch"), children: kids }, [pb.x0, zero]);
    // The value ticks: round numbers up the panel's left edge.
    const yt = ticksIn(pb.range, 3);
    const yd = Math.max(0, -Math.floor(Math.log10(yt.step) + 1e-9));
    const ykids: Drawable[] = [];
    yt.ticks.forEach((v, i) => {
      const Y = g.sy(k, v);
      ykids.push(kit.stroke(`ticks_${k}__m${i}`, [[pb.x0 - 6, Y], [pb.x0 + 6, Y]], { color: COLORS.guide, strokeWidth: 2, instant: true }));
      ykids.push(kit.text(`ticks_${k}__t${i}`, [pb.x0 - 12, Y], fmt(v, yd), { fontSize: TICK_FONT, color: COLORS.guide, anchor: "end" }));
    });
    push({ id: `ticks_${k}`, kind: "group", z: Z_STROKE, style: defaultStyle({ color: COLORS.guide }), drawOpts: defaultDrawOpts("instant"), children: ykids }, [pb.x0, pb.y1]);
    // The caption in the left gutter: the symbol, and its unit under it.
    const mid = (pb.y0 + pb.y1) / 2;
    const cp: Pt = [52, mid + 16];
    push(kit.text(`label_${k}`, cp, sym[k], { fontSize: CAPTION_FONT, color: PANEL_COLORS[k] }), cp);
    const up: Pt = [52, mid - 24];
    push(kit.text(`unit_${k}`, up, unit[k], { fontSize: 19, color: COLORS.guide }), up);
    follow(`axes_${k}`, `ticks_${k}`, `label_${k}`, `unit_${k}`);
    drawnWith[`axes_${k}`] = [`ticks_${k}`, `label_${k}`, `unit_${k}`];
  }

  // The time axis's numbers and caption, under the bottom panel.
  {
    const kids: Drawable[] = [];
    tTicks.ticks.forEach((v, i) => kids.push(kit.text(`time_ticks__t${i}`, [g.sx(v), bottomPanel.y0 - 28], fmt(v, tDec), { fontSize: TICK_FONT, color: COLORS.guide })));
    push({ id: "time_ticks", kind: "group", z: Z_STROKE, style: defaultStyle({ color: COLORS.guide }), drawOpts: defaultDrawOpts("instant"), children: kids }, [g.plotX1, bottomPanel.y0 - 28]);
    const tp: Pt = [g.plotX1 + AXIS_OVERHANG + 14, bottomPanel.y0 - 28];
    push(kit.text("label_t", tp, `${sym.t} (${unit.t})`, { fontSize: 22, anchor: "start" }), tp);
    const owner = `axes_${bottomPanel.key}`;
    follow(owner, "time_ticks", "label_t");
    drawnWith[owner].push("time_ticks", "label_t");
  }
  groups.axes = g.panels.map((p) => `axes_${p.key}`);

  // Where one piece meets the next: a faint dashed line down every panel.
  if (m.segs.length > 1) {
    const kids = m.segs.slice(1).map((s, i) => kit.stroke(`boundaries__${i}`, [[g.sx(s.t0), bottomPanel.y0], [g.sx(s.t0), g.top]], { color: COLORS.guide, strokeWidth: 1.5, dash: true, opacity: 0.6, ms: SKETCH_MS.guides }));
    push({ id: "boundaries", kind: "group", z: Z_STROKE - 1, style: defaultStyle({ color: COLORS.guide }), drawOpts: defaultDrawOpts("sketch"), children: kids });
  }

  // The area under v(t): the displacement, up to the cursor or over the whole motion.
  const vPanel = g.panels.find((p) => p.key === "v");
  if (vPanel && shade !== "none") {
    const tEnd = shade === "all" ? T : now.t;
    const pieces = areaPieces(g, tEnd);
    // At t = 0 there is no area yet — but the element exists (a cast draws
    // it before the sweep that fills it).
    const o: Pt = [g.sx(0), g.sy("v", 0)];
    if (pieces.length === 0) pieces.push({ sign: 1, pts: [o, o, o] });
    const kids = pieces.map((pc, i) => kit.area(`area__${i}`, pc.pts, pc.sign > 0 ? COLORS.region1 : COLORS.regionLoss, { opacity: 0.45 }));
    push({ id: "area", kind: "group", z: 0, style: defaultStyle({ color: COLORS.region1 }), drawOpts: defaultDrawOpts("sketch", SKETCH_MS.region), children: kids }, [g.sx(tEnd / 2), g.sy("v", 0)]);
  }

  // The graphs.
  for (const pb of g.panels) {
    const k = pb.key;
    const color = PANEL_COLORS[k];
    const style = { color, strokeWidth: 4.5, ms: SKETCH_MS.curve };
    if (k === "x") {
      const pts = sampleX(m).map(([t, x]): Pt => [g.sx(t), g.sy("x", x)]);
      push(kit.stroke("curve_x", pts, style), pts[pts.length - 1]);
    } else if (k === "v") {
      for (const s of m.segs) {
        const id = `v_seg_${s.index}`;
        const pts: Pt[] = [[g.sx(s.t0), g.sy("v", s.v0)], [g.sx(s.t1), g.sy("v", s.v1)]];
        push(kit.stroke(id, pts, { ...style, ms: Math.max(500, (SKETCH_MS.curve * s.d) / T) }), pts[1]);
        vSegIds.push(id);
      }
      groups.curve_v = vSegIds;
    } else {
      for (const s of m.segs) {
        const id = `a_seg_${s.index}`;
        const pts: Pt[] = [[g.sx(s.t0), g.sy("a", s.a)], [g.sx(s.t1), g.sy("a", s.a)]];
        push(kit.stroke(id, pts, { ...style, ms: Math.max(500, (SKETCH_MS.curve * s.d) / T) }), pts[1]);
        aSegIds.push(id);
      }
      groups.curve_a = aSegIds;
    }
  }

  // ---- the cursor ---------------------------------------------------------
  const values: Record<string, number> = {};
  if (cursorOn) {
    const X = g.sx(now.t);
    push(kit.stroke("cursor", [[X, bottomPanel.y0 - 2], [X, g.top + 6]], { color: CURSOR_COLOR, strokeWidth: 2, dash: true, ms: SKETCH_MS.guides }), [X, g.top + 6]);
    // Its handle: the time, written under the axis in a pill the viewer drags.
    const tText = `${sym.t} = ${fmt(now.t, Math.max(1, tDec))} ${unit.t}`;
    const tw = heuristicMeasure(tText, READOUT_FONT).w;
    const cx = Math.min(g.plotX1 + 20 - tw / 2, Math.max(g.plotX0 - 20 + tw / 2, X));
    const cy = bottomPanel.y0 - 62;
    const pill = kit.rect(cx - tw / 2 - 10, cy - 16, tw + 20, 32);
    push(kit.stroke("cursor_knob", pill, { closed: true, color: CURSOR_COLOR, strokeWidth: 2, fill: "#fbf7ee", ms: SKETCH_MS.guides }), [cx, cy]);
    push(kit.text("readout_t", [cx, cy], tText, { fontSize: READOUT_FONT }), [cx, cy]);
    follow("cursor", "cursor_knob", "readout_t");
    drawnWith.cursor = ["cursor_knob", "readout_t"];
    const tangents = P.tangents !== false;
    const readout = P.readout !== false;
    for (const pb of g.panels) {
      const k = pb.key;
      const v = now[k];
      const c: Pt = [X, g.sy(k, v)];
      const color = PANEL_COLORS[k];
      push(kit.stroke(`dot_${k}`, [c], { shapeHint: { type: "circle", c, r: 7 }, color, fill: color, strokeWidth: 2, ms: SKETCH_MS.dot }), c);
      follow("cursor", `dot_${k}`);
      if (tangents && k !== "a") {
        // The slope of this graph at the cursor is the next one's value.
        const slope = k === "x" ? now.v : now.a;
        const dirX = g.sx(1) - g.sx(0);
        const dirY = slope * g.scale(k);
        const L = Math.hypot(dirX, dirY) || 1;
        const pts = clipSegment(c, [dirX / L, dirY / L], 62, pb);
        push(kit.stroke(`tangent_${k}`, pts, { color: TANGENT_COLOR, strokeWidth: 3, ms: SKETCH_MS.connector }), pts[1]);
        follow("cursor", `tangent_${k}`);
      }
      if (readout) {
        const d = decimalsFor(pb.range[1] - pb.range[0]);
        const rp: Pt = [g.plotX1 + AXIS_OVERHANG + 12, pb.y1 - 12];
        push(kit.text(`readout_${k}`, rp, `${sym[k]} = ${fmt(v, d)} ${unit[k]}`, { fontSize: READOUT_FONT, anchor: "start", color }), rp);
        follow("cursor", `readout_${k}`);
      }
    }
    // Drawing the cursor brings everything it carries: its handle, the dots,
    // the tangents, the readouts.
    drawnWith.cursor = attached.cursor.slice();
    groups.readouts = [...g.panels.map((p) => `readout_${p.key}`), "readout_t"].filter((id) => order.includes(id));
  }

  // ---- values --------------------------------------------------------------
  const total = travelTo(m, T);
  const r6 = (v: number): number => Number(v.toFixed(6));
  Object.assign(values, {
    t: r6(now.t),
    x: r6(now.x),
    v: r6(now.v),
    a: r6(now.a),
    displacement: r6(travel.displacement),
    distance: r6(travel.distance),
    duration: r6(T),
    x0: r6(m.x0),
    v0: r6(m.segs[0].v0),
    x_end: r6(m.segs[m.segs.length - 1].x1),
    v_end: r6(m.segs[m.segs.length - 1].v1),
    displacement_total: r6(total.displacement),
    distance_total: r6(total.distance),
  });
  m.segs.forEach((s, i) => {
    values[`a_${i}`] = r6(s.a);
    values[`v_${i}`] = r6(s.v1);
  });

  const fp = framePanel(g);
  return {
    drawables,
    labels: [],
    anchors,
    order,
    attached,
    drawnWith,
    groups,
    values,
    frame: { x: [0, T], y: [fp.range[0], fp.range[1]], box: { x0: fp.x0, y0: fp.y0, x1: fp.x1, y1: fp.y1 } },
  };
}

/** The tangent through c along unit direction u, `half` either way, cut to the panel's box. */
function clipSegment(c: Pt, u: Pt, half: number, pb: PanelBox): Pt[] {
  let lo = -half;
  let hi = half;
  const cut = (p: number, d: number, min: number, max: number): void => {
    if (Math.abs(d) < 1e-12) return;
    const a = (min - p) / d;
    const b = (max - p) / d;
    lo = Math.max(lo, Math.min(a, b));
    hi = Math.min(hi, Math.max(a, b));
  };
  cut(c[0], u[0], pb.x0, pb.x1);
  cut(c[1], u[1], pb.y0, pb.y1);
  if (!(hi > lo)) return [c, c];
  return [[c[0] + u[0] * lo, c[1] + u[1] * lo], [c[0] + u[0] * hi, c[1] + u[1] * hi]];
}

/** The region between v(t) and the zero line from 0 to tEnd, cut where v
 *  changes sign: each piece one polygon, with its sign. */
export function areaPieces(g: Geometry, tEnd: number): { sign: number; pts: Pt[] }[] {
  const m = g.motion;
  // v(t) as a polyline of (t, v), with every zero crossing and jump as a vertex.
  const path: [number, number][] = [];
  for (const s of m.segs) {
    if (s.t0 >= tEnd) break;
    const t1 = Math.min(s.t1, tEnd);
    const vAt = (t: number): number => s.v0 + s.a * (t - s.t0);
    path.push([s.t0, s.v0]);
    if (Math.abs(s.a) > 1e-12) {
      const r = s.t0 - s.v0 / s.a;
      if (r > s.t0 && r < t1) path.push([r, 0]);
    }
    path.push([t1, vAt(t1)]);
  }
  const out: { sign: number; pts: Pt[] }[] = [];
  let cur: [number, number][] = [];
  let sign = 0;
  const flush = (): void => {
    if (cur.length >= 2 && sign !== 0) {
      const t0 = cur[0][0];
      const t1 = cur[cur.length - 1][0];
      if (t1 - t0 > 1e-9) {
        const pts: Pt[] = [[g.sx(t0), g.sy("v", 0)], ...cur.map(([t, v]): Pt => [g.sx(t), g.sy("v", v)]), [g.sx(t1), g.sy("v", 0)]];
        out.push({ sign, pts });
      }
    }
    cur = [];
  };
  for (const [t, v] of path) {
    const sg = Math.abs(v) < 1e-12 ? 0 : Math.sign(v);
    if (sg !== 0 && sign !== 0 && sg !== sign) {
      // A jump across zero: close this piece at the jump's time, start the next there.
      flush();
      sign = sg;
      cur.push([t, v]);
      continue;
    }
    if (sg !== 0) sign = sign || sg;
    cur.push([t, v]);
    if (sg === 0 && cur.length > 1) {
      flush();
      sign = 0;
      cur.push([t, v]);
    }
  }
  flush();
  return out;
}
