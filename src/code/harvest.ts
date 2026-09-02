// The Python side of the data bridge: after a run, resolve each requested
// dotted path in the script's namespace and convert it to plain JSON. Runs
// inside pyodide (the wrapper's __g namespace); this module only BUILDS the
// script and parses its result, so it stays dependency-free and node-testable.
//
// Conversion (spec §4.3): DataFrame → {columns, rows} with numbers kept as
// numbers and NaN/None as null; a column, Series, ndarray, list, tuple or
// range → list; dict → object; scalars as they are; anything else is an
// error naming the path. Caps are ERRORS, never truncation — a chart must not
// quietly lie about its data.

export const DATA_CAP_NUMBERS = 5000;
export const DATA_CAP_ROWS = 200;

export interface HarvestPayload {
  data: Record<string, unknown>;
  errors: Record<string, string>;
}

export function dataHarvestScript(paths: string[]): string {
  return `
import json as __json, math as __math
__paths = ${JSON.stringify(paths).replace(/,/g, ", ")}
__CAP_N = ${DATA_CAP_NUMBERS}
__CAP_ROWS = ${DATA_CAP_ROWS}
__out = {"data": {}, "errors": {}}

def __is_df(o):
    return type(o).__name__ == "DataFrame"

def __is_series(o):
    return type(o).__name__ == "Series"

def __scalar(v):
    if v is None:
        return None
    if isinstance(v, bool):
        return v
    if isinstance(v, (int, float)):
        f = float(v)
        return None if (__math.isnan(f) or __math.isinf(f)) else v
    if hasattr(v, "item"):
        try:
            return __scalar(v.item())
        except Exception:
            pass
    if isinstance(v, str):
        return v
    return str(v)

def __count(v):
    if isinstance(v, (list, tuple)):
        return sum(__count(x) for x in v)
    if isinstance(v, dict):
        if "rows" in v and "columns" in v and isinstance(v["rows"], list):
            return len(v["rows"]) * max(1, len(v["columns"]))
        return sum(__count(x) for x in v.values())
    return 1

def __convert(v, path):
    if __is_df(v):
        n = len(v.index)
        if n > __CAP_ROWS:
            raise ValueError("%d rows, the cap is %d — aggregate or sample in the script" % (n, __CAP_ROWS))
        cols = [str(c) for c in v.columns]
        rows = [[__scalar(x) for x in r] for r in v.itertuples(index=False, name=None)]
        return {"columns": cols, "rows": rows}
    if __is_series(v) or hasattr(v, "tolist"):
        v = v.tolist()
    if isinstance(v, range):
        v = list(v)
    if isinstance(v, (list, tuple)):
        out = [__convert(x, path) for x in v]
        return out
    if isinstance(v, dict):
        return {str(k): __convert(x, path) for k, x in v.items()}
    if v is None or isinstance(v, (bool, int, float, str)):
        return __scalar(v)
    if hasattr(v, "item"):
        return __scalar(v)
    raise TypeError("%s is not data (a number, string, list, dict, Series or DataFrame)" % type(v).__name__)

for __p in __paths:
    try:
        __segs = __p.split(".")
        if __segs[0] not in __g:
            raise NameError("no variable %s" % __segs[0])
        __obj = __g[__segs[0]]
        for __s in __segs[1:]:
            if __is_df(__obj) and __s in __obj.columns:
                __obj = __obj[__s]
            elif isinstance(__obj, dict) and __s in __obj:
                __obj = __obj[__s]
            elif hasattr(__obj, __s):
                __obj = getattr(__obj, __s)
            else:
                raise KeyError("no column, key or attribute %s" % __s)
        __val = __convert(__obj, __p)
        __n = __count(__val)
        if __n > __CAP_N:
            raise ValueError("%d values, the cap is %d — downsample or aggregate in the script" % (__n, __CAP_N))
        __out["data"][__p] = __val
    except Exception as __e:
        __out["errors"][__p] = "%s" % __e
__json.dumps(__out)
`;
}

export function parseHarvest(raw: unknown): HarvestPayload {
  const empty: HarvestPayload = { data: {}, errors: {} };
  if (typeof raw !== "string") return empty;
  try {
    const p = JSON.parse(raw) as { data?: unknown; errors?: unknown };
    if (typeof p !== "object" || p === null || Array.isArray(p)) return empty;
    const data = p.data && typeof p.data === "object" && !Array.isArray(p.data) ? (p.data as Record<string, unknown>) : {};
    const errors: Record<string, string> = {};
    if (p.errors && typeof p.errors === "object" && !Array.isArray(p.errors)) {
      for (const [k, v] of Object.entries(p.errors as Record<string, unknown>)) errors[k] = String(v);
    }
    return { data, errors };
  } catch {
    return empty;
  }
}
