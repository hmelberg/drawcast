// Dot-path helpers for the animate command: template params are nested
// objects (demand_shift.amount), animate targets address them by path.

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** An array index segment ("0", "12") — arrays are records with integer keys. */
function indexOf(seg: string): number | null {
  return /^\d+$/.test(seg) ? Number(seg) : null;
}

/** The numeric value at a dot path, or null when missing/non-numeric. Array
 *  segments are integer indices (values.2, series.0.values.1). */
export function readParam(params: Record<string, unknown> | undefined, path: string): number | null {
  let cur: unknown = params;
  for (const seg of path.split(".")) {
    if (Array.isArray(cur)) {
      const i = indexOf(seg);
      if (i === null) return null;
      cur = cur[i];
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
