// equation_plot's presets (2026-09-28): the common science curves as
// ready-made params — the equation in its textbook letters, the parameters
// at their canonical values with slider ranges and labels, the axes named
// with their units, and the marks a textbook draws on them (the asymptote,
// the half-way point with its dashed guides, the half-life). `preset: "name"`
// fills in whatever the author did not write:
//
//   every field    the author's wins when given (equation, ranges, labels…)
//   params         merged per name: a bare number sets the preset's value,
//                  an object's keys go over the preset's ({max: 50} keeps
//                  value, min, step and label)
//   marks          the author's are ADDED to the preset's; preset_marks:
//                  false leaves the preset's out
//
// A preset parameter no equation or mark reads any more (the author wrote an
// equation of their own) is left out. Resolving is idempotent: a resolved
// params object resolves to itself, so the widget's patches, the expansion
// before layout (spec/expand.ts) and the template's own read agree.
import type { Command, Spec } from "../../spec/types";
import type { EquationPlotParams, MarkSpec } from "./model";
import type { ParamSpec, ParamsMap } from "../params-ui/params";

/** A preset: the params it fills in. The manifest's `preset` description
 *  carries one line per preset (tests hold the two lists together). */
export interface Preset {
  params: EquationPlotParams;
}

const MM = "v(S) = V_max*S/(K_m + S)";
const MM_PARAMS: ParamsMap = {
  V_max: { value: 10, min: 1, max: 20, step: 0.5, label: "Vmax" },
  K_m: { value: 2, min: 0.2, max: 10, step: 0.1, label: "Km" },
};
const INHIBITOR: ParamsMap = {
  I: { value: 2, min: 0, max: 10, step: 0.5, label: "inhibitor [I]" },
  K_i: { value: 1, min: 0.2, max: 5, step: 0.1, label: "Ki" },
};
const VMAX_LINE: MarkSpec = { kind: "hline", at: "V_max", label: "Vmax", id: "vmax" };
const KM_POINT: MarkSpec = { kind: "point", at: "K_m", x_label: "Km", y_label: "Vmax/2", id: "km" };
const LOGISTIC = "N(t) = K/(1 + ((K - N_0)/N_0)*exp(-r*t))";
const LOGISTIC_PARAMS: ParamsMap = {
  K: { value: 1000, min: 200, max: 1100, step: 50, label: "capacity K" },
  N_0: { value: 10, min: 1, max: 200, step: 1, label: "N0" },
  r: { value: 0.5, min: 0.1, max: 1.5, step: 0.05, label: "growth rate r" },
};
const LOGISTIC_MARKS: MarkSpec[] = [
  { kind: "hline", at: "K", label: "K", id: "capacity" },
  { kind: "point", at: "ln((K - N_0)/N_0)/r", y_label: "K/2", id: "inflection" },
];

export const PRESETS: Record<string, Preset> = {
  michaelis_menten: {
    params: { equation: MM, params: MM_PARAMS, x_range: [0, 20], x_label: "substrate [S]", y_label: "rate v", controls: "both", marks: [VMAX_LINE, KM_POINT] },
  },
  michaelis_menten_competitive: {
    params: {
      equation: [MM, "v_I = V_max*S/(K_m*(1 + I/K_i) + S)"],
      params: { ...MM_PARAMS, ...INHIBITOR },
      x_range: [0, 40],
      x_label: "substrate [S]",
      y_label: "rate v",
      controls: "panel",
      marks: [VMAX_LINE, KM_POINT, { kind: "point", at: "K_m*(1 + I/K_i)", curve: 1, x_label: "apparent Km", id: "km_app" }],
    },
  },
  michaelis_menten_noncompetitive: {
    params: {
      equation: [MM, "v_I = V_max*S/((1 + I/K_i)*(K_m + S))"],
      params: { ...MM_PARAMS, ...INHIBITOR },
      x_range: [0, 30],
      x_label: "substrate [S]",
      y_label: "rate v",
      controls: "panel",
      marks: [VMAX_LINE, { kind: "hline", at: "V_max/(1 + I/K_i)", label: "apparent Vmax", id: "vmax_app" }, KM_POINT, { kind: "point", at: "K_m", curve: 1, id: "km_i" }],
    },
  },
  logistic_growth: {
    params: { equation: LOGISTIC, params: LOGISTIC_PARAMS, x_range: [0, 25], x_label: "time t", y_label: "population N", controls: "both", marks: LOGISTIC_MARKS },
  },
  logistic_vs_exponential: {
    params: {
      equation: [LOGISTIC, "N_exp = N_0*exp(r*t)"],
      params: LOGISTIC_PARAMS,
      x_range: [0, 25],
      y_range: [0, 1200],
      x_label: "time t",
      y_label: "population N",
      controls: "panel",
      marks: LOGISTIC_MARKS,
    },
  },
  dose_response: {
    params: {
      equation: "E(C) = E_0 + E_max*C^n/(EC_50^n + C^n)",
      params: {
        E_0: { value: 0, min: 0, max: 50, step: 1, label: "baseline E0", fixed: true },
        E_max: { value: 100, min: 10, max: 100, step: 1, label: "Emax" },
        EC_50: { value: 1, min: 0.01, max: 100, step: 0.01, label: "EC50" },
        n: { value: 1, min: 0.5, max: 4, step: 0.1, label: "Hill n" },
      },
      x_scale: "log",
      x_range: [0.001, 1000],
      x_label: "dose C",
      y_label: "effect E",
      controls: "both",
      marks: [
        { kind: "hline", at: "E_0 + E_max", label: "max effect", id: "emax" },
        { kind: "point", at: "EC_50", x_label: "EC50", y_label: "half", id: "ec50" },
      ],
    },
  },
  oxygen_dissociation: {
    params: {
      equation: "S(P) = 100*P^n/(P_50^n + P^n)",
      params: {
        P_50: { value: 26.8, min: 15, max: 45, step: 0.1, label: "P50 (mmHg)" },
        n: { value: 2.7, min: 1, max: 4, step: 0.1, label: "Hill n" },
      },
      x_range: [0, 100],
      y_range: [0, 100],
      x_label: "PO2 (mmHg)",
      y_label: "saturation %",
      controls: "both",
      marks: [{ kind: "point", at: "P_50", x_label: "P50", y_label: "50%", id: "p50" }],
    },
  },
  first_order_decay: {
    params: {
      equation: "A(t) = A_0*exp(-k*t)",
      params: { A_0: { value: 100, min: 10, max: 100, step: 5, label: "A0" }, k: { value: 0.2, min: 0.02, max: 1, step: 0.02, label: "rate constant k" } },
      x_range: [0, 20],
      x_label: "time t",
      y_label: "amount A",
      controls: "both",
      marks: [{ kind: "point", at: "ln(2)/k", x_label: "t½", y_label: "A0/2", id: "half_life" }],
    },
  },
  radioactive_decay: {
    params: {
      equation: "N(t) = N_0*(1/2)^(t/T)",
      params: { N_0: { value: 1000, min: 100, max: 1000, step: 50, label: "N0" }, T: { value: 5, min: 1, max: 20, step: 0.5, label: "half-life T" } },
      x_range: [0, 25],
      x_label: "time t",
      y_label: "nuclei N",
      controls: "both",
      marks: [
        { kind: "point", at: "T", x_label: "T", y_label: "N0/2", id: "half_life" },
        { kind: "point", at: "2*T", x_label: "2T", y_label: "N0/4", id: "two_half_lives" },
      ],
    },
  },
  second_order_decay: {
    params: {
      equation: "A(t) = A_0/(1 + k*A_0*t)",
      params: { A_0: { value: 1, min: 0.2, max: 2, step: 0.1, label: "A0" }, k: { value: 0.5, min: 0.05, max: 2, step: 0.05, label: "rate constant k" } },
      x_range: [0, 20],
      x_label: "time t",
      y_label: "concentration A",
      controls: "both",
      marks: [{ kind: "point", at: "1/(k*A_0)", x_label: "t½", y_label: "A0/2", id: "half_life" }],
    },
  },
  beer_lambert: {
    params: {
      equation: "A(c) = epsilon*l*c",
      params: {
        epsilon: { value: 6.22, min: 1, max: 20, step: 0.01, label: "ε (per mM·cm)" },
        l: { value: 1, min: 0.1, max: 2, step: 0.1, label: "path l (cm)" },
        c_1: { value: 0.2, min: 0, max: 0.5, step: 0.01, label: "sample c" },
      },
      x_range: [0, 0.5],
      x_label: "concentration c (mM)",
      y_label: "absorbance A",
      controls: "both",
      marks: [{ kind: "point", at: "c_1", label: true, id: "sample" }],
    },
  },
  damped_oscillation: {
    params: {
      equation: ["x(t) = A*exp(-gamma*t)*cos(omega*t)", "envelope = A*exp(-gamma*t)"],
      params: {
        A: { value: 1, min: 0.2, max: 2, step: 0.1, label: "amplitude A" },
        gamma: { value: 0.2, min: 0.02, max: 1, step: 0.02, label: "damping γ" },
        omega: { value: 3, min: 0.5, max: 8, step: 0.1, label: "frequency ω" },
      },
      x_range: [0, 20],
      x_label: "time t",
      y_label: "displacement x",
      controls: "panel",
      marks: [{ kind: "point", at: "1/gamma", curve: 1, y_label: "A/e", id: "decay_time" }],
    },
  },
};

export const PRESET_NAMES = Object.keys(PRESETS);

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

/** The words an equation or a mark's `at` reads (a cheap scan: enough to tell which preset parameters are still used). */
function wordsIn(P: EquationPlotParams): Set<string> {
  const out = new Set<string>();
  const scan = (s: unknown): void => {
    if (typeof s === "string") for (const w of s.match(/[A-Za-z_][A-Za-z0-9_]*/g) ?? []) out.add(w);
  };
  for (const e of Array.isArray(P.equation) ? P.equation : [P.equation]) scan(e);
  for (const mk of P.marks ?? []) if (isObj(mk)) scan(mk.at);
  return out;
}

/**
 * The params with their preset filled in under them (see the head of this
 * file). No preset, or one this build does not know: the params as they are
 * (the lint names an unknown one).
 */
export function withPreset(P: EquationPlotParams): EquationPlotParams {
  if (!isObj(P) || typeof P.preset !== "string" || !Object.prototype.hasOwnProperty.call(PRESETS, P.preset)) return P;
  const base = PRESETS[P.preset].params;
  const out: EquationPlotParams = { ...base };
  for (const [k, v] of Object.entries(P)) if (v !== undefined) (out as Record<string, unknown>)[k] = v;

  // Marks: the preset's, then the author's, each once.
  const own = Array.isArray(P.marks) ? P.marks : [];
  const all = [...(P.preset_marks === false ? [] : (base.marks ?? [])), ...own];
  const seen = new Set<string>();
  out.marks = all.filter((mk) => {
    const key = JSON.stringify(mk);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  // Params: per name, the author's over the preset's.
  const given: ParamsMap = isObj(P.params) ? (P.params as ParamsMap) : {};
  const preset: ParamsMap = base.params ?? {};
  const used = wordsIn(out);
  const params: ParamsMap = {};
  for (const [name, spec] of Object.entries(preset)) {
    const a = given[name];
    if (a === undefined) {
      if (used.has(name)) params[name] = spec;
      continue;
    }
    const b: ParamSpec = typeof spec === "number" ? { value: spec } : spec;
    params[name] = typeof a === "number" ? { ...b, value: a } : isObj(a) ? { ...b, ...a } : a;
  }
  for (const [name, a] of Object.entries(given)) if (!(name in params)) params[name] = a;
  out.params = params;
  return out;
}

/**
 * The expansion before layout (spec/expand.ts): an equation_plot spec's
 * preset written out into its params, so the player, the tray, the lint and
 * every animate see ordinary params — and an animate of "params.K_m" on a
 * parameter written as an object is re-aimed at "params.K_m.value", the path
 * where its number now lives. The same object back when nothing changes.
 */
export function expandEquationPreset(spec: Spec): Spec {
  if (spec.template !== "equation_plot" || !isObj(spec.params)) return spec;
  const raw = spec.params as unknown as EquationPlotParams;
  const params = withPreset(raw);
  const objects = isObj(params.params) ? params.params : {};
  let changed = params !== raw;
  const aim = (cmd: Command): Command => {
    if (!isObj(cmd.animate)) return cmd;
    let moved = false;
    const animate: Record<string, number | string> = {};
    for (const [k, v] of Object.entries(cmd.animate)) {
      const m = /^params\.([A-Za-z_][A-Za-z0-9_]*)$/.exec(k);
      if (m && isObj(objects[m[1]])) {
        animate[`${k}.value`] = v;
        moved = true;
      } else animate[k] = v;
    }
    if (!moved) return cmd;
    changed = true;
    return { ...cmd, animate };
  };
  const commands = spec.commands?.map(aim);
  if (!changed) return spec;
  return { ...spec, params: params as unknown as Spec["params"], ...(commands ? { commands } : {}) };
}
