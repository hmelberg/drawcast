// The Anvil registry (registry delivery 1): EVERY publish to the author's
// own GitHub repo — one drawcast or a whole course — claims the repo (proof
// the publisher controls it) and registers the published item, so the
// teacher dashboard and a free title name (drawcast.app/#<name>) work
// without anyone visiting Share -> Pretty link.
//
// Same POST body-is-text/plain-JSON shape as names.ts (registerName,
// claimCourse), but a DIFFERENT pair of endpoints with a different
// contract: this is the free, automatic registration every publish gets,
// not the bought pretty link. A registry failure must NEVER fail a
// publish — every function here is wrapped in try/catch and answers with a
// word rather than throwing; the 10 s bound (AbortSignal.timeout) is the
// caller's job, the same "bounded" fetch the course publish already uses
// for claimCourse/registerName.

import type { CompiledCard } from "./card/types";
import { stripDocExt } from "./cast-file";
import { apiBase } from "./learn";
import type { PublishFile } from "./publish/github";

/**
 * POST /claim: mints a one-time nonce for `repo` ("owner/repo") and hands
 * back the file the caller must commit ALONGSIDE the publish — proof, once
 * verifyClaim reads it back from raw.githubusercontent.com, that whoever is
 * publishing controls the repo. Null signed out (no token) or on any
 * refusal or network trouble; this never throws.
 */
export async function claimFile(api: string, token: string, repo: string, fetchImpl: typeof fetch = fetch): Promise<PublishFile | null> {
  if (!token) return null;
  try {
    const res = await fetchImpl(`${apiBase(api)}/_/api/claim`, {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body: JSON.stringify({ key: token, repo }),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { nonce?: unknown; path?: unknown };
    if (typeof body.nonce !== "string") return null;
    const path = typeof body.path === "string" ? body.path : ".drawcast/claim";
    return { path, content: body.nonce + "\n" };
  } catch {
    return null;
  }
}

/**
 * POST /claim/verify, once the claim file above has been committed: true
 * only when Anvil has read it back from GitHub and its first line matches
 * the nonce. raw.githubusercontent.com can lag a commit made a second ago,
 * so an answer of {verified:false} is asked again — up to `attempts` times
 * (3), `delayMs` (3 s) apart, each attempt bounded by its own `timeoutMs`
 * signal (final review M3); `sleep` is injectable for tests. A refusal, a
 * malformed answer or network trouble is false at once, never a throw.
 */
export async function verifyClaim(
  api: string,
  token: string,
  repo: string,
  fetchImpl: typeof fetch = fetch,
  opts: { attempts?: number; delayMs?: number; timeoutMs?: number; sleep?: (ms: number) => Promise<void> } = {},
): Promise<boolean> {
  const attempts = opts.attempts ?? 3;
  const delayMs = opts.delayMs ?? 3_000;
  const timeoutMs = opts.timeoutMs ?? 10_000;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  for (let i = 0; i < attempts; i++) {
    if (i > 0) await sleep(delayMs);
    try {
      const res = await fetchImpl(`${apiBase(api)}/_/api/claim/verify`, {
        method: "POST",
        headers: { "content-type": "text/plain" },
        body: JSON.stringify({ key: token, repo }),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!res.ok) return false;
      const body = (await res.json()) as { verified?: unknown };
      if (body.verified === true) return true;
      if (body.verified !== false) return false;
    } catch {
      return false;
    }
  }
  return false;
}

export interface RegisterInput {
  /** The session token; omitted, the registration is read-only — the
   *  item's current state comes back, but no free name is minted or moved. */
  key?: string;
  kind: "cast" | "course";
  target: string;
  title?: string;
  page?: string;
  lectures?: string[];
  /** The front page's format (standalone/transcript.ts castFacts) — a cast only. */
  format?: "drawcast" | "quiz" | "xplanation";
  /** Topic tags from the cast's `tags:` header. */
  tags?: string[];
  /** The cast's level (the brief's #basic / #advanced; castFacts) — absent is the default viewer. */
  level?: "basic" | "advanced";
  /** The listing card (src/card): the poster frame as text, with the poster's address when public. */
  card?: CompiledCard;
}

export interface RegisterResult {
  item: unknown;
  /** The free title name now pointing at this item, or null in a read-only answer. */
  name: string | null;
  owner: "you" | "other" | "none";
  proven: boolean;
}

export type RegistryOutcome = RegisterResult | "key" | "rate" | "error";

/**
 * POST /register: records the published item and, signed in, mints or moves
 * its free title name. `"key"` is a 401 (a token the server no longer
 * knows), `"rate"` a 429; anything else that is not a 200 — a 400, a 5xx, a
 * network failure — is `"error"`. Never throws.
 */
export async function registerItem(api: string, reg: RegisterInput, fetchImpl: typeof fetch = fetch): Promise<RegistryOutcome> {
  try {
    const res = await fetchImpl(`${apiBase(api)}/_/api/register`, {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body: JSON.stringify(reg),
    });
    if (res.ok) {
      const body = (await res.json()) as Partial<RegisterResult>;
      const owner = body.owner === "you" || body.owner === "other" ? body.owner : "none";
      return { item: body.item, name: typeof body.name === "string" ? body.name : null, owner, proven: body.proven === true };
    }
    if (res.status === 401) return "key";
    if (res.status === 429) return "rate";
    return "error";
  } catch {
    return "error";
  }
}

/**
 * The status suffix after a publish registers (registry delivery 1): the
 * free name when one came back, a warning when the repo answers to someone
 * else's account (never a failure — the publish itself already landed), or
 * nothing at all when registration succeeded but minted no name to show.
 * `"key"`/`"rate"`/a network failure all say the publish is fine, only the
 * registry step did not happen — each with its own cure.
 */
export function registryNote(out: RegistryOutcome, signIn = "sign in again (Settings → Publishing)", retry = "try again within the hour"): string {
  // A 401 is a stale or missing session, not an unreachable server — the
  // cure is signing in; the skill passes its own "run: … login" (M5).
  if (out === "key") return ` · not registered — ${signIn}`;
  // A 429 is the registry's hourly budget per IP (drawcast-anvil limits.py),
  // not a dead server: waiting cures it. The skill passes its own retry line.
  if (out === "rate") return ` · not registered (rate limited — ${retry})`;
  if (out === "error") return " · not registered (server unreachable)";
  if (out.owner === "other") return " · registered to another account — republish while signed in to prove the repo is yours";
  return out.name ? ` · drawcast.app/#${out.name}` : "";
}

// ---- Private (registry delivery 2, task 9): quote, pay, and the return trip
// from Stripe. A cast or a course is priced by the SAME registry row every
// publish already registers with (registerItem above) — quoting and paying
// never commit anything; the actual lock (Task 10) is a separate step that
// only runs once the quote says nothing is due.

export interface PrivateQuote {
  /** Cents owed right now. */
  due: number;
  currency: string;
  paidLectures: number;
  private: boolean;
  /** The item's CURRENT catalogue listing state, same informational role as
   *  `private` above — independent of whatever `listed` the request asked
   *  about (registry deliveries 3–4, task 9). Optional: an older server that
   *  predates this field simply omits it, and the Share panel's Listed
   *  checkbox defaults that absence to true (fix round 1). */
  listed?: boolean;
  owner: "you" | "other" | "none";
  name: string | null;
}

export type PrivateQuoteOutcome = PrivateQuote | "key" | "error";

export interface PrivateQuoteInput {
  key: string;
  kind: "cast" | "course";
  target: string;
  /** 1–200; a cast is always 1. */
  lectures: number;
  private: boolean;
  /** Whether the item should appear in the catalogue (registry deliveries
   *  3–4, task 9: the Share panel's Listed switch) — optional, default true
   *  server-side. `price_due` is 0 only for public+listed; a private
   *  purchase covers unlisting too (plan ruling 8), so this rides in the
   *  SAME quote as `private` rather than a quote of its own. */
  listed?: boolean;
}

/**
 * POST /register/quote: what ticking Private costs right now, for an item
 * that need not exist yet (a first private publish). Signed in only — a 401
 * is `"key"`, anything else that is not a 200 (a 400, a 5xx, a network
 * failure) is `"error"`. Never throws.
 */
export async function quotePrivate(api: string, body: PrivateQuoteInput, fetchImpl: typeof fetch = fetch): Promise<PrivateQuoteOutcome> {
  try {
    const res = await fetchImpl(`${apiBase(api)}/_/api/register/quote`, {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return res.status === 401 ? "key" : "error";
    const b = (await res.json()) as Partial<{ due: unknown; currency: unknown; paid_lectures: unknown; private: unknown; listed: unknown; owner: unknown; name: unknown }>;
    if (typeof b.due !== "number") return "error";
    const owner = b.owner === "you" || b.owner === "other" ? b.owner : "none";
    return {
      due: b.due,
      currency: typeof b.currency === "string" ? b.currency : "usd",
      paidLectures: typeof b.paid_lectures === "number" ? b.paid_lectures : 0,
      private: b.private === true,
      // Left undefined (never defaulted here) when the server omits it — the
      // caller decides the default (Share's Listed checkbox: true, an older
      // server predating this field).
      listed: typeof b.listed === "boolean" ? b.listed : undefined,
      owner,
      name: typeof b.name === "string" ? b.name : null,
    };
  } catch {
    return "error";
  }
}

export interface PrivatePayInput {
  key: string;
  kind: "cast" | "course";
  target: string;
  title: string;
  /** A course's page — must be under https://<owner>.github.io/<repo>/. */
  page?: string;
  lectures: number;
  /** Whether this purchase locks the item private — optional, default true
   *  server-side (every payment before task 9 was implicitly this). Sent
   *  explicitly `false` when the ONLY thing being paid for is unlisting
   *  while the item stays public (plan ruling 8: unlisting costs the same
   *  as private, bought once, and must not silently lock the files too). */
  private?: boolean;
  /** Whether the item should be listed after paying — optional, default
   *  true server-side. Sent `false` from the Listed switch's own Pay
   *  button (task 9); the Private checkbox's Pay button sends whatever
   *  Listed currently reads, so one payment covers both when both are
   *  requested together. */
  listed?: boolean;
  /** The app URL Stripe sends the browser back to (an allowlisted origin). */
  return: string;
}

export type PrivatePayOutcome =
  | { url: string }
  | "nothing-due" // 409 {error:"nothing-due"} — the quote is already 0
  | "pending" // 409 {error:"pending"} — a checkout for this item is already open
  | "owner" // 403 — registered to someone else
  | "key" // 401
  | "error";

/**
 * POST /register/pay: opens a Stripe Checkout session for the SAME quote
 * `quotePrivate` priced — `{url}` is where the browser goes next; Stripe
 * returns it to `<return origin>/#privpaid=<name>`, `#privunpaid=<name>` or
 * `#privorphan=<name>` (privateInHash below). Every refusal is a word; never throws.
 */
export async function startPrivatePayment(api: string, body: PrivatePayInput, fetchImpl: typeof fetch = fetch): Promise<PrivatePayOutcome> {
  try {
    const res = await fetchImpl(`${apiBase(api)}/_/api/register/pay`, {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body: JSON.stringify(body),
    });
    if (res.ok) {
      const b = (await res.json()) as { url?: unknown };
      return typeof b.url === "string" ? { url: b.url } : "error";
    }
    if (res.status === 409) {
      const b = (await res.json().catch(() => ({}))) as { error?: unknown };
      return b.error === "pending" ? "pending" : "nothing-due";
    }
    if (res.status === 403) return "owner";
    if (res.status === 401) return "key";
    return "error";
  } catch {
    return "error";
  }
}

/**
 * What every lock path (main.ts's privateCastLock, ui/course.ts's publish,
 * cast.mjs push's lockPrivate) does when a quote comes back due 0 but
 * `private: false` — an item that once paid ONLY to unlist (paid_lectures
 * raised, the row never flipped private) and is now being asked for by a
 * Private tick. POST /register/pay with the SAME body a Pay click would
 * send settles it: the server, seeing nothing due, flips the row private
 * for free and answers 409 `{error:"nothing-due"}` — which IS success here,
 * never an error (startPrivatePayment already tells it apart from 409
 * `pending`). Only once this resolves "ok" is it safe to go on to fetch the
 * item key; any other outcome is the caller's to word, using its own
 * existing refusal text for "owner"/"key"/"error" (and the {url}/"pending"
 * shapes, which a due-0 quote should never produce, fold into "error" too —
 * this never opens a browser tab on its own).
 */
export type EnsurePrivateOutcome = "ok" | Exclude<PrivatePayOutcome, "nothing-due">;

export async function ensurePrivateApplied(
  api: string,
  key: string,
  body: Omit<PrivatePayInput, "key">,
  fetchImpl: typeof fetch = fetch,
): Promise<EnsurePrivateOutcome> {
  const outcome = await startPrivatePayment(api, { key, ...body }, fetchImpl);
  return outcome === "nothing-due" ? "ok" : outcome;
}

/**
 * Stripe's return for a private purchase, read from the URL fragment —
 * `paidInHash`'s sibling for `/register/pay` (names.ts's own is the pretty-
 * link purchase, a different endpoint and a different fragment shape).
 */
export function privateInHash(hash: string): { outcome: "privpaid" | "privunpaid" | "privorphan"; name: string } | null {
  const m = /^#(privpaid|privunpaid|privorphan)=([a-z0-9-]+)$/.exec(hash);
  if (!m) return null;
  return { outcome: m[1] as "privpaid" | "privunpaid" | "privorphan", name: m[2] };
}

// ---- Listed (registry deliveries 3–4, task 9): whether an already-
// registered item shows in the public catalogue (#browse). Unlike Private,
// listing takes effect at once — it never waits for a republish, so the
// Share panel's Listed switch calls this directly instead of feeding
// refreshPrivateLine/Publish.

/**
 * The registry's own row identifier (Anvil's `registry.item_key`) — the SAME
 * string crypto/lecture-lock.ts's envelope carries, and publish/cast.ts's
 * `privateCastTarget` already derives inline for a cast ("item is the target
 * without .yaml"). A course's key is its target verbatim (no extension to
 * strip). `/register/listing` (fix round 1, checked against the server's
 * `parse_register_listing`) identifies its row by exactly this string, never
 * `{kind, target}` — pure, so both shapes are a real, DOM-free test.
 */
export function registryItemKey(kind: "cast" | "course", target: string): string {
  return kind === "cast" ? stripDocExt(target) : target;
}

export type SetListingOutcome =
  | "ok"
  | { due: number } // 402 {error:"pay", due} — unlisting an item that has never paid (plan ruling 8)
  | "owner" // 403 {error:"owner"} — registered to someone else
  | "key" // 401
  | "error";

/**
 * POST /register/listing: turns an already-registered item's catalogue
 * listing on or off. Listing again (`listed: true`) is always free; turning
 * it off is free only once the item has ever paid for Private (any
 * `paid_lectures > 0`) — otherwise the server refuses with the one-time fee
 * still owed, `{due}`, and the caller pays it through `startPrivatePayment`
 * with `listed: false` (which settles `listed` even when `private` stays
 * false — plan ruling 8). `item` is the registry item-key STRING
 * (registryItemKey above) — the caller derives it from `kind`/`target`
 * before calling, so this function never needs either. Every refusal is a
 * word; never throws.
 */
export async function setListing(api: string, key: string, item: string, listed: boolean, fetchImpl: typeof fetch = fetch): Promise<SetListingOutcome> {
  try {
    const res = await fetchImpl(`${apiBase(api)}/_/api/register/listing`, {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body: JSON.stringify({ key, item, listed }),
      signal: AbortSignal.timeout(10_000),
    });
    if (res.ok) return "ok";
    if (res.status === 401) return "key";
    if (res.status === 403) return "owner";
    if (res.status === 402) {
      const b = (await res.json().catch(() => ({}))) as { due?: unknown };
      return { due: typeof b.due === "number" ? b.due : 0 };
    }
    return "error";
  } catch {
    return "error";
  }
}
