// Source art → atlas JSON + preview. Deterministic, run by hand, output checked in:
//   node scripts/build-anatomy-atlas.mjs
//
// The skeleton comes from LadyofHats' public-domain "Human skeleton front en.svg".
// Every bone there is PAINTED — a base fill plus shading and highlight paths —
// so a bone's silhouette is the polygon UNION of its paths, not any one of
// them. Groups sit in the page through matrix/translate attributes, composed
// here by scripts/anatomy/svg.mjs. Regions are convex hulls of their bones;
// joints are derived from the bones they join; organs are authored shapes.

import { createServer } from "vite";
import { fileURLToPath } from "node:url";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import polygonClipping from "polygon-clipping";
import { simplify, ringArea, centroid, convexHull, blob, tube, closestPair, round1 } from "./anatomy/geom.mjs";
import { parseSvg, ringsOf } from "./anatomy/svg.mjs";
import { BONES, IGNORED_SOURCES, NON_BONE_FILLS, REGIONS, GROUPS } from "../assets/anatomy-sources/skeleton-map.mjs";
import { JOINTS, jointRadius } from "../assets/anatomy-sources/joints.mjs";
import { VISCERA, VISCERA_GROUPS, BODY_OUTLINE } from "../assets/anatomy-sources/viscera.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const SRC = `${ROOT}assets/anatomy-sources/human-skeleton-front.svg`;
const OUT = `${ROOT}src/scenes/anatomy`;
const PREVIEW = `${ROOT}assets/anatomy-sources/preview.svg`;

const SPACE = [1000, 2000];
const TOP = 60, BOTTOM = 1940;           // where the skeleton's extremes land in atlas y
const TOL = { skeleton: 1.2, viscera: 1.5 };
const MIN_AREA = { outer: 20, hole: 40 }; // atlas units², after decimation
const SEGMENTS = 6;                       // curve samples per bezier, before decimation
const SOURCE = "Wikimedia Commons, LadyofHats (Mariana Ruiz Villarreal), public domain; organs authored for drawcast";

const bbox = (pts) => {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of pts) { if (x < x0) x0 = x; if (y < y0) y0 = y; if (x > x1) x1 = x; if (y > y1) y1 = y; }
  return { x0, y0, x1, y1 };
};
const outerPts = (rings) => rings.flatMap((r) => r.outer);
const pointsIn = (part) => part.rings.reduce((s, r) => s + r.outer.length + (r.holes ?? []).reduce((t, h) => t + h.length, 0), 0);

/** polygon-clipping MultiPolygon → decimated AtlasRing[]. Its rings repeat the
 *  first point at the end; ours do not. */
function toAtlasRings(multi, tol) {
  const out = [];
  for (const poly of multi) {
    const outer = simplify(poly[0].slice(0, -1), tol);
    if (outer.length < 3 || ringArea(outer) < MIN_AREA.outer) continue;
    const holes = poly.slice(1).map((h) => simplify(h.slice(0, -1), tol)).filter((h) => h.length >= 3 && ringArea(h) >= MIN_AREA.hole);
    out.push(holes.length > 0 ? { outer: round1(outer), holes: holes.map(round1) } : { outer: round1(outer) });
  }
  return out;
}

async function main() {
  // noDiscovery: this script only needs ssrLoadModule; without it vite starts
  // a dependency scan of index.html that is still running when the server
  // closes, and reports that as an error after the build has finished.
  const server = await createServer({ root: ROOT, server: { middlewareMode: true }, appType: "custom", logLevel: "warn", optimizeDeps: { noDiscovery: true, include: [] } });
  try {
    const { sampleSvgPath } = await server.ssrLoadModule("/src/scenes/svgpath.ts");
    const svg = parseSvg(readFileSync(SRC, "utf8"));

    // 1. Which path belongs to which bone: the innermost mapped group in its
    //    chain wins, so Mandible beats Skull; a loose path is mapped by its own id.
    const boneOfSource = new Map();
    for (const b of BONES) for (const s of b.sources) boneOfSource.set(s, b.id);
    const ignored = new Set(IGNORED_SOURCES);
    const raw = {}; // bone id → rings in SOURCE coordinates
    for (const p of svg.paths) {
      if (p.chain[0] !== "layer3") continue;                 // the skeleton layer only
      if (NON_BONE_FILLS.has(p.fill)) continue;               // outlines and label art
      if (p.chain.some((g) => ignored.has(g))) continue;
      let bone = null;
      for (let i = p.chain.length - 1; i >= 0 && !bone; i--) bone = boneOfSource.get(p.chain[i]) ?? null;
      if (!bone && p.id) bone = boneOfSource.get(p.id) ?? null;
      if (!bone) continue;
      for (const r of ringsOf(p, sampleSvgPath, SEGMENTS)) if (r.length >= 3 && ringArea(r) > 0.05) (raw[bone] ??= []).push(r);
    }
    for (const b of BONES) if (!raw[b.id]) throw new Error(`bone "${b.id}" got no paths — check its sources ${JSON.stringify(b.sources)}`);

    // 2. Source frame → atlas frame. The spine's centroid is the midline; the
    //    skeleton's extremes land at TOP and BOTTOM.
    const all = Object.values(raw).flat().flat();
    const { y0, y1 } = bbox(all);
    const spine = ["cervical_vertebrae", "thoracic_vertebrae", "lumbar_vertebrae"].flatMap((id) => raw[id]);
    const [midX] = centroid(spine);
    const k = (BOTTOM - TOP) / (y1 - y0);
    const toAtlas = ([x, y]) => [SPACE[0] / 2 + (x - midX) * k, TOP + (y - y0) * k];
    console.log(`source: ${svg.paths.length} paths, midline x=${midX.toFixed(1)}, y ${y0.toFixed(1)}..${y1.toFixed(1)}, scale ${k.toFixed(3)}`);

    // 3. Bones: union of the painted shapes, then decimate.
    const skeleton = {};
    for (const b of BONES) {
      const polys = raw[b.id].map((r) => [r.map(toAtlas)]);
      let multi;
      try {
        multi = polygonClipping.union(...polys);
      } catch (e) {
        console.warn(`union failed for ${b.id} (${e.message}); keeping the raw rings`);
        multi = polys.map((p) => [[...p[0], p[0][0]]]);
      }
      const rings = toAtlasRings(multi, TOL.skeleton);
      if (rings.length === 0) throw new Error(`bone "${b.id}" decimated to nothing`);
      skeleton[b.id] = { name: b.name, system: "skeleton", kind: "bone", parent: b.parent, detail: b.detail, depth: 1, sex: "any", rings, ...(b.uberon ? { uberon: b.uberon } : {}) };
    }

    // 4. Joints: derived from the bones they join.
    for (const j of JOINTS) {
      let c, diag;
      if (j.between) {
        const [a, b] = j.between.map((id) => outerPts(skeleton[id].rings));
        const { p, q } = closestPair(a, b);
        c = [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
        const d = (pts) => { const bb = bbox(pts); return Math.hypot(bb.x1 - bb.x0, bb.y1 - bb.y0); };
        diag = Math.max(d(a), d(b));
      } else {
        const pts = outerPts(skeleton[j.top].rings);
        c = pts.reduce((best, p) => (p[1] < best[1] ? p : best), pts[0]);
        const bb = bbox(pts);
        diag = Math.hypot(bb.x1 - bb.x0, bb.y1 - bb.y0);
      }
      const r = jointRadius(diag);
      skeleton[j.id] = { name: j.name, system: "skeleton", kind: "joint", parent: j.parent, detail: 2, depth: 5, sex: "any", rings: [{ outer: round1(blob({ c, rx: r, ry: r, n: 16 })) }] };
    }

    // 5. Regions: convex hull of the region's bones. The hull of decimated
    //    bones is already coarse; simplifying it further would cut corners
    //    off and let a bone poke outside its own region.
    const body = {};
    for (const rg of REGIONS) {
      const pts = rg.of.flatMap((id) => outerPts(skeleton[id].rings));
      const hull = convexHull(pts);
      body[rg.id] = { name: rg.name, system: "skeleton", kind: "region", parent: rg.parent, detail: 1, depth: 0, sex: "any", rings: [{ outer: round1(hull) }], ...(rg.uberon ? { uberon: rg.uberon } : {}) };
    }
    for (const g of GROUPS) body[g.id] = { name: g.name, system: "skeleton", kind: "group", parent: g.parent, detail: 1, depth: 0, sex: "any", rings: [] };
    for (const g of VISCERA_GROUPS) body[g.id] = { name: g.name, system: "viscera", kind: "group", parent: g.parent, detail: 1, depth: 0, sex: "any", rings: [] };
    body.body_outline = { name: { en: "Body", nb: "Kropp", la: "Corpus" }, system: "skeleton", kind: "outline", parent: null, detail: 1, depth: 0, sex: "any", rings: [{ outer: round1(BODY_OUTLINE) }] };

    // 6. Organs: authored shapes, decimated to the viscera tolerance.
    const viscera = {};
    for (const o of VISCERA) {
      const s = o.shape;
      const ring = s.kind === "blob" ? blob(s) : s.kind === "tube" ? tube(s.path, s.w) : s.pts;
      const outer = simplify(ring, TOL.viscera);
      viscera[o.id] = { name: o.name, system: "viscera", kind: "organ", parent: o.parent, detail: o.detail, depth: o.depth, sex: o.sex ?? "any", color: o.color, rings: [{ outer: round1(outer) }], ...(o.uberon ? { uberon: o.uberon } : {}) };
    }

    // 7. Write, one part per line so diffs stay readable.
    mkdirSync(OUT, { recursive: true });
    const write = (name, parts) => {
      const head = `{\n "view": "anterior",\n "space": ${JSON.stringify(SPACE)},\n "source": ${JSON.stringify(SOURCE)},\n "parts": {\n`;
      const rows = Object.entries(parts).map(([id, p]) => `  ${JSON.stringify(id)}: ${JSON.stringify(p)}`).join(",\n");
      writeFileSync(`${OUT}/${name}`, `${head}${rows}\n }\n}\n`);
      const n = Object.values(parts).reduce((s, p) => s + pointsIn(p), 0);
      console.log(`${name}: ${Object.keys(parts).length} parts, ${n} points`);
    };
    write("atlas-body.json", body);
    write("atlas-skeleton.json", skeleton);
    write("atlas-viscera.json", viscera);

    // 8. Landmarks, for placing organs and the outline by hand.
    console.log("landmarks (atlas units, y down):");
    for (const rg of REGIONS) { const bb = bbox(body[rg.id].rings[0].outer); console.log(`  ${rg.id.padEnd(18)} x ${bb.x0.toFixed(0)}..${bb.x1.toFixed(0)}  y ${bb.y0.toFixed(0)}..${bb.y1.toFixed(0)}`); }

    // 9. The preview: left, what detail 1 draws; right, detail 3 with every organ and joint.
    writeFileSync(PREVIEW, preview(body, skeleton, viscera));
    console.log(`preview: ${PREVIEW}`);
  } finally {
    await server.close();
  }
}

function preview(body, skeleton, viscera) {
  const d = (r) => `M${r.outer.map(([x, y]) => `${x} ${y}`).join("L")}Z${(r.holes ?? []).map((h) => `M${h.map(([x, y]) => `${x} ${y}`).join("L")}Z`).join("")}`;
  const shape = (p, fill, stroke, width = 1.6, opts = "") => p.rings.map((r) => `<path d="${d(r)}" fill="${fill}" fill-rule="evenodd" stroke="${stroke}" stroke-width="${width}" ${opts}/>`).join("");
  const byDepth = (parts) => Object.values(parts).filter((p) => p.rings.length > 0).sort((a, b) => a.depth - b.depth);
  const outline = shape(body.body_outline, "none", "#999", 1.6, 'stroke-dasharray="6 4"');
  const left = outline
    + byDepth(body).filter((p) => p.kind === "region").map((p) => shape(p, "#e6dcc4", "#333")).join("")
    + byDepth(viscera).filter((p) => p.detail === 1).map((p) => shape(p, p.color, "#333", 1.6, 'fill-opacity="0.6"')).join("");
  const right = outline
    + byDepth(skeleton).filter((p) => p.kind === "bone").map((p) => shape(p, "#e6dcc4", "#333")).join("")
    + byDepth(viscera).map((p) => shape(p, p.color, "#333", 1.6, 'fill-opacity="0.6"')).join("")
    + byDepth(skeleton).filter((p) => p.kind === "joint").map((p) => shape(p, "none", "#c0392b", 2.5)).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 2000 2000" width="1000" height="1000">`
    + `<rect width="2000" height="2000" fill="#faf6ec"/><g>${left}</g><g transform="translate(1000,0)">${right}</g>`
    + `<line x1="1000" y1="0" x2="1000" y2="2000" stroke="#bbb"/></svg>`;
}

main();
