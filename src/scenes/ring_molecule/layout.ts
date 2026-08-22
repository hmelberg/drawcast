// Deterministic ring-molecule layout (skeletal chemistry notation): a 5- or
// 6-ring with optional heteroatoms, alternating aromatic double bonds, and
// outward substituents. Bonds trim at labeled atoms; atom symbols are
// exact-position text (never collision-moved).

import {
  COLORS,
  Z_STROKE,
  Z_TEXT,
  SKETCH_MS,
  defaultDrawOpts,
  defaultStyle,
  type Drawable,
  type Pt,
} from "../../layout/model";
import type { LabelRequest } from "../../layout/labels";
import type { SceneLayout } from "../types";

export interface RingMoleculeParams {
  /** 5 or 6 (default 6). */
  ring_size?: number;
  /** Per-vertex atom symbol, index 0 at the top, clockwise not required — "C", null or omitted = skeletal carbon (no label). */
  atoms?: (string | null)[];
  /** Alternating inner double bonds (aromatic ring). */
  aromatic?: boolean;
  substituents?: { position: number; text: string }[];
  /** Caption under the figure. */
  name?: string;
}

const CX = 500, CY = 400, R = 170;
const ATOM_GAP = 26;

export function layoutRingMolecule(params: RingMoleculeParams): SceneLayout {
  const n = params.ring_size === 5 ? 5 : 6;
  const atomAt = (i: number): string | null => {
    const a = params.atoms?.[((i % n) + n) % n];
    return a && a !== "C" ? a : null;
  };
  const vertex = (i: number): Pt => {
    const th = Math.PI / 2 + (i * 2 * Math.PI) / n;
    return [CX + R * Math.cos(th), CY + R * Math.sin(th)];
  };

  const drawables: Drawable[] = [];
  const labels: LabelRequest[] = [];
  const anchors: Record<string, Pt> = { ring_center: [CX, CY] };
  const order: string[] = [];

  // Ring bonds, trimmed where an atom symbol occupies a vertex.
  const bonds: Drawable[] = [];
  for (let i = 0; i < n; i++) {
    const a = vertex(i), b = vertex((i + 1) % n);
    const d = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const u: Pt = [(b[0] - a[0]) / d, (b[1] - a[1]) / d];
    const tA = atomAt(i) ? ATOM_GAP : 0;
    const tB = atomAt(i + 1) ? ATOM_GAP : 0;
    bonds.push({
      id: `bond_${i}`,
      kind: "stroke",
      pts: [
        [a[0] + u[0] * tA, a[1] + u[1] * tA],
        [b[0] - u[0] * tB, b[1] - u[1] * tB],
      ],
      z: Z_STROKE,
      style: defaultStyle({ strokeWidth: 4 }),
      drawOpts: defaultDrawOpts("sketch", SKETCH_MS.connector),
    });
  }
  drawables.push({ id: "ring", kind: "group", z: Z_STROKE, style: defaultStyle(), drawOpts: defaultDrawOpts(), children: bonds });
  order.push("ring");

  if (params.aromatic) {
    const inner: Drawable[] = [];
    for (let i = 0; i < n - (n % 2); i += 2) {
      const a = vertex(i), b = vertex((i + 1) % n);
      const shrink = 0.18;
      const toC = (p: Pt): Pt => [p[0] + (CX - p[0]) * 0.13, p[1] + (CY - p[1]) * 0.13];
      inner.push({
        id: `dbond_${i}`,
        kind: "stroke",
        pts: [
          toC([a[0] + (b[0] - a[0]) * shrink, a[1] + (b[1] - a[1]) * shrink]),
          toC([b[0] - (b[0] - a[0]) * shrink, b[1] - (b[1] - a[1]) * shrink]),
        ],
        z: Z_STROKE,
        style: defaultStyle({ strokeWidth: 3.5 }),
        drawOpts: defaultDrawOpts("sketch", SKETCH_MS.connector),
      });
    }
    drawables.push({ id: "double_bonds", kind: "group", z: Z_STROKE, style: defaultStyle(), drawOpts: defaultDrawOpts(), children: inner });
    order.push("double_bonds");
  }

  // Heteroatom symbols: exact-position text at their vertex.
  for (let i = 0; i < n; i++) {
    const sym = atomAt(i);
    if (!sym) continue;
    const id = `atom_${i}`;
    drawables.push({
      id,
      kind: "text",
      pos: vertex(i),
      text: sym,
      fontSize: 30,
      anchor: "middle",
      z: Z_TEXT,
      style: defaultStyle({ color: COLORS.demand }),
      drawOpts: defaultDrawOpts("instant"),
    });
    anchors[id] = vertex(i);
    order.push(id);
  }

  // Substituents: outward spur + exact text at its end.
  for (const sub of params.substituents ?? []) {
    const pos = ((sub.position % n) + n) % n;
    const v = vertex(pos);
    const th = Math.PI / 2 + (pos * 2 * Math.PI) / n;
    const u: Pt = [Math.cos(th), Math.sin(th)];
    const t0 = atomAt(pos) ? ATOM_GAP : 0;
    const id = `sub_${pos}`;
    drawables.push({
      id: `${id}_body`,
      kind: "stroke",
      pts: [
        [v[0] + u[0] * t0, v[1] + u[1] * t0],
        [v[0] + u[0] * 58, v[1] + u[1] * 58],
      ],
      z: Z_STROKE,
      style: defaultStyle({ strokeWidth: 4 }),
      drawOpts: defaultDrawOpts("sketch", SKETCH_MS.connector),
    });
    drawables.push({
      id,
      kind: "text",
      pos: [v[0] + u[0] * 88, v[1] + u[1] * 88],
      text: sub.text,
      fontSize: 28,
      anchor: "middle",
      z: Z_TEXT,
      style: defaultStyle({ color: COLORS.supply }),
      drawOpts: defaultDrawOpts("instant"),
    });
    anchors[id] = [v[0] + u[0] * 88, v[1] + u[1] * 88];
    order.push(id);
  }

  if (params.name) {
    labels.push({
      id: "molecule_name",
      anchor: [CX, CY - R - 78],
      side: "below",
      text: params.name,
      fontSize: 30,
      style: defaultStyle(),
      drawOpts: defaultDrawOpts("instant"),
    });
    order.push("molecule_name");
  }

  return { drawables, labels, anchors, order };
}
