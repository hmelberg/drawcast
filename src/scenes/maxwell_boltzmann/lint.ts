// What maxwell_boltzmann's params say that the schema cannot check: a
// temperature or molar mass that is no amount, a temperature outside the
// t_range the axes are scaled for, a catalyst's Ea at or above Ea (or with
// no Ea), an Ea beyond the axis, a share too thin to see without tail_zoom,
// speed marks the energy axis has no place for.
import { fractionAbove, pdf } from "./physics";
import { axisOfEnergy, LIMITS, readModel, SPEEDS, type MaxwellParams } from "./model";

type Issue = { severity: "warn" | "error"; message: string };

const num = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

export function lintMaxwell(P: MaxwellParams): Issue[] {
  const out: Issue[] = [];
  const m = readModel(P);
  const amount = (field: string, v: unknown, [lo, hi]: readonly [number, number], unit: string): void => {
    if (v === undefined) return;
    if (!num(v) || v <= 0) out.push({ severity: "error", message: `${field} must be a positive number (${unit})` });
    else if (v < lo || v > hi) out.push({ severity: "warn", message: `${field} ${v} ${unit} is outside ${lo}–${hi}` });
  };
  amount("T", P.T, LIMITS.T, "K");
  amount("molar_mass", P.molar_mass, LIMITS.M, "g/mol");
  if (P.compare && typeof P.compare === "object") {
    amount("compare.T", P.compare.T, LIMITS.T, "K");
    amount("compare.molar_mass", P.compare.molar_mass, LIMITS.M, "g/mol");
    if (P.compare.T === undefined && P.compare.molar_mass === undefined) out.push({ severity: "warn", message: "compare gives neither T nor molar_mass — it draws the same curve twice" });
    if (m.mode === "energy" && P.compare.molar_mass !== undefined && P.compare.T === undefined) out.push({ severity: "warn", message: "the energy distribution does not depend on molar mass — a compare that changes only molar_mass draws the same curve (use mode speed)" });
  }
  if (P.t_range !== undefined) {
    const t = P.t_range;
    if (!Array.isArray(t) || t.length !== 2 || !num(t[0]) || !num(t[1]) || !(t[1] > t[0]) || !(t[0] > 0)) out.push({ severity: "error", message: "t_range must be [low, high] in K, low < high" });
  }
  for (const [field, T] of [["T", m.main.T], ["compare.T", m.compare?.T]] as const) {
    if (T !== undefined && (T < m.tRange[0] || T > m.tRange[1])) out.push({ severity: "warn", message: `${field} ${T} K is outside t_range [${m.tRange.join(", ")}] — the axes are scaled for that range` });
  }
  if (P.ea !== undefined && (!num(P.ea) || P.ea <= 0)) out.push({ severity: "error", message: "ea must be a positive number (kJ/mol)" });
  if (P.ea_catalyst !== undefined) {
    if (!num(P.ea_catalyst) || P.ea_catalyst <= 0) out.push({ severity: "error", message: "ea_catalyst must be a positive number (kJ/mol)" });
    else if (m.ea === null) out.push({ severity: "error", message: "ea_catalyst needs ea (the uncatalysed barrier) beside it" });
    else if (P.ea_catalyst >= m.ea) out.push({ severity: "error", message: `ea_catalyst ${P.ea_catalyst} is not below ea ${m.ea} — a catalyst LOWERS the barrier` });
  }
  if (m.ea !== null) {
    if (axisOfEnergy(m.mode, m.ea, m.main.M) > m.xMax) out.push({ severity: "warn", message: `Eₐ is past the axis's end (x_max ${m.xMax}) — its line is not drawn` });
    const F = fractionAbove(m.ea, m.main.T);
    if (F < 0.002 && m.tailZoom === null) out.push({ severity: "warn", message: `only ${(F * 100).toPrecision(2)} % of molecules are past Eₐ — the shaded tail is too thin to see; set tail_zoom (e.g. ${Math.max(10, 10 ** Math.round(Math.log10(0.02 / F)))})` });
  }
  if (P.tail_zoom !== undefined) {
    if (!num(P.tail_zoom) || P.tail_zoom <= 1) out.push({ severity: "error", message: "tail_zoom must be a number above 1 (the tail's magnification)" });
    else if (m.ea === null) out.push({ severity: "warn", message: "tail_zoom magnifies the tail past Eₐ — give ea" });
    else {
      // The magnified tail must fit under the plot's top where it starts (the lowest barrier, the hottest curve).
      const start = Math.min(m.ea, m.eaCat ?? Infinity);
      const high = Math.max(...[m.main, ...(m.compare ? [m.compare] : [])].map((c) => pdf(m.mode, axisOfEnergy(m.mode, start, c.M), c.T, c.M)));
      if (high * P.tail_zoom > m.yMax) {
        const raw = (0.8 * m.yMax) / high;
        const pow = 10 ** Math.floor(Math.log10(raw));
        const fit = [5, 2, 1].map((k) => k * pow).find((v) => v <= raw) ?? pow;
        out.push({ severity: "warn", message: `tail_zoom ${P.tail_zoom} lifts the tail off the top of the plot — ${fit >= 2 ? `use ${fit} or less` : "the tail needs no magnifying"}` });
      }
    }
  }
  if (Array.isArray(P.speeds)) {
    for (const s of P.speeds) if (!(SPEEDS as readonly string[]).includes(s)) out.push({ severity: "warn", message: `speeds: "${s}" is not one of ${SPEEDS.join(", ")}` });
    if (m.mode === "energy" && P.speeds.includes("rms")) out.push({ severity: "warn", message: "speeds: rms is a speed — the energy axis marks only mp (RT/2) and mean (3RT/2)" });
  }
  if (P.x_max !== undefined && (!num(P.x_max) || P.x_max <= 0)) out.push({ severity: "error", message: "x_max must be a positive number" });
  return out;
}
