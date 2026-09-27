// What field_lines' params say that the schema cannot check: no charges or
// too many, a charge off the page or on top of another, a charge the figure
// clamps, a test charge sitting on a charge.
import { FRAME, MAX_CHARGES, MIN_GAP, Q_MAX, readCharges, type FieldLinesParams } from "./model";

type Issue = { severity: "warn" | "error"; message: string };

export function lintFieldLines(P: FieldLinesParams): Issue[] {
  const out: Issue[] = [];
  const list = Array.isArray(P.charges) ? P.charges : [];
  if (list.length === 0) out.push({ severity: "error", message: "charges: give 1–4 charges ({q, x, y})" });
  if (list.length > MAX_CHARGES) out.push({ severity: "error", message: `charges: at most ${MAX_CHARGES} (${list.length} given; the rest are not drawn)` });
  list.slice(0, MAX_CHARGES).forEach((c, i) => {
    if (!c || typeof c !== "object") return;
    if (typeof c.q === "number" && Math.abs(c.q) > Q_MAX) out.push({ severity: "warn", message: `charges[${i}].q ${c.q} is drawn as ${Math.sign(c.q) * Q_MAX} (−${Q_MAX}…${Q_MAX})` });
    if (c.q === 0) out.push({ severity: "warn", message: `charges[${i}] has q 0: it makes no field` });
    const [x0, x1] = FRAME.x;
    const [y0, y1] = FRAME.y;
    if (typeof c.x === "number" && (c.x < x0 + 0.4 || c.x > x1 - 0.4)) out.push({ severity: "warn", message: `charges[${i}].x ${c.x} is off the page (${x0 + 0.4}…${x1 - 0.4})` });
    if (typeof c.y === "number" && (c.y < y0 + 0.4 || c.y > y1 - 0.4)) out.push({ severity: "warn", message: `charges[${i}].y ${c.y} is off the page (${y0 + 0.4}…${y1 - 0.4})` });
  });
  const cs = readCharges(P);
  for (let i = 0; i < cs.length; i++)
    for (let j = i + 1; j < cs.length; j++) {
      const d = Math.hypot(cs[i].x - cs[j].x, cs[i].y - cs[j].y);
      if (d < Math.max(MIN_GAP, cs[i].r + cs[j].r + 0.1)) out.push({ severity: "warn", message: `charges[${i}] and charges[${j}] are ${d.toFixed(2)} apart — their discs touch` });
    }
  const t = P.test_charge;
  if (t && typeof t === "object") {
    for (const c of cs) if (Math.hypot(t.x - c.x, t.y - c.y) < c.r + 0.3) out.push({ severity: "warn", message: `test_charge sits on charges[${c.index}]` });
  }
  return out;
}
