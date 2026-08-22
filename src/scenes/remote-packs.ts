// Remote packs (M5): pack YAML fetched from a URL — the official index or a
// user-supplied URL — and cached in localStorage (src/store.ts's
// RemotePackEntry trio). Registration goes through the SAME parsePack /
// registerPack every other pack uses (src/scenes/packs.ts) — there is no
// parallel path, so the never-clobber / all-or-nothing-per-pack discipline
// (and its tests) apply here for free.

import { loadRemotePacks } from "../store";
import { parsePack, registerPack, unregisterPack } from "./packs";

export const OFFICIAL_INDEX_URL = "https://raw.githubusercontent.com/hmelberg/drawcast-templates/main/index.json";

/** Generous for a real pack's YAML, small enough to reject an abusive URL. */
const MAX_YAML_CHARS = 500_000;

export interface RemoteIndexEntry {
  id: string;
  title: string;
  description: string;
  url: string;
}

/** Fetch + validate the official pack index. Throws on a malformed response. */
export async function fetchOfficialIndex(): Promise<RemoteIndexEntry[]> {
  const res = await fetch(OFFICIAL_INDEX_URL);
  if (!res.ok) throw new Error(`official index fetch failed: HTTP ${res.status}`);
  const data: unknown = await res.json();
  if (!Array.isArray(data)) throw new Error("official index: expected a JSON array");
  return data.map((raw, i) => {
    const e = raw as Record<string, unknown>;
    if (typeof e.id !== "string" || typeof e.title !== "string" || typeof e.description !== "string" || typeof e.url !== "string") {
      throw new Error(`official index entry ${i} is missing id/title/description/url`);
    }
    return { id: e.id, title: e.title, description: e.description, url: e.url };
  });
}

/**
 * Fetch a pack's YAML text. https-only (a pack's layout bodies run as JS in
 * the browser — spec/UI risk text calls this out for custom URLs; the
 * official index is trusted, but the fetch itself stays https-only either
 * way) and capped at MAX_YAML_CHARS so a hostile or broken URL can't hand
 * back an unbounded response.
 */
export async function fetchRemotePackYaml(url: string): Promise<string> {
  if (!/^https:\/\//.test(url)) throw new Error(`remote pack URLs must be https:// — got "${url}"`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`pack fetch failed: HTTP ${res.status} (${url})`);
  const text = await res.text();
  if (text.length > MAX_YAML_CHARS) {
    throw new Error(`pack YAML too large (${text.length} chars > ${MAX_YAML_CHARS} cap) — ${url}`);
  }
  return text;
}

/**
 * Parse + register already-fetched pack YAML under the pack's OWN id (from
 * its header) — never a synthesized "remote:<url>" id. That keeps a remote
 * pack indistinguishable from a bundled one once registered: same id space,
 * same collision rule (registerPack refuses a clashing id and rolls the
 * whole pack back), same catalog entry. `url` is only used to prefix error
 * messages — it never affects the id.
 */
export function registerRemotePackYaml(url: string, yaml: string): { ok: boolean; id?: string; errors: string[] } {
  const { pack, errors } = parsePack(yaml);
  if (!pack) return { ok: false, errors: errors.map((e) => `${url}: ${e}`) };
  const r = registerPack(pack.id, yaml);
  return { ok: r.ok, id: pack.id, errors: r.ok ? [] : r.errors.map((e) => `${url}: ${e}`) };
}

/**
 * Startup registration: CACHED yaml only — this must never fetch. A remote
 * host that's slow, offline, or gone must not block or flake app startup the
 * way a fetch-on-startup design would.
 *
 * Ruling on a cached-registration failure (stale/edited-elsewhere cache that
 * no longer parses, or now collides with something else registered first):
 * keep-and-warn, not drop-from-enabled. M3's packs.ts drops a pack id from
 * settings only for a DETERMINISTIC failure — one where retrying can never
 * help (see EnsurePackResult.retriable there). A cached remote entry's
 * failure isn't reliably deterministic: Refresh re-fetches and may get
 * different (fixed) bytes, and a same-bytes collision can clear once
 * whatever registered first is gone. Since "a retry might work" is exactly
 * M3's condition for keeping a setting rather than dropping it, `enabled`
 * (and the cache) is left untouched here — only a console.warn from the
 * caller (main.ts) surfaces the failure. This is symmetry with the
 * retriable rule, not a new one.
 */
export function registerCachedRemotePacksAtStartup(): { url: string; ok: boolean; errors: string[] }[] {
  return loadRemotePacks()
    .filter((e) => e.enabled)
    .map((e) => {
      const r = registerRemotePackYaml(e.url, e.yaml);
      return { url: e.url, ok: r.ok, errors: r.errors };
    });
}

/** Unregister a remote pack by its cached entry's id — no re-parse needed. */
export function unregisterRemotePack(url: string): void {
  const entry = loadRemotePacks().find((e) => e.url === url);
  if (!entry) return;
  unregisterPack(entry.id);
}
