// What equation_plot's params say that the schema cannot check: an equation
// that does not parse or calls an unknown function, a parameter whose value
// lies outside its own range, a curve with nothing to draw over the range,
// a preset this build does not know, a mark that cannot be placed.
import { markAt, markIds, readModel, sampleCurve, type EquationPlotParams } from "./model";
import { PRESET_NAMES, withPreset } from "./presets";

type Issue = { severity: "warn" | "error"; message: string };

export function lintEquationPlot(raw: EquationPlotParams): Issue[] {
  const out: Issue[] = [];
  if (raw.preset !== undefined && (typeof raw.preset !== "string" || !PRESET_NAMES.includes(raw.preset)))
    out.push({ severity: "error", message: `unknown preset ${JSON.stringify(raw.preset)} — one of ${PRESET_NAMES.join(", ")}` });
  const P = withPreset(raw);
  const m = readModel(P);
  for (const e of m.errors) out.push({ severity: "error", message: e });
  const given = P.params && typeof P.params === "object" ? P.params : {};
  for (const [name, spec] of Object.entries(given)) {
    if (!spec || typeof spec !== "object") continue;
    const { value, min, max } = spec;
    if (typeof min === "number" && typeof max === "number" && !(max > min)) out.push({ severity: "error", message: `param "${name}": min ${min} is not below max ${max}` });
    else if (typeof value === "number" && ((typeof min === "number" && value < min) || (typeof max === "number" && value > max)))
      out.push({ severity: "error", message: `param "${name}": value ${value} is outside its range [${min ?? "−∞"}, ${max ?? "∞"}]` });
  }
  const names = new Set(m.params.map((p) => p.name));
  for (const [field, list] of [
    ["editable", P.editable],
    ["panel", P.panel],
    ["drag", typeof P.drag === "string" ? [P.drag] : Array.isArray(P.drag) ? P.drag : []],
  ] as const) {
    for (const n of Array.isArray(list) ? list : []) if (typeof n === "string" && !names.has(n)) out.push({ severity: "warn", message: `${field}: "${n}" is not a parameter of the equation` });
  }
  const ids = markIds(m.marks);
  const seen = new Set<string>();
  for (const mk of m.marks) {
    if ((mk.kind === "point" || mk.kind === "tangent") && mk.at === undefined) out.push({ severity: "warn", message: `mark ${mk.kind} has no \`at\` — it is placed mid-range` });
    if ((mk.kind === "hline" || mk.kind === "vline") && mk.at === undefined) out.push({ severity: "error", message: `mark ${mk.kind} needs \`at\` (${mk.kind === "hline" ? "a y" : "an x"})` });
    else if ((mk.kind === "hline" || mk.kind === "vline") && !Number.isFinite(markAt(mk, m))) out.push({ severity: "warn", message: `mark ${mk.kind}: at "${mk.at}" has no value at these parameters` });
    if ((mk.x_label !== undefined || mk.y_label !== undefined) && mk.kind !== "point") out.push({ severity: "warn", message: `mark ${mk.kind}: x_label and y_label belong to a point — ignored` });
    if (mk.kind === "tangent" && m.xScale === "log") out.push({ severity: "warn", message: "a tangent is not drawn on a log x axis" });
    if ((mk.curve ?? 0) >= m.curves.length) out.push({ severity: "error", message: `mark ${mk.kind}: curve ${mk.curve} does not exist` });
    const id = ids.get(mk);
    if (id !== undefined) {
      if (seen.has(id)) out.push({ severity: "error", message: `two marks have the id "${id}"` });
      seen.add(id);
    }
  }
  // A parameter spelled as a product ("ax" for a*x) reads as one name.
  const v = m.variable;
  for (const p of m.params) {
    if (!p.declared && p.name.length > 1 && p.name.includes(v) && /^[A-Za-z]+$/.test(p.name))
      out.push({ severity: "warn", message: `"${p.name}" is read as one parameter — for a product write ${p.name.split("").join("*")}` });
  }
  for (const c of m.curves) {
    if (!c.node) continue;
    const { ys } = sampleCurve(c, m.env, m.xRange, 120, m.xScale);
    const finite = ys.filter(Number.isFinite).length;
    const which = m.curves.length > 1 ? `equation ${c.index + 1}` : "the equation";
    if (finite === 0) out.push({ severity: "error", message: `${which} is undefined over the whole x range [${m.xRange.join(", ")}] at these parameter values` });
    else if (finite < ys.length * 0.5) out.push({ severity: "warn", message: `${which} is undefined over most of the x range` });
  }
  return out;
}
