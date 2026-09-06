// The 3D body: pure rules the anatomy branch of openModel3d relies on. No DOM,
// no 3dmol — node tests cover everything here. The mesh pack in
// public/anatomy3d/ is written by scripts/build-anatomy-meshes.mjs; the wire
// format lives in scripts/anatomy/mesh.mjs (encodeMesh) and here (decodeMesh).

export interface PackMesh {
  positions: Float32Array;
  indices: Uint16Array | Uint32Array;
  triangles: number;
}

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
