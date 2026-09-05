// Names — drawcast.app/#learn-russian (spec §7). A name is a pointer kept
// in the Anvil registry; this module knows the rule, reads a name out of a
// hash, swaps it for the resolved target, and registers one after a
// publish. The rule and RESERVED_PREFIXES mirror drawcast-anvil's
// server_code/names.py — tests/names.test.ts pins both.

import { apiBase } from "./learn";

export const NAME_RE = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?(?:\/[a-z0-9-]{1,20})?$/;
/** May not start a name, with or without a trailing dash: `gh-…` is an alias of `gh=…` in the viewer. */
export const RESERVED_PREFIXES = ["gh", "gdoc", "gdrive", "url", "anvil", "api", "name", "course", "learner", "me"] as const;

export function normalizeName(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") return null;
  const name = raw.trim().toLowerCase();
  if (!NAME_RE.test(name)) return null;
  const base = name.split("/", 1)[0];
  for (const p of RESERVED_PREFIXES) if (base === p || base.startsWith(p + "-")) return null;
  return name;
}

export const MIN_NAME_LENGTH = 8;

/** May this name be REGISTERED? Mirrors names.py's registrable(). Reading
 *  stays normalizeName's job, so a name already registered below the floor
 *  keeps resolving (spec §9). */
export function isRegistrable(raw: string | null | undefined): boolean {
  const name = normalizeName(raw);
  if (name === null) return false;
  return name.split("/", 1)[0].length >= MIN_NAME_LENGTH;
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
 *  `anvil/` key, GitHub for anything else. One place, so runNamed does not
 *  have to know how a cast key is shaped. */
export function anvilHashFor(hash: string, target: string): string {
  return target.startsWith("anvil/") ? `#anvil=${target.slice("anvil/".length)}${hashTail(hash)}` : ghHashFor(hash, target);
}

export interface Resolved {
  kind: "cast" | "course";
  target: string;
  page: string | null;
}

export async function resolveName(api: string, name: string, fetchImpl: typeof fetch = fetch): Promise<Resolved | null> {
  try {
    const res = await fetchImpl(`${apiBase(api)}/_/api/name?n=${encodeURIComponent(name)}`);
    if (!res.ok) return null;
    const body = (await res.json()) as Partial<Resolved>;
    if ((body.kind !== "cast" && body.kind !== "course") || typeof body.target !== "string") return null;
    return { kind: body.kind, target: body.target, page: typeof body.page === "string" ? body.page : null };
  } catch {
    return null;
  }
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

export async function registerName(api: string, reg: Registration, fetchImpl: typeof fetch = fetch): Promise<"ok" | "taken" | "owner" | "key" | "invalid" | "rate" | "error"> {
  if (normalizeName(reg.name) !== reg.name) return "invalid";
  try {
    const res = await fetchImpl(`${apiBase(api)}/_/api/name`, {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body: JSON.stringify(reg),
    });
    if (res.ok) return "ok";
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
export function nameNote(outcome: "ok" | "taken" | "owner" | "key" | "invalid" | "rate" | "error", name: string): string {
  switch (outcome) {
    case "ok":
      return ` · also at https://drawcast.app/#${name}`;
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
      return " · name not registered: not signed in — sign in again from Settings → Publishing (drawcast account)";
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
      return " · course not claimed: not signed in — sign in again from Settings → Publishing (drawcast account)";
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
