// The 3D body: pure rules the anatomy branch of openModel3d relies on. No DOM,
// no 3dmol — node tests cover everything here. The mesh pack in
// public/anatomy3d/ is written by scripts/build-anatomy-meshes.mjs; the wire
// format lives in scripts/anatomy/mesh.mjs (encodeMesh) and here (decodeMesh).

import type { AtlasPart, AtlasSystem } from "../scenes/anatomy/types";

export interface PackMesh {
  positions: Float32Array;
  indices: Uint16Array | Uint32Array;
  triangles: number;
}

// ---------- which parts, from the figure's params ----------

export interface Anatomy3dInput {
  systems: AtlasSystem[];
  detail: 1 | 2 | 3;
  layer: "superficial" | "deep";
  focus: string[];
  outline: "skin" | "line" | "none";
  sex: "neutral" | "female" | "male";
  names: "en" | "nb" | "la";
}

/** The template's own defaults, read the way its layout reads params. */
export function anatomyInputFrom(params: Record<string, unknown>): Anatomy3dInput {
  const systems = Array.isArray(params.systems) ? (params.systems.filter((s) => s === "skeleton" || s === "viscera") as AtlasSystem[]) : [];
  const d = params.detail;
  const detail = d === 1 || d === 2 || d === 3 ? d : 2;
  return {
    systems: systems.length > 0 ? systems : ["viscera"],
    detail,
    layer: params.layer === "deep" ? "deep" : "superficial",
    focus: Array.isArray(params.focus) ? params.focus.filter((f): f is string => typeof f === "string") : [],
    outline: params.outline === "line" || params.outline === "none" ? params.outline : "skin",
    sex: params.sex === "female" || params.sex === "male" ? params.sex : "neutral",
    names: params.names === "nb" || params.names === "la" ? params.names : "en",
  };
}

const SYSTEM_ORDER: Record<AtlasSystem, number> = { skeleton: 0, viscera: 1 };

/** The parts the figure draws, by the template's leaf rule (anatomy.yaml
 *  `leaves`): a part with geometry whose detail ≤ the level and none of whose
 *  geometry-bearing children's is; focused parts at level 3 and only they and
 *  their descendants; `layer: deep` lifts the superficial-tagged organs away.
 *  Same order as the template — skeleton first, then by depth. The skin comes
 *  last, when the figure has an outline and is not focused. The one thing not
 *  mirrored is the point-budget fallback, which no shipped figure trips. */
export function visibleParts(all: Record<string, AtlasPart>, q: Anatomy3dInput): string[] {
  const children: Record<string, string[]> = {};
  for (const [id, p] of Object.entries(all)) if (p.parent) (children[p.parent] ??= []).push(id);
  const byName: Record<string, string> = {};
  for (const [id, p] of Object.entries(all)) {
    byName[id.toLowerCase()] = id;
    for (const key of ["en", "nb", "la"] as const) if (p.name[key]) byName[String(p.name[key]).toLowerCase()] = id;
  }
  const focusIds = new Set<string>();
  for (const f of q.focus) {
    const root = byName[f.trim().toLowerCase()];
    if (!root) continue;
    const stack = [root];
    while (stack.length > 0) {
      const id = stack.pop()!;
      if (focusIds.has(id)) continue;
      focusIds.add(id);
      stack.push(...(children[id] ?? []));
    }
  }
  const focusing = focusIds.size > 0;
  const hasGeo = (id: string) => all[id].rings.length > 0 && all[id].kind !== "outline";
  const drawnAt = (id: string, L: number) => hasGeo(id) && all[id].detail <= L && !(children[id] ?? []).some((c) => hasGeo(c) && all[c].detail <= L);
  // The engine's parts() already keeps only the requested systems; filtering
  // again here makes the rule right on any atlas record it is handed. Joints
  // are the figure's derived dots — nothing in BodyParts3D, nothing in the pack.
  const inSystems = (id: string) => q.systems.includes(all[id].system) && all[id].kind !== "joint";
  const ids = Object.keys(all).filter(
    (id) =>
      inSystems(id) &&
      drawnAt(id, focusIds.has(id) ? 3 : q.detail) &&
      (!focusing || focusIds.has(id)) &&
      !(q.layer === "deep" && all[id].layer === "superficial"),
  );
  ids.sort((a, b) => SYSTEM_ORDER[all[a].system] - SYSTEM_ORDER[all[b].system] || all[a].depth - all[b].depth || (a < b ? -1 : 1));
  if (!focusing && q.outline !== "none" && all.body_outline) ids.push("body_outline");
  return ids;
}

// ---------- how the parts look ----------

/** The peel works from the front: each part's rank in [0, 1] is where its
 *  front-most point sits among the parts shown — 0 for the one reaching
 *  furthest toward the camera (the skin, when it is there), 1 for the one
 *  furthest back. Ranks come from the pack's bounding boxes (max Z), not the
 *  atlas's mean depth: the lungs' centre lies behind the heart's, but their
 *  front edges lie in front of it, and it is the front edges that hide. One
 *  part, or all at the same depth: every rank 0. */
export function peelRanks(zFronts: number[]): number[] {
  const max = Math.max(...zFronts);
  const min = Math.min(...zFronts);
  const span = max - min;
  return zFronts.map((z) => (span > 0 ? (max - z) / span : 0));
}

/** The width of the peel's soft edge, in rank units. */
export const PEEL_EDGE = 0.1;

/** How see-through a part is at a peel value in [0, 1]: parts whose rank is
 *  in front of the peel fade out over PEEL_EDGE, parts behind it stay. The
 *  skin is a faint shell (0.3) even before any peel. At peel 1 only the
 *  furthest-back part remains. */
export function peelOpacity(part: Pick<AtlasPart, "kind">, rank: number, peel: number): number {
  const p = Math.max(0, Math.min(1, peel));
  const o = Math.max(0, Math.min(1, (rank - p + PEEL_EDGE) / PEEL_EDGE));
  return part.kind === "outline" ? 0.3 * o : o;
}

export interface CustomShape {
  vertexArr: { x: number; y: number; z: number }[];
  /** Empty on purpose: 3dmol computes normals when this is shorter than
   *  vertexArr — and it reads `.length` on it, so it must exist. */
  normalArr: never[];
  faceArr: number[];
  color: string;
  opacity: number;
  clickable: true;
}

/** What 3dmol's addCustom takes for one mesh of one part. */
export function toCustomShape(mesh: PackMesh, color: string, opacity: number): CustomShape {
  const vertexArr: CustomShape["vertexArr"] = [];
  for (let i = 0; i < mesh.positions.length; i += 3) vertexArr.push({ x: mesh.positions[i], y: mesh.positions[i + 1], z: mesh.positions[i + 2] });
  return { vertexArr, normalArr: [], faceArr: Array.from(mesh.indices), color, opacity, clickable: true };
}

export function partName(part: AtlasPart, names: "en" | "nb" | "la"): string {
  return part.name[names] ?? part.name.en;
}

// ---------- where the pack lives ----------

/** The pack is a public/ directory, so it sits beside the app wherever the app is served from. */
export const PACK_PATH = "anatomy3d/";
export function packUrl(file: string, baseURI: string): string {
  return new URL(PACK_PATH + file, baseURI).href;
}

// ---------- the wire format ----------

/** Reads a mesh-pack .bin: "DCM1", u32 vertex count, u32 index count, u32
 *  flags (bit 0 → Uint32 indices), Float32 positions, then the indices. */
export function decodeMesh(buf: ArrayBuffer): PackMesh {
  const dv = new DataView(buf);
  if (buf.byteLength < 16 || String.fromCharCode(dv.getUint8(0), dv.getUint8(1), dv.getUint8(2), dv.getUint8(3)) !== "DCM1") {
    throw new Error("not a DCM1 mesh file");
  }
  const nv = dv.getUint32(4, true);
  const ni = dv.getUint32(8, true);
  const wide = (dv.getUint32(12, true) & 1) === 1;
  const posBytes = nv * 12;
  const need = 16 + posBytes + ni * (wide ? 4 : 2);
  if (buf.byteLength < need) throw new Error(`mesh file length ${buf.byteLength} is short of the ${need} bytes its header promises`);
  // Slices, not views: a Uint32 view needs 4-byte alignment the index block
  // may not have, and the copies are small.
  const positions = new Float32Array(buf.slice(16, 16 + posBytes));
  const idxBuf = buf.slice(16 + posBytes, need);
  const indices = wide ? new Uint32Array(idxBuf) : new Uint16Array(idxBuf);
  return { positions, indices, triangles: ni / 3 };
}
