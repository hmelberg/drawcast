// What des_process' params say that the schema cannot check: a route to a
// node that does not exist, shares that do not add up to 1, a node nobody
// reaches or that leads nowhere, a station whose utilisation is 1 or more
// (its queue grows without bound — the picture is honest, but say so), and
// a run that would make more entities than the engine keeps.
import { stationTheory, trafficRates } from "./engine";
import { MAX_ENTITIES, MAX_NODES, MAX_SERVERS, nodeSpecs, readModel, routeEntries, type DesParams } from "./model";

type Issue = { severity: "warn" | "error"; message: string };

export function lintDes(P: DesParams): Issue[] {
  const out: Issue[] = [];
  const raw = Array.isArray(P.nodes) ? P.nodes : [];
  if (raw.length === 0) return [{ severity: "error", message: "nodes: give a source, a station and a sink at least" }];
  if (raw.length > MAX_NODES) out.push({ severity: "error", message: `nodes: at most ${MAX_NODES} (${raw.length} given)` });
  raw.forEach((n, i) => {
    if (!n || typeof n !== "object" || typeof n.id !== "string" || !n.id.trim()) out.push({ severity: "error", message: `nodes[${i}] needs an id` });
    else if (!["source", "station", "delay", "sink"].includes(n.type)) out.push({ severity: "error", message: `nodes[${i}] ("${n.id}"): type must be source, station, delay or sink` });
  });
  const specs = nodeSpecs(P);
  const ids = new Set<string>();
  for (const n of specs) {
    if (ids.has(n.id)) out.push({ severity: "error", message: `node id "${n.id}" is used twice` });
    ids.add(n.id);
  }
  if (!specs.some((n) => n.type === "source")) out.push({ severity: "error", message: "nodes: no source — nothing arrives" });
  if (!specs.some((n) => n.type === "sink")) out.push({ severity: "error", message: "nodes: no sink — entities have nowhere to leave" });
  specs.forEach((n, i) => {
    if (n.type === "sink") {
      if (n.to !== undefined) out.push({ severity: "warn", message: `sink "${n.id}" has a \`to\`: a sink keeps what reaches it` });
      return;
    }
    const entries = routeEntries(specs, i);
    if (entries.length === 0) out.push({ severity: "error", message: `node "${n.id}" leads nowhere: give it \`to\` (it is the last node, and not a sink)` });
    for (const [to] of entries) {
      if (!ids.has(to)) out.push({ severity: "error", message: `node "${n.id}" routes to "${to}", which is not a node (${[...ids].join(", ")})` });
      else if (to === n.id) out.push({ severity: "error", message: `node "${n.id}" routes to itself` });
    }
    if (n.to && typeof n.to === "object") {
      const sum = Object.values(n.to).reduce((a, p) => a + (typeof p === "number" && Number.isFinite(p) ? p : 0), 0);
      if (Math.abs(sum - 1) > 0.005) out.push({ severity: "error", message: `node "${n.id}": its route shares add up to ${Number(sum.toFixed(3))}, not 1` });
      for (const [to, p] of Object.entries(n.to)) if (!(typeof p === "number" && p >= 0 && p <= 1)) out.push({ severity: "error", message: `node "${n.id}": the share to "${to}" must be a number 0–1` });
    }
    if (n.type === "source") {
      const has = [n.rate, n.every].some((v) => typeof v === "number" && v > 0) || n.interarrival !== undefined || (Array.isArray(n.times) && n.times.length > 0);
      if (!has) out.push({ severity: "error", message: `source "${n.id}" needs rate (per time unit), every, interarrival or times` });
    }
    if (n.type === "station" && typeof n.servers === "number" && (n.servers < 1 || n.servers > MAX_SERVERS)) out.push({ severity: "warn", message: `station "${n.id}": servers ${n.servers} is drawn as ${Math.max(1, Math.min(MAX_SERVERS, Math.round(n.servers)))} (1–${MAX_SERVERS})` });
  });
  if (out.some((i) => i.severity === "error")) return out;

  const m = readModel(P);
  m.nodes.forEach((n) => {
    if ((n.kind === "station" || n.kind === "delay") && !n.service) out.push({ severity: "error", message: `${n.kind} "${n.id}": its ${n.kind === "delay" ? "time" : "service"} is not a distribution this template reads` });
    if (n.kind === "source" && n.inter === undefined && !n.times) out.push({ severity: "error", message: `source "${n.id}": its arrivals are not a distribution this template reads` });
  });
  // Reached: every node but a source should be fed by something.
  const fed = new Set<number>();
  for (const n of m.nodes) for (const r of n.routes) fed.add(r.to);
  for (const n of m.nodes) if (n.kind !== "source" && !fed.has(n.index)) out.push({ severity: "warn", message: `node "${n.id}" is never reached (no route leads to it)` });
  const rates = trafficRates(m);
  for (const n of m.nodes) {
    if (n.kind !== "station") continue;
    const th = stationTheory(m, n.index, rates);
    if (th && th.rho >= 1 && !Number.isFinite(n.capacity))
      out.push({ severity: "warn", message: `station "${n.id}" is ${Math.round(th.rho * 100)}% utilised (λ ${Number(th.lambda.toFixed(3))} × service ${Number(n.service!.mean.toFixed(3))} / ${n.servers} server${n.servers > 1 ? "s" : ""} ≥ 1): its queue grows without bound` });
  }
  const expected = rates.reduce((a, r, i) => a + (m.nodes[i].kind === "source" ? r : 0), 0) * m.horizon;
  if (expected > MAX_ENTITIES) out.push({ severity: "warn", message: `about ${Math.round(expected)} arrivals by the horizon: the run stops making them at ${MAX_ENTITIES} — shorten the horizon or lower the rate` });
  if (typeof P.warmup === "number" && P.warmup >= m.horizon) out.push({ severity: "error", message: `warmup ${P.warmup} is not before the horizon ${m.horizon}` });
  if (typeof P.t === "number" && (P.t < 0 || P.t > m.horizon)) out.push({ severity: "warn", message: `t ${P.t} is outside the run (0–${m.horizon}); it is drawn clamped` });
  return out;
}
