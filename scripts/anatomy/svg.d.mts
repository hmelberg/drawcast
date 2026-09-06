// Type surface of svg.mjs for the node tests.

export type Matrix = [number, number, number, number, number, number];

export interface SvgPath {
  id: string | null;
  d: string;
  fill: string;
  chain: (string | null)[];
  matrix: Matrix;
}

export const IDENTITY: Matrix;
export function parseTransform(str: string | null | undefined): Matrix;
export function compose(A: Matrix, B: Matrix): Matrix;
export function apply(M: Matrix, p: number[]): number[];
export function parseSvg(text: string): { viewBox: number[] | null; paths: SvgPath[] };
export function ringsOf(path: SvgPath, sample: (d: string, segments?: number) => number[][][], segments?: number): number[][][];
