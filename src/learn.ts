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
  /** The variable the answer was stored under: the explicit store, else
   *  `_answers.N` — the dashboard's grouping key across cohorts. */
  id?: string;
  /** Every attempt, verbatim; [] for a skipped quiz. */
  given: string[];
  expected: string;
  correct: boolean;
  /** Seconds from the question opening to the answer (latest attempt); absent without a live gate. */
  secs?: number;
  /** When the answer was given (ISO) — set by the outbox sweep so a
   *  back-filled answer keeps its own time, not the time it was sent. */
  at?: string;
}

/** One view of one playlist item (spec 2026-09-16-course-progress §2): the
 *  seconds it was on screen with the tab visible, the seconds the player
 *  was playing, and whether it reached "done" in that view. */
export interface ItemPayload {
  item: number;
  title: string;
  visible_secs: number;
  playing_secs: number;
  done: boolean;
}

export type LearnEvent =
  | { kind: "opened" | "completed" | "handed_in"; cast: string }
  | ({ kind: "answer"; cast: string } & AnswerPayload)
  | ({ kind: "item"; cast: string } & ItemPayload);

/** The run's hand-in settings for a course, as `GET /_/api/run` answers them
 *  (spec §4): whether the run asks for a hand-in, its due date, and when this
 *  account handed in, if it did. */
export interface RunInfo {
  handin: boolean;
  due?: string;
  handed_in?: string;
}

/** The server's own limits (spec §3): at most 10 attempts, 2000 characters
 *  each. Trimming here means a long retry streak still records its answer
 *  instead of coming back a 400 the player would silently swallow. */
const MAX_ATTEMPTS = 10;
const MAX_TEXT = 2000;

/** What became of a report. `refused` is the server's no — `401 key` (the
 *  token is dead) or `403 enrol` (the account is not in this cast's course)
 *  — and the caller stops asking for this cast; `failed` is everything else
 *  (no token, not a cast key, the network, a 5xx, a 429), after which the
 *  next event may still get through. None of it is the player's business
 *  to shout about; it goes on drawing. */
export type SendOutcome = "ok" | "refused" | "failed";

/**
 * Report one event under the account `key` names. Never throws.
 */
export async function sendEvent(api: string, ev: LearnEvent, key: string, fetchImpl: typeof fetch = fetch): Promise<SendOutcome> {
  if (!CAST_KEY_RE.test(ev.cast) || !key) return "failed";
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
    if (res.ok) return "ok";
    return res.status === 401 || res.status === 403 ? "refused" : "failed";
  } catch {
    return "failed";
  }
}

/**
 * The outbox sweep's send (spec §3): one event per call, in order, so it
 * works against today's server; a list body is the server round's
 * optimisation. A refusal (401/403) is the server's no for this cast, so the
 * rest are not sent and come back refused; a failure is one event's outage
 * and the next may still get through.
 */
export async function sendEvents(api: string, events: LearnEvent[], key: string, fetchImpl: typeof fetch = fetch): Promise<SendOutcome[]> {
  const out: SendOutcome[] = [];
  let refused = false;
  for (const ev of events) {
    if (refused) {
      out.push("refused");
      continue;
    }
    const outcome = await sendEvent(api, ev, key, fetchImpl);
    if (outcome === "refused") refused = true;
    out.push(outcome);
  }
  return out;
}

/**
 * The run's hand-in settings for a course (spec §4). A read, so the token
 * travels in the query like the cast fetch's does (identity design §1: a
 * fetch address no person handles). Null on anything but a JSON object
 * from a 200 — the button simply stays hidden. Never throws.
 */
export async function runInfo(api: string, key: string, course: string, cast?: string, fetchImpl: typeof fetch = fetch): Promise<RunInfo | null> {
  if (!key) return null;
  try {
    // `cast` makes handed_in the LECTURE's own hand-in, not the course's latest.
    const res = await fetchImpl(`${apiBase(api)}/_/api/run?key=${encodeURIComponent(key)}&course=${encodeURIComponent(course)}${cast ? `&cast=${encodeURIComponent(cast)}` : ""}`);
    if (!res.ok) return null;
    const body: unknown = await res.json();
    if (typeof body !== "object" || body === null || Array.isArray(body)) return null;
    const b = body as { handin?: unknown; due?: unknown; handed_in?: unknown };
    return {
      handin: b.handin === true,
      ...(typeof b.due === "string" && b.due ? { due: b.due } : {}),
      ...(typeof b.handed_in === "string" && b.handed_in ? { handed_in: b.handed_in } : {}),
    };
  } catch {
    return null;
  }
}

export type JoinOutcome = "ok" | "pending" | "rejected" | "key" | "closed" | "run" | "invalid" | "rate" | "error";

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
 * without a request, since the server could only answer 401 to it. `200
 * {state}` maps to `ok`, `pending` or `rejected`. The rest of the server's
 * words map one to one: `401 key`, `403 closed` (the run is not taking
 * learners), `404 run` (no such run), `400 invalid` (the body itself was
 * refused — an answer, not an outage), `429 rate`.
 */
export async function joinCourse(api: string, key: string, req: JoinRequest, fetchImpl: typeof fetch = fetch): Promise<JoinOutcome> {
  if (!key) return "key";
  try {
    const res = await fetchImpl(`${apiBase(api)}/_/api/enroll`, {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body: JSON.stringify({ key, ...req }),
    });
    if (res.ok) {
      // The answer's `state` (spec §3): pending when the run wants approval,
      // rejected when the teachers already said no. A 200 with anything
      // else — active, no field, a body that is not JSON — is in.
      const body = (await res.json().catch(() => ({}))) as { state?: unknown };
      return body.state === "pending" ? "pending" : body.state === "rejected" ? "rejected" : "ok";
    }
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
    case "pending":
      return "Your request is with the course's teachers — you'll get an email when they decide.";
    case "rejected":
      return "The course's teachers declined your request to join. If that seems wrong, ask them directly.";
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
