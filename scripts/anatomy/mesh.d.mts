export interface ClusteredMesh {
  positions: Float32Array;
  indices: Uint32Array;
  triangles: number;
}
export function toPack(positions: Float32Array, centre: [number, number, number]): Float32Array;
export function clusterMesh(positions: Float32Array, cell: number): ClusteredMesh;
export function decimateToBudget(positions: Float32Array, cell: number, budget: number): { mesh: ClusteredMesh; cell: number };
export function simplifyMesh(mesh: { positions: Float32Array; indices: Uint32Array | Uint16Array }, budget: number): ClusteredMesh;
export function bboxOfMesh(positions: Float32Array): [number, number, number, number, number, number];
export function encodeMesh(mesh: { positions: Float32Array; indices: Uint32Array | Uint16Array }): Uint8Array;
