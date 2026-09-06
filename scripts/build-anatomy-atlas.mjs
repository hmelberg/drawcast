// BodyParts3D meshes → atlas JSON + preview. Deterministic given the cache;
// run by hand, output checked in:
//   node scripts/build-anatomy-atlas.mjs
//
// Every part is the frontal projection of one or more FMA-identified meshes:
// the triangles are projected (x → right, z → up), scan-filled into a coverage
// mask over the atlas space, and the mask is contoured. Union and holes come
// out of the mask for free. The first run downloads ~150 MB into
// .cache/bodyparts3d/ (gitignored); later runs are offline.

import { fileURLToPath } from "node:url";
import { mkdirSync, writeFileSync, existsSync, unlinkSync } from "node:fs";
import { simplify, ringArea, centroid, convexHull, blob, closestPair, round1 } from "./anatomy/geom.mjs";
import { parseStl } from "./anatomy/stl.mjs";
import { Mask } from "./anatomy/raster.mjs";
import { fetchCatalogue, fetchStl, elementsFor } from "./anatomy/bp3d.mjs";
import { SKIN, BONES, REGIONS, GROUPS, VISCERA, AUTHORED, VISCERA_GROUPS } from "../assets/anatomy-sources/bodyparts.mjs";
import { JOINTS, jointRadius } from "../assets/anatomy-sources/joints.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const CACHE = `${ROOT}.cache/bodyparts3d`;
const OUT = `${ROOT}src/scenes/anatomy/atlas`;
const PREVIEW = `${ROOT}assets/anatomy-sources/preview.svg`;

const SPACE = [1000, 2000];
const TOP = 40, BOTTOM = 1960;          // where the skin's extremes land in atlas y
const CELL = 1.5;                        // atlas units per mask cell
const TOL = 1.0;                         // Douglas–Peucker, atlas units
const MIN_AREA = { outer: 20, hole: 40 };
const SOURCE = "BodyParts3D, © The Database Center for Life Science licensed under CC Attribution-Share Alike 2.1 Japan (release 3.0); uterus authored";

const log = (s) => console.log(s);
const bbox = (pts) => { let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity; for (const [x, y] of pts) { if (x < x0) x0 = x; if (y < y0) y0 = y; if (x > x1) x1 = x; if (y > y1) y1 = y; } return { x0, y0, x1, y1 }; };
const outerPts = (rings) => rings.flatMap((r) => r.outer);
const pointsIn = (part) => part.rings.reduce((s, r) => s + r.outer.length + (r.holes ?? []).reduce((t, h) => t + h.length, 0), 0);

async function main() {
  const cat = await fetchCatalogue({ cacheDir: CACHE });
  log(`catalogue: ${cat.names.size} names, ${cat.composites.size} composites`);

  /** The meshes of one part: [{ id, positions }], skipping files the mirror lacks. */
  const meshesFor = async (label, spec) => {
    const ids = elementsFor(cat, spec);
    const out = [];
    for (const id of ids) {
      const bytes = await fetchStl(id, { cacheDir: CACHE, log });
      if (!bytes) continue;
      out.push({ id, ...parseStl(bytes) });
    }
    const tris = out.reduce((s, m) => s + m.triangles, 0);
    log(`${label}: ${out.length}/${ids.length} meshes, ${tris} triangles`);
    if (out.length === 0 && !spec.optional) throw new Error(`${label}: no geometry — check its ids in bodyparts.mjs`);
    return out;
  };

  // 1. The skin sets the frame: its z-extremes → TOP/BOTTOM, its x-midline → 500.
  const skin = await meshesFor("skin", SKIN);
  let zTop = -Infinity, zBot = Infinity, xMin = Infinity, xMax = -Infinity;
  for (const m of skin) for (let i = 0; i < m.positions.length; i += 3) {
    const x = m.positions[i], z = m.positions[i + 2];
    if (z > zTop) zTop = z; if (z < zBot) zBot = z; if (x < xMin) xMin = x; if (x > xMax) xMax = x;
  }
  const k = (BOTTOM - TOP) / (zTop - zBot);
  const xMid = (xMin + xMax) / 2;
  const project = (x, z) => [SPACE[0] / 2 + (x - xMid) * k, TOP + (zTop - z) * k];
  log(`frame: z ${zBot.toFixed(0)}..${zTop.toFixed(0)} mm, x mid ${xMid.toFixed(0)}, scale ${k.toFixed(3)} atlas units/mm`);

  /** Project + rasterise + contour a part's meshes → { rings, depth }. */
  const silhouette = (meshes) => {
    const mask = new Mask(Math.ceil(SPACE[0] / CELL), Math.ceil(SPACE[1] / CELL), CELL, [0, 0]);
    let ySum = 0, n = 0;
    for (const m of meshes) {
      const p = m.positions;
      for (let i = 0; i < p.length; i += 9) {
        mask.fillTriangle(project(p[i], p[i + 2]), project(p[i + 3], p[i + 5]), project(p[i + 6], p[i + 8]));
        ySum += -(p[i + 1] + p[i + 4] + p[i + 7]); n += 3;
      }
    }
    const rings = [];
    for (const r of mask.rings()) {
      const outer = simplify(r.outer, TOL);
      if (outer.length < 3 || ringArea(outer) < MIN_AREA.outer) continue;
      const holes = r.holes.map((h) => simplify(h, TOL)).filter((h) => h.length >= 3 && ringArea(h) >= MIN_AREA.hole);
      rings.push(holes.length ? { outer: round1(outer), holes: holes.map(round1) } : { outer: round1(outer) });
    }
    return { rings, depth: Math.round((n ? ySum / n : 0) * 10) / 10 };
  };
  const record = (spec, system, kind, geo, extra = {}) => ({
    name: spec.name, system, kind, parent: spec.parent, detail: spec.detail, depth: geo.depth, sex: spec.sex ?? "any",
    ...(spec.color ? { color: spec.color } : {}), source: "bodyparts3d", ...(spec.layer ? { layer: spec.layer } : {}), ...(spec.behind ? { behind: true } : {}),
    rings: geo.rings, ...(spec.uberon ? { uberon: spec.uberon } : {}), ...extra,
  });

  // 2. Bones.
  const skeleton = {};
  for (const b of BONES) {
    const geo = silhouette(await meshesFor(b.id, b));
    if (geo.rings.length === 0) throw new Error(`${b.id}: projected to nothing`);
    skeleton[b.id] = record(b, "skeleton", "bone", geo);
  }

  // 3. Joints: derived from the projected bones, as in round 1.
  for (const j of JOINTS) {
    let c, diag;
    const d = (pts) => { const bb = bbox(pts); return Math.hypot(bb.x1 - bb.x0, bb.y1 - bb.y0); };
    if (j.between) {
      const [a, b] = j.between.map((id) => outerPts(skeleton[id].rings));
      const { p, q } = closestPair(a, b);
      c = [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
      diag = Math.max(d(a), d(b));
    } else {
      const pts = outerPts(skeleton[j.top].rings);
      c = pts.reduce((best, p) => (p[1] < best[1] ? p : best), pts[0]);
      diag = d(pts);
    }
    const r = jointRadius(diag);
    skeleton[j.id] = { name: j.name, system: "skeleton", kind: "joint", parent: j.parent, detail: 2, depth: 999, sex: "any", source: "bodyparts3d", rings: [{ outer: round1(blob({ c, rx: r, ry: r, n: 16 })) }] };
  }

  // 4. Regions (detail 1): hulls of their bones. Groups. The skin as the outline.
  const body = {};
  for (const rg of REGIONS) {
    const pts = rg.of.flatMap((id) => outerPts(skeleton[id].rings));
    body[rg.id] = { name: rg.name, system: "skeleton", kind: "region", parent: rg.parent, detail: 1, depth: 0, sex: "any", source: "bodyparts3d", rings: [{ outer: round1(convexHull(pts)) }], ...(rg.uberon ? { uberon: rg.uberon } : {}) };
  }
  for (const g of GROUPS) body[g.id] = { name: g.name, system: "skeleton", kind: "group", parent: g.parent, detail: 1, depth: 0, sex: "any", source: "bodyparts3d", rings: [] };
  for (const g of VISCERA_GROUPS) body[g.id] = { name: g.name, system: "viscera", kind: "group", parent: g.parent, detail: 1, depth: 0, sex: "any", source: "bodyparts3d", rings: [] };
  const skinGeo = silhouette(skin);
  body.body_outline = { name: { en: "Body", nb: "Kropp", la: "Corpus" }, system: "skeleton", kind: "outline", parent: null, detail: 1, depth: -999, sex: "any", source: "bodyparts3d", rings: skinGeo.rings };
  log(`skin: ${skinGeo.rings.length} ring(s), ${skinGeo.rings.reduce((s, r) => s + (r.holes?.length ?? 0), 0)} hole(s)`);

  // 5. Organs, then the one authored part placed against the projected pelvis.
  const viscera = {};
  for (const o of VISCERA) {
    const geo = silhouette(await meshesFor(o.id, o));
    if (geo.rings.length === 0) throw new Error(`${o.id}: projected to nothing`);
    viscera[o.id] = record(o, "viscera", "organ", geo);
  }
  for (const a of AUTHORED) {
    const pb = bbox(outerPts(skeleton.hip_bones.rings));
    const c = [(pb.x0 + pb.x1) / 2, pb.y0 + 0.62 * (pb.y1 - pb.y0)];
    viscera[a.id] = { name: a.name, system: "viscera", kind: "organ", parent: a.parent, detail: a.detail, depth: (viscera.bladder?.depth ?? 0) - 5, sex: a.sex, color: a.color, source: "authored", rings: [{ outer: round1(simplify(blob({ c, ...a.shape }), TOL)) }], ...(a.uberon ? { uberon: a.uberon } : {}) };
  }

  // 6. Write.
  mkdirSync(OUT, { recursive: true });
  const write = (name, parts) => {
    const head = `{\n "view": "anterior",\n "space": ${JSON.stringify(SPACE)},\n "source": ${JSON.stringify(SOURCE)},\n "parts": {\n`;
    const rows = Object.entries(parts).map(([id, p]) => `  ${JSON.stringify(id)}: ${JSON.stringify(p)}`).join(",\n");
    writeFileSync(`${OUT}/${name}`, `${head}${rows}\n }\n}\n`);
    const n = Object.values(parts).reduce((s, p) => s + pointsIn(p), 0);
    log(`${name}: ${Object.keys(parts).length} parts, ${n} points`);
  };
  write("atlas-body.json", body);
  write("atlas-skeleton.json", skeleton);
  write("atlas-viscera.json", viscera);
  for (const stale of ["atlas-body.json", "atlas-skeleton.json", "atlas-viscera.json"]) {
    const old = `${ROOT}src/scenes/anatomy/${stale}`;
    if (existsSync(old)) unlinkSync(old);
  }

  log("landmarks (atlas units, y down):");
  for (const rg of REGIONS) { const bb = bbox(body[rg.id].rings[0].outer); log(`  ${rg.id.padEnd(18)} x ${bb.x0.toFixed(0)}..${bb.x1.toFixed(0)}  y ${bb.y0.toFixed(0)}..${bb.y1.toFixed(0)}`); }

  writeFileSync(PREVIEW, preview(body, skeleton, viscera));
  log(`preview: ${PREVIEW}`);
}

function preview(body, skeleton, viscera) {
  const d = (r) => `M${r.outer.map(([x, y]) => `${x} ${y}`).join("L")}Z${(r.holes ?? []).map((h) => `M${h.map(([x, y]) => `${x} ${y}`).join("L")}Z`).join("")}`;
  const shape = (p, fill, stroke, width = 1.4, opts = "") => p.rings.map((r) => `<path d="${d(r)}" fill="${fill}" fill-rule="evenodd" stroke="${stroke}" stroke-width="${width}" ${opts}/>`).join("");
  const byDepth = (parts) => Object.values(parts).filter((p) => p.rings.length > 0 && p.kind !== "outline").sort((a, b) => a.depth - b.depth);
  const skin = shape(body.body_outline, "#f1dccb", "#c9b4a3", 1.2, 'fill-opacity="0.7"');
  const left = skin
    + byDepth(body).filter((p) => p.kind === "region").map((p) => shape(p, "#e6dcc4", "#333")).join("")
    + byDepth(viscera).filter((p) => p.detail === 1).map((p) => shape(p, p.color, "#333", 1.4, 'fill-opacity="0.65"')).join("");
  const right = skin
    + byDepth(skeleton).filter((p) => p.kind === "bone").map((p) => shape(p, "#e6dcc4", "#333")).join("")
    + byDepth(viscera).map((p) => shape(p, p.color, "#333", 1.4, `fill-opacity="0.65"${p.behind ? ' stroke-dasharray="5 4"' : ""}`)).join("")
    + byDepth(skeleton).filter((p) => p.kind === "joint").map((p) => shape(p, "none", "#c0392b", 2.5)).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 2000 2000" width="1000" height="1000">`
    + `<rect width="2000" height="2000" fill="#faf6ec"/><g>${left}</g><g transform="translate(1000,0)">${right}</g>`
    + `<line x1="1000" y1="0" x2="1000" y2="2000" stroke="#bbb"/></svg>`;
}

main().catch((e) => { console.error(e); process.exit(1); });
