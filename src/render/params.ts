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

/** Immutably overlay numeric overrides onto params, creating missing objects. */
export function withOverrides(
  params: Record<string, unknown> | undefined,
  overrides: Record<string, number>,
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
