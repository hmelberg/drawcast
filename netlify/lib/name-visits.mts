// The daily visit record per name. Pure: no Blobs, no network, no dates
// beyond the key algebra — so every rule here is testable without a
// platform. A later task's Netlify function resolves drawcast.app/#<name>,
// calls addVisit on each lookup, and stores the result at visitKey(name,
// day) in Netlify Blobs — one DayRecord per name per day.
//
// Privacy: a record holds no IP, cookie or visitor id — only counts, by
// country, source and referring domain. That is the whole point of this
// module: it is impossible to reconstruct who visited from what it stores.

export type Visit = { country: string; source: "name" | "lecture"; ref: string };

export type DayRecord = {
  count: number;
  country: Record<string, number>;
  source: Record<string, number>;
  ref: Record<string, number>;
};

/** The Blobs key for a name's record on one day. */
export function visitKey(name: string, day: string): string {
  return `v/${name}/${day}`;
}

/** drawcast.app itself, and any subdomain of it, is never an external
 *  referrer — a visit arriving from the app's own pages (e.g. a course's
 *  end page linking to another name) should not count as "the world sent
 *  someone here". */
function isInternalHost(host: string): boolean {
  return host === "drawcast.app" || host.endsWith(".drawcast.app");
}

/** The referring URL's host, for counting by referring domain — never the
 *  full URL (which could carry a path, query string, or fragment that
 *  encodes more than we want to keep). `""` for an empty or invalid URL, and
 *  `""` for drawcast.app or any of its subdomains (see isInternalHost). */
export function refDomain(ref: string): string {
  if (!ref) return "";
  let host: string;
  try {
    host = new URL(ref).host;
  } catch {
    return "";
  }
  return isInternalHost(host) ? "" : host;
}

/** Increment `map[key]` by one, in place on a fresh object (the caller owns
 *  copying). Once a map already holds 50 keys besides "other", any key not
 *  already present is folded into "other" instead of being added — an
 *  existing key (one recorded before the cap was reached) keeps counting on
 *  its own, so the cap bounds how many DISTINCT keys a day can accumulate,
 *  not how high any one of them can count. */
function bump(map: Record<string, number>, key: string): void {
  const CAP = 50;
  const known = Object.prototype.hasOwnProperty.call(map, key);
  const distinctKeys = Object.keys(map).filter((k) => k !== "other").length;
  const target = known || distinctKeys < CAP ? key : "other";
  map[target] = (map[target] ?? 0) + 1;
}

/** Fold one more visit into a day's record, returning a NEW DayRecord — the
 *  input `rec` (and its maps) is never mutated, since a caller may hold onto
 *  it (e.g. to retry a conditional Blobs write against the same base). Pass
 *  `null` for a day with no record yet.
 *
 *  `v.ref` is a domain, not a raw URL — the caller resolves it with
 *  refDomain() first (e.g. from a request's Referer header) so that an
 *  internal or invalid referrer has already collapsed to "" before it gets
 *  here. An empty `v.ref` is left out of `ref` entirely: "no referrer" is
 *  not a domain worth counting. */
export function addVisit(rec: DayRecord | null, v: Visit): DayRecord {
  const next: DayRecord = {
    count: (rec?.count ?? 0) + 1,
    country: { ...(rec?.country ?? {}) },
    source: { ...(rec?.source ?? {}) },
    ref: { ...(rec?.ref ?? {}) },
  };
  bump(next.country, v.country);
  bump(next.source, v.source);
  if (v.ref) bump(next.ref, v.ref);
  return next;
}
