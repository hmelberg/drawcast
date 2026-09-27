// What refraction's params say that the schema cannot check: an angle the
// figure clamps, an index below 1, a medium named with no index the
// template knows, options that draw nothing at these values.
import { MEDIA, readModel, THETA_MAX, type RefractionParams } from "./model";

type Issue = { severity: "warn" | "error"; message: string };

export function lintRefraction(P: RefractionParams): Issue[] {
  const out: Issue[] = [];
  const m = readModel(P);
  const t = P.theta1_deg;
  if (typeof t === "number" && (t < 0 || t > THETA_MAX)) out.push({ severity: "warn", message: `theta1_deg ${t} is drawn as ${m.theta1}° (0–${THETA_MAX})` });
  for (const k of [1, 2] as const) {
    const n = P[`n${k}`];
    const name = P[`medium${k}`];
    if (typeof n === "number" && n < 1) out.push({ severity: "warn", message: `n${k} ${n} is below 1 — light would travel faster than in a vacuum` });
    if (typeof n === "number" && n > 3) out.push({ severity: "warn", message: `n${k} ${n} is above 3 — the viewer can only scrub 1–3` });
    if (typeof n !== "number" && typeof name === "string" && name.trim() && MEDIA[name.trim().toLowerCase()] === undefined)
      out.push({ severity: "warn", message: `medium${k} "${name}" has no index the template knows — give n${k}` });
  }
  if (Math.abs(m.n1 - m.n2) < 1e-9) out.push({ severity: "warn", message: "n1 equals n2: the ray does not bend" });
  if (P.show_critical === true && m.critical === null) out.push({ severity: "warn", message: "show_critical: there is no critical angle when n1 ≤ n2 (light slows down)" });
  if (m.tir && P.apparent === true) out.push({ severity: "warn", message: "apparent: past the critical angle no light gets out, so nothing is seen" });
  if (m.tir && P.eye === true) out.push({ severity: "warn", message: "eye: past the critical angle no light reaches it" });
  return out;
}
