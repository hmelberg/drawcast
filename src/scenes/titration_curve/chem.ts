// The chemistry of a titration, exactly: the pH at every volume of titrant
// is the root of the solution's charge balance — every ion counted,
// dilution included, water's own Kw included — never a patchwork of the
// textbook's region formulas (initial / buffer / equivalence / excess).
// The same root gives the right answer in every region and between them.
//
//   acid analyte (HₙA, C mol/L after dilution), NaOH titrant (Na⁺ = Cₜ):
//     [H⁺] + [Na⁺] = [OH⁻] + C·Σ j·αⱼ          (αⱼ: the share with j protons lost)
//   base analyte (B taking up to n protons), HCl titrant (Cl⁻ = Cₜ):
//     [H⁺] + C·Σ (n − j)·αⱼ = [OH⁻] + [Cl⁻]
//
// A strong acid is fully dissociated (charge 1 per formula unit), a strong
// base fully protonated's opposite (its Na⁺ counts). A weak one's pKa's are
// those of the ACID form (acetic acid 4.76; for ammonia, NH₄⁺'s 9.25), so
// half-way to each equivalence point the pH is (nearly) that pKa for both.
// Activities are taken as concentrations (25 °C, Kw = 1.0 × 10⁻¹⁴).

export const KINDS = ["strong_acid", "weak_acid", "strong_base", "weak_base"] as const;
export type Kind = (typeof KINDS)[number];

export const KW = 1e-14;

export interface Titration {
  kind: Kind;
  /** Analyte concentration, mol/L. */
  ca: number;
  /** Analyte volume, mL. */
  va: number;
  /** Titrant concentration, mol/L. */
  ct: number;
  /** A weak analyte's pKa's (its acid form's), ascending; empty for a strong one. */
  pkas: number[];
}

export const isAcid = (k: Kind): boolean => k === "strong_acid" || k === "weak_acid";
export const isWeak = (k: Kind): boolean => k === "weak_acid" || k === "weak_base";

/** Protons the analyte gives up (an acid) or takes (a base) per formula unit. */
export const protons = (t: Titration): number => (isWeak(t.kind) ? Math.max(1, t.pkas.length) : 1);

/** The equivalence volumes (mL): k·Cₐ·Vₐ / Cₜ for each proton k. */
export function equivalenceVolumes(t: Titration): number[] {
  const out: number[] = [];
  for (let k = 1; k <= protons(t); k++) out.push((k * t.ca * t.va) / t.ct);
  return out;
}

/** Σ j·αⱼ — the mean number of protons lost from the fully protonated form, at [H⁺] = h. */
export function protonsLost(h: number, pkas: number[]): number {
  const n = pkas.length;
  // Terms hⁿ⁻ʲ·K₁…Kⱼ, scaled by hⁿ so nothing underflows at high pH.
  let num = 0;
  let den = 0;
  let prod = 1;
  for (let j = 0; j <= n; j++) {
    if (j > 0) prod *= 10 ** -pkas[j - 1] / h;
    den += prod;
    num += j * prod;
  }
  return num / den;
}

/** The charge imbalance (positive − negative, mol/L) at a trial pH: falls as the pH rises. */
function imbalance(t: Titration, v: number, pH: number): number {
  const h = 10 ** -pH;
  const oh = KW / h;
  const total = t.va + v;
  const c = (t.ca * t.va) / total;
  const ct = (t.ct * v) / total;
  if (isAcid(t.kind)) {
    const anion = t.kind === "strong_acid" ? c : c * protonsLost(h, t.pkas);
    return h + ct - oh - anion;
  }
  if (t.kind === "strong_base") return h + c - oh - ct;
  const n = t.pkas.length;
  const cation = c * (n - protonsLost(h, t.pkas));
  return h + cation - oh - ct;
}

/** The pH after v mL of titrant: the charge balance's root (bisection; it is monotone). */
export function phAt(t: Titration, v: number): number {
  let lo = -3;
  let hi = 17;
  for (let i = 0; i < 80; i++) {
    const mid = (lo + hi) / 2;
    if (imbalance(t, Math.max(0, v), mid) > 0) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/** The volume in [a, b] at which the (monotone) curve reaches pH p, or null. */
export function volumeAtPh(t: Titration, p: number, a: number, b: number): number | null {
  const fa = phAt(t, a) - p;
  const fb = phAt(t, b) - p;
  if (fa === 0) return a;
  if (fa * fb > 0) return null;
  let lo = a;
  let hi = b;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if ((phAt(t, mid) - p) * fa > 0) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/** The curve's samples from 0 to vMax: even, with extra near each equivalence point (the jump). */
export function sampleCurve(t: Titration, vMax: number, n = 320): [number, number][] {
  const xs = new Set<number>();
  for (let i = 0; i <= n; i++) xs.add((vMax * i) / n);
  for (const ve of equivalenceVolumes(t)) {
    const w = Math.max(vMax * 0.04, ve * 0.03);
    for (let i = -60; i <= 60; i++) {
      const x = ve + (w * i) / 60;
      if (x >= 0 && x <= vMax) xs.add(x);
    }
  }
  return [...xs].sort((a, b) => a - b).map((x) => [x, phAt(t, x)]);
}

// ---- indicators ------------------------------------------------------------

export interface Indicator {
  name: string;
  /** Its short, drawn name. */
  label: string;
  lo: number;
  hi: number;
  /** Its colour below lo (acid form) and above hi (base form). */
  acid: string;
  base: string;
}

/** The usual four, by transition range (pH). */
export const INDICATORS: Record<string, Indicator> = {
  methyl_orange: { name: "methyl_orange", label: "methyl orange", lo: 3.1, hi: 4.4, acid: "#c8372d", base: "#e8b923" },
  methyl_red: { name: "methyl_red", label: "methyl red", lo: 4.4, hi: 6.2, acid: "#c8372d", base: "#e8c547" },
  bromothymol_blue: { name: "bromothymol_blue", label: "bromothymol blue", lo: 6.0, hi: 7.6, acid: "#d9c22e", base: "#2f6bb3" },
  phenolphthalein: { name: "phenolphthalein", label: "phenolphthalein", lo: 8.2, hi: 10.0, acid: "#eef2f3", base: "#d9468f" },
};

const hex = (c: string): [number, number, number] => [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)];

/** The indicator's colour at a pH: its acid form below the range, its base form above, mixed across it. */
export function indicatorColor(ind: Indicator, pH: number): string {
  const s = Math.min(1, Math.max(0, (pH - ind.lo) / (ind.hi - ind.lo)));
  const [a, b] = [hex(ind.acid), hex(ind.base)];
  return "#" + a.map((x, i) => Math.round(x + (b[i] - x) * s).toString(16).padStart(2, "0")).join("");
}

/** The indicator whose range's middle is nearest a pH. */
export function nearestIndicator(pH: number): Indicator {
  let best = INDICATORS.phenolphthalein;
  for (const ind of Object.values(INDICATORS)) if (Math.abs((ind.lo + ind.hi) / 2 - pH) < Math.abs((best.lo + best.hi) / 2 - pH)) best = ind;
  return best;
}
