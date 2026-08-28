// Dot-path helpers for the animate command: template params are nested
// objects (demand_shift.amount), animate targets address them by path.

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** The numeric value at a dot path, or null when missing/non-numeric. */
export function readParam(params: Record<string, unknown> | undefined, path: string): number | null {
  let cur: unknown = params;
  for (const seg of path.split(".")) {
    if (!isRecord(cur)) return null;
    cur = cur[seg];
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
    let host = out;
    let ok = true;
    for (let i = 0; i < segs.length - 1; i++) {
      const existing = host[segs[i]];
      if (existing === undefined) host[segs[i]] = {};
      else if (isRecord(existing)) host[segs[i]] = { ...existing };
      else { ok = false; break; }
      host = host[segs[i]] as Record<string, unknown>;
    }
    if (ok) host[segs[segs.length - 1]] = value;
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
