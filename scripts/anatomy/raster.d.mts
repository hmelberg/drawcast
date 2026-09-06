export class Mask {
  width: number;
  height: number;
  cell: number;
  origin: number[];
  data: Uint8Array;
  constructor(width: number, height: number, cell: number, origin?: number[]);
  toCell(p: number[]): number[];
  fillTriangle(a: number[], b: number[], c: number[]): void;
  subtract(other: Mask): void;
  covered(): number;
  rings(): { outer: number[][]; holes: number[][][] }[];
}
