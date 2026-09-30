// The /drawcast skill's drawcast account and names (cast.mjs login, logout,
// name, name-wait). A session token comes from the device sign-in
// (drawcast-anvil's /device/start + /device/poll: the terminal shows a code,
// the person types it on drawcast.anvil.app/#device) and is kept in
// ~/.config/drawcast/session.json, readable by the user only. Apart from
// cast.mjs so tests can reach it; nothing here imports the app.
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pagesUrlFor } from "./cast-github.mjs";

/** The drawcast server: DRAWCAST_API, else the default app (src/learn.ts DEFAULT_ENROLL_API). */
export const apiUrl = () => (process.env.DRAWCAST_API || "https://drawcast.anvil.app").replace(/\/+$/, "");

/** A fetch bound to `timeoutMs` — never the callee's own job (src/registry.ts
 *  says so explicitly: claimFile/verifyClaim/registerItem's bound is the
 *  caller's). Without it a stalled Anvil hangs `push --direct` AFTER the
 *  git push has already landed (the "Pushed to …" line never prints), or a
 *  `push --dry-run`'s claim. `timeoutMs` and the underlying `fetchImpl` are
 *  both injectable so a test can prove the abort without waiting 10 s. */
export function boundedFetch(timeoutMs = 10_000, fetchImpl = fetch) {
  return (input, init) => fetchImpl(input, { ...init, signal: AbortSignal.timeout(timeoutMs) });
}
export const sessionPath = (home) => join(home, ".config/drawcast/session.json");

export function readSession(home) {
  const f = sessionPath(home);
  if (!existsSync(f)) return null;
  try {
    const s = JSON.parse(readFileSync(f, "utf8"));
    return typeof s.key === "string" ? { api: s.api, key: s.key, email: s.email ?? null } : null;
  } catch {
    return null;
  }
}

export function writeSession(home, s) {
  const f = sessionPath(home);
  mkdirSync(join(home, ".config/drawcast"), { recursive: true, mode: 0o700 });
  writeFileSync(f, JSON.stringify(s) + "\n", { mode: 0o600 });
  chmodSync(f, 0o600); // writeFileSync's mode only applies to a NEW file
}

export function clearSession(home) {
  rmSync(sessionPath(home), { force: true });
}

const post = (fetchImpl, url, body) => fetchImpl(url, { method: "POST", headers: { "content-type": "text/plain" }, body: JSON.stringify(body) });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/** The device sign-in: say the code and where to type it, poll until the
 *  person allows (→ {key, email}), denies or the code expires (→ throws). */
export async function deviceLogin({ api, label, fetchImpl = fetch, sleep = wait, say = console.log }) {
  const start = await post(fetchImpl, `${api}/_/api/device/start`, { label });
  if (!start.ok) throw new Error(start.status === 429 ? "rate — too many sign-ins in the last hour" : `the drawcast server did not answer (${start.status})`);
  const { device, code, verify, interval, expires_in } = await start.json();
  say(`Open ${verify} (sign in if asked) and type this code: ${code}\nWaiting up to ${Math.round(expires_in / 60)} minutes…`);
  for (let waited = 0; waited < expires_in; waited += interval) {
    await sleep(interval * 1000);
    // The person has typed the code by now: a hiccup (a dropped connection, a
    // 5xx from a transaction conflict, the poll budget) is waited out, not fatal.
    const r = await post(fetchImpl, `${api}/_/api/device/poll`, { device }).catch(() => null);
    if (!r || r.status === 202 || r.status === 429 || r.status >= 500) continue;
    const body = await r.json().catch(() => ({}));
    if (r.ok && typeof body.key === "string") return { key: body.key, email: body.email ?? null };
    throw new Error(body.error || `poll ${r.status}`);
  }
  throw new Error("expired");
}

/** What POST /name and /name/pay are sent for a workdir's published copy
 *  (its origin.json), under `name`. `lib` is the app's own builders —
 *  courseRegistration, castRegistration, parseCourse — so the shapes cannot
 *  drift from what the app's Share panel sends. */
export function registrationFor(origin, name, lib, courseText) {
  const repo = { owner: origin.owner, repo: origin.repo };
  if (origin.kind === "course") {
    const course = lib.parseCourse(courseText);
    const reg = lib.courseRegistration({ ...course, name }, repo, origin.coursesDir, pagesUrlFor(origin.owner, origin.repo, origin.path));
    if (!reg) throw new Error("the course has no slug — run publish-target and push first");
    return reg;
  }
  if (origin.kind !== "cast") throw new Error(`a ${origin.kind} cannot have a name — only a cast or a course`);
  const slug = origin.file.replace(/\.ya?ml$/i, "");
  return { ...lib.castRegistration(slug, repo, origin.castsDir, pagesUrlFor(origin.owner, origin.repo, origin.castsDir)), name };
}

/** What `push`/`register` send to POST /register after a publish lands
 *  (registry delivery 1) — the free, automatic registration every publish
 *  gets, distinct from `registrationFor`'s bought pretty name (no `name`
 *  in the shape below: registerItem never takes one, only ever hands one
 *  back). `lib` is the app's own builders — parseCourse, courseRegistration
 *  — so a course's target/page/title/lectures cannot drift from what the
 *  app's own publish sends. A cast has no title of its own the way a
 *  course's `# <title>` is one, so its registered title is its file's
 *  stem — the same thing its slug already is. */
export function registerFor(origin, lib, courseText) {
  const repo = { owner: origin.owner, repo: origin.repo };
  if (origin.kind === "course") {
    const course = lib.parseCourse(courseText);
    const reg = lib.courseRegistration(course, repo, origin.coursesDir, pagesUrlFor(origin.owner, origin.repo, origin.path));
    if (!reg) throw new Error("the course has no slug — run publish-target and push first");
    return { kind: reg.kind, target: reg.target, title: reg.title, page: reg.page, lectures: reg.lectures };
  }
  if (origin.kind !== "cast") throw new Error(`a ${origin.kind} cannot be registered — only a cast or a course`);
  return {
    kind: "cast",
    target: `${origin.owner}/${origin.repo}/${origin.castsDir}/${origin.file}`,
    title: origin.file.replace(/\.ya?ml$/i, ""),
    page: pagesUrlFor(origin.owner, origin.repo, origin.castsDir),
  };
}

/**
 * The registry step (registry delivery 1) once a signed-in publish has
 * landed (cast.mjs push/register): verify the claim (when asked — push
 * asks only for the claim it minted this run; register asks whenever
 * signed in, since an earlier push's claim already landed), then register
 * the item — a course claims its default run first (CONTROLLER RULING:
 * as the app's own course publish does, so only the course's owner can
 * ever hold a name for it), folding claimCourse's own note in before
 * registerItem's — then registerItem. Pure (apart from the network calls
 * it is handed): cast.mjs loads `registry`/`names` via withVite and builds
 * `reg` (registerFor) before calling this, which is what makes this
 * testable without a real Vite session.
 *
 * `registry` is src/registry.ts's `{verifyClaim, registerItem,
 * registryNote}`; `names` is src/names.ts's `{courseClaim, claimCourse,
 * claimNote}` — needed, and read, only for a course. `fetchImpl` bounds
 * every one of these calls (boundedFetch above) — never their own job,
 * per src/registry.ts's own contract, and the caller's to enforce.
 *
 * Returns the note to show and any free name that came back (null
 * otherwise) — recording it on origin.freeName is the caller's job, kept
 * out of here so this stays a pure function.
 */
export async function registerNow({ origin, session, verify, reg, registry, names, fetchImpl }) {
  const { verifyClaim, registerItem, registryNote } = registry;
  const api = session?.api ?? apiUrl();
  const repoStr = `${origin.owner}/${origin.repo}`;
  let note = "";
  if (verify && session) await verifyClaim(api, session.key, repoStr, fetchImpl);
  if (origin.kind === "course" && session) {
    const { courseClaim, claimCourse, claimNote } = names;
    const claimed = await claimCourse(api, courseClaim(session.key, reg), fetchImpl);
    note += claimNote(claimed);
  }
  const out = await registerItem(api, { key: session?.key, ...reg }, fetchImpl);
  note += registryNote(out, "run: node scripts/cast.mjs login");
  return { note, name: typeof out === "object" ? out.name : null };
}

/**
 * Does this push carry the claim file (final review C2)? Only when the push
 * lands where the pusher can push themselves — `--direct`, or a PR branch on
 * the same repo — so a proof in the repo proves THEM. A PR from a fork
 * would, once merged, prove the contributor and hand them every unproven
 * row; a source revision proves nothing the registry uses.
 */
export function shouldClaim({ kind, canPush }) {
  // `direct` changes nothing: --direct without push rights is refused
  // before any commit, and a PR on a repo the user can push to is theirs.
  return kind !== "source" && canPush === true;
}

/** Only a cast or a course is an item the registry knows (M4). */
export function registrable(origin) {
  return origin?.kind === "cast" || origin?.kind === "course";
}

export const dollars = (cents) => `${Number.isInteger(cents / 100) ? cents / 100 : (cents / 100).toFixed(2)} USD`;

/** One line on where a name stands and what to do next — the terminal's
 *  wording (names.ts's nameNote speaks of the app's Settings). */
export function nameAdvice(state, name, price) {
  switch (state) {
    case "free":
      return `drawcast.app/#${name} is free: ${dollars(price)}, one-time. To buy it: cast.mjs name <workdir> ${name} --buy --price ${price}`;
    case "yours":
      return `drawcast.app/#${name} is already yours — cast.mjs name <workdir> ${name} --buy points it here at no cost`;
    case "taken":
      return `drawcast.app/#${name} belongs to someone else — pick another`;
    case "short":
      return `"${name}" is too short — a name has at least 3 characters`;
    case "invalid":
      return `"${name}" is not a valid name (a-z, 0-9 and dashes; not starting gh-, anvil-, url-, …)`;
    case "owner":
      return "the course this points at belongs to another drawcast account";
    case "key":
      return "not signed in to drawcast (or signed out from the account page) — run: node scripts/cast.mjs login";
    case "rate":
      return "too many tries in the last hour — try again later";
    default:
      return "the drawcast server did not answer — try again in a minute";
  }
}

/** Poll the public resolver (GET /name?n=) until `name` points at `target`.
 *  The Stripe redirect and the webhook both settle a paid name, so this sees
 *  either; it never claims success for a name that resolves elsewhere. */
export async function waitForName({ api, name, target, timeoutS = 540, fetchImpl = fetch, sleep = wait }) {
  for (let t = 0; t <= timeoutS; t += 5) {
    const r = await fetchImpl(`${api}/_/api/name?n=${encodeURIComponent(name)}`).catch(() => null);
    if (r?.ok) {
      const body = await r.json().catch(() => ({}));
      return body.target === target ? "ok" : "elsewhere";
    }
    await sleep(5000);
  }
  return "timeout";
}

/** The check's state, with a stale token caught: /name/check reads an
 *  unknown key as no key (so a revoked session hears "taken" for its own
 *  name). For "free" and "taken" POST /name is asked too — it answers 401
 *  for a dead key and writes nothing for those two (402 and 409 come before
 *  any claim). "yours" already proves the key is live. `N` is names.ts. */
export async function checkName(N, api, reg) {
  const { state } = await N.checkPaidName(api, reg.name, reg.key, reg.kind);
  if (state !== "free" && state !== "taken") return state;
  return (await N.registerName(api, reg)) === "key" ? "key" : state;
}

/** Why a name may not be bought for this workdir yet — or null. A name must
 *  point at files that are live on the default branch: not a workdir aimed
 *  but never pushed, nor a first publish still waiting in a PR. `prState`
 *  is gh's answer for origin.pr (OPEN / MERGED / CLOSED), when there is one. */
export function nameBlocker(origin, prState) {
  if (origin.published === "new") return "it is aimed at its repo but not pushed yet — push it first";
  if (origin.published === "pr" && prState !== "MERGED") return `its first publish is a pull request not merged yet (${origin.pr?.url ?? "?"}) — merge it first`;
  return null;
}

// ---- Private (registry delivery 2, task 11): `pull` unlocks, `push` locks,
// `private` pays. Every function below is pure/injectable — the actual
// crypto (lockText/unlockForAuthor, src/crypto/lecture-lock.ts,
// src/item-key.ts) and network calls (quotePrivate/startPrivatePayment,
// src/registry.ts) are the app's own, loaded by cast.mjs through withVite and
// handed in here, exactly like registerNow above takes `registry`/`names` —
// so this file still imports nothing from src/ and stays testable with
// fakes. The actual lock STEP (fix round 1, #2) is the app's own
// publish/lock.ts lockLectureFiles, loaded and called directly by cast.mjs —
// not reimplemented here, so its envelope-header check, its `.png` refusal
// and its dropping of a stray `bytes` field can never drift from what a
// browser publish enforces.

/**
 * The item key lockText/fetchItemKey bind an envelope to (crypto/lecture-
 * lock.ts's `item`) — the SAME prediction the app itself makes (a cast:
 * publish/cast.ts's privateCastTarget, the target without `.yaml`; a course:
 * ui/course.ts's own publish, the course's registry target itself, applied
 * to every lecture file it locks) — built from `reg`, `registerFor`'s own
 * output, so it can never drift from what gets registered.
 */
export function privateItemFor(origin, reg) {
  return origin.kind === "cast" ? reg.target.replace(/\.ya?ml$/i, "") : reg.target;
}

/**
 * What a private quote still owes, worded identically everywhere it shows —
 * push's own refusal, and `private` printed with no `--price` — and the
 * exact next command. Null when nothing is due (already fully paid for
 * what would publish). Never prints the key.
 */
export function privateDueMessage(quote, work) {
  if (quote.due <= 0) return null;
  return `Private needs ${dollars(quote.due)} for the new lectures — run: node scripts/cast.mjs private ${work} --price ${quote.due}`;
}

/**
 * `cast.mjs private`'s (and push's own) full advice for a quote outcome —
 * the price and the next command, that it is already paid, or why nothing
 * could be quoted at all. Never prints the key.
 */
export function privateQuoteAdvice(quote, work) {
  if (quote === "key") return "not signed in to drawcast (or signed out from the account page) — run: node scripts/cast.mjs login";
  if (quote === "error") return "the drawcast server did not answer — try again in a minute";
  if (quote.owner === "other") return "this is registered to another drawcast account — private is only for its own owner";
  return privateDueMessage(quote, work) ?? "Private is paid — push to publish locked.";
}

/** `cast.mjs private --price`'s advice once startPrivatePayment refuses to
 *  open Checkout at all (never opened, so there is nothing to wait for). */
export function privatePayAdvice(pay) {
  switch (pay) {
    case "nothing-due":
      return "nothing is due — private is already paid; push to publish locked.";
    case "pending":
      return "a checkout for this is already open — finish that one, then run private again";
    case "owner":
      return "this is registered to another drawcast account — private is only for its own owner";
    case "key":
      return "not signed in to drawcast (or signed out from the account page) — run: node scripts/cast.mjs login";
    default:
      return "the drawcast server did not answer — try again in a minute";
  }
}

/**
 * Poll POST /register/quote (cast.mjs private, after Checkout opened) every
 * 5 s up to `timeoutS` (9 min, name-wait's own budget) until the item is
 * fully settled — due 0 AND private true, both: a quote can echo an old
 * `due` for a beat after the webhook flips `private`, or vice versa.
 * "timeout" if it never settles (a cancelled or unfinished checkout charges
 * nothing). `quotePrivate` is the caller's own (src/registry.ts), so this
 * stays free of any import of it; `sleep` is injectable so a test drives
 * every tick without waiting.
 */
export async function waitForPrivate({ api, body, quotePrivate, timeoutS = 540, fetchImpl = fetch, sleep = wait }) {
  for (let t = 0; t <= timeoutS; t += 5) {
    const q = await quotePrivate(api, body, fetchImpl);
    if (typeof q === "object" && q.due === 0 && q.private === true) return "paid";
    await sleep(5000);
  }
  return "timeout";
}
