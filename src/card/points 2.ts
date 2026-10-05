// A card's points, compactly (card lab round 2, 2026-10-05): integer points
// as one string, the first point whole and each next one as its difference
// from the one before. Points on a curve lie close together, so most numbers
// are one or two digits.

export type Pt = [number, number];

export function encodePts(pts: readonly Pt[]): string {
  const out: number[] = [];
  let px = 0;
  let py = 0;
  pts.forEach(([x, y], i) => {
    const rx = Math.round(x);
    const ry = Math.round(y);
    out.push(i === 0 ? rx : rx - px, i === 0 ? ry : ry - py);
    px = rx;
    py = ry;
  });
  return out.join(" ");
}

export function decodePts(s: string): Pt[] {
  const n = s.trim() ? s.trim().split(/\s+/).map(Number) : [];
  const out: Pt[] = [];
  let x = 0;
  let y = 0;
  for (let i = 0; i + 1 < n.length; i += 2) {
    x = i === 0 ? n[0] : x + n[i];
    y = i === 0 ? n[1] : y + n[i + 1];
    out.push([x, y]);
  }
  return out;
}
