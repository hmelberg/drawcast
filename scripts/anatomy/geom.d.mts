// Type surface of geom.mjs for the node tests. Points are [x, y] arrays.

export function simplify(pts: number[][], tol: number): number[][];
export function ringArea(pts: number[][]): number;
export function centroid(rings: number[][][]): number[];
export function convexHull(points: number[][]): number[][];
export function blob(s: { c: number[]; rx: number; ry: number; rot?: number; wobble?: number; seed?: number; n?: number }): number[][];
export function tube(path: number[][], width: number): number[][];
export function closestPair(a: number[][], b: number[][]): { p: number[]; q: number[]; d: number };
export const round1: (pts: number[][]) => number[][];
