// Names — drawcast.app/#learn-russian (spec §7). A name is a pointer kept
// in the Anvil registry; this module knows the rule, reads a name out of a
// hash, swaps it for the resolved target, and registers one after a
// publish. The rule and RESERVED_PREFIXES mirror drawcast-anvil's
// server_code/names.py — tests/names.test.ts pins both.

import { apiBase } from "./learn";

export const NAME_RE = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?(?:\/[a-z0-9-]{1,20})?$/;
/** May not start a name, with or without a trailing dash: `gh-…` is an alias of `gh=…` in the viewer. */
export const RESERVED_PREFIXES = ["gh", "gdoc", "gdrive", "url", "anvil", "api", "name", "course", "learner"] as const;

export function normalizeName(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") return null;
  const name = raw.trim().toLowerCase();
  if (!NAME_RE.test(name)) return null;
  const base = name.split("/", 1)[0];
  for (const p of RESERVED_PREFIXES) if (base === p || base.startsWith(p + "-")) return null;
  return name;
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

/** The same hash with the name replaced by its resolved gh target. */
export function ghHashFor(hash: string, target: string): string {
  const rest = hash.slice(1).split("&").slice(1);
  return `#gh=${target}${rest.length ? "&" + rest.join("&") : ""}`;
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
      return " · name not registered: the author key was rejected (Settings → Publishing)";
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
// Publishing with an author key makes the publisher the course's owner in
// the teacher dashboard. The claim runs BEFORE the name registration, so a
// name is only ever registered by the course's owner.

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
      return " · author key rejected";
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
