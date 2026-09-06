// Pure mesh tools for the 3D pack: BodyParts3D millimetres → pack centimetres,
// vertex clustering (the decimation), and the .bin writer. Node-tested; the
// browser-side reader lives in src/ui/anatomy3d.ts and shares the format.
//
// Pack coordinates: X = x (patient's left → screen right when facing the
// body), Y = z (up), Z = −y (anterior toward the camera), re-centred on the
// skin and divided by ten. The mapping has determinant +1, so face winding
// survives. Centimetres, not metres: a 170-unit body sits where 3dmol's
// camera, slab and picking are tuned; a 1.7-unit one does not.

/** BodyParts3D mm triangles (9 floats each) → pack cm, same layout. */
export function toPack(positions, centre) {
  const [cx, cy, cz] = centre;
  const out = new Float32Array(positions.length);
  for (let i = 0; i < positions.length; i += 3) {
    out[i] = (positions[i] - cx) / 10;
    out[i + 1] = (positions[i + 2] - cz) / 10;
    out[i + 2] = (cy - positions[i + 1]) / 10; // written this way round so the centre gives +0, not −0
  }
  return out;
}

/** Snap vertices to a grid of `cell`, merge equal cells, drop degenerate faces
 *  and the vertices only they referenced. Deterministic: first occurrence wins. */
export function clusterMesh(positions, cell) {
  const key = new Map();
  const verts = [];
  const indices = [];
  const snap = (v) => Math.round(v / cell);
  const indexOf = (x, y, z) => {
    const kx = snap(x), ky = snap(y), kz = snap(z);
    const k = `${kx},${ky},${kz}`;
    let idx = key.get(k);
    if (idx === undefined) {
      idx = verts.length / 3;
      key.set(k, idx);
      verts.push(kx * cell, ky * cell, kz * cell);
    }
    return idx;
  };
  for (let i = 0; i < positions.length; i += 9) {
    const a = indexOf(positions[i], positions[i + 1], positions[i + 2]);
    const b = indexOf(positions[i + 3], positions[i + 4], positions[i + 5]);
    const c = indexOf(positions[i + 6], positions[i + 7], positions[i + 8]);
    if (a === b || b === c || a === c) continue;
    indices.push(a, b, c);
  }
  const used = new Uint8Array(verts.length / 3);
  for (const i of indices) used[i] = 1;
  const remap = new Int32Array(used.length).fill(-1);
  const kept = [];
  for (let i = 0; i < used.length; i++) {
    if (!used[i]) continue;
    remap[i] = kept.length / 3;
    kept.push(verts[i * 3], verts[i * 3 + 1], verts[i * 3 + 2]);
  }
  return { positions: new Float32Array(kept), indices: Uint32Array.from(indices, (i) => remap[i]), triangles: indices.length / 3 };
}

/** Cluster at `cell` (shares vertices, sheds the sub-cell noise), then collapse
 *  edges by quadric error until the triangle budget holds. The cell never
 *  grows: a grid coarse enough to meet a budget on its own makes a blocky body
 *  (the skin needed 28 mm cells for 20 000 triangles); collapsing the cheapest
 *  edges keeps the silhouette and spends the triangles where the surface bends. */
export function decimateToBudget(positions, cell, budget) {
  const clustered = clusterMesh(positions, cell);
  return { mesh: simplifyMesh(clustered, budget), cell };
}

/** Quadric edge collapse (Garland & Heckbert 1997): each vertex carries the sum
 *  of its faces' plane quadrics; the edge whose merged vertex has the least
 *  error goes first; the merged vertex is the better of the two ends or the
 *  midpoint; a collapse that would flip a neighbouring face is skipped. Works
 *  on any indexed triangle soup and keeps a closed surface closed. */
export function simplifyMesh({ positions, indices }, budget) {
  const nv = positions.length / 3;
  const nf = indices.length / 3;
  if (nf <= budget) return { positions: Float32Array.from(positions), indices: Uint32Array.from(indices), triangles: nf };
  const P = Float64Array.from(positions);
  const F = Int32Array.from(indices);
  const alive = new Uint8Array(nf).fill(1);
  const dead = new Uint8Array(nv);
  const stamp = new Uint32Array(nv);
  const Q = new Float64Array(nv * 10);
  const vf = Array.from({ length: nv }, () => []);
  for (let f = 0; f < nf; f++) for (let i = 0; i < 3; i++) vf[F[3 * f + i]].push(f);

  /** Face normal (unnormalised), optionally with vertex `moved` at (mx, my, mz). */
  const normalOf = (f, moved = -1, mx = 0, my = 0, mz = 0) => {
    const at = (i) => {
      const v = F[3 * f + i];
      return v === moved ? [mx, my, mz] : [P[3 * v], P[3 * v + 1], P[3 * v + 2]];
    };
    const a = at(0), b = at(1), c = at(2);
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const wx = c[0] - a[0], wy = c[1] - a[1], wz = c[2] - a[2];
    return [uy * wz - uz * wy, uz * wx - ux * wz, ux * wy - uy * wx];
  };
  for (let f = 0; f < nf; f++) {
    const [a, b, c] = normalOf(f);
    const len = Math.hypot(a, b, c);
    if (len === 0) continue;
    const na = a / len, nb = b / len, nc = c / len;
    const v0 = F[3 * f];
    const d = -(na * P[3 * v0] + nb * P[3 * v0 + 1] + nc * P[3 * v0 + 2]);
    const q = [na * na, na * nb, na * nc, na * d, nb * nb, nb * nc, nb * d, nc * nc, nc * d, d * d];
    for (let i = 0; i < 3; i++) {
      const o = F[3 * f + i] * 10;
      for (let k = 0; k < 10; k++) Q[o + k] += q[k];
    }
  }
  const sum = new Float64Array(10);
  const errAt = (x, y, z) =>
    sum[0] * x * x + 2 * sum[1] * x * y + 2 * sum[2] * x * z + 2 * sum[3] * x + sum[4] * y * y + 2 * sum[5] * y * z + 2 * sum[6] * y + sum[7] * z * z + 2 * sum[8] * z + sum[9];
  /** Cheapest placement for merging v1 and v2: either end or the midpoint. */
  const costOf = (v1, v2) => {
    for (let k = 0; k < 10; k++) sum[k] = Q[v1 * 10 + k] + Q[v2 * 10 + k];
    const a = [P[3 * v1], P[3 * v1 + 1], P[3 * v1 + 2]];
    const b = [P[3 * v2], P[3 * v2 + 1], P[3 * v2 + 2]];
    const m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
    let best = m, bestErr = errAt(m[0], m[1], m[2]);
    for (const p of [a, b]) {
      const e = errAt(p[0], p[1], p[2]);
      if (e < bestErr) { bestErr = e; best = p; }
    }
    return [bestErr, best[0], best[1], best[2]];
  };

  // A binary min-heap of [cost, v1, v2, stamp1, stamp2, x, y, z]; stale entries
  // (a vertex moved or died since) are dropped when popped.
  const heap = [];
  const push = (e) => {
    heap.push(e);
    let i = heap.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (heap[p][0] <= heap[i][0]) break;
      [heap[p], heap[i]] = [heap[i], heap[p]];
      i = p;
    }
  };
  const pop = () => {
    const top = heap[0];
    const last = heap.pop();
    if (heap.length > 0) {
      heap[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
        if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
        if (m === i) break;
        [heap[m], heap[i]] = [heap[i], heap[m]];
        i = m;
      }
    }
    return top;
  };
  const pushEdge = (v1, v2) => {
    if (v1 === v2 || dead[v1] || dead[v2]) return;
    const [c, x, y, z] = costOf(v1, v2);
    push([c, v1, v2, stamp[v1], stamp[v2], x, y, z]);
  };
  const seen = new Set();
  for (let f = 0; f < nf; f++) {
    for (let i = 0; i < 3; i++) {
      let a = F[3 * f + i], b = F[3 * f + ((i + 1) % 3)];
      if (a > b) [a, b] = [b, a];
      const key = a * nv + b;
      if (seen.has(key)) continue;
      seen.add(key);
      pushEdge(a, b);
    }
  }
  seen.clear();

  const has = (f, v) => F[3 * f] === v || F[3 * f + 1] === v || F[3 * f + 2] === v;
  let faces = nf;
  while (faces > budget && heap.length > 0) {
    const [, v1, v2, s1, s2, x, y, z] = pop();
    if (dead[v1] || dead[v2] || stamp[v1] !== s1 || stamp[v2] !== s2) continue;
    // Faces that survive the collapse (touching one end, not both) must not flip.
    let flips = false;
    for (const v of [v1, v2]) {
      for (const f of vf[v]) {
        if (!alive[f] || (has(f, v1) && has(f, v2))) continue;
        const n0 = normalOf(f);
        const n1 = normalOf(f, v, x, y, z);
        if (n0[0] * n1[0] + n0[1] * n1[1] + n0[2] * n1[2] <= 0) { flips = true; break; }
      }
      if (flips) break;
    }
    if (flips) continue;
    P[3 * v1] = x; P[3 * v1 + 1] = y; P[3 * v1 + 2] = z;
    for (let k = 0; k < 10; k++) Q[v1 * 10 + k] += Q[v2 * 10 + k];
    for (const f of vf[v2]) {
      if (!alive[f]) continue;
      for (let i = 0; i < 3; i++) if (F[3 * f + i] === v2) F[3 * f + i] = v1;
      const a = F[3 * f], b = F[3 * f + 1], c = F[3 * f + 2];
      if (a === b || b === c || a === c) { alive[f] = 0; faces--; }
      else vf[v1].push(f);
    }
    vf[v2] = [];
    dead[v2] = 1;
    vf[v1] = vf[v1].filter((f) => alive[f]);
    stamp[v1]++;
    const around = new Set();
    for (const f of vf[v1]) for (let i = 0; i < 3; i++) { const u = F[3 * f + i]; if (u !== v1) around.add(u); }
    for (const u of around) pushEdge(v1, u);
  }

  // Compact: only vertices alive faces still reference.
  const remap = new Int32Array(nv).fill(-1);
  const outPos = [];
  const outIdx = [];
  for (let f = 0; f < nf; f++) {
    if (!alive[f]) continue;
    for (let i = 0; i < 3; i++) {
      const v = F[3 * f + i];
      if (remap[v] < 0) { remap[v] = outPos.length / 3; outPos.push(P[3 * v], P[3 * v + 1], P[3 * v + 2]); }
      outIdx.push(remap[v]);
    }
  }
  return { positions: new Float32Array(outPos), indices: Uint32Array.from(outIdx), triangles: outIdx.length / 3 };
}

/** [x0, y0, z0, x1, y1, z1] of a positions array (3 floats per vertex). */
export function bboxOfMesh(positions) {
  const bb = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
  for (let i = 0; i < positions.length; i += 3) {
    for (let a = 0; a < 3; a++) {
      const v = positions[i + a];
      if (v < bb[a]) bb[a] = v;
      if (v > bb[a + 3]) bb[a + 3] = v;
    }
  }
  return bb;
}

/** "DCM1" | u32 vertices | u32 indices | u32 flags (bit 0: u32 indices) |
 *  f32 ×3 per vertex | indices (u16 unless > 65 535 vertices) | zero pad to 4. */
export function encodeMesh({ positions, indices }) {
  const nv = positions.length / 3;
  const wide = nv > 65535;
  const idxBytes = indices.length * (wide ? 4 : 2);
  const total = Math.ceil((16 + positions.length * 4 + idxBytes) / 4) * 4;
  const out = new Uint8Array(total);
  const dv = new DataView(out.buffer);
  out.set([0x44, 0x43, 0x4d, 0x31], 0);
  dv.setUint32(4, nv, true);
  dv.setUint32(8, indices.length, true);
  dv.setUint32(12, wide ? 1 : 0, true);
  for (let i = 0; i < positions.length; i++) dv.setFloat32(16 + i * 4, positions[i], true);
  const o = 16 + positions.length * 4;
  for (let i = 0; i < indices.length; i++) {
    if (wide) dv.setUint32(o + i * 4, indices[i], true);
    else dv.setUint16(o + i * 2, indices[i], true);
  }
  return out;
}
