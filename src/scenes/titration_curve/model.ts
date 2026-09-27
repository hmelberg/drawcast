// titration_curve's params, read once into the numbers the layout, the lint
// and the widget all use — defaults filled in, bad values set aside (the
// lint names them).
import { niceCeil } from "../plot-axes";
import { equivalenceVolumes, INDICATORS, isAcid, isWeak, KINDS, type Indicator, type Kind, type Titration } from "./chem";

export interface CompareParams {
  kind?: Kind;
  c_analyte?: number;
  v_analyte?: number;
  c_titrant?: number;
  pka?: number | number[];
  label?: string;
}

export interface TitrationParams {
  kind?: Kind;
  c_analyte?: number;
  v_analyte?: number;
  c_titrant?: number;
  pka?: number | number[];
  v?: number;
  v_max?: number;
  trace?: boolean;
  indicator?: string;
  marks?: string[];
  neutral?: boolean;
  compare?: CompareParams;
  label?: string;
  analyte?: string;
  titrant?: string;
  numbers?: boolean;
  flask?: boolean;
  x_label?: string;
  y_label?: string;
  title?: string;
}

export const MARKS = ["equivalence", "half", "buffer"] as const;

/** The widget's bounds (and the lint's). */
export const LIMITS = { c: [0.001, 2] as const, va: [1, 250] as const, pka: [0.5, 13.5] as const };

export const DEFAULT_PKA = { acid: 4.76, base: 9.25 };

export interface Model {
  main: Titration;
  compare: Titration | null;
  compareLabel: string | null;
  label: string | null;
  vMax: number;
  /** The cursor's volume (mL), or null when the figure has none. */
  v: number | null;
  trace: boolean;
  indicator: Indicator | null;
  marks: Set<string>;
  neutral: boolean;
  numbers: boolean;
  flask: boolean;
  analyte: string;
  titrant: string;
  errors: string[];
}

const num = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const pos = (v: unknown, d: number): number => (num(v) && v > 0 ? v : d);
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

/** A weak analyte's pKa list, as given (a number or a list of up to 3), ascending; the default when missing. */
export function pkasOf(kind: Kind, given: unknown): number[] {
  if (!isWeak(kind)) return [];
  const list = (Array.isArray(given) ? given : [given]).filter(num).slice(0, 3);
  if (list.length === 0) return [isAcid(kind) ? DEFAULT_PKA.acid : DEFAULT_PKA.base];
  return [...list].sort((a, b) => a - b);
}

export function readModel(P: TitrationParams): Model {
  const errors: string[] = [];
  const kind: Kind = KINDS.includes(P.kind as Kind) ? (P.kind as Kind) : "weak_acid";
  const main: Titration = { kind, ca: pos(P.c_analyte, 0.1), va: pos(P.v_analyte, 25), ct: pos(P.c_titrant, 0.1), pkas: pkasOf(kind, P.pka) };
  let compare: Titration | null = null;
  const C = P.compare && typeof P.compare === "object" ? P.compare : null;
  if (C) {
    const ck: Kind = KINDS.includes(C.kind as Kind) ? (C.kind as Kind) : kind;
    compare = {
      kind: ck,
      ca: pos(C.c_analyte, main.ca),
      va: pos(C.v_analyte, main.va),
      ct: pos(C.c_titrant, main.ct),
      pkas: pkasOf(ck, C.pka ?? (isWeak(kind) && isAcid(kind) === isAcid(ck) ? P.pka : undefined)),
    };
  }
  const lastEq = Math.max(...equivalenceVolumes(main), ...(compare ? equivalenceVolumes(compare) : []));
  const vMax = num(P.v_max) && P.v_max > 0 ? P.v_max : niceCeil(lastEq * (protonsOf(main) > 1 ? 1.4 : 2));
  const v = num(P.v) ? Math.min(vMax, Math.max(0, P.v)) : null;
  const indicator = typeof P.indicator === "string" && P.indicator !== "none" ? (INDICATORS[P.indicator] ?? null) : null;
  if (typeof P.indicator === "string" && P.indicator !== "none" && !indicator) errors.push(`unknown indicator "${P.indicator}" (${Object.keys(INDICATORS).join(", ")} or none)`);
  const marks = new Set(Array.isArray(P.marks) ? P.marks.filter((m) => (MARKS as readonly string[]).includes(m)) : MARKS);
  const acid = isAcid(kind);
  return {
    main,
    compare,
    compareLabel: C ? str(C.label) : null,
    label: str(P.label),
    vMax,
    v,
    trace: P.trace === true && v !== null,
    indicator,
    marks,
    neutral: P.neutral === true,
    numbers: P.numbers !== false,
    flask: P.flask === true,
    analyte: str(P.analyte) ?? (acid ? "acid" : "base"),
    titrant: str(P.titrant) ?? (acid ? "NaOH" : "HCl"),
    errors,
  };
}

const protonsOf = (t: Titration): number => (isWeak(t.kind) ? t.pkas.length : 1);
