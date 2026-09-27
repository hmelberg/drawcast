// What plot3d's params say that the schema cannot check: an expression that
// does not parse or calls an unknown function, a parameter outside its own
// range (params-ui lintParams), a name the expressions read that `params`
// never declares (it is silently 1 — usually a typo, or "ax" for a*x), a
// surface undefined over the whole domain, a mark off it.
import { lintParams } from "../params-ui/params";
import { readModel, surfaceAt, type Plot3dParams } from "./model";

type Issue = { severity: "warn" | "error"; message: string };

export function lintPlot3d(P: Plot3dParams): Issue[] {
  const out: Issue[] = [];
  const m = readModel(P);
  for (const e of m.errors) out.push({ severity: "error", message: e });
  out.push(...lintParams(P.params, m, { editable: P.editable, panel: P.panel }).filter((i) => !/parameters — at most/.test(i.message)));
  const kinds = [typeof P.surface === "string" && P.surface.trim() !== "", !!P.curve, Array.isArray(P.points) && P.points.length > 0].filter(Boolean).length;
  if (kinds > 1) out.push({ severity: "warn", message: `give one of surface, curve or points — only the ${m.kind} is drawn` });
  for (const n of m.undeclared) {
    const product = n.length > 1 && /^[A-Za-z]+$/.test(n) && [...n].some((ch) => m.variables.includes(ch));
    out.push({ severity: "warn", message: product ? `"${n}" is read as one parameter — for a product write ${n.split("").join("*")}` : `"${n}" is not in params — it is drawn at 1; declare it (with min/max for a slider)` });
  }
  if (m.kind === "surface" && m.surface?.node) {
    const f = m.surface.fn;
    const [d0, d1] = m.domain;
    let finite = 0;
    let total = 0;
    for (let i = 0; i < 9; i++)
      for (let j = 0; j < 9; j++) {
        total++;
        if (Number.isFinite(f({ ...m.env, x: d0 + ((d1 - d0) * i) / 8, y: d0 + ((d1 - d0) * j) / 8 }))) finite++;
      }
    if (finite === 0) out.push({ severity: "error", message: `the surface is undefined over the whole domain [${m.domain.join(", ")}] at these parameter values` });
    else if (finite < total / 2) out.push({ severity: "warn", message: "the surface is undefined over most of the domain (drawn at 0 there)" });
  }
  if (Array.isArray(P.marks) && P.marks.length > 0 && m.kind !== "surface") out.push({ severity: "warn", message: "marks sit on a surface — this figure draws none" });
  m.marks.forEach((mk, i) => {
    const coord = (a: number | string): number => (typeof a === "number" ? a : (m.byName.get(a)?.value ?? NaN));
    const x = coord(mk.at[0]);
    const y = coord(mk.at[1]);
    const [d0, d1] = m.domain;
    if (!Number.isFinite(x) || !Number.isFinite(y)) out.push({ severity: "error", message: `mark ${i}: at ${JSON.stringify(mk.at)} is not a point` });
    else if (x < d0 || x > d1 || y < d0 || y > d1) out.push({ severity: "warn", message: `mark ${i}: (${x}, ${y}) is outside the domain [${d0}, ${d1}]` });
    else if (!Number.isFinite(surfaceAt(m, x, y))) out.push({ severity: "warn", message: `mark ${i}: the surface is undefined at (${x}, ${y})` });
  });
  if (!m.showEquation && m.controls === "equation" && m.params.some((p) => p.editable)) {
    out.push({ severity: "warn", message: 'controls "equation" with show_equation false: the viewer has nothing to change the parameters with — use controls "panel"' });
  }
  return out;
}
