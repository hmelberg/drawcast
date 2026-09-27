// What titration_curve's params say that the schema cannot check: a
// concentration or volume that is no amount, a pKa given to a strong
// analyte (ignored) or missing from a weak one (defaulted), pKa's out of
// order, a cursor or an equivalence point off the axis, an unknown
// indicator, a comparison titrated with the other titrant.
import { equivalenceVolumes, isAcid, isWeak, KINDS, type Kind } from "./chem";
import { LIMITS, readModel, type TitrationParams } from "./model";

type Issue = { severity: "warn" | "error"; message: string };

const num = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

export function lintTitration(P: TitrationParams): Issue[] {
  const out: Issue[] = [];
  const m = readModel(P);
  for (const e of m.errors) out.push({ severity: "error", message: e });
  const amount = (field: string, v: unknown, [lo, hi]: readonly [number, number], unit: string): void => {
    if (v === undefined) return;
    if (!num(v) || v <= 0) out.push({ severity: "error", message: `${field} must be a positive number (${unit})` });
    else if (v < lo || v > hi) out.push({ severity: "warn", message: `${field} ${v} ${unit} is outside the usual ${lo}–${hi}` });
  };
  const pkas = (field: string, kind: Kind, given: unknown): void => {
    if (given === undefined) {
      if (isWeak(kind)) out.push({ severity: "warn", message: `${field}: a ${kind.replace("_", " ")} needs its pKa — ${isAcid(kind) ? "4.76 (acetic acid)" : "9.25 (NH₄⁺)"} is assumed` });
      return;
    }
    if (!isWeak(kind)) {
      out.push({ severity: "warn", message: `${field} is ignored: a ${kind.replace("_", " ")} is fully ${isAcid(kind) ? "dissociated" : "ionised"} — use kind weak_${isAcid(kind) ? "acid" : "base"}` });
      return;
    }
    const list = Array.isArray(given) ? given : [given];
    if (list.length === 0 || list.length > 3 || !list.every(num)) {
      out.push({ severity: "error", message: `${field} must be a number or a list of 1–3 numbers` });
      return;
    }
    for (const p of list) if (p < LIMITS.pka[0] || p > LIMITS.pka[1]) out.push({ severity: "warn", message: `${field} ${p} is outside ${LIMITS.pka[0]}–${LIMITS.pka[1]}` });
    for (let i = 1; i < list.length; i++) if (!(list[i] > list[i - 1])) out.push({ severity: "error", message: `${field}: a polyprotic analyte's pKa's rise (pKa1 < pKa2 < pKa3) — got ${JSON.stringify(list)}` });
  };
  amount("c_analyte", P.c_analyte, LIMITS.c, "mol/L");
  amount("v_analyte", P.v_analyte, LIMITS.va, "mL");
  amount("c_titrant", P.c_titrant, LIMITS.c, "mol/L");
  pkas("pka", m.main.kind, P.pka);
  if (P.kind !== undefined && !KINDS.includes(P.kind as Kind)) out.push({ severity: "error", message: `kind "${String(P.kind)}" is not one of ${KINDS.join(", ")}` });
  if (P.v_max !== undefined && (!num(P.v_max) || P.v_max <= 0)) out.push({ severity: "error", message: "v_max must be a positive number (mL)" });
  const eqs = equivalenceVolumes(m.main);
  if (eqs[eqs.length - 1] > m.vMax) out.push({ severity: "warn", message: `the equivalence point (${eqs[eqs.length - 1].toFixed(1)} mL) is past v_max ${m.vMax} mL — it is not drawn` });
  if (P.v !== undefined) {
    if (!num(P.v)) out.push({ severity: "error", message: "v (the cursor's volume) must be a number of mL" });
    else if (P.v < 0 || P.v > m.vMax) out.push({ severity: "warn", message: `v ${P.v} mL is off the axis (0–${m.vMax} mL) — drawn at its end` });
  }
  if (P.trace === true && P.v === undefined) out.push({ severity: "warn", message: "trace draws the curve up to v — give v (and animate it)" });
  if (Array.isArray(P.marks)) for (const k of P.marks) if (!["equivalence", "half", "buffer"].includes(k)) out.push({ severity: "warn", message: `marks: "${k}" is not one of equivalence, half, buffer` });
  if (P.compare && typeof P.compare === "object") {
    const C = P.compare;
    if (C.kind !== undefined && !KINDS.includes(C.kind as Kind)) out.push({ severity: "error", message: `compare.kind "${String(C.kind)}" is not one of ${KINDS.join(", ")}` });
    amount("compare.c_analyte", C.c_analyte, LIMITS.c, "mol/L");
    amount("compare.v_analyte", C.v_analyte, LIMITS.va, "mL");
    amount("compare.c_titrant", C.c_titrant, LIMITS.c, "mol/L");
    if (m.compare) {
      if (C.pka !== undefined || !isWeak(m.compare.kind)) pkas("compare.pka", m.compare.kind, C.pka);
      if (isAcid(m.compare.kind) !== isAcid(m.main.kind)) out.push({ severity: "warn", message: "compare titrates a base against an acid's curve (or the reverse): the two use different titrants" });
    }
  }
  return out;
}
