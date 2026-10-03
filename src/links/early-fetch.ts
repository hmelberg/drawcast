// Starting a #gh= cast's download before the viewer has loaded (2026-10-03),
// the way entry.ts starts a name's lookup: the two downloads overlap instead
// of running one after the other. Kept tiny — it rides in the entry chunk.
//
// This reads the hash on its own, more loosely than the viewer does; the
// viewer uses the result only when its own, authoritative parse names the
// same URL (viewer.ts fetchGhText), so a disagreement costs one wasted
// request, never a wrong cast.

export interface EarlyFetch {
  url: string;
  res: Promise<Response>;
}

/** The raw GitHub URL a #gh= hash names (viewer.ts rawUrlFor's shape), or null. */
export function ghRawUrlInHash(hash: string): string | null {
  const m = /[#&]gh[=-]([\w.-]+)\/([\w.-]+)\/([^&\s]+)/.exec(hash);
  if (!m) return null;
  let path: string;
  try {
    path = decodeURIComponent(m[3]);
  } catch {
    return null;
  }
  if (!/^(?!.*\.\.)[\w./-]+\.(cast|ya?ml|json|txt)$/.test(path)) return null;
  return `https://raw.githubusercontent.com/${m[1]}/${m[2]}/HEAD/${path}`;
}

export function startGhFetch(hash: string, fetchImpl: typeof fetch = fetch): EarlyFetch | undefined {
  const url = ghRawUrlInHash(hash);
  if (!url) return undefined;
  const res = fetchImpl(url);
  // Never an unhandled rejection: the viewer retries a failed early try.
  res.catch(() => undefined);
  return { url, res };
}
