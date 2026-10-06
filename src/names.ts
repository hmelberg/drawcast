// Names — drawcast.app/#learn-russian (spec §7). A name is a pointer kept
// in the Anvil registry; this module knows the rule, reads a name out of a
// hash, swaps it for the resolved target, and registers one after a
// publish. The rule and RESERVED_PREFIXES mirror drawcast-anvil's
// server_code/names.py — tests/names.test.ts pins both.

import { apiBase } from "./learn";

export const NAME_RE = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?(?:\/[a-z0-9-]{1,20})?$/;
/** May not start a name, with or without a trailing dash: `gh-…` is an alias of `gh=…` in the viewer. */
export const RESERVED_PREFIXES = ["gh", "gdoc", "gdrive", "url", "anvil", "api", "name", "course", "learner", "me", "browse", "www", "cast", "paste", "create"] as const;

/**
 * Whole names nobody may register or buy (credit plan, 2026-10-06): academic
 * subjects kept for drawcast's own subject pages, and the app's own words.
 * Exact matches only; write gates only (reading is unaffected). Mirrors
 * drawcast-anvil's RESERVED_NAMES — tests/names-reserved.test.ts pins it.
 */
export const RESERVED_NAMES: readonly string[] = [
  "math", "maths", "mathematics", "physics", "chemistry", "biology", "economics", "history",
  "geography", "philosophy", "psychology", "sociology", "statistics", "medicine", "law",
  "literature", "english", "language", "languages", "computing", "programming", "science",
  "art", "music", "politics", "engineering",
  "quiz", "quizzes", "test", "tests", "exam", "blog", "help", "about", "faq", "docs", "terms",
  "privacy", "pricing", "credits", "subscribe", "account", "login", "signin", "settings",
  "studio", "library", "home", "search", "watch", "saved", "admin", "support", "contact",
  "new", "feed", "popular", "featured", "courses", "lectures", "books", "my",
];

export function isReservedName(raw: string): boolean {
  return RESERVED_NAMES.includes(raw.trim().toLowerCase().split("/", 1)[0]);
}

export function normalizeName(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") return null;
  const name = raw.trim().toLowerCase();
  if (!NAME_RE.test(name)) return null;
  const base = name.split("/", 1)[0];
  for (const p of RESERVED_PREFIXES) if (base === p || base.startsWith(p + "-")) return null;
  return name;
}

// ---- Paid names (paid-names round 2026-09-17; every name since the pretty-
// link round 2026-09-18) ------------------------------------------------------
// A name — a cast's or a course's — is bought, one-time, priced by the base's
// length in US cents; the floor is three characters. The direct `#gh=` link
// stays free; the name is the pretty link. Mirrors server_code/names.py —
// tests/names.test.ts pins the four constants to that file.
export const PAID_MIN_LENGTH = 3;
export const PRICE_TIERS: readonly (readonly [number, number])[] = [
  [5, 2000],
  [7, 1000],
];
export const PRICE_LONG = 500;
export const PRICE_CURRENCY = "usd";

/** Cents for registering `raw` as a course name — by the BASE's length. */
export function priceFor(raw: string): number {
  const base = raw.trim().toLowerCase().split("/", 1)[0];
  for (const [upto, cents] of PRICE_TIERS) if (base.length <= upto) return cents;
  return PRICE_LONG;
}

/** May this name be BOUGHT? The read rule, a base name only, and the paid floor. */
export function isPayable(raw: string | null | undefined): boolean {
  const name = normalizeName(raw);
  if (name === null || name.includes("/")) return false;
  return name.length >= PAID_MIN_LENGTH && !isReservedName(name);
}

/** "5 USD", "10.50 USD" — whole units where they are whole. */
export function formatPrice(cents: number, currency: string = PRICE_CURRENCY): string {
  const units = cents / 100;
  const text = Number.isInteger(units) ? String(units) : units.toFixed(2);
  return `${text} ${currency.toUpperCase()}`;
}

/** Stripe's return lands on drawcast.app with the outcome in the fragment. */
export function paidInHash(hash: string): { outcome: "paid" | "unpaid" | "taken"; name: string } | null {
  const m = /^#(paid|unpaid|taken)=([a-z0-9-]+)$/.exec(hash);
  if (!m) return null;
  return { outcome: m[1] as "paid" | "unpaid" | "taken", name: m[2] };
}

/** The name segment of a hash: everything after "#" up to the first "&". */
export function nameInHash(hash: string): string | null {
  if (!hash.startsWith("#")) return null;
  const first = hash.slice(1).split("&", 1)[0];
  if (first.includes("=")) return null;
  try {
    return normalizeName(decodeURIComponent(first));
  } catch {
    return null; // a malformed percent-escape is not a name, not a crash
  }
}

export function isNameHash(hash: string): boolean {
  return nameInHash(hash) !== null;
}

/** Everything after the name segment, ready to append: "&mode=silent" or "". */
function hashTail(hash: string): string {
  const rest = hash.slice(1).split("&").slice(1);
  return rest.length ? "&" + rest.join("&") : "";
}

/** The same hash with the name replaced by its resolved gh target. */
export function ghHashFor(hash: string, target: string): string {
  return `#gh=${target}${hashTail(hash)}`;
}

/** The hash a resolved target should be played through: the server for an
 *  `anvil/` key, Drive for a `gdrive/` id (pretty-link round), GitHub for
 *  anything else. One place, so runNamed does not have to know how a cast
 *  key is shaped. */
export function anvilHashFor(hash: string, target: string): string {
  if (target.startsWith("anvil/")) return `#anvil=${target.slice("anvil/".length)}${hashTail(hash)}`;
  if (target.startsWith("gdrive/")) return `#gdrive=${target.slice("gdrive/".length)}${hashTail(hash)}`;
  return ghHashFor(hash, target);
}

/** The registry's form of a cast published to Google Drive. */
export function driveTarget(fileId: string): string {
  return `gdrive/${fileId}`;
}

export interface Resolved {
  kind: "cast" | "course";
  target: string;
  page: string | null;
}

/**
 * Endpoints tried in order, the same shape as VIEW_ENDPOINTS in src/views.ts:
 * same-origin first (the Netlify deploy, and `netlify dev`), then the
 * absolute URL for the GitHub Pages deploy, which calls the drawcast.app
 * function cross-origin. Both proxy to the very same Anvil registry, so a
 * JSON answer of any status from either one is authoritative — see
 * resolveName below.
 */
export const NAME_ENDPOINTS = ["/.netlify/functions/name", "https://drawcast.app/.netlify/functions/name"];

function toResolved(body: unknown): Resolved | null {
  const b = body as Partial<Resolved>;
  if ((b.kind !== "cast" && b.kind !== "course") || typeof b.target !== "string") return null;
  return { kind: b.kind, target: b.target, page: typeof b.page === "string" ? b.page : null };
}

/**
 * Resolves a name against Anvil's registry, through the Netlify endpoints
 * first (they cache a hot name for 60 s and record a visit — see
 * netlify/functions/name.mts) and Anvil directly as the last resort.
 *
 * The endpoints are tried in order, and the rule for moving to the next one
 * is deliberately narrow: move on when the fetch itself throws (offline,
 * DNS, timeout), when the response body is not JSON (e.g. a platform's own
 * HTML error page for a route that does not exist there — the "wrong
 * endpoint" case, not an answer from Anvil at all), OR when the JSON body
 * carries a 5xx status (or a 429: see below) — that is the Netlify FUNCTION reporting its own
 * trouble reaching Anvil (see defaultResolve in netlify/functions/name.mts,
 * which synthesises a 502 on a fetch failure), not an answer from Anvil
 * itself, so treating it as authoritative would turn "this one path to
 * Anvil is broken" into "no drawcast by that name" for every viewer. A JSON
 * 2xx or 4xx, by contrast, IS Anvil's actual answer relayed through the
 * proxy: a JSON 404 means "unknown name" and stops the search right there,
 * same as a malformed 200 does. The final, direct-to-Anvil attempt has
 * nowhere left to move on to, so a 5xx there is simply null.
 */
export async function resolveName(
  api: string,
  name: string,
  fetchImpl: typeof fetch = fetch,
  opts?: { src?: "name" | "lecture"; ref?: string },
): Promise<Resolved | null> {
  const src = opts?.src === "lecture" ? "lecture" : "name";
  const ref = opts?.ref ?? "";
  const query = `n=${encodeURIComponent(name)}&src=${src}&ref=${encodeURIComponent(ref)}`;

  for (const endpoint of NAME_ENDPOINTS) {
    try {
      const res = await fetchImpl(`${endpoint}?${query}`);
      let body: unknown;
      try {
        body = await res.json();
      } catch {
        continue; // not JSON — the wrong endpoint, not an answer; try the next
      }
      // A 5xx JSON body is the function's own trouble reaching Anvil, not
      // Anvil's answer — try the next endpoint rather than reporting "no
      // drawcast by that name" for what is really a broken proxy path.
      // A 429 likewise: Anvil's name budget is per client IP, and every
      // viewer reaches it through Netlify's few egress IPs — one busy minute
      // for everyone is not "no such name" (final review I2); Anvil direct
      // counts this viewer's own IP instead.
      if (res.status >= 500 || res.status === 429) continue;
      if (!res.ok) return null; // a 4xx JSON body IS Anvil's authoritative "no"
      return toResolved(body);
    } catch {
      /* network error — try the next endpoint */
    }
  }

  // Both Netlify endpoints are unreachable or answered with something that
  // is not JSON at all: fall back to Anvil directly, exactly as before this
  // endpoint existed.
  try {
    const res = await fetchImpl(`${apiBase(api)}/_/api/name?n=${encodeURIComponent(name)}`);
    if (!res.ok) return null;
    return toResolved(await res.json());
  } catch {
    return null;
  }
}

/**
 * Resolves the name a hash carries — null when it carries none or the
 * registry says no. One call for both callers: entry.ts starts it the moment
 * the page knows the hash, so the lookup runs WHILE the viewer chunks
 * download (it used to start only after them, ~1.4 s into a cold load), and
 * runNamed awaits that same promise — or starts its own when it has none.
 */
export function lookupNamed(
  hash: string,
  api: string,
  fetchImpl: typeof fetch = fetch,
  referrer = "",
): Promise<Resolved | null> {
  const name = nameInHash(hash);
  if (!name) return Promise.resolve(null);
  return resolveName(api, name, fetchImpl, { src: name.includes("/") ? "lecture" : "name", ref: referrer });
}

export interface Registration {
  key: string;
  name: string;
  kind: "cast" | "course";
  target: string;
  page?: string;
  title?: string;
  lectures?: string[];
}

export type RegisterOutcome = "ok" | "taken" | "owner" | "key" | "invalid" | "rate" | "error" | "pay";

export async function registerName(api: string, reg: Registration, fetchImpl: typeof fetch = fetch): Promise<RegisterOutcome> {
  if (normalizeName(reg.name) !== reg.name) return "invalid";
  try {
    const res = await fetchImpl(`${apiBase(api)}/_/api/name`, {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body: JSON.stringify(reg),
    });
    if (res.ok) return "ok";
    // A course name not yet yours is a sale (paid-names round): the
    // registration waits for Stripe — startNamePayment is the door.
    if (res.status === 402) return "pay";
    if (res.status === 409) return "taken";
    if (res.status === 403) return "owner";
    if (res.status === 401) return "key";
    if (res.status === 400) return "invalid";
    if (res.status === 429) return "rate";
    return "error";
  } catch {
    return "error";
  }
}

/** The status suffix after a publish (spec §7). */
export function nameNote(outcome: RegisterOutcome, name: string): string {
  switch (outcome) {
    case "ok":
      return ` · also at https://drawcast.app/#${name}`;
    case "pay":
      return ` · the name "${name}" is not registered — buy it under Share → Pretty link (${formatPrice(priceFor(name))})`;
    case "taken":
      return ` · the name "${name}" is taken by someone else (set name: in the document to pick another)`;
    case "owner":
      // Shared with the cast publish (main.ts, kind: "cast") — "this course"
      // would be wrong there, so the wording names neither subject.
      return " · the name was not registered: you do not own what it points at";
    case "key":
      // 401: no session token, or one the server no longer knows (signed out
      // from the dashboard, or the row revoked). The cure is the same either
      // way, and it lives in one place.
      return " · name not registered: not signed in — sign in again at the top right";
    case "invalid":
      return ` · "${name}" is not a valid name`;
    case "rate":
      return " · name not registered: too many were made in the last hour — try again later";
    case "error":
      return " · name not registered (registry unreachable)";
    default: {
      const unreachable: never = outcome;
      return unreachable;
    }
  }
}

// ---- The Check button (round 0 spec §9) ------------------------------------

export type CheckState = "free" | "yours" | "taken" | "short" | "invalid" | "error";

/** The note under the field: what to do next, not what happened. For a
 *  course name (paid-names round) `price` says what a free name costs, and
 *  `kind: "course"` states the paid floor instead of the free one. */
export function checkNote(state: CheckState, name: string, opts: { price?: number; kind?: "cast" | "course" } = {}): string {
  switch (state) {
    case "free":
      return opts.price !== undefined
        ? `"${name}" is free — ${formatPrice(opts.price)} to register it as this ${opts.kind === "course" ? "course" : "drawcast"}’s address.`
        : `"${name}" is free.`;
    case "yours":
      return `"${name}" is already yours — publishing moves it to this ${opts.kind === "course" ? "course" : "drawcast"}.`;
    case "taken":
      return `"${name}" belongs to someone else. Pick another.`;
    case "short":
      return `A name needs at least ${PAID_MIN_LENGTH} characters.`;
    case "invalid":
      return "That is not a valid name: lower-case letters, digits and dashes, not starting with a reserved word like gh or me.";
    case "error":
      return "Could not check the name just now — publishing will tell you for certain.";
    default: {
      const unreachable: never = state;
      return unreachable;
    }
  }
}

/**
 * The Check button (spec §9; every name bought since the pretty-link round):
 * advice, not a reservation. The rule and the paid floor are checked here
 * FIRST, so a malformed or short name costs no request out of the
 * name budget; `kind` rides the body; the server's price comes back beside
 * the state so the note can say what a free name costs. The token is what
 * tells "yours" from "taken"; signed out, no key is sent and the server
 * never answers "yours". Never throws: an unreachable registry is "error".
 */
export async function checkPaidName(api: string, name: string, token: string, kind: "cast" | "course", fetchImpl: typeof fetch = fetch): Promise<{ state: CheckState; price?: number }> {
  const normalized = normalizeName(name);
  if (normalized === null) return { state: "invalid" };
  if (!isPayable(normalized)) return { state: "short" };
  try {
    const res = await fetchImpl(`${apiBase(api)}/_/api/name/check`, {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body: JSON.stringify(token ? { name: normalized, key: token, kind } : { name: normalized, kind }),
    });
    if (!res.ok) return { state: "error" };
    const body = (await res.json()) as { state?: unknown; price?: unknown };
    const state = body.state;
    if (!(state === "free" || state === "yours" || state === "taken" || state === "short" || state === "invalid")) return { state: "error" };
    return typeof body.price === "number" ? { state, price: body.price } : { state };
  } catch {
    return { state: "error" };
  }
}

export type PaymentStart =
  | { url: string }
  /** Paid from credit (`pay: "credits"`): the name is already registered. */
  | { paidCredits: number }
  /** 402 — the balance does not cover the price. */
  | "credit"
  | "taken"
  | "yours"
  | "owner"
  | "key"
  | "invalid"
  | "rate"
  | "error";

/**
 * Open a Stripe Checkout Session for a course name (POST /_/api/name/pay):
 * the registration body plus `return`, the address Stripe sends the browser
 * back to — drawcast.app reads the outcome from the fragment (paidInHash).
 * `{url}` is where the browser goes next; every refusal is a word.
 */
export async function startNamePayment(api: string, args: Registration & { return: string; pay?: "credits" }, fetchImpl: typeof fetch = fetch): Promise<PaymentStart> {
  try {
    const res = await fetchImpl(`${apiBase(api)}/_/api/name/pay`, {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body: JSON.stringify(args),
    });
    if (res.ok) {
      const body = (await res.json()) as { url?: unknown; paid?: unknown; credits?: unknown };
      if (body.paid === "credits") return { paidCredits: typeof body.credits === "number" ? body.credits : 0 };
      return typeof body.url === "string" ? { url: body.url } : "error";
    }
    if (res.status === 402) return "credit";
    if (res.status === 409) {
      const body = (await res.json().catch(() => ({}))) as { error?: unknown };
      return body.error === "yours" ? "yours" : "taken";
    }
    if (res.status === 403) return "owner";
    if (res.status === 401) return "key";
    if (res.status === 400) return "invalid";
    if (res.status === 429) return "rate";
    return "error";
  } catch {
    return "error";
  }
}

// ---- The claim (teachers round, spec §3) ----------------------------------
// Publishing while signed in (the session token, round 0 spec §1) makes the
// publisher the course's owner in the teacher dashboard. The claim runs
// BEFORE the name registration, so a name is only ever registered by the
// course's owner.

export interface CourseClaim {
  key: string;
  course: string;
  title?: string;
  page?: string;
  lectures?: string[];
}

export type ClaimOutcome = "ok" | "owner" | "key" | "invalid" | "rate" | "error";

/** The claim a course registration implies: same target, title, page, lectures. */
export function courseClaim(key: string, reg: Omit<Registration, "key">): CourseClaim {
  return { key, course: reg.target, title: reg.title, page: reg.page, lectures: reg.lectures };
}

export async function claimCourse(api: string, claim: CourseClaim, fetchImpl: typeof fetch = fetch): Promise<ClaimOutcome> {
  try {
    const res = await fetchImpl(`${apiBase(api)}/_/api/course`, {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body: JSON.stringify(claim),
    });
    if (res.ok) return "ok";
    if (res.status === 403) return "owner";
    if (res.status === 401) return "key";
    if (res.status === 400) return "invalid";
    if (res.status === 429) return "rate";
    return "error";
  } catch {
    return "error";
  }
}

/** The status suffix after a course publish (spec §5). */
export function claimNote(outcome: ClaimOutcome): string {
  switch (outcome) {
    case "ok":
      return " · you own this course";
    case "owner":
      return " · this course is owned by another author — not claimed";
    case "key":
      return " · course not claimed: not signed in — sign in again at the top right";
    case "invalid":
      return " · course not claimed (the registry rejected the request)";
    case "rate":
      return " · course not claimed: too many were made in the last hour — try again later";
    case "error":
      return " · course not claimed (registry unreachable)";
    default: {
      const unreachable: never = outcome;
      return unreachable;
    }
  }
}

/**
 * drawcast.app/w/<name>[/<lecture>] (2026-10-03, delivery 3) as the hash the
 * router already understands: `#<name>` plus whatever hash the address
 * carried (`&mode=silent`, a sign-in's `t=`). null for any other path. The
 * edge (netlify/edge-functions/watch-page.mts) has already given the page its
 * head; the app then plays the name exactly as it plays #name.
 */
export function watchPathHash(pathname: string, hash: string): string | null {
  const m = /^\/w\/([a-z0-9-]+)(?:\/(\d{1,3}))?\/?$/i.exec(pathname);
  if (!m) return null;
  const name = `${m[1].toLowerCase()}${m[2] ? `/${Number(m[2])}` : ""}`;
  const tail = hash.replace(/^#/, "");
  const out = `#${name}${tail ? `&${tail}` : ""}`;
  return isNameHash(out) ? out : null;
}
