// What motion_graphs' params say that the schema cannot check: a piece with
// no positive duration, more pieces than the figure draws, a piece whose own
// x0 disagrees with where the one before it ended (position cannot jump), a
// piece given both a and v1 that disagree, a cursor time outside the motion,
// a header number that is not written, and both motion forms at once.
import { MAX_SEGMENTS, numbersOf, PANEL_KEYS, resolveMotion, type MotionParams } from "./model";

type Issue = { severity: "warn" | "error"; message: string };

const num = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const close = (a: number, b: number): boolean => Math.abs(a - b) <= 1e-6 * Math.max(1, Math.abs(a), Math.abs(b));

export function lintMotionGraphs(P: MotionParams): Issue[] {
  const out: Issue[] = [];
  const segs = Array.isArray(P.segments) ? P.segments : null;
  if (segs && segs.length > MAX_SEGMENTS) out.push({ severity: "error", message: `${segs.length} segments — at most ${MAX_SEGMENTS} are drawn; merge pieces with the same acceleration` });
  if (segs) {
    if (num(P.a) || num(P.duration)) out.push({ severity: "warn", message: "segments given: the top-level a and duration are ignored (each piece has its own)" });
    segs.slice(0, MAX_SEGMENTS).forEach((s, i) => {
      if (!s || typeof s !== "object") return out.push({ severity: "error", message: `segments[${i}] is not an object` });
      if (!num(s.duration)) out.push({ severity: "error", message: `segments[${i}]: duration is missing` });
      else if (s.duration <= 0) out.push({ severity: "error", message: `segments[${i}]: duration ${s.duration} — a piece must last a positive time` });
      if (num(s.a) && num(s.v1)) out.push({ severity: "warn", message: `segments[${i}]: both a and v1 given — a is used, v1 ignored` });
    });
  } else if (num(P.duration) && P.duration <= 0) out.push({ severity: "error", message: `duration ${P.duration} — the motion must last a positive time` });
  const m = resolveMotion(P);
  if (segs) {
    // Position is continuous: a piece's own x0 must be where the last one ended.
    segs.slice(0, MAX_SEGMENTS).forEach((s, i) => {
      if (!s || !num(s.x0)) return;
      const r = m.segs.find((q) => q.index === i);
      if (!r) return;
      const expected = r.x0;
      if (!close(s.x0, expected)) out.push({ severity: "error", message: `segments[${i}]: x0 ${s.x0} but the object is at ${Number(expected.toFixed(4))} there — position cannot jump; drop x0 from later pieces (it follows from the motion)` });
    });
    if (num(segs[0]?.v0) && num(P.v0) && !close(segs[0].v0!, P.v0)) out.push({ severity: "warn", message: `v0 ${P.v0} and segments[0].v0 ${segs[0].v0} disagree — segments[0].v0 is used` });
  }
  if (num(P.t) && (P.t < 0 || P.t > m.T + 1e-9)) out.push({ severity: "warn", message: `t ${P.t} is outside the motion [0, ${Number(m.T.toFixed(4))}] — the cursor stops at the end` });
  if (Array.isArray(P.panels)) {
    const bad = P.panels.filter((k) => !(PANEL_KEYS as string[]).includes(k));
    if (bad.length > 0) out.push({ severity: "warn", message: `panels: ${bad.map((b) => JSON.stringify(b)).join(", ")} — the panels are "x", "v" and "a"` });
  }
  if (Array.isArray(P.numbers)) {
    const shown = numbersOf(P, m);
    const dropped = (P.numbers as string[]).filter((k) => !shown.includes(k as never));
    if (dropped.length > 0) out.push({ severity: "warn", message: `numbers: ${dropped.join(", ")} not written — the header writes x0, v0 and (constant acceleration only) a` });
  }
  for (const k of ["x_range", "v_range", "a_range"] as const) {
    const r = P[k];
    if (r !== undefined && !(Array.isArray(r) && r.length === 2 && num(r[0]) && num(r[1]) && r[1] > r[0])) out.push({ severity: "warn", message: `${k} must be [min, max] with min < max — the automatic range is used` });
  }
  const shade = P.shade;
  if ((shade === "to_cursor" || shade === "all" || shade === true) && Array.isArray(P.panels) && !P.panels.includes("v")) out.push({ severity: "warn", message: "shade is the area under v(t) — add \"v\" to panels" });
  return out;
}
