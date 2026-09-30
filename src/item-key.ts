// The client for Anvil's `/key` (registry delivery 2, task 4): the only way
// this app learns a private item's AES key. The viewer uses it as a learner
// (unlockForViewer); the author's own publish/pull reuses it with the
// owner's own token (unlockForAuthor, task 8) whenever it reads a published
// lecture back from GitHub. Nothing here may throw into a page load — every
// failure is a denial or a stored fallback, never an exception, and every
// storage call is wrapped too (quota errors, Safari private mode can throw
// on a get/set/remove, not only on obtaining the object).
//
// The kept key (localStorage["drawcast.itemkey:<item>"], main origin only —
// the view origin never reaches this: a locked lecture is bounced to the
// main origin before unlockForViewer runs, security/view-origin.ts's
// lockedRoute) is a courtesy for reading offline, not a cache trusted over
// the network: Anvil is asked FIRST whenever a request can be made at all,
// and the kept key is read only when that request never got a clean answer
// — the fetch itself failing, a 5xx/429, or a 200 whose body is not the
// shape the contract promises (fix round 1, controller-accepted extension)
// — never when Anvil answers with a refusal. A refusal (401/403/404)
// deletes the kept key: the point of asking every time is that standing
// changes — revoked, rotated, rejected — and yesterday's key must stop
// working today. With no clean answer AND nothing kept, that is `{denied:
// "offline"}` — deliberately not `{denied: 401}`: 401 renders the sign-in
// door, whose button drops the current session (deps.forget()) — exactly
// wrong for "the network is down", which has nothing to do with whether
// this browser's session is any good.

import { isLocked, envelopeOf, unlockText, ENROLL_API } from "./crypto/lecture-lock";
import { apiBase, DEFAULT_ENROLL_API } from "./learn";
import { getToken } from "./account";

/** A localStorage-shaped store — the real one on the main origin, a
 *  Map-backed shim in tests. */
export type KeyStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

const ITEM_KEY_PREFIX = "drawcast.itemkey:";

export function itemKeyStorageKey(item: string): string {
  return ITEM_KEY_PREFIX + item;
}

/** localStorage on the main origin, guarded like account.ts's own storage()
 *  helper — private-mode Safari can throw on mere ACCESS to the global, not
 *  only on use. Exported and used as unlockForViewer's default so runViewer
 *  needs no localStorage reference of its own (tests/learn-viewer.test.ts
 *  bans any in viewer.ts — a pre-existing guard against an older, removed
 *  identity mechanism, kept exactly as it was). */
export function liveKeyStorage(): KeyStorage | null {
  try {
    return localStorage;
  } catch {
    return null;
  }
}

/** Wraps a storage so a throw from get/set/remove — a quota error, a
 *  security-restricted context, anything — never reaches a caller. A kept
 *  key is a courtesy; losing the ability to keep one is not a page-load
 *  failure. Safe to apply more than once. */
function guarded(s: KeyStorage | null): KeyStorage | null {
  if (!s) return null;
  return {
    getItem: (k: string) => {
      try {
        return s.getItem(k);
      } catch {
        return null;
      }
    },
    setItem: (k: string, v: string) => {
      try {
        s.setItem(k, v);
      } catch {
        /* the key just isn't kept this time */
      }
    },
    removeItem: (k: string) => {
      try {
        s.removeItem(k);
      } catch {
        /* nothing to do if it won't go */
      }
    },
  };
}

/**
 * Anvil's answer to `/key` (server_code/api.py, task 4), mapped one to one,
 * plus one denial of this client's own: a session nobody knows (401); a
 * standing that is not "ok" (403, with the course's own free name/title and
 * page, so a door can be built straight from the denial — the same shape
 * courseDoor already takes); an item that is not private at all (404) —
 * moved, or the course took its privacy back off since this lecture was
 * published; or Anvil never gave a clean answer at all and nothing was kept
 * to fall back on ("offline" — see the module doc above for why this is not
 * folded into 401).
 */
export type KeyDenial =
  | { denied: 401 }
  | { denied: 403; standing: "none" | "pending" | "rejected"; title: string; page: string | null; name?: string }
  | { denied: 404 }
  | { denied: "offline" };

export type FetchKeyResult = { key: string } | KeyDenial;

/**
 * Asks Anvil for one item's key. 10 s bound, like every other registry call
 * (entry.ts, main.ts, ui/course.ts) — a sleeping backend costs ten seconds,
 * not the visit. `token` is the account's session token; `item` is the
 * envelope's own `item` field (crypto/lecture-lock.ts), never anything the
 * envelope's `enroll` field names — that field is not authenticated, and
 * `api` here is always ENROLL_API/DEFAULT_ENROLL_API, the same value, never
 * the envelope's.
 *
 * A 200 keeps the key for next time. A refusal (401/403/404) drops whatever
 * was kept — see the module doc above. Anything else that is not a clean
 * answer — the fetch itself failing (offline, a timeout), a 5xx/429, or a
 * 200 whose body is not the `{key}` shape the contract promises — falls
 * back to the kept key if there is one, so a learner who has already opened
 * this lecture once can still open it on a flaky connection; with nothing
 * kept, that is `{denied: "offline"}`, never `{denied: 401}` (module doc).
 */
export async function fetchItemKey(
  api: string,
  token: string,
  item: string,
  fetchImpl: typeof fetch = fetch,
  storageIn: KeyStorage | null = null,
): Promise<FetchKeyResult> {
  const storage = guarded(storageIn);
  const storageKey = itemKeyStorageKey(item);
  const kept = (): FetchKeyResult => {
    const k = storage?.getItem(storageKey);
    return k ? { key: k } : { denied: "offline" };
  };
  let res: Response;
  try {
    res = await fetchImpl(`${apiBase(api)}/_/api/key`, {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body: JSON.stringify({ key: token, item }),
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    return kept();
  }
  if (res.ok) {
    const body = (await res.json().catch(() => ({}))) as { key?: unknown };
    if (typeof body.key === "string" && body.key) {
      storage?.setItem(storageKey, body.key);
      return { key: body.key };
    }
    return kept();
  }
  if (res.status === 401) {
    storage?.removeItem(storageKey);
    return { denied: 401 };
  }
  if (res.status === 404) {
    storage?.removeItem(storageKey);
    return { denied: 404 };
  }
  if (res.status === 403) {
    storage?.removeItem(storageKey);
    const body = (await res.json().catch(() => ({}))) as { standing?: unknown; title?: unknown; page?: unknown; name?: unknown };
    const standing = body.standing === "pending" || body.standing === "rejected" ? body.standing : "none";
    // `name` is the item's free drawcast.app name (final review M3), when it
    // has one — what the locked door links to, never the spaced title.
    const name = typeof body.name === "string" && /^[a-z0-9-]+$/.test(body.name) ? body.name : undefined;
    return { denied: 403, standing, title: typeof body.title === "string" && body.title ? body.title : item, page: typeof body.page === "string" ? body.page : null, ...(name ? { name } : {}) };
  }
  // A 5xx, a 429: Anvil's own trouble, not an answer about this item's
  // standing — the same fallback as the request never landing.
  return kept();
}

/** The token, fetch and storage the viewer's unlock needs — mirrors
 *  viewer.ts's DoorDeps in spirit: everything outside this module is
 *  injected, so the node suite can drive fetchItemKey's every branch. */
export interface UnlockDeps {
  /** Defaults to ENROLL_API — see the security note on fetchItemKey above. */
  api?: string;
  /** The signed-in account's session token, or "" signed out — read lazily
   *  (a function, not a value), so a token that changes between the first
   *  attempt and the wrong-key retry below is seen. */
  token: () => string;
  fetchImpl?: typeof fetch;
  /** Omit to use the live localStorage-backed store (liveKeyStorage,
   *  guarded); pass null explicitly to run with no storage at all (tests
   *  exercising the network-only paths), or inject a Map-backed shim.
   *  Guarded again here regardless — see `guarded` above. */
  storage?: KeyStorage | null;
}

export type UnlockOutcome = { text: string } | { door: KeyDenial & { item: string } };

/**
 * The viewer's single unlock choke point (task 7): plain text passes
 * straight through untouched. A locked envelope asks fetchItemKey and
 * decrypts; a denial becomes a `door` result for the caller to render
 * (runViewer, src/viewer.ts, owns the DOM — this module does not). A key
 * that decrypts wrong — a stale kept key past a rotation, task 4's "a
 * take-over rotates the key" — is dropped and asked for again ONCE, so a
 * genuine rotation (or a transient network blip that served the wrong
 * fallback) heals itself on the very next request instead of a permanent
 * wrong-key door. Wrong twice is no longer a local-cache problem: the kept
 * key (fetchItemKey stores every 200 key it gets, even one that turns out
 * not to decrypt) is dropped again, and the result is the same door a 404
 * gets — "this lecture is locked, and its key is no longer available" —
 * never the sign-in door, which would only tempt a perfectly good session
 * to sign out over a key mismatch it cannot fix by doing so.
 */
export async function unlockForViewer(text: string, deps: UnlockDeps): Promise<UnlockOutcome> {
  if (!isLocked(text)) return { text };
  const envelope = envelopeOf(text);
  // isLocked matched the header but the fields it promises are missing —
  // not a key problem, and there is no item to build a door or a join
  // request from.
  if (!envelope) return { door: { denied: 404, item: "" } };
  const { item } = envelope;
  const api = deps.api ?? ENROLL_API;
  const fetchImpl = deps.fetchImpl ?? fetch;
  const storage = guarded(deps.storage === undefined ? liveKeyStorage() : deps.storage);

  const attempt = async (): Promise<UnlockOutcome | "wrong-key"> => {
    const result = await fetchItemKey(api, deps.token(), item, fetchImpl, storage);
    if ("denied" in result) return { door: { ...result, item } };
    try {
      return { text: await unlockText(text, result.key) };
    } catch {
      return "wrong-key";
    }
  };

  const first = await attempt();
  if (first !== "wrong-key") return first;
  storage?.removeItem(itemKeyStorageKey(item));
  const second = await attempt();
  if (second !== "wrong-key") return second;
  storage?.removeItem(itemKeyStorageKey(item));
  return { door: { denied: 404, item } };
}

/** unlockForAuthor's deps — every field optional, since the three call sites
 *  (main.ts's course load and publish reuse, ui/course.ts's bake reuse) just
 *  want the live account, network and storage; a test injects every field to
 *  drive fetchItemKey's branches without either. */
export interface AuthorUnlockDeps {
  /** Defaults to DEFAULT_ENROLL_API. */
  api?: string;
  /** Defaults to account.ts's getToken — the signed-in account's own token,
   *  read lazily like unlockForViewer's. */
  token?: () => string;
  fetchImpl?: typeof fetch;
  /** Omit to use the live localStorage-backed store; pass null explicitly to
   *  run with no storage, or inject a Map-backed shim (tests). */
  storage?: KeyStorage | null;
}

export type AuthorUnlockOutcome = { text: string } | { locked: string };

/**
 * The author's own re-read of a published lecture (task 8): loading a
 * course back from GitHub, and reusing baked narration on a republish, both
 * read a file that may be a private lecture's locked envelope. Plain text
 * passes straight through untouched, exactly like unlockForViewer above.
 *
 * A locked envelope is unlocked the same way a learner's is — fetchItemKey,
 * this time with the AUTHOR's own token — but none of the three call sites
 * want a door to render: they just want "the previous file", and a locked
 * one they cannot open is no different from a file that was never there.
 * So every failure — a denial of any kind, a key that decrypts wrong, even
 * an envelope missing the fields it promises — collapses to one shape,
 * `{locked: <short reason>}`, and never throws. The reason is for a status
 * line, never the key: fetchItemKey's own key is never put in it.
 */
export async function unlockForAuthor(text: string, deps: AuthorUnlockDeps = {}): Promise<AuthorUnlockOutcome> {
  if (!isLocked(text)) return { text };
  const envelope = envelopeOf(text);
  if (!envelope) return { locked: "not a valid envelope" };
  const api = deps.api ?? DEFAULT_ENROLL_API;
  const token = deps.token ?? getToken;
  const fetchImpl = deps.fetchImpl ?? fetch;
  const storage = guarded(deps.storage === undefined ? liveKeyStorage() : deps.storage);
  const result = await fetchItemKey(api, token(), envelope.item, fetchImpl, storage);
  if ("denied" in result) return { locked: `denied: ${result.denied}` };
  try {
    return { text: await unlockText(text, result.key) };
  } catch {
    return { locked: "wrong key" };
  }
}
