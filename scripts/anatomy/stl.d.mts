export function parseStl(buf: Uint8Array | ArrayBuffer): { positions: Float32Array; triangles: number };
export function bboxOf(positions: Float32Array | number[]): { min: number[]; max: number[] };
