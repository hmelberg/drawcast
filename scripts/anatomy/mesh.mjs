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

/** Cluster at `cell`, growing it by a quarter until the triangle budget holds. */
export function decimateToBudget(positions, cell, budget) {
  let c = cell;
  let mesh = clusterMesh(positions, c);
  while (mesh.triangles > budget) {
    c *= 1.25;
    mesh = clusterMesh(positions, c);
  }
  return { mesh, cell: c };
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
