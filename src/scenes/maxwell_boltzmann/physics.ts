// The Maxwell–Boltzmann distribution of an ideal gas, per molecule, exactly:
//
//   speed   f(v) = 4π (M / 2πRT)^{3/2} v² exp(−Mv² / 2RT)        (v in m/s)
//   energy  f(E) = 2/√π · (RT)^{−3/2} · √E · exp(−E / RT)        (E in kJ/mol)
//
// Both are normalised (∫ f = 1). They are the SAME molecules: a speed v is a
// kinetic energy E = ½Mv², so the share of molecules with at least the
// activation energy Ea is one number whichever axis the figure draws —
//
//   F(Ea) = erfc(√x) + 2√(x/π) e^{−x},   x = Ea / RT
//
// (the upper regularised gamma function Q(3/2, x)). Collision theory's
// exp(−Ea/RT) — the share of COLLISIONS energetic enough along the line of
// centres, the Arrhenius factor — is reported beside it as a value, not
// drawn: the shaded area under the drawn curve is F.

export const R = 8.314462618; // J/(mol·K)

export type Mode = "speed" | "energy";

/** Molar mass in g/mol → kg/mol. */
const kg = (M: number): number => M / 1000;

export const vMostProbable = (T: number, M: number): number => Math.sqrt((2 * R * T) / kg(M));
export const vMean = (T: number, M: number): number => Math.sqrt((8 * R * T) / (Math.PI * kg(M)));
export const vRms = (T: number, M: number): number => Math.sqrt((3 * R * T) / kg(M));
/** Most probable and mean kinetic energy, kJ/mol: RT/2 and 3RT/2. */
export const eMostProbable = (T: number): number => (R * T) / 2000;
export const eMean = (T: number): number => (3 * R * T) / 2000;

/** The speed density at v (per m/s). */
export function speedPdf(v: number, T: number, M: number): number {
  if (!(v >= 0)) return 0;
  const a = kg(M) / (2 * R * T);
  return 4 * Math.PI * (a / Math.PI) ** 1.5 * v * v * Math.exp(-a * v * v);
}

/** The energy density at E kJ/mol (per kJ/mol). */
export function energyPdf(E: number, T: number): number {
  if (!(E >= 0)) return 0;
  const rt = (R * T) / 1000;
  return (2 / Math.sqrt(Math.PI)) * rt ** -1.5 * Math.sqrt(E) * Math.exp(-E / rt);
}

export const pdf = (mode: Mode, x: number, T: number, M: number): number => (mode === "speed" ? speedPdf(x, T, M) : energyPdf(x, T));

/** The density's highest value (at the most probable speed or energy). */
export const peakPdf = (mode: Mode, T: number, M: number): number => (mode === "speed" ? speedPdf(vMostProbable(T, M), T, M) : energyPdf(eMostProbable(T), T));

/** erfc to ~1e-13 relative (continued fraction beyond x = 2, series below). */
export function erfc(x: number): number {
  if (x < 0) return 2 - erfc(-x);
  if (x < 2) {
    // erf by its Taylor series: converges fast for x < 3.
    let sum = x;
    let term = x;
    for (let n = 1; n < 200; n++) {
      term *= (-x * x) / n;
      const add = term / (2 * n + 1);
      sum += add;
      if (Math.abs(add) < 1e-17 * Math.abs(sum)) break;
    }
    return 1 - (2 / Math.sqrt(Math.PI)) * sum;
  }
  // Lentz's continued fraction: erfc x = e^{−x²}/√π · 1/(x + ½/(x + 1/(x + 3/2/(x + …))))
  let f = x;
  let C = x;
  let D = 0;
  for (let n = 1; n < 300; n++) {
    const a = n / 2;
    D = x + a * D;
    C = x + a / C;
    D = 1 / D;
    const delta = C * D;
    f *= delta;
    if (Math.abs(delta - 1) < 1e-16) break;
  }
  return Math.exp(-x * x) / (Math.sqrt(Math.PI) * f);
}

/** The share of molecules with kinetic energy ≥ Ea (kJ/mol) at T. */
export function fractionAbove(Ea: number, T: number): number {
  if (!(Ea > 0)) return 1;
  const x = (Ea * 1000) / (R * T);
  return erfc(Math.sqrt(x)) + 2 * Math.sqrt(x / Math.PI) * Math.exp(-x);
}

/** The speed at which a molecule of molar mass M (g/mol) has kinetic energy Ea (kJ/mol). */
export const speedForEnergy = (Ea: number, M: number): number => Math.sqrt((2 * Ea * 1000) / kg(M));
/** The kinetic energy (kJ/mol) of a molecule at speed v. */
export const energyForSpeed = (v: number, M: number): number => (0.5 * kg(M) * v * v) / 1000;

/** The Arrhenius (collision-theory) factor exp(−Ea/RT). */
export const boltzmannFactor = (Ea: number, T: number): number => Math.exp((-Ea * 1000) / (R * T));
