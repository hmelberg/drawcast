// The client for Anvil's `/key` (registry delivery 2, task 4): the only way
// this app learns a private item's AES key. The viewer uses it as a learner
// (this file); the author's own publish/pull reuses it with the owner's
// token (a later task). Nothing here may throw into a page load — every
// failure is a denial or a stored fallback, never an exception.
//
// The kept key (localStorage["drawcast.itemkey:<item>"], main origin only —
// the view origin never reaches this: a locked lecture is bounced to the
// main origin before unlockForViewer runs, security/view-origin.ts's
// lockedRoute) is a courtesy for reading offline, not a cache trusted over
// the network: Anvil is asked FIRST whenever a request can be made at all,
// and the kept key is read only when that request never got an answer
// (offline, a timeout, a malformed 200) — never when Anvil answers with a
// refusal. A refusal (401/403/404) deletes the kept key: the point of asking
// every time is that standing changes — revoked, rotated, rejected — and
// yesterday's key must stop working today.

import { isLocked, envelopeOf, unlockText, ENROLL_API } from "./crypto/lecture-lock";
import { apiBase } from "./learn";

/** A localStorage-shaped store — the real one on the main origin, a
 *  Map-backed shim in tests. */
export type KeyStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

const ITEM_KEY_PREFIX = "drawcast.itemkey:";

export function itemKeyStorageKey(item: string): string {
  return ITEM_KEY_PREFIX + item;
}

/**
 * Anvil's answer to `/key` (server_code/api.py, task 4), mapped one to one:
 * a session nobody knows (401); a standing that is not "ok" (403, with the
 * course's own free name/title and page, so a door can be built straight
 * from the denial — the same shape courseDoor already takes); or an item
 * that is not private at all (404) — moved, or the course took its privacy
 * back off since this lecture was published.
 */
export type KeyDenial =
  | { denied: 401 }
  | { denied: 403; standing: "none" | "pending" | "rejected"; title: string; page: string | null }
  | { denied: 404 };

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
 * answer — the fetch itself failing (offline, a timeout), a 5xx, or a 200
 * whose body is not the `{key}` shape the contract promises — falls back to
 * the kept key if there is one, so a learner who has already opened this
 * lecture once can still open it on a flaky connection; with nothing kept,
 * that is a 401 denial, the same door a signed-out visitor gets.
 */
export async function fetchItemKey(
  api: string,
  token: string,
  item: string,
  fetchImpl: typeof fetch = fetch,
  storage: KeyStorage | null = null,
): Promise<FetchKeyResult> {
  const storageKey = itemKeyStorageKey(item);
  const kept = (): FetchKeyResult => {
    const k = storage?.getItem(storageKey);
    return k ? { key: k } : { denied: 401 };
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
    const body = (await res.json().catch(() => ({}))) as { standing?: unknown; title?: unknown; page?: unknown };
    const standing = body.standing === "pending" || body.standing === "rejected" ? body.standing : "none";
    return { denied: 403, standing, title: typeof body.title === "string" && body.title ? body.title : item, page: typeof body.page === "string" ? body.page : null };
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
  /** null on the view origin, or anywhere storage itself is unavailable. */
  storage: KeyStorage | null;
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
 * wrong-key door; failing twice ends in the same door a signed-out visitor
 * would get.
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

  const attempt = async (): Promise<UnlockOutcome | "wrong-key"> => {
    const result = await fetchItemKey(api, deps.token(), item, fetchImpl, deps.storage);
    if ("denied" in result) return { door: { ...result, item } };
    try {
      return { text: await unlockText(text, result.key) };
    } catch {
      return "wrong-key";
    }
  };

  const first = await attempt();
  if (first !== "wrong-key") return first;
  deps.storage?.removeItem(itemKeyStorageKey(item));
  const second = await attempt();
  return second === "wrong-key" ? { door: { denied: 401, item } } : second;
}
