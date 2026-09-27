// refraction: a ray of light meeting the boundary between two media — the
// normal, the incident ray from its source, the refracted ray bent by
// Snell's law, the partly reflected ray (as strong as Fresnel says), the
// angles θ₁ and θ₂ with their values, and past the critical angle total
// internal reflection. Options: the law written with its numbers, the
// wavefronts (closer together where light is slower), where the source
// APPEARS to an eye looking back along the refracted ray (the bent straw),
// and a slab that sends the ray out parallel, shifted sideways.
//
// Every number is live: the layout re-runs on each animate frame and each
// widget patch, and `values` carries them for {refraction.<key>} tokens.
import { segmentIntersectsBox, type BBox } from "../../layout/geometry";
import { heuristicMeasure } from "../../layout/measure";
import { COLORS, SKETCH_MS, type Drawable, type Pt } from "../../layout/model";
import { kit } from "../kit";
import type { SceneLayout } from "../types";
import { add, apparentPoint, dirDown, dirUp, extents, readModel, scale, slabShift, type Model, type RefractionParams } from "./model";

export type { RefractionParams } from "./model";

export const RAY_COLOR = COLORS.demand;
const MEDIUM_FILL = "#7fb2d0";
const LABEL_FONT = 26;
const ANGLE_FONT = 26;
const ARC_R = 58;

/** A medium's wash: denser media look deeper. */
export function mediumOpacity(n: number): number {
  return Math.max(0.06, Math.min(0.5, 0.06 + ((n - 1) / 1.5) * 0.5));
}

/** An angle written for the canvas: whole degrees when it is one, else one decimal. */
export function fmtDeg(a: number): string {
  const r = Math.round(a * 10) / 10;
  return `${kit.num(Number.isInteger(r) ? r : Number(r.toFixed(1)))}°`;
}
/** An index written with two decimals (1.00, 1.33). */
export const fmtN = (n: number): string => kit.num(Number(n.toFixed(2)), 2);

/** A text's box at its centre, by the lint's own measure. */
function textBox(pos: Pt, s: string, fontSize: number): BBox {
  const { w, h } = heuristicMeasure(s, fontSize);
  return { x: pos[0] - w / 2, y: pos[1] - h / 2, w, h };
}

/** The page a word must stay on (the figure's band, clear of the edges). */
const PAGE = { x0: 20, y0: 150, x1: 980, y1: 680 };

/**
 * The first candidate centre whose text box crosses none of the segments,
 * none of the boxes taken and stays on the page; failing all of them, the
 * nearest clear spot on widening rings round the first.
 */
function placeClear(cands: Pt[], s: string, fontSize: number, segs: [Pt, Pt][], taken: BBox[]): Pt {
  const pad = 4;
  const clear = (c: Pt): boolean => {
    const b = textBox(c, s, fontSize);
    const bb = { x: b.x - pad, y: b.y - pad, w: b.w + 2 * pad, h: b.h + 2 * pad };
    if (bb.x < PAGE.x0 || bb.x + bb.w > PAGE.x1 || bb.y < PAGE.y0 || bb.y + bb.h > PAGE.y1) return false;
    if (segs.some(([a, z]) => segmentIntersectsBox(a, z, bb))) return false;
    return !taken.some((t) => t.x < bb.x + bb.w && bb.x < t.x + t.w && t.y < bb.y + bb.h && bb.y < t.y + t.h);
  };
  for (const c of cands) if (clear(c)) return c;
  const [cx, cy] = cands[0];
  for (let r = 20; r <= 260; r += 12)
    for (let k = 0; k < 16; k++) {
      const a = (k * Math.PI) / 8;
      const c: Pt = [cx + r * Math.cos(a), cy + r * Math.sin(a)];
      if (clear(c)) return c;
    }
  return cands[0];
}

/** Candidate centres in two wedges (canonical angle ranges, radians from +x), nearest first, the first wedge first at each radius. */
function wedgeCands(m: Model, wedges: [number, number][]): Pt[] {
  const out: Pt[] = [];
  for (const r of [92, 108, 124, 140, 158, 176, 195])
    for (const [a0, a1] of wedges)
      for (const t of [0.5, 0.35, 0.65, 0.2, 0.8]) {
        const a = a0 + t * (a1 - a0);
        out.push(m.world([Math.cos(a) * r, Math.sin(a) * r]));
      }
  return out;
}

export function layoutRefraction(P: RefractionParams): SceneLayout {
  const m = readModel(P);
  const ext = extents(m);
  const drawables: Drawable[] = [];
  const order: string[] = [];
  const anchors: Record<string, Pt> = {};
  const attached: Record<string, string[]> = {};
  const groups: Record<string, string[]> = { rays: [], angles: [], media: [] };
  const values: Record<string, number> = {};
  const push = (d: Drawable, anchor?: Pt, group?: string): void => {
    drawables.push(d);
    order.push(d.id);
    if (anchor) anchors[d.id] = anchor;
    if (group) groups[group].push(d.id);
  };
  const attach = (to: string, id: string): void => {
    attached[to] = [...(attached[to] ?? []), id];
  };
  /** Segments no text may cross (the page's lines, as they are drawn). */
  const segs: [Pt, Pt][] = [];
  const taken: BBox[] = [];
  const W = m.world;
  const O = m.O;
  const showAngles = P.show_angles !== false;

  // ---- the media and the boundary -------------------------------------------
  const x0 = 70,
    x1 = 930;
  const yAt = (cy: number): number => W([0, cy])[1];
  const band = (id: string, cyA: number, cyB: number, n: number): void => {
    const ya = yAt(cyA),
      yb = yAt(cyB);
    // A flat wash (no hachure): the medium is a tint, not a region to count.
    push(kit.area(id, [[x0, ya], [x1, ya], [x1, yb], [x0, yb]], MEDIUM_FILL, { opacity: mediumOpacity(n), precise: true }), [(x0 + x1) / 2, (ya + yb) / 2], "media");
  };
  band("medium1", 0, ext.up, m.n1);
  band("medium2", 0, m.slab ? -ext.slabDown : -ext.down, m.n2);
  if (m.slab) band("medium3", -ext.slabDown, -ext.down, m.n1);
  const boundary: [Pt, Pt] = [[x0, O[1]], [x1, O[1]]];
  push(kit.stroke("boundary", boundary, { strokeWidth: 3.5, ms: SKETCH_MS.axis }), O);
  segs.push(boundary);
  let P2: Pt | null = null; // the slab's exit point, canonical
  if (m.slab) {
    const y2 = yAt(-ext.slabDown);
    const b2: [Pt, Pt] = [[x0, y2], [x1, y2]];
    push(kit.stroke("boundary2", b2, { strokeWidth: 3.5, ms: SKETCH_MS.axis }), [O[0], y2]);
    segs.push(b2);
  }

  // The normal, dashed, through the hit point.
  const nUp = Math.min(ext.up, 230) - 10;
  const nDown = Math.min(m.slab ? ext.slabDown + 40 : ext.down, 230) - 10;
  const normal: [Pt, Pt] = [W([0, nUp]), W([0, -nDown])];
  push(kit.stroke("normal", normal, { dash: true, color: COLORS.guide, strokeWidth: 2.5, ms: SKETCH_MS.guides }), O);
  segs.push(normal);

  // ---- the medium labels, left, either side of the boundary ----------------
  const mediumLabel = (id: string, nid: string, name: string | null, n: number, cy: number, owner: string): void => {
    let x = x0 + 14;
    const y = yAt(cy);
    if (name) {
      const t = kit.text(id, [x, y], name, { fontSize: LABEL_FONT, anchor: "start" });
      push(t, [x, y], "media");
      attach(owner, id);
      const w = heuristicMeasure(name, LABEL_FONT).w;
      taken.push(textBox([x + w / 2, y], name, LABEL_FONT));
      x += w + 18;
    }
    if (nid) {
      const s = `n = ${fmtN(n)}`;
      push(kit.text(nid, [x, y], s, { fontSize: LABEL_FONT, anchor: "start", color: COLORS.supply }), [x, y], "media");
      attach(owner, nid);
      taken.push(textBox([x + heuristicMeasure(s, LABEL_FONT).w / 2, y], s, LABEL_FONT));
    }
  };
  mediumLabel("medium1_name", "n1_label", m.name1, m.n1, 44, "medium1");
  mediumLabel("medium2_name", "n2_label", m.name2, m.n2, -44, "medium2");
  if (m.slab) mediumLabel("medium3_name", "", m.name1, m.n1, -ext.slabDown - 44, "medium3");

  // ---- the strokes: every line is down before any word looks for room -------------
  const inDir: Pt = [-Math.sin((m.theta1 * Math.PI) / 180), Math.cos((m.theta1 * Math.PI) / 180)]; // O → source
  const Sc = scale(inDir, m.R);
  const S = W(Sc);
  // The source: a small lamp the viewer takes hold of.
  push(kit.area("source", kit.circle(S, 11, 20), RAY_COLOR, { precise: true, ms: SKETCH_MS.node }), S);
  taken.push({ x: S[0] - 14, y: S[1] - 14, w: 28, h: 28 });
  // The incident ray, its arrow halfway along.
  const Mid = W(scale(inDir, m.R * 0.5));
  push(
    {
      id: "incident_ray",
      kind: "group",
      z: 1,
      style: kit.stroke("_", []).style,
      drawOpts: kit.stroke("_", [], { ms: SKETCH_MS.arrow }).drawOpts,
      children: [
        kit.stroke("incident_ray__a", [S, Mid], { arrowhead: "end", color: RAY_COLOR, strokeWidth: 4.5, ms: SKETCH_MS.arrow / 2 }),
        kit.stroke("incident_ray__b", [Mid, O], { color: RAY_COLOR, strokeWidth: 4.5, ms: SKETCH_MS.arrow / 2 }),
      ],
    },
    Mid,
    "rays",
  );
  segs.push([S, O]);
  attach("incident_ray", "source");

  // The reflected ray: as strong as the reflectance.
  const R = m.reflect;
  if (P.show_reflection !== false || m.tir) {
    const E = W(scale(dirUp(m.theta1), m.R));
    push(kit.stroke("reflected_ray", [O, E], { arrowhead: "end", color: RAY_COLOR, strokeWidth: m.tir ? 4.5 : 3, opacity: m.tir ? 1 : Math.min(1, 0.3 + 0.7 * Math.sqrt(R)), ms: SKETCH_MS.arrow }), E, "rays");
    segs.push([O, E]);
  }

  // The refracted ray (and through a slab, the ray out of it).
  let refrEnd: Pt | null = null; // canonical
  let finalDir: Pt | null = null; // canonical direction of the ray the eye sees
  if (m.theta2 !== null) {
    const d2 = dirDown(m.theta2);
    let len = m.R;
    if (m.slab) {
      const t = ext.slabDown / Math.max(1e-6, Math.cos((m.theta2 * Math.PI) / 180));
      const hit = scale(d2, t);
      if (hit[0] <= ext.rightX - 20) {
        P2 = hit;
        len = t;
      } else len = Math.min(t, (ext.rightX - 20) / Math.max(1e-6, d2[0]));
    } else {
      // Keep a grazing ray on the page, and an eye at its end inside the band.
      len = Math.min(len, (ext.rightX - 30) / Math.max(1e-6, d2[0]));
      if (P.eye === true) len = Math.min(len, (ext.down - 62) / Math.max(1e-6, -d2[1]));
    }
    refrEnd = scale(d2, len);
    finalDir = d2;
    const E = W(refrEnd);
    push(kit.stroke("refracted_ray", [O, E], { arrowhead: P2 ? undefined : "end", color: RAY_COLOR, strokeWidth: 4.5, opacity: Math.min(1, 0.3 + 0.7 * (1 - R)), ms: SKETCH_MS.arrow }), E, "rays");
    segs.push([O, E]);
  }
  let shiftAt: { mid: Pt; along: Pt } | null = null;
  if (P2 && m.theta2 !== null) {
    const W2 = W(P2);
    const n2line: [Pt, Pt] = [W(add(P2, [0, 40])), W(add(P2, [0, -Math.min(90, ext.down - ext.slabDown - 10)]))];
    push(kit.stroke("normal2", n2line, { dash: true, color: COLORS.guide, strokeWidth: 2.5, ms: SKETCH_MS.guides }), W2);
    segs.push(n2line);
    const d3 = dirDown(m.theta1);
    const room = ext.down - ext.slabDown - 12;
    let len3 = Math.min(m.R, room / Math.max(1e-6, -d3[1]));
    len3 = Math.max(20, Math.min(len3, (ext.rightX - 20 - P2[0]) / Math.max(1e-6, d3[0])));
    const E3c = add(P2, scale(d3, len3));
    refrEnd = E3c;
    finalDir = d3;
    const E3 = W(E3c);
    push(kit.stroke("exit_ray", [W2, E3], { arrowhead: "end", color: RAY_COLOR, strokeWidth: 4.5, ms: SKETCH_MS.arrow }), E3, "rays");
    segs.push([W2, E3]);
    // The incident ray carried straight on, and the sideways shift between them.
    // As far as the page allows, below and beside.
    const want = ext.slabDown / Math.cos((m.theta1 * Math.PI) / 180) + len3 * 0.8;
    const lenX = Math.min(want, (ext.rightX - 20) / Math.max(1e-6, -inDir[0]), (ext.down - 10) / Math.max(1e-6, inDir[1]));
    const ext0 = W(scale([-inDir[0], -inDir[1]], lenX));
    push(kit.stroke("incident_extension", [O, ext0], { dash: true, color: COLORS.guide, strokeWidth: 2.5, ms: SKETCH_MS.guides }), ext0);
    segs.push([O, ext0]);
    const shift = slabShift(m.theta1, m.theta2);
    values.shift = Math.round(shift * 1000) / 1000;
    if (shift * ext.slabDown > 14) {
      // The perpendicular from a point on the exit ray to the extension.
      const q = add(P2, scale(d3, len3 * 0.55));
      const perp: Pt = [d3[1], -d3[0]];
      const pOn = add(q, scale(perp, -shift * ext.slabDown));
      const a = W(q),
        b = W(pOn);
      push(kit.stroke("shift_arrow", [a, b], { arrowhead: "both", color: COLORS.accent, strokeWidth: 2.5, ms: SKETCH_MS.arrow }), [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]);
      segs.push([a, b]);
      shiftAt = { mid: add(q, scale(perp, (-shift * ext.slabDown) / 2)), along: d3 };
    }
  }

  // The angles' arcs.
  const aIn = Math.PI / 2 + (m.theta1 * Math.PI) / 180; // canonical: the up-normal is π/2
  const aOut = m.theta2 === null ? null : -Math.PI / 2 + (m.theta2 * Math.PI) / 180;
  if (showAngles) {
    const arc = (a0: number, a1: number): Pt[] => kit.arc([0, 0], ARC_R, a0, a1, 16).map((p) => W(p));
    if (m.theta1 > 0.5) push(kit.stroke("theta1_arc", arc(Math.PI / 2, aIn), { color: COLORS.ink, strokeWidth: 2.5, ms: SKETCH_MS.guides }), W([Math.cos((Math.PI / 2 + aIn) / 2) * ARC_R, Math.sin((Math.PI / 2 + aIn) / 2) * ARC_R]), "angles");
    if (aOut !== null && m.theta2! > 0.5) push(kit.stroke("theta2_arc", arc(-Math.PI / 2, aOut), { color: COLORS.ink, strokeWidth: 2.5, ms: SKETCH_MS.guides }), W([Math.cos((-Math.PI / 2 + aOut) / 2) * ARC_R, Math.sin((-Math.PI / 2 + aOut) / 2) * ARC_R]), "angles");
  }

  // Where the source appears (the bent straw), and the eye.
  let image: { I: Pt; Iw: Pt } | null = null;
  if (P.apparent === true && m.theta2 !== null) {
    const I = apparentPoint(m)!;
    const Iw = W(I);
    push(kit.stroke("apparent_ray", [O, Iw], { dash: true, color: RAY_COLOR, strokeWidth: 2.5, opacity: 0.8, ms: SKETCH_MS.guides }), Iw);
    segs.push([O, Iw]);
    push(kit.stroke("image", kit.circle(Iw, 10, 18), { closed: true, color: RAY_COLOR, strokeWidth: 2.5, dash: true, ms: SKETCH_MS.node }), Iw);
    taken.push({ x: Iw[0] - 12, y: Iw[1] - 12, w: 24, h: 24 });
    image = { I, Iw };
    values.depth_ratio = Math.round((I[1] / Math.max(1e-9, Sc[1])) * 1000) / 1000;
  }
  if (P.eye === true && refrEnd && finalDir) {
    const at = add(refrEnd, scale(finalDir, 34));
    push(eyeDrawable("eye", at, [-finalDir[0], -finalDir[1]], m), W(at));
    const e = W(at);
    taken.push({ x: e[0] - 26, y: e[1] - 26, w: 52, h: 52 });
  }

  // The critical angle.
  let critDir: Pt | null = null;
  if (m.critical !== null && P.show_critical !== false) {
    critDir = [-Math.sin((m.critical * Math.PI) / 180), Math.cos((m.critical * Math.PI) / 180)];
    const Ec = W(scale(critDir, m.R * 0.9));
    push(kit.stroke("critical_line", [O, Ec], { dash: true, color: COLORS.accent, strokeWidth: 2.5, ms: SKETCH_MS.guides }), Ec);
    segs.push([O, Ec]);
  }

  // Snell's law, at a fixed place: on the source's side, in medium 2's lower corner (it is free there).
  if (P.show_law === true) {
    const law = "n₁ sin θ₁ = n₂ sin θ₂";
    const sinT2 = (m.n1 / m.n2) * Math.sin((m.theta1 * Math.PI) / 180);
    const nums = m.theta2 !== null ? `${fmtN(m.n1)} · sin ${fmtDeg(m.theta1)} = ${fmtN(m.n2)} · sin ${fmtDeg(m.theta2)}` : `sin θ₂ = ${kit.num(Number(sinT2.toFixed(2)), 2)} > 1`;
    const cy = m.slab ? -ext.down + 60 : -ext.down + 70;
    const xs = m.sx > 0 ? x0 + 14 : x1 - 14;
    const anchor = m.sx > 0 ? "start" : "end";
    const lawPos: Pt = [xs, yAt(cy)];
    const numPos: Pt = [xs, yAt(cy - 36)];
    push(kit.text("law", lawPos, law, { fontSize: 26, anchor }), lawPos);
    push(kit.text("law_numbers", numPos, nums, { fontSize: 24, anchor, color: COLORS.supply }), numPos);
    attach("law", "law_numbers");
    for (const [s, pos, f] of [[law, lawPos, 26], [nums, numPos, 24]] as const) {
      const w = heuristicMeasure(s, f).w;
      taken.push(textBox([anchor === "start" ? pos[0] + w / 2 : pos[0] - w / 2, pos[1]], s, f));
    }
  }

  // Wavefronts: crests across each ray, λ/n apart.
  if (P.wavefronts === true) {
    const kids: Drawable[] = [];
    const crests = (from: Pt, to: Pt, n: number, tag: string): void => {
      const L = Math.hypot(to[0] - from[0], to[1] - from[1]);
      if (L < 1) return;
      const u: Pt = [(to[0] - from[0]) / L, (to[1] - from[1]) / L];
      const v: Pt = [-u[1], u[0]];
      const lam = 40 / n;
      let k = 0;
      for (let s = lam; s < L - 12; s += lam, k++) {
        const c = add(from, scale(u, s));
        const tick: [Pt, Pt] = [add(c, scale(v, -14)), add(c, scale(v, 14))];
        kids.push(kit.stroke(`wavefronts__${tag}${k}`, tick, { color: COLORS.guide, strokeWidth: 2, ms: 60 }));
        segs.push(tick);
      }
    };
    crests(S, O, m.n1, "i");
    if (m.theta2 !== null && refrEnd) {
      crests(O, P2 ? W(P2) : W(refrEnd), m.n2, "r");
      if (P2) crests(W(P2), W(refrEnd), m.n1, "x");
    }
    if (kids.length > 0) push({ id: "wavefronts", kind: "group", z: 1, style: kids[0].style, drawOpts: kit.stroke("_", [], { ms: SKETCH_MS.guides }).drawOpts, children: kids }, O);
  }

  // ---- the words, each where no line crosses it ---------------------------------------
  const word = (id: string, s: string, font: number, cands: Pt[], color?: string, owner?: string, group?: string): void => {
    const pos = placeClear(cands, s, font, segs, taken);
    push(kit.text(id, pos, s, { fontSize: font, ...(color ? { color } : {}) }), pos, group);
    if (owner) attach(owner, id);
    taken.push(textBox(pos, s, font));
  };
  if (showAngles) {
    // Inside the angle, or between the ray and the boundary — whichever holds it nearer.
    word("theta1_label", `θ₁ = ${fmtDeg(m.theta1)}`, ANGLE_FONT, wedgeCands(m, [[Math.PI / 2, aIn], [aIn, Math.PI]]), undefined, m.theta1 > 0.5 ? "theta1_arc" : undefined, "angles");
    if (aOut !== null)
      word("theta2_label", `θ₂ = ${fmtDeg(m.theta2!)}`, ANGLE_FONT, [...wedgeCands(m, [[-Math.PI / 2, aOut], [aOut, 0]]), ...wedgeCands(m, [[-Math.PI / 2 - 0.9, -Math.PI / 2 - 0.2]])], undefined, m.theta2! > 0.5 ? "theta2_arc" : undefined, "angles");
  }
  if (typeof P.source_label === "string" && P.source_label.trim()) {
    const s = P.source_label.trim();
    const w = heuristicMeasure(s, LABEL_FONT).w;
    const out = W(scale(inDir, m.R + 26));
    const side = Math.sign(out[0] - O[0]) || -1;
    const up = Math.sign(S[1] - O[1]) || 1;
    word("source_label", s, LABEL_FONT, [[S[0] + side * (w / 2 + 22), S[1]], [out[0], out[1] + 30 * up], [S[0], S[1] + 34 * up], [S[0] - side * (w / 2 + 22), S[1]], [S[0], S[1] - 34 * up]], undefined, "source");
  }
  if (image) {
    const { Iw } = image;
    const s = typeof P.image_label === "string" && P.image_label.trim() ? P.image_label.trim() : kit.say({ en: "appears here", nb: "ser ut til å være her" });
    const w = heuristicMeasure(s, 24).w;
    const away = Math.sign(Iw[0] - O[0]) || -1;
    const v = m.sy > 0 ? 1 : -1;
    word("image_label", s, 24, [[Iw[0] + away * (w / 2 + 20), Iw[1]], [Iw[0], Iw[1] + 30 * v], [Iw[0], Iw[1] - 30 * v], [Iw[0] - away * (w / 2 + 20), Iw[1]], [Iw[0] + away * (w / 2 + 20), Iw[1] + 30 * v]], RAY_COLOR, "image");
  }
  if (critDir) {
    const s = `θc = ${fmtDeg(m.critical!)}`;
    const w = heuristicMeasure(s, 24).w;
    const base = scale(critDir, m.R * 0.9 + 22);
    const cands: Pt[] = [add(base, [-w / 2, 12]), add(base, [0, 26]), add(base, [-w / 2 - 20, -22])];
    for (const k of [0.62, 0.75, 0.5]) cands.push(add(scale(critDir, m.R * k), [-w / 2 - 16, 0]), add(scale(critDir, m.R * k), [w / 2 + 16, 0]));
    word("critical_label", s, 24, cands.map(W), COLORS.accent, "critical_line");
  }
  if (m.tir) {
    const s = kit.say({ en: "Total internal reflection", nb: "Totalrefleksjon" });
    const w = heuristicMeasure(s, 26).w;
    word("tir_label", s, 26, [W([w / 2 + 40, -70]), W([w / 2 + 40, -120]), W([-(w / 2 + 40), -70]), W([w / 2 + 40, -170])], RAY_COLOR);
  }
  if (shiftAt) {
    const { mid, along } = shiftAt;
    const s = kit.say({ en: "shift", nb: "forskyvning" });
    word("shift_label", s, 24, [add(mid, scale(along, 40)), add(mid, scale(along, -40)), add(mid, scale(along, 70)), add(mid, [60, -30]), add(mid, scale(along, -70))].map(W), COLORS.accent, "shift_arrow");
  }

  if (typeof P.title === "string" && P.title.trim()) {
    const pos: Pt = [500, 700];
    push(kit.text("title", pos, P.title.trim(), { fontSize: 32 }), pos);
  }

  // ---- the numbers ------------------------------------------------------------------------
  const r1 = (v: number): number => Math.round(v * 10) / 10;
  values.theta1 = r1(m.theta1);
  if (m.theta2 !== null) values.theta2 = r1(m.theta2);
  if (m.critical !== null) values.critical = r1(m.critical);
  values.n1 = Math.round(m.n1 * 100) / 100;
  values.n2 = Math.round(m.n2 * 100) / 100;
  values.reflected = r1(R * 100);
  values.transmitted = r1((1 - R) * 100);
  values.v1 = Math.round((1 / m.n1) * 1000) / 1000;
  values.v2 = Math.round((1 / m.n2) * 1000) / 1000;
  values.tir = m.tir ? 1 : 0;

  for (const k of Object.keys(groups)) if (groups[k].length === 0) delete groups[k];
  return { drawables, labels: [], anchors, order, attached, groups, values, frame: { x: [0, 1000], y: [0, 750], box: { x0: 0, y0: 0, x1: 1000, y1: 750 } } };
}

/** An eye looking along `look` (canonical unit vector) from `at` (canonical). */
function eyeDrawable(id: string, at: Pt, look: Pt, m: Model): Drawable {
  const W = m.world;
  const u = look;
  const v: Pt = [-u[1], u[0]];
  const pt = (a: number, b: number): Pt => W(add(at, add(scale(u, a), scale(v, b))));
  // An almond across the line of sight, its lids bulging toward and away from it.
  const lid = (sgn: number): Pt[] => {
    const out: Pt[] = [];
    for (let i = 0; i <= 12; i++) {
      const t = -1 + (2 * i) / 12;
      out.push(pt(sgn * 11 * (1 - t * t), t * 22));
    }
    return out;
  };
  const pupil = kit.circle(pt(3, 0), 6, 12);
  return {
    id,
    kind: "group",
    z: 1,
    style: kit.stroke("_", []).style,
    drawOpts: kit.stroke("_", [], { ms: SKETCH_MS.node }).drawOpts,
    children: [
      kit.stroke(`${id}__upper`, lid(1), { strokeWidth: 3 }),
      kit.stroke(`${id}__lower`, lid(-1), { strokeWidth: 3 }),
      kit.stroke(`${id}__pupil`, pupil, { closed: true, fill: COLORS.ink, strokeWidth: 2 }),
    ],
  };
}
