// tests/contrast.ts — WCAG relative luminance and contrast ratio.

/** WCAG 2.1 relative luminance of a #rrggbb colour. */
export function relativeLuminance(hex: string): number {
  const h = hex.replace("#", "");
  const ch = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
  const lin = ch.map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
}

/** Contrast ratio between two luminances (WCAG 2.1). */
export function contrastOfLuminances(a: number, b: number): number {
  const [x, y] = [a, b].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

export function contrastRatio(a: string, b: string): number {
  return contrastOfLuminances(relativeLuminance(a), relativeLuminance(b));
}
