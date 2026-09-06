// BodyParts3D meshes → the 3D pack in public/anatomy3d/: one decimated .bin
// per bone, organ and the skin, an index.json the app reads, and the licence
// files. Deterministic given the cache; run by hand, output checked in:
//   node scripts/build-anatomy-meshes.mjs
// Shares the STL cache (.cache/bodyparts3d/) with build-anatomy-atlas.mjs;
// the first run downloads what the atlas build has not already fetched.

import { fileURLToPath } from "node:url";
import { mkdirSync, writeFileSync, readdirSync, unlinkSync, copyFileSync, readFileSync, statSync } from "node:fs";
import { parseStl } from "./anatomy/stl.mjs";
import { fetchCatalogue, fetchStl, elementsFor } from "./anatomy/bp3d.mjs";
import { toPack, decimateToBudget, encodeMesh, bboxOfMesh } from "./anatomy/mesh.mjs";
import { SKIN, BONES, REGIONS, VISCERA } from "../assets/anatomy-sources/bodyparts.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const CACHE = `${ROOT}.cache/bodyparts3d`;
const OUT = `${ROOT}public/anatomy3d`;
const ATLAS_DIR = `${ROOT}src/scenes/anatomy/atlas`;
const SOURCE = "BodyParts3D, © The Database Center for Life Science licensed under CC Attribution-Share Alike 2.1 Japan (release 3.0)";
// The template's own defaults (anatomy.yaml SYSTEM_COLOR / SKIN) — pinned by tests/anatomy3d-pack.test.ts.
const SYSTEM_COLOR = { skeleton: "#e6dcc4", viscera: "#c9a15f" };
const SKIN_COLOR = "#f1dccb";
const CELL_MM = { skeleton: 2, viscera: 3, skin: 6 };
const SKIN_BUDGET = 20000;
/** Triangles a part may keep: proportional to its size, 400 for a carpal, 4 000 for a femur. */
const budgetFor = (bbox) => {
  const d = Math.hypot(bbox[3] - bbox[0], bbox[4] - bbox[1], bbox[5] - bbox[2]);
  return Math.max(400, Math.min(4000, Math.round(d * 100)));
};
const log = (s) => console.log(s);

async function main() {
  const cat = await fetchCatalogue({ cacheDir: CACHE });
  log(`catalogue: ${cat.names.size} names, ${cat.composites.size} composites`);

  /** All of a part's meshes as one raw triangle soup (mm), skipping files the mirror lacks. */
  const raw = async (label, spec) => {
    const chunks = [];
    for (const id of elementsFor(cat, spec)) {
      const bytes = await fetchStl(id, { cacheDir: CACHE, log });
      if (bytes) chunks.push(parseStl(bytes).positions);
    }
    if (chunks.length === 0) throw new Error(`${label}: no geometry — check its ids in bodyparts.mjs`);
    const all = new Float32Array(chunks.reduce((s, c) => s + c.length, 0));
    let o = 0;
    for (const c of chunks) {
      all.set(c, o);
      o += c.length;
    }
    return all;
  };

  // The skin sets the centre; everything is re-centred on it.
  const skinMm = await raw("skin", SKIN);
  const bb = bboxOfMesh(skinMm);
  const centre = [(bb[0] + bb[3]) / 2, (bb[1] + bb[4]) / 2, (bb[2] + bb[5]) / 2];
  log(`centre (mm): ${centre.map((v) => v.toFixed(0)).join(", ")}; height ${((bb[5] - bb[2]) / 10).toFixed(1)} cm`);

  mkdirSync(OUT, { recursive: true });
  for (const f of readdirSync(OUT)) if (f.endsWith(".bin")) unlinkSync(`${OUT}/${f}`);

  const parts = {};
  let total = 0;
  const round1 = (v) => Math.round(v * 10) / 10;
  const emit = (id, positionsMm, { system, kind, color, layer, cellMm, budget }) => {
    const packed = toPack(positionsMm, centre);
    const bbox = bboxOfMesh(packed);
    const { mesh, cell } = decimateToBudget(packed, cellMm / 10, budget ?? budgetFor(bbox));
    if (mesh.positions.length / 3 >= 64000) throw new Error(`${id}: ${mesh.positions.length / 3} vertices — over 3dmol's Uint16 limit; lower its budget`);
    const bytes = encodeMesh(mesh);
    writeFileSync(`${OUT}/${id}.bin`, bytes);
    parts[id] = { files: [`${id}.bin`], triangles: mesh.triangles, bytes: bytes.length, bbox: bbox.map(round1), system, kind, color, ...(layer ? { layer } : {}) };
    total += mesh.triangles;
    log(`${id.padEnd(22)} ${String(positionsMm.length / 9).padStart(8)} → ${String(mesh.triangles).padStart(6)} tris  cell ${(cell * 10).toFixed(2)} mm  ${bytes.length} B`);
  };

  emit("body_outline", skinMm, { system: "skeleton", kind: "outline", color: SKIN_COLOR, cellMm: CELL_MM.skin, budget: SKIN_BUDGET });
  for (const b of BONES) emit(b.id, await raw(b.id, b), { system: "skeleton", kind: "bone", color: b.color ?? SYSTEM_COLOR.skeleton, cellMm: CELL_MM.skeleton });
  for (const o of VISCERA) emit(o.id, await raw(o.id, o), { system: "viscera", kind: "organ", color: o.color ?? SYSTEM_COLOR.viscera, layer: o.layer, cellMm: CELL_MM.viscera });
  // Regions are their bones: no file of their own, so the pack holds every triangle once.
  for (const rg of REGIONS) {
    const bbs = rg.of.map((id) => parts[id].bbox);
    const bbox = [0, 1, 2].map((a) => Math.min(...bbs.map((b) => b[a]))).concat([3, 4, 5].map((a) => Math.max(...bbs.map((b) => b[a]))));
    parts[rg.id] = { files: rg.of.map((id) => `${id}.bin`), triangles: rg.of.reduce((s, id) => s + parts[id].triangles, 0), bytes: 0, bbox, system: "skeleton", kind: "region", color: SYSTEM_COLOR.skeleton };
  }

  writeFileSync(`${OUT}/index.json`, JSON.stringify({ version: 1, units: "cm", source: SOURCE, parts }, null, 1) + "\n");
  copyFileSync(`${ATLAS_DIR}/LICENSE`, `${OUT}/LICENSE`);
  writeFileSync(
    `${OUT}/ATTRIBUTION.md`,
    readFileSync(`${ATLAS_DIR}/ATTRIBUTION.md`, "utf8") + "\nThe meshes in this directory are decimated copies of the BodyParts3D 3.0 STL files, re-centred and scaled to centimetres (`scripts/build-anatomy-meshes.mjs`).\n",
  );
  const size = readdirSync(OUT).filter((f) => f.endsWith(".bin")).reduce((s, f) => s + statSync(`${OUT}/${f}`).size, 0);
  log(`pack: ${Object.keys(parts).length} parts, ${total} triangles, ${(size / 1e6).toFixed(2)} MB`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
