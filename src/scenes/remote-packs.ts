// Remote packs (M5): pack YAML fetched from a URL — the official index or a
// user-supplied URL — and cached in localStorage (src/store.ts's
// RemotePackEntry trio). Registration goes through the SAME parsePack /
// registerPack every other pack uses (src/scenes/packs.ts) — there is no
// parallel path, so the never-clobber / all-or-nothing-per-pack discipline
// (and its tests) apply here for free.

import { loadRemotePacks } from "../store";
import { packTemplateIds, parsePack, registerPack, unregisterPack } from "./packs";

export const OFFICIAL_INDEX_URL = "https://raw.githubusercontent.com/hmelberg/drawcast-templates/main/index.json";

/**
 * Trust must derive from the URL itself, not from "this URL happened to be
 * listed in the index" — a listing is just a pointer, fetched from the same
 * unauthenticated raw.githubusercontent.com host anyone can query. Anything
 * NOT under this prefix is untrusted-tier regardless of where the app found
 * the URL (an index entry, a bookmark, wherever) and must get the same
 * confirm() gate a pasted custom URL gets.
 */
export const OFFICIAL_PACK_URL_PREFIX = "https://raw.githubusercontent.com/hmelberg/drawcast-templates/";

export function isOfficialPackUrl(url: string): boolean {
  return url.startsWith(OFFICIAL_PACK_URL_PREFIX);
}

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

export interface RegisterRemotePackResult {
  ok: boolean;
  id?: string;
  errors: string[];
  /**
   * True only for a same-url replace whose fresh registration failed AND
   * whose restore-of-the-previous-version ALSO failed (or had nothing
   * cached to restore) — the pack id is now completely unregistered, not
   * merely "still the old version". Absent/false in every other failure
   * (including a successful restore) — the pack is still registered under
   * some working version, just not the one just attempted.
   */
  unloaded?: boolean;
}

/**
 * Parse + register already-fetched pack YAML under the pack's OWN id (from
 * its header) — never a synthesized "remote:<url>" id. That keeps a remote
 * pack indistinguishable from a bundled one once registered: same id space,
 * same collision rule (registerPack refuses a clashing id and rolls the
 * whole pack back), same catalog entry.
 *
 * `registerPack` itself is idempotent-by-design (re-registering an
 * already-owned id is a cheap no-op success — see its own comment) — that's
 * correct for a bundled pack (there is exactly one YAML source per id, ever).
 * It is WRONG left unguarded for a remote pack, where two DIFFERENT URLs can
 * each declare the same `pack:` header id: the second URL's registerPack
 * call would short-circuit to phantom success (reporting the FIRST pack's
 * template ids as if they were its own), and a later Remove on the second
 * (phantom) entry would then unregister the FIRST pack's real, live
 * templates out from under it. So this function pre-checks ownership itself:
 *
 * - id not currently owned → register normally (the common case).
 * - id owned, and an ENABLED cache entry for this exact (id, url) pair
 *   already exists → this is a legitimate re-register (Refresh, the Enabled
 *   checkbox flipped back on, or an ordinary re-Load/re-Add of the same
 *   URL) of the SAME remote pack: unregister the stale templates first,
 *   then register fresh. This is a real REPLACE, not registerPack's no-op
 *   short-circuit — it's what actually fixes stale-content-on-refresh. The
 *   replace is SELF-RESTORING: if the fresh registration fails, the
 *   previously-cached yaml is re-registered so the pack is never left
 *   silently unregistered just because a re-Load/re-Add happened to be
 *   reachable from a caller (loadAndRegisterRemotePack, main.ts) that has
 *   no restore logic of its own — only the Refresh handler was hardened
 *   with that before; this makes the function itself safe for every
 *   caller. The ENABLED requirement matters: a DISABLED cached entry is,
 *   by definition, not what's actually registered — if some UNRELATED
 *   registration (a built-in pack, or another remote pack) later claimed
 *   this same id while the entry sat disabled, matching on {id, url} alone
 *   would be a false positive, and unregisterPack here would evict that
 *   unrelated owner's templates instead of this entry's own (review fix
 *   round 3).
 * - id owned by anything else (a different URL, a built-in/bundled pack
 *   like "physics", or a matching {id, url} whose cached entry is
 *   currently DISABLED) → refuse outright, register nothing. `url` is
 *   threaded through purely to make this decision and to prefix error
 *   messages — it never affects the id used for registration.
 */
export function registerRemotePackYaml(url: string, yaml: string): RegisterRemotePackResult {
  const { pack, errors } = parsePack(yaml);
  if (!pack) return { ok: false, errors: errors.map((e) => `${url}: ${e}`) };

  if (packTemplateIds(pack.id).length > 0) {
    const sameSource = loadRemotePacks().some((e) => e.id === pack.id && e.url === url && e.enabled);
    if (!sameSource) {
      return { ok: false, id: pack.id, errors: [`pack id "${pack.id}" is already in use — packs must have unique ids`] };
    }

    // Same source replacing itself: grab the cached previous yaml BEFORE
    // unregistering, so a failed fresh registration can be undone.
    const prevYaml = loadRemotePacks().find((e) => e.url === url)?.yaml;
    unregisterPack(pack.id);
    const fresh = registerPack(pack.id, yaml);
    if (fresh.ok) return { ok: true, id: pack.id, errors: [] };

    const baseErrors = fresh.errors.map((e) => `${url}: ${e}`);
    const restored = prevYaml !== undefined && registerPack(pack.id, prevYaml).ok;
    if (restored) {
      return { ok: false, id: pack.id, errors: [...baseErrors, "— the previous version was kept"] };
    }
    return { ok: false, id: pack.id, unloaded: true, errors: [...baseErrors, "— the pack is now unloaded; re-add it"] };
  }

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
