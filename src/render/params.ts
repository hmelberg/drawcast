// Dot-path helpers for the animate command: template params are nested
// objects (demand_shift.amount), animate targets address them by path.

import { fitRegion, isFitName } from "../layout/regions";

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** An array index segment ("0", "12") — arrays are records with integer keys. */
function indexOf(seg: string): number | null {
  return /^\d+$/.test(seg) ? Number(seg) : null;
}

/** The numeric value at a dot path, or null when missing/non-numeric. Array
 *  segments are integer indices (values.2, series.0.values.1). A fit-name
 *  string is coerced to its rectangle ONLY when the segment that produced it
 *  was exactly `box` — `rule: "left"` is not a region just because "left"
 *  happens to be one of the five names. */
export function readParam(params: Record<string, unknown> | undefined, path: string): number | null {
  const segs = path.split(".");
  let cur: unknown = params;
  for (let i = 0; i < segs.length; i++) {
    const seg = segs[i];
    if (i > 0 && segs[i - 1] === "box" && isFitName(cur)) cur = fitRegion(cur);
    if (Array.isArray(cur)) {
      const idx = indexOf(seg);
      if (idx === null) return null;
      cur = cur[idx];
    } else if (isRecord(cur)) {
      cur = cur[seg];
    } else {
      return null;
    }
  }
  return typeof cur === "number" && Number.isFinite(cur) ? cur : null;
}

/** Immutably overlay overrides onto params, creating missing objects.
 *  Values are usually numbers (animate, sliders) but free-play previews
 *  override whole params of any shape (a fen string, a moves array). */
export function withOverrides(
  params: Record<string, unknown> | undefined,
  overrides: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...(params ?? {}) };
  for (const [path, value] of Object.entries(overrides)) {
    const segs = path.split(".");
    let host: Record<string, unknown> | unknown[] = out;
    let ok = true;
    for (let i = 0; i < segs.length - 1; i++) {
      const key: string | number = Array.isArray(host) ? (indexOf(segs[i]) ?? -1) : segs[i];
      if (key === -1) { ok = false; break; }
      const existing: unknown = (host as Record<string | number, unknown>)[key];
      let next: Record<string, unknown> | unknown[];
      if (existing === undefined) next = {};
      else if (Array.isArray(existing)) next = [...existing];
      else if (isRecord(existing)) next = { ...existing };
      else if (segs[i] === "box" && isFitName(existing)) next = fitRegion(existing) as unknown as Record<string, unknown>;
      else { ok = false; break; }
      (host as Record<string | number, unknown>)[key] = next;
      host = next;
    }
    if (!ok) continue;
    const last = segs[segs.length - 1];
    if (Array.isArray(host)) {
      const i = indexOf(last);
      if (i !== null) host[i] = value;
    } else {
      host[last] = value;
    }
  }
  return out;
}

/** `animate: {box: "right"}` → the region's four numbers; anything else is
 *  copied as written (the planner then judges it as it always has). */
export function expandBoxAnimate(animate: Record<string, unknown>): Record<string, unknown> {
  const v = animate["box"];
  if (!isFitName(v)) return { ...animate };
  const { box: _box, ...rest } = animate;
  const r = fitRegion(v);
  return { ...rest, "box.x": r.x, "box.y": r.y, "box.w": r.w, "box.h": r.h };
}

/** The visible set grown by ids the previewed layout introduces — a free-play
 *  preview (a chess move to a never-visited square) mints element ids the
 *  plan's visible set has never heard of; without this they would be skipped
 *  as undrawn. Ids the base layout already had keep their honest visibility. */
export function withNewIdsVisible(
  baseIds: ReadonlySet<string>,
  previewOrder: readonly string[],
  visible: ReadonlySet<string>,
): ReadonlySet<string> {
  const fresh = previewOrder.filter((id) => !baseIds.has(id) && !visible.has(id));
  if (fresh.length === 0) return visible;
  return new Set([...visible, ...fresh]);
}

/** animate keeps a var's value under `vars.<name>` (design 2026-09-10 §2.4); layout wants it in spec.vars. */
export function splitVarOverrides(params: Record<string, unknown>): { params: Record<string, unknown>; vars: Record<string, number> } {
  const rest: Record<string, unknown> = {};
  const vars: Record<string, number> = {};
  for (const [k, v] of Object.entries(params)) {
    if (k.startsWith("vars.") && typeof v === "number") vars[k.slice(5)] = v;
    else rest[k] = v;
  }
  return { params: rest, vars };
}
