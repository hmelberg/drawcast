// What equation_plot's params say that the schema cannot check: an equation
// that does not parse or calls an unknown function, a parameter whose value
// lies outside its own range, a curve with nothing to draw over the range.
import { readModel, sampleCurve, type EquationPlotParams } from "./model";

type Issue = { severity: "warn" | "error"; message: string };

export function lintEquationPlot(P: EquationPlotParams): Issue[] {
  const out: Issue[] = [];
  const m = readModel(P);
  for (const e of m.errors) out.push({ severity: "error", message: e });
  const given = P.params && typeof P.params === "object" ? P.params : {};
  for (const [name, raw] of Object.entries(given)) {
    if (!raw || typeof raw !== "object") continue;
    const { value, min, max } = raw;
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
  for (const mk of m.marks) {
    if ((mk.kind === "point" || mk.kind === "tangent") && mk.at === undefined) out.push({ severity: "warn", message: `mark ${mk.kind} has no \`at\` — it is placed mid-range` });
    if ((mk.curve ?? 0) >= m.curves.length) out.push({ severity: "error", message: `mark ${mk.kind}: curve ${mk.curve} does not exist` });
  }
  // A parameter spelled as a product ("ax" for a*x) reads as one name.
  const v = m.variable;
  for (const p of m.params) {
    if (!p.declared && p.name.length > 1 && p.name.includes(v) && /^[A-Za-z]+$/.test(p.name))
      out.push({ severity: "warn", message: `"${p.name}" is read as one parameter — for a product write ${p.name.split("").join("*")}` });
  }
  for (const c of m.curves) {
    if (!c.node) continue;
    const { ys } = sampleCurve(c, m.env, m.xRange, 120);
    const finite = ys.filter(Number.isFinite).length;
    const which = m.curves.length > 1 ? `equation ${c.index + 1}` : "the equation";
    if (finite === 0) out.push({ severity: "error", message: `${which} is undefined over the whole x range [${m.xRange.join(", ")}] at these parameter values` });
    else if (finite < ys.length * 0.5) out.push({ severity: "warn", message: `${which} is undefined over most of the x range` });
  }
  return out;
}
