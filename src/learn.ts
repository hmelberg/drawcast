// Learners, client side (spec §1, §3): the three events the player reports
// for the course a cast belongs to. The account is the identity — the
// session token account.ts keeps — so there is nothing here to remember per
// course. The token arrives as a PARAMETER: this module imports nothing, and
// account.ts imports it, so reading the token here would cycle. Same rule
// as views.ts — nothing here may ever throw into playback; every failure
// path returns null/false and the drawing goes on.

export const DEFAULT_ENROLL_API = "https://drawcast.anvil.app";
/** Mirrors the cast-key rule in netlify/lib/view-key.mts (and src/views.ts). */
export const CAST_KEY_RE = /^[\w.-]+\/[\w.-]+\/(?!.*\.\.)[\w./-]+\.(ya?ml|json|txt)$/;
const OPENED_PREFIX = "drawcast.learned:";

/** owner/repo/<dir>/<slug> — the cast key without its file name. */
export function courseKeyOf(castKey: string): string {
  return castKey.replace(/\/[^/]*$/, "");
}

export function apiBase(url: string): string {
  return url.replace(/\/+$/, "");
}

/** Same shape as firstViewInSession: a reload does not re-report `opened`. */
export function firstOpenInSession(castKey: string, storage: Pick<Storage, "getItem" | "setItem"> | null): boolean {
  if (!storage) return true;
  try {
    const marker = OPENED_PREFIX + castKey;
    if (storage.getItem(marker)) return false;
    storage.setItem(marker, "1");
    return true;
  } catch {
    return true;
  }
}

export interface AnswerPayload {
  /** 0-based index of the playlist item this answer belongs to (spec §4). */
  item: number;
  step: number;
  question: string;
  /** Every attempt, verbatim; [] for a skipped quiz. */
  given: string[];
  expected: string;
  correct: boolean;
}

export type LearnEvent = { kind: "opened" | "completed"; cast: string } | ({ kind: "answer"; cast: string } & AnswerPayload);

/** The server's own limits (spec §3): at most 10 attempts, 2000 characters
 *  each. Trimming here means a long retry streak still records its answer
 *  instead of coming back a 400 the player would silently swallow. */
const MAX_ATTEMPTS = 10;
const MAX_TEXT = 2000;

/**
 * Report one event under the account `key` names. `false` for every way it
 * can fail — no token, a key that is not a cast key, the network, and the
 * server's own refusals: `401 key` (the token is dead) and `403 enrol` (the
 * account is not in this cast's course). None of those is the player's
 * business to shout about; it goes on drawing.
 */
export async function sendEvent(api: string, ev: LearnEvent, key: string, fetchImpl: typeof fetch = fetch): Promise<boolean> {
  if (!CAST_KEY_RE.test(ev.cast) || !key) return false;
  const payload: LearnEvent =
    ev.kind === "answer"
      ? { ...ev, given: ev.given.slice(-MAX_ATTEMPTS).map((g) => g.slice(0, MAX_TEXT)), expected: ev.expected.slice(0, MAX_TEXT) }
      : ev;
  try {
    const res = await fetchImpl(`${apiBase(api)}/_/api/event`, {
      method: "POST",
      // text/plain keeps this a simple request: no preflight, and keepalive
      // lets a `completed` fired on the last frame outlive the tab.
      headers: { "content-type": "text/plain" },
      body: JSON.stringify({ key, ...payload }),
      keepalive: true,
    });
    return res.ok;
  } catch {
    return false;
  }
}

export type JoinOutcome = "ok" | "key" | "closed" | "run" | "invalid" | "rate" | "error";

export interface JoinRequest {
  /** The course key — what a course name resolves to (owner/repo/<dir>). */
  course: string;
  title: string;
  /** Where the course lives; must be https, the server refuses anything else. */
  page: string;
  /** A run slug; absent means the course's default run. */
  run?: string;
}

/**
 * One click for a signed-in account (spec §3). Idempotent on the server, so
 * joining twice is the same enrolment. Never throws; an empty token is "key"
 * without a request, since the server could only answer 401 to it. The
 * server's words map one to one: `401 key`, `403 closed` (the run is not
 * taking learners), `404 run` (no such run), `400 invalid` (the body itself
 * was refused — an answer, not an outage), `429 rate`.
 */
export async function joinCourse(api: string, key: string, req: JoinRequest, fetchImpl: typeof fetch = fetch): Promise<JoinOutcome> {
  if (!key) return "key";
  try {
    const res = await fetchImpl(`${apiBase(api)}/_/api/enroll`, {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body: JSON.stringify({ key, ...req }),
    });
    if (res.ok) return "ok";
    switch (res.status) {
      case 401:
        return "key";
      case 403:
        return "closed";
      case 404:
        return "run";
      case 400:
        return "invalid";
      case 429:
        return "rate";
      default:
        return "error";
    }
  } catch {
    return "error";
  }
}

/** What the door says after the click: what to do next, not what happened. */
export function joinNote(outcome: JoinOutcome): string {
  switch (outcome) {
    case "ok":
      return "You're in. Your progress and answers in this course are kept for you and its teachers.";
    case "key":
      return "Your sign-in has expired — sign in again to join.";
    case "closed":
      return "This course is not taking new learners right now — ask its teacher.";
    case "run":
      return "This course has no open run to join — ask its teacher.";
    case "invalid":
      return "The drawcast server refused this join as malformed — the course may need publishing again. Ask its teacher.";
    case "rate":
      return "Too many joins from here in the last hour — try again later.";
    case "error":
      return "Could not reach the drawcast server — try again in a moment.";
    default: {
      const unreachable: never = outcome;
      return unreachable;
    }
  }
}
