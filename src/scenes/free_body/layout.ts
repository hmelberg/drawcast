// Deterministic free-body diagram layout. The LLM supplies forces as
// (label, angle, relative magnitude) — angles in degrees, 0 = +x, CCW, y-up
// (gravity = 270). All geometry (body, ground/incline, hatching, arrows,
// angle arc) is computed here.

import {
  COLORS,
  Z_STROKE,
  SKETCH_MS,
  defaultDrawOpts,
  defaultStyle,
  type Drawable,
  type Pt,
} from "../../layout/model";
import type { LabelRequest } from "../../layout/labels";
import type { SceneLayout } from "../types";

export interface ForceSpec {
  id?: string;
  label: string;
  /** Degrees; 0 = +x, counter-clockwise, y-up. Gravity = 270. */
  angle_deg: number;
  /** Relative magnitude 0..1 (arrow length). Default 0.7. */
  magnitude?: number;
  color?: "red" | "blue" | "purple" | "gray";
  dash?: boolean;
}

export interface FreeBodyParams {
  body?: "box" | "ball" | "dot";
  body_label?: string;
  /** If set (degrees, ~10–40), the body sits on an incline rising to the right. */
  incline_deg?: number;
  forces?: ForceSpec[];
  /** Dashed x/y axes through the body. */
  show_axes?: boolean;
  net_force?: { label?: string; angle_deg: number; magnitude?: number };
}

const FORCE_COLORS = {
  red: COLORS.demand,
  blue: COLORS.supply,
  purple: COLORS.accent,
  gray: COLORS.guide,
} as const;

const rad = (deg: number): number => (deg * Math.PI) / 180;

export function layoutFreeBody(params: FreeBodyParams): SceneLayout {
  const drawables: Drawable[] = [];
  const labels: LabelRequest[] = [];
  const anchors: Record<string, Pt> = {};
  const order: string[] = [];
  const push = (d: Drawable) => {
    drawables.push(d);
    order.push(d.id);
  };
  const label = (id: string, anchor: Pt, side: LabelRequest["side"], text: string, color: string = COLORS.ink, fontSize = 28) => {
    labels.push({ id, anchor, side, text, fontSize, style: defaultStyle({ color }), drawOpts: defaultDrawOpts("instant") });
    order.push(id);
  };

  const incline = params.incline_deg !== undefined ? Math.max(8, Math.min(45, params.incline_deg)) : undefined;
  const th = incline !== undefined ? rad(incline) : 0;

  // Ground / incline with hatching, and the body's center.
  let center: Pt;
  const bodyKind = params.body ?? "box";
  const half = bodyKind === "dot" ? 10 : 52;
  if (incline === undefined) {
    const groundY = 235;
    push({
      id: "ground",
      kind: "stroke",
      pts: [
        [140, groundY],
        [860, groundY],
      ],
      z: Z_STROKE,
      style: defaultStyle({ strokeWidth: 4 }),
      drawOpts: defaultDrawOpts("sketch", SKETCH_MS.axis),
    });
    push(hatchGroup("ground_hatch", [140, groundY], [860, groundY], -1));
    center = [500, groundY + half + 4];
  } else {
    // Incline rising to the right: base corner at left.
    const x0 = 170, x1 = 830, baseY = 170;
    const rise = Math.min((x1 - x0) * Math.tan(th), 430);
    const apex: Pt = [x1, baseY + rise];
    push({
      id: "incline",
      kind: "stroke",
      pts: [
        [x0, baseY],
        [x1, baseY],
        apex,
      ],
      closed: true,
      z: Z_STROKE,
      style: defaultStyle({ strokeWidth: 4 }),
      drawOpts: defaultDrawOpts("sketch", SKETCH_MS.axis),
    });
    push(hatchGroup("ground_hatch", [x0, baseY], [x1, baseY], -1));
    // Angle arc + label at the base corner.
    const arcPts: Pt[] = [];
    const slope = Math.atan2(rise, x1 - x0);
    for (let i = 0; i <= 12; i++) {
      const a = (slope * i) / 12;
      arcPts.push([x0 + 95 * Math.cos(a), baseY + 95 * Math.sin(a)]);
    }
    push({
      id: "angle_arc",
      kind: "stroke",
      pts: arcPts,
      z: Z_STROKE,
      style: defaultStyle({ strokeWidth: 2.5, color: COLORS.guide }),
      drawOpts: defaultDrawOpts("sketch", SKETCH_MS.guides),
    });
    label("label_angle", [x0 + 130, baseY + rise * 0.11], "right", `θ = ${incline}°`, COLORS.guide, 26);
    // Body midway up the slope, offset perpendicular to it.
    const mx = (x0 + x1) / 2;
    const my = baseY + (rise * (mx - x0)) / (x1 - x0);
    const nx = -Math.sin(slope), ny = Math.cos(slope);
    center = [mx + nx * (half + 6), my + ny * (half + 6)];
  }

  // Body.
  if (bodyKind === "ball" || bodyKind === "dot") {
    push({
      id: "body",
      kind: "stroke",
      pts: [center],
      shapeHint: { type: "circle", c: center, r: half },
      z: Z_STROKE,
      style: defaultStyle({ strokeWidth: 4 }),
      drawOpts: defaultDrawOpts("sketch", SKETCH_MS.node),
    });
  } else {
    const s = half;
    const rot = incline !== undefined ? Math.atan2(Math.tan(th), 1) : 0;
    const corner = (dx: number, dy: number): Pt => [
      center[0] + dx * Math.cos(rot) - dy * Math.sin(rot),
      center[1] + dx * Math.sin(rot) + dy * Math.cos(rot),
    ];
    push({
      id: "body",
      kind: "stroke",
      pts: [corner(-s, -s), corner(s, -s), corner(s, s), corner(-s, s)],
      closed: true,
      z: Z_STROKE,
      style: defaultStyle({ strokeWidth: 4 }),
      drawOpts: defaultDrawOpts("sketch", SKETCH_MS.node),
    });
  }
  anchors["body"] = center;
  if (params.body_label) label("label_body", center, "below-left", params.body_label);

  // Dashed axes through the body.
  if (params.show_axes) {
    const axes: Drawable[] = [];
    const L = 250;
    axes.push(axisLine("fbd_x", [center[0] - L * 0.7, center[1]], [center[0] + L, center[1]]));
    axes.push(axisLine("fbd_y", [center[0], center[1] - L * 0.7], [center[0], center[1] + L]));
    push({ id: "axes", kind: "group", z: Z_STROKE, style: defaultStyle(), drawOpts: defaultDrawOpts(), children: axes });
    label("label_x_axis", [center[0] + L + 18, center[1]], "right", "x", COLORS.guide, 26);
    label("label_y_axis", [center[0], center[1] + L + 18], "above", "y", COLORS.guide, 26);
  }

  // Forces.
  const forces = params.forces ?? [];
  forces.forEach((f, i) => {
    const id = `force_${f.id ?? i}`;
    const len = 95 + 150 * Math.max(0.15, Math.min(1, f.magnitude ?? 0.7));
    const a = rad(f.angle_deg);
    const from: Pt = [center[0] + Math.cos(a) * (half + 4), center[1] + Math.sin(a) * (half + 4)];
    const to: Pt = [center[0] + Math.cos(a) * (half + 4 + len), center[1] + Math.sin(a) * (half + 4 + len)];
    push({
      id,
      kind: "stroke",
      pts: [from, to],
      arrowhead: "end",
      z: Z_STROKE,
      style: defaultStyle({ strokeWidth: 5, color: f.color ? FORCE_COLORS[f.color] : COLORS.ink, dash: f.dash }),
      drawOpts: defaultDrawOpts("sketch", SKETCH_MS.arrow),
    });
    anchors[id] = to;
    label(`label_${f.id ?? i}`, [center[0] + Math.cos(a) * (half + len + 36), center[1] + Math.sin(a) * (half + len + 36)], sideFor(f.angle_deg), f.label, f.color ? FORCE_COLORS[f.color] : COLORS.ink);
  });

  // Net force (dashed, accent).
  if (params.net_force) {
    const n = params.net_force;
    const len = 95 + 150 * Math.max(0.15, Math.min(1, n.magnitude ?? 0.85));
    const a = rad(n.angle_deg);
    const to: Pt = [center[0] + Math.cos(a) * (half + 4 + len), center[1] + Math.sin(a) * (half + 4 + len)];
    push({
      id: "net_force",
      kind: "stroke",
      pts: [[center[0] + Math.cos(a) * (half + 4), center[1] + Math.sin(a) * (half + 4)], to],
      arrowhead: "end",
      z: Z_STROKE,
      style: defaultStyle({ strokeWidth: 5, color: COLORS.accent, dash: true }),
      drawOpts: defaultDrawOpts("sketch", SKETCH_MS.arrow),
    });
    anchors["net_force"] = to;
    label("label_net", [to[0] + Math.cos(a) * 40, to[1] + Math.sin(a) * 40], sideFor(n.angle_deg), n.label ?? "F_net", COLORS.accent);
  }

  return { drawables, labels, anchors, order };
}

function sideFor(angleDeg: number): LabelRequest["side"] {
  const a = ((angleDeg % 360) + 360) % 360;
  if (a < 45 || a >= 315) return "right";
  if (a < 135) return "above";
  if (a < 225) return "left";
  return "below";
}

function axisLine(id: string, from: Pt, to: Pt): Drawable {
  return {
    id,
    kind: "stroke",
    pts: [from, to],
    arrowhead: "end",
    z: Z_STROKE,
    style: defaultStyle({ strokeWidth: 2.5, color: COLORS.guide, dash: true }),
    drawOpts: defaultDrawOpts("sketch", SKETCH_MS.guides),
  };
}

/** Short hatch ticks under a ground line (dir = -1 hatches below). */
function hatchGroup(id: string, from: Pt, to: Pt, dir: 1 | -1): Drawable {
  const children: Drawable[] = [];
  const n = 18;
  for (let i = 1; i < n; i++) {
    const t = i / n;
    const x = from[0] + (to[0] - from[0]) * t;
    const y = from[1] + (to[1] - from[1]) * t;
    children.push({
      id: `${id}_${i}`,
      kind: "stroke",
      pts: [
        [x, y],
        [x - 14, y + 20 * dir],
      ],
      z: Z_STROKE,
      style: defaultStyle({ strokeWidth: 2, color: COLORS.guide }),
      drawOpts: defaultDrawOpts("instant"),
    });
  }
  return { id, kind: "group", z: Z_STROKE, style: defaultStyle(), drawOpts: defaultDrawOpts(), children };
}
