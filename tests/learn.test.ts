// The learner client. Every network call is injected, as in tests/views-client.test.ts.
import { readFileSync } from "node:fs";
import { describe, expect, test, vi } from "vitest";
import { apiBase, CAST_KEY_RE, courseKeyOf, DEFAULT_ENROLL_API, firstOpenInSession, joinCourse, joinNote, sendEvent, type JoinOutcome } from "../src/learn";

const CAST = "hmelberg/dcast/learn-russian/03-cases.yaml";
const COURSE = "hmelberg/dcast/learn-russian";
const API = "https://drawcast.anvil.app";
const KEY = "k".repeat(40);

function memoryStorage() {
  const data: Record<string, string> = {};
  return {
    getItem: (k: string) => data[k] ?? null,
    setItem: (k: string, v: string) => {
      data[k] = v;
    },
    data,
  };
}
function throwingStorage() {
  const boom = () => {
    throw new Error("private mode");
  };
  return { getItem: boom, setItem: boom };
}
function fetchReturning(status: number, body: unknown): typeof fetch {
  return vi.fn(async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;
}
function callOf(f: typeof fetch): [string, RequestInit] {
  return (f as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
}
function calls(f: typeof fetch): number {
  return (f as unknown as ReturnType<typeof vi.fn>).mock.calls.length;
}

describe("the module's shape", () => {
  const src = readFileSync(new URL("../src/learn.ts", import.meta.url), "utf8");
  test("imports nothing — account.ts imports it, so the token arrives as a parameter, never through getToken", () => {
    expect(src).not.toMatch(/^\s*import\b/m);
    expect(src).not.toMatch(/\bgetToken\b/);
    expect(src).toMatch(/export async function sendEvent\(api: string, ev: LearnEvent, key: string, fetchImpl: typeof fetch = fetch\)/);
  });
  test("nothing code-shaped survives: no code map, no ?learner=, no progress read, no forget", () => {
    expect(src).not.toMatch(/LEARNERS_KEY|CODE_RE|normalizeCode|learnerFor|saveLearner|forgetLearner|readLearners|learnerParam|stripLearnerParam|reportingAllowed|readProgress|LearnerEntry/);
    expect(src).not.toMatch(/\/_\/api\/progress|\/_\/api\/forget|localStorage/);
  });
});

describe("keys", () => {
  test("the course key is the cast key without its file name", () => {
    expect(courseKeyOf(CAST)).toBe(COURSE);
    expect(courseKeyOf("anvil/spanish1/01-intro.yaml")).toBe("anvil/spanish1");
  });
  test("apiBase strips trailing slashes only", () => {
    expect(apiBase("https://drawcast.anvil.app/")).toBe("https://drawcast.anvil.app");
    expect(apiBase("https://drawcast.anvil.app")).toBe("https://drawcast.anvil.app");
    expect(DEFAULT_ENROLL_API).toBe(apiBase(DEFAULT_ENROLL_API));
  });
  test("a cast key is a GitHub key or the server's own — a/b/<path>.yaml, never climbing", () => {
    expect(CAST_KEY_RE.test(CAST)).toBe(true);
    expect(CAST_KEY_RE.test("anvil/spanish1/01-intro.yaml")).toBe(true);
    expect(CAST_KEY_RE.test("anvil/spanish1/../secret.yaml")).toBe(false);
    expect(CAST_KEY_RE.test("not-a-key")).toBe(false);
    expect(CAST_KEY_RE.test("a/b/c.png")).toBe(false);
  });
});

describe("firstOpenInSession", () => {
  test("first open reports, a reload does not, no storage always reports", () => {
    const s = memoryStorage();
    expect(firstOpenInSession(CAST, s)).toBe(true);
    expect(firstOpenInSession(CAST, s)).toBe(false);
    expect(firstOpenInSession(CAST, null)).toBe(true);
  });
  test("a storage that throws is the same as none", () => {
    expect(firstOpenInSession(CAST, throwingStorage())).toBe(true);
  });
});

describe("sendEvent", () => {
  test("posts JSON as text/plain to <api>/_/api/event, carrying the account token as key — and no code", async () => {
    const f = fetchReturning(200, { ok: true });
    expect(await sendEvent(API, { kind: "opened", cast: CAST }, KEY, f)).toBe(true);
    const [url, init] = callOf(f);
    expect(url).toBe("https://drawcast.anvil.app/_/api/event");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>)["content-type"]).toBe("text/plain");
    expect(init.keepalive).toBe(true);
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(body).toEqual({ key: KEY, kind: "opened", cast: CAST });
    expect("code" in body).toBe(false);
  });
  test("a trailing slash on the api is not doubled", async () => {
    const f = fetchReturning(200, { ok: true });
    await sendEvent("https://drawcast.anvil.app/", { kind: "completed", cast: CAST }, KEY, f);
    expect(callOf(f)[0]).toBe("https://drawcast.anvil.app/_/api/event");
  });
  test("an answer carries item, step, question, attempts, expected and correct", async () => {
    const f = fetchReturning(200, { ok: true });
    await sendEvent(API, { kind: "answer", cast: CAST, item: 2, step: 4, question: "Which case?", given: ["dative", "genitive"], expected: "genitive", correct: true }, KEY, f);
    expect(JSON.parse(callOf(f)[1].body as string)).toEqual({
      key: KEY, kind: "answer", cast: CAST, item: 2, step: 4, question: "Which case?", given: ["dative", "genitive"], expected: "genitive", correct: true,
    });
  });
  test("the attempts are trimmed to what the server accepts: the last 10, 2000 characters each", async () => {
    const f = fetchReturning(200, { ok: true });
    const tries = Array.from({ length: 12 }, (_, i) => `try-${i}`);
    await sendEvent(API, { kind: "answer", cast: CAST, item: 0, step: 1, question: "Q", given: tries, expected: "x", correct: false }, KEY, f);
    const sent = JSON.parse(callOf(f)[1].body as string) as { given: string[] };
    expect(sent.given).toEqual(tries.slice(2));
    expect(sent.given.length).toBe(10);
    const g = fetchReturning(200, { ok: true });
    await sendEvent(API, { kind: "answer", cast: CAST, item: 0, step: 1, question: "Q", given: ["a".repeat(3000)], expected: "b".repeat(3000), correct: false }, KEY, g);
    const long = JSON.parse(callOf(g)[1].body as string) as { given: string[]; expected: string };
    expect(long.given[0].length).toBe(2000);
    expect(long.expected.length).toBe(2000);
  });
  test("a cast key that is not a cast key is refused without a request", async () => {
    const f = fetchReturning(200, { ok: true });
    expect(await sendEvent(API, { kind: "opened", cast: "not-a-key" }, KEY, f)).toBe(false);
    expect(calls(f)).toBe(0);
  });
  test("no token, no request: signed out reports nothing", async () => {
    const f = fetchReturning(200, { ok: true });
    expect(await sendEvent(API, { kind: "opened", cast: CAST }, "", f)).toBe(false);
    expect(calls(f)).toBe(0);
  });
  test("a refusal is false, never a throw into playback — 403 enrol, 401 key, a 500, the network", async () => {
    expect(await sendEvent(API, { kind: "opened", cast: CAST }, KEY, fetchReturning(403, { error: "enrol" }))).toBe(false);
    expect(await sendEvent(API, { kind: "opened", cast: CAST }, KEY, fetchReturning(401, { error: "key" }))).toBe(false);
    expect(await sendEvent(API, { kind: "opened", cast: CAST }, KEY, fetchReturning(500, {}))).toBe(false);
    const dead = vi.fn(async () => {
      throw new Error("offline");
    }) as unknown as typeof fetch;
    expect(await sendEvent(API, { kind: "opened", cast: CAST }, KEY, dead)).toBe(false);
  });
});

// Joining (spec §3): one click for a signed-in account, from the door the
// course's name opens in the app.
describe("joinCourse", () => {
  const REQ = { course: COURSE, title: "Learn Russian", page: "https://hmelberg.github.io/dcast/learn-russian/" };
  test("posts the token and the course as text/plain JSON to <api>/_/api/enroll — no name, no address, no code", async () => {
    const f = fetchReturning(200, { ok: true, state: "active" });
    expect(await joinCourse("https://drawcast.anvil.app/", KEY, REQ, f)).toBe("ok");
    const [url, init] = callOf(f);
    expect(url).toBe("https://drawcast.anvil.app/_/api/enroll");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>)["content-type"]).toBe("text/plain");
    expect(JSON.parse(init.body as string)).toEqual({ key: KEY, course: COURSE, title: "Learn Russian", page: "https://hmelberg.github.io/dcast/learn-russian/" });
  });
  test("a run travels only when one was asked for", async () => {
    const f = fetchReturning(200, { ok: true, state: "active" });
    await joinCourse(API, KEY, { ...REQ, run: "spring" }, f);
    expect(JSON.parse(callOf(f)[1].body as string).run).toBe("spring");
  });
  test("no token, no request", async () => {
    const f = fetchReturning(200, { ok: true });
    expect(await joinCourse(API, "", REQ, f)).toBe("key");
    expect(calls(f)).toBe(0);
  });
  test("the server's refusals map one to one — a 400 is an answer, not an outage — and everything else (a 500, the network) is error", async () => {
    expect(await joinCourse(API, KEY, REQ, fetchReturning(401, { error: "key" }))).toBe("key");
    expect(await joinCourse(API, KEY, REQ, fetchReturning(403, { error: "closed" }))).toBe("closed");
    expect(await joinCourse(API, KEY, REQ, fetchReturning(404, { error: "run" }))).toBe("run");
    expect(await joinCourse(API, KEY, REQ, fetchReturning(400, { error: "page" }))).toBe("invalid");
    expect(await joinCourse(API, KEY, REQ, fetchReturning(429, { error: "rate" }))).toBe("rate");
    expect(await joinCourse(API, KEY, REQ, fetchReturning(500, { error: "boom" }))).toBe("error");
    const dead = vi.fn(async () => {
      throw new Error("offline");
    }) as unknown as typeof fetch;
    expect(await joinCourse(API, KEY, REQ, dead)).toBe("error");
  });
  test("every outcome has its own sentence saying what to do next", () => {
    const outcomes: JoinOutcome[] = ["ok", "key", "closed", "run", "invalid", "rate", "error"];
    const notes = outcomes.map((o) => joinNote(o));
    for (const note of notes) expect(note.length).toBeGreaterThan(10);
    expect(new Set(notes).size).toBe(outcomes.length);
    expect(joinNote("ok")).toMatch(/teachers/);
    expect(joinNote("key")).toMatch(/sign in again/i);
    expect(joinNote("closed")).toMatch(/ask its teacher/);
    expect(joinNote("invalid")).not.toMatch(/could not reach/i);
    expect(joinNote("error")).toMatch(/could not reach/i);
  });
});
