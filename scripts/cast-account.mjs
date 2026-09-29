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

const dollars = (cents) => `${Number.isInteger(cents / 100) ? cents / 100 : (cents / 100).toFixed(2)} USD`;

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
