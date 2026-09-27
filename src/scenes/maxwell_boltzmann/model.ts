// maxwell_boltzmann's params, read once into what the layout, the lint and
// the widget use: defaults filled in, the axes' scale fixed from t_range so
// a change of T moves the CURVE, never the axes.
import { niceCeil } from "../plot-axes";
import { peakPdf, speedForEnergy, vRms, type Mode } from "./physics";

export interface CompareParams {
  T?: number;
  molar_mass?: number;
  label?: string;
}

export interface MaxwellParams {
  mode?: Mode;
  T?: number;
  molar_mass?: number;
  label?: string;
  compare?: CompareParams;
  ea?: number;
  ea_catalyst?: number;
  speeds?: string[];
  t_range?: [number, number];
  x_max?: number;
  tail_zoom?: number;
  show_fraction?: boolean;
  x_label?: string;
  y_label?: string;
  title?: string;
}

export const SPEEDS = ["mp", "mean", "rms"] as const;
export const DEFAULT_T_RANGE: [number, number] = [250, 600];
/** The widget's and the lint's bounds. */
export const LIMITS = { T: [20, 5000] as const, M: [1, 500] as const };

export interface Curve {
  T: number;
  M: number;
  label: string | null;
}

export interface Model {
  mode: Mode;
  main: Curve;
  compare: Curve | null;
  ea: number | null;
  eaCat: number | null;
  speeds: Set<string>;
  tRange: [number, number];
  xMax: number;
  yMax: number;
  tailZoom: number | null;
  showFraction: boolean;
}

const num = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const pos = (v: unknown, d: number): number => (num(v) && v > 0 ? v : d);
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

/** An energy on the drawn axis: kJ/mol itself, or the speed that carries it. */
export const axisOfEnergy = (mode: Mode, Ea: number, M: number): number => (mode === "energy" ? Ea : speedForEnergy(Ea, M));

export function readModel(P: MaxwellParams): Model {
  const mode: Mode = P.mode === "energy" ? "energy" : "speed";
  const main: Curve = { T: pos(P.T, 300), M: pos(P.molar_mass, 28), label: str(P.label) };
  const C = P.compare && typeof P.compare === "object" ? P.compare : null;
  const compare: Curve | null = C ? { T: pos(C.T, main.T), M: pos(C.molar_mass, main.M), label: str(C.label) } : null;
  const ea = num(P.ea) && P.ea > 0 ? P.ea : null;
  const eaCat = ea !== null && num(P.ea_catalyst) && P.ea_catalyst > 0 ? P.ea_catalyst : null;
  const curves = [main, ...(compare ? [compare] : [])];
  const Ts = curves.map((c) => c.T);
  const tr = P.t_range;
  const tRange: [number, number] =
    Array.isArray(tr) && num(tr[0]) && num(tr[1]) && tr[1] > tr[0] && tr[0] > 0
      ? [tr[0], tr[1]]
      : [
          Math.min(...Ts) < DEFAULT_T_RANGE[0] ? Math.round(0.8 * Math.min(...Ts)) : DEFAULT_T_RANGE[0],
          Math.max(...Ts) > DEFAULT_T_RANGE[1] ? Math.round(1.25 * Math.max(...Ts)) : DEFAULT_T_RANGE[1],
        ];
  const Ms = curves.map((c) => c.M);
  const eaAxis = ea === null ? 0 : Math.max(...Ms.map((M) => axisOfEnergy(mode, ea, M)));
  const base = mode === "speed" ? 2.4 * vRms(tRange[1], Math.min(...Ms)) : (5 * 8.314462618 * tRange[1]) / 1000;
  const xMax = num(P.x_max) && P.x_max > 0 ? P.x_max : niceCeil(Math.max(base, eaAxis * 1.3));
  const yMax = 1.28 * Math.max(...Ms.map((M) => peakPdf(mode, tRange[0], M)));
  const speeds = new Set(Array.isArray(P.speeds) ? P.speeds.filter((s) => (SPEEDS as readonly string[]).includes(s)) : []);
  return {
    mode,
    main,
    compare,
    ea,
    eaCat,
    speeds,
    tRange,
    xMax,
    yMax,
    tailZoom: num(P.tail_zoom) && P.tail_zoom > 1 ? P.tail_zoom : null,
    showFraction: P.show_fraction !== false,
  };
}
