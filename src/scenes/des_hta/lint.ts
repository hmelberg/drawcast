// What des_hta's params say that the schema cannot check: an event naming a
// state that does not exist, an event leaving the death state, a
// distribution whose parameters make no law, a strategy's hazard ratio for
// an event that is not there, a horizon too short to see anything, too many
// patients for a live figure.
import { deadIndex, eventName, lawOf, MAX_EVENTS, MAX_PATIENTS, MAX_SHOW, MAX_STATES, medianOf, slugify, type HtaParams } from "./model";

type Issue = { severity: "warn" | "error"; message: string };

export function lintDesHta(P: HtaParams): Issue[] {
  const out: Issue[] = [];
  if (!P || typeof P !== "object") return out;
  const states = Array.isArray(P.states) ? P.states : [];
  const events = Array.isArray(P.events) ? P.events : [];
  if (states.length < 2) out.push({ severity: "error", message: "states: give 2–5 states, the first where every patient starts" });
  if (states.length > MAX_STATES) out.push({ severity: "error", message: `states: at most ${MAX_STATES} (${states.length} given; the rest are left out)` });
  const names = states.map((s) => s?.name);
  const seen = new Set<string>();
  for (const n of names) {
    if (typeof n !== "string" || !n.trim()) out.push({ severity: "error", message: "states: every state needs a name" });
    else if (seen.has(slugify(n))) out.push({ severity: "error", message: `states: "${n}" appears twice` });
    else seen.add(slugify(n));
  }
  states.forEach((s, i) => {
    if (typeof s?.utility === "number" && (s.utility > 1 || s.utility < -0.6)) out.push({ severity: "warn", message: `states[${i}].utility ${s.utility} is outside −0.6…1 (a QALY weight)` });
  });
  if (events.length === 0) out.push({ severity: "error", message: "events: give at least one event ({from, to, dist, …})" });
  if (events.length > MAX_EVENTS) out.push({ severity: "error", message: `events: at most ${MAX_EVENTS} (${events.length} given)` });
  const dead = deadIndex(P);
  const deadName = dead >= 0 ? names[dead] : undefined;
  if (dead < 0 && states.length >= 2) out.push({ severity: "warn", message: "no death state: name one \"Dead\" (or leave a state no event leaves) — survival curves need it" });
  const evNames = new Set<string>();
  events.forEach((e, i) => {
    if (!e || typeof e !== "object") return;
    const where = `events[${i}] (${e.from} → ${e.to})`;
    if (!names.includes(e.from)) out.push({ severity: "error", message: `${where}: unknown state "${e.from}" — states are ${names.map((n) => `"${n}"`).join(", ")}` });
    if (!names.includes(e.to)) out.push({ severity: "error", message: `${where}: unknown state "${e.to}" — states are ${names.map((n) => `"${n}"`).join(", ")}` });
    if (deadName !== undefined && e.from === deadName) out.push({ severity: "error", message: `${where}: leaves "${deadName}", the absorbing death state — nothing leaves it` });
    const law = lawOf(e);
    if (typeof law === "string") out.push({ severity: "error", message: `${where}: ${law}` });
    else if (e.from === e.to && medianOf(law) < 0.02) out.push({ severity: "warn", message: `${where}: a recurrent event more than ~35 times a year — check the rate` });
    if (typeof e.cost === "number" && e.cost < 0) out.push({ severity: "warn", message: `${where}: a negative one-off cost` });
    const n = eventName(e);
    if (evNames.has(n)) out.push({ severity: "error", message: `${where}: another event is also named "${n}" — give each a distinct name` });
    evNames.add(n);
  });
  // Every state but the first must be reachable, or its colour in the key means nothing.
  states.forEach((s, i) => {
    if (i === 0 || typeof s?.name !== "string") return;
    if (!events.some((e) => e && e.to === s.name && e.from !== e.to) && !(P.background && i === dead)) out.push({ severity: "warn", message: `state "${s.name}" is never entered (no event goes to it)` });
  });
  const strategies = Array.isArray(P.strategies) ? P.strategies : [];
  if (strategies.length !== 2) out.push({ severity: "error", message: `strategies: give exactly two — [comparator, intervention] (${strategies.length} given)` });
  strategies.slice(0, 2).forEach((s, k) => {
    if (!s || typeof s !== "object") return;
    const who = `strategies[${k}] (${s.name})`;
    if (typeof s.hr === "number" && !(s.hr >= 0)) out.push({ severity: "error", message: `${who}: hr must be ≥ 0` });
    if (typeof s.hr === "number" && s.hr > 5) out.push({ severity: "warn", message: `${who}: hr ${s.hr} is very large` });
    if (s.hr && typeof s.hr === "object") {
      for (const [key, v] of Object.entries(s.hr)) {
        if (!events.some((e) => e && (eventName(e) === key || slugify(eventName(e)) === key))) out.push({ severity: "error", message: `${who}: hr names "${key}", which is no event's name — events are ${[...evNames].map((n) => `"${n}"`).join(", ")}` });
        if (!(typeof v === "number" && v >= 0)) out.push({ severity: "error", message: `${who}: hr.${key} must be a number ≥ 0` });
      }
    }
    if (typeof s.until === "string" && !names.includes(s.until)) out.push({ severity: "error", message: `${who}: until names unknown state "${s.until}"` });
    if (typeof s.cost === "number" && s.cost < 0) out.push({ severity: "warn", message: `${who}: a negative treatment cost` });
  });
  if (typeof P.patients === "number") {
    if (P.patients > MAX_PATIENTS) out.push({ severity: "warn", message: `patients: at most ${MAX_PATIENTS} for a live figure (${P.patients} given; ${MAX_PATIENTS} are simulated)` });
    if (P.patients < 100) out.push({ severity: "warn", message: `patients: ${P.patients} is few — the means will be noisy (use 500–2000)` });
  }
  const H = typeof P.horizon === "number" ? P.horizon : 20;
  if (!(H > 0)) out.push({ severity: "error", message: "horizon: years, > 0" });
  else if (H > 100) out.push({ severity: "warn", message: "horizon: at most 100 years" });
  else {
    // Too short: most patients still in the first state at the horizon.
    const first = names[0];
    const exits = events.filter((e) => e && e.from === first && e.to !== first).map(lawOf).filter((l): l is Exclude<ReturnType<typeof lawOf>, string> => typeof l !== "string");
    if (exits.length) {
      const H0 = exits.reduce((a, l) => a + l.H(H), 0);
      if (Math.exp(-H0) > 0.8) out.push({ severity: "warn", message: `horizon ${H} years is short: about ${Math.round(Math.exp(-H0) * 100)}% of patients have not left "${first}" by then — lengthen it` });
    }
  }
  if (typeof P.t === "number" && (P.t < 0 || P.t > H)) out.push({ severity: "warn", message: `t ${P.t} is outside 0…${H} (the horizon)` });
  if (typeof P.show === "number" && (P.show < 1 || P.show > MAX_SHOW)) out.push({ severity: "warn", message: `show: 1–${MAX_SHOW} patients` });
  const d = P.discount;
  const dv = typeof d === "number" ? [d] : d && typeof d === "object" ? [d.costs, d.qalys] : [];
  if (dv.some((v) => typeof v === "number" && (v < 0 || v > 0.2))) out.push({ severity: "warn", message: "discount: a yearly rate 0–0.2 (0.035 is NICE's)" });
  if (P.risk && (typeof P.risk.share !== "number" || P.risk.share <= 0 || P.risk.share > 1 || typeof P.risk.hr !== "number")) out.push({ severity: "error", message: "risk: {share: 0–1, hr: a hazard ratio}" });
  return out;
}
