// Binary STL: an 80-byte header, a uint32 triangle count, then 50 bytes per
// triangle — a float32 normal (ignored), three float32 vertices, a uint16
// attribute (ignored). Little-endian throughout. BodyParts3D's mirror ships
// exactly this; ASCII STL is not handled and is rejected by the length check.

export function parseStl(buf) {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  if (bytes.length < 84) throw new Error(`STL too short: ${bytes.length} bytes`);
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const triangles = dv.getUint32(80, true);
  const expected = 84 + 50 * triangles;
  if (bytes.length !== expected) throw new Error(`STL length ${bytes.length} does not match header (${triangles} triangles → ${expected} bytes)`);
  const positions = new Float32Array(triangles * 9);
  for (let i = 0; i < triangles; i++) {
    const o = 84 + 50 * i + 12;
    for (let k = 0; k < 9; k++) positions[i * 9 + k] = dv.getFloat32(o + 4 * k, true);
  }
  return { positions, triangles };
}

/** Axis-aligned bounds of a positions array (9 floats per triangle). */
export function bboxOf(positions) {
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < positions.length; i += 3) {
    for (let a = 0; a < 3; a++) {
      const v = positions[i + a];
      if (v < min[a]) min[a] = v;
      if (v > max[a]) max[a] = v;
    }
  }
  return { min, max };
}
