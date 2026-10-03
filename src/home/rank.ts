// The Popular row's source: names by visits over the last 30 days
// (netlify/functions/rank.mts, CDN-cached for an hour). Absolute, like the
// card pictures, so local dev and deploy previews see the live counts.
import type { RankEntry } from "./model";

export const RANK_URL = "https://drawcast.app/.netlify/functions/rank";

/** The ranks, or [] on any failure — a missing Popular row, never an error. */
export async function fetchRanks(fetchImpl: typeof fetch = fetch): Promise<RankEntry[]> {
  try {
    const res = await fetchImpl(RANK_URL, { signal: AbortSignal.timeout(8_000) });
    if (!res.ok) return [];
    const body = (await res.json()) as { ranks?: unknown };
    if (!Array.isArray(body.ranks)) return [];
    return body.ranks.filter(
      (r): r is RankEntry => !!r && typeof (r as RankEntry).name === "string" && typeof (r as RankEntry).visits === "number",
    );
  } catch {
    return [];
  }
}
