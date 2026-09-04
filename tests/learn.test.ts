// The learner client. Every network call is injected, as in tests/views-client.test.ts.
import { describe, expect, test, vi } from "vitest";
import {
  apiBase, courseKeyOf, firstOpenInSession, forgetLearner, learnerFor, learnerParam, normalizeCode,
  readLearners, readProgress, reportingAllowed, saveLearner, sendEvent, stripLearnerParam, LEARNERS_KEY,
} from "../src/learn";

const CAST = "hmelberg/dcast/learn-russian/03-cases.yaml";
const COURSE = "hmelberg/dcast/learn-russian";
const ENTRY = { code: "fjell-rev-havn", api: "https://drawcast.anvil.app", name: "Kari" };

function memoryStorage() {
  const data: Record<string, string> = {};
  return {
    getItem: (k: string) => data[k] ?? null,
    setItem: (k: string, v: string) => { data[k] = v; },
    removeItem: (k: string) => { delete data[k]; },
    data,
  };
}
function throwingStorage() {
  const boom = () => { throw new Error("private mode"); };
  return { getItem: boom, setItem: boom, removeItem: boom };
}
function fetchReturning(status: number, body: unknown): typeof fetch {
  return vi.fn(async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;
}
function callOf(f: typeof fetch): [string, RequestInit] {
  return (f as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
}

describe("normalizeCode", () => {
  test("lower-cases, trims, accepts spaces for hyphens", () => {
    expect(normalizeCode(" Fjell-Rev-Havn ")).toBe("fjell-rev-havn");
    expect(normalizeCode("fjell rev havn")).toBe("fjell-rev-havn");
  });
  test("rejects anything that is not three words", () => {
    for (const bad of ["x", "fjell-rev", "fjell-rev-havn-x", "fjell-rév-havn", "", null, undefined]) expect(normalizeCode(bad)).toBeNull();
  });
});

describe("keys", () => {
  test("the course key is the cast key without its file name", () => {
    expect(courseKeyOf(CAST)).toBe(COURSE);
  });
  test("apiBase strips trailing slashes only", () => {
    expect(apiBase("https://drawcast.anvil.app/")).toBe("https://drawcast.anvil.app");
    expect(apiBase("https://drawcast.anvil.app")).toBe("https://drawcast.anvil.app");
  });
});

describe("the learners map", () => {
  test("save, read back, forget — keyed by course so two courses coexist", () => {
    const s = memoryStorage();
    saveLearner(s, COURSE, ENTRY);
    saveLearner(s, "o/r/other", { code: "a-b-c", api: "https://x" });
    expect(learnerFor(s, COURSE)).toEqual(ENTRY);
    expect(Object.keys(readLearners(s))).toEqual([COURSE, "o/r/other"]);
    forgetLearner(s, COURSE);
    expect(learnerFor(s, COURSE)).toBeNull();
    expect(learnerFor(s, "o/r/other")?.code).toBe("a-b-c");
  });
  test("corrupt or absent storage reads as empty and never throws", () => {
    const s = memoryStorage();
    s.data[LEARNERS_KEY] = "{not json";
    expect(readLearners(s)).toEqual({});
    expect(readLearners(null)).toEqual({});
    expect(() => saveLearner(throwingStorage(), COURSE, ENTRY)).not.toThrow();
    expect(learnerFor(throwingStorage(), COURSE)).toBeNull();
  });
});

describe("the learner param", () => {
  test("is read from a hash or a query string, case-insensitively", () => {
    expect(learnerParam("https://drawcast.app/#gh=a/b/c.yaml&learner=Fjell-Rev-Havn&mode=silent")).toBe("fjell-rev-havn");
    expect(learnerParam("https://h.github.io/dcast/learn-russian/?learner=fjell-rev-havn")).toBe("fjell-rev-havn");
    expect(learnerParam("https://drawcast.app/#gh=a/b/c.yaml")).toBeNull();
    expect(learnerParam("https://drawcast.app/#gh=a/b/c.yaml&learner=nope")).toBeNull();
  });
  test("a malformed percent-escape is null, not a throw", () => {
    expect(learnerParam("https://drawcast.app/#gh=a/b/c.yaml&learner=100%")).toBeNull();
    expect(learnerParam("https://drawcast.app/#gh=a/b/c.yaml&learner=fjell%zz")).toBeNull();
  });
  test("stripping removes only that parameter, wherever it sits", () => {
    expect(stripLearnerParam("https://drawcast.app/#gh=a/b/c.yaml&learner=fjell-rev-havn&mode=silent")).toBe("https://drawcast.app/#gh=a/b/c.yaml&mode=silent");
    expect(stripLearnerParam("https://drawcast.app/#gh=a/b/c.yaml&learner=fjell-rev-havn")).toBe("https://drawcast.app/#gh=a/b/c.yaml");
    expect(stripLearnerParam("https://h.github.io/x/?learner=a-b-c")).toBe("https://h.github.io/x/");
    expect(stripLearnerParam("https://h.github.io/x/?run=spring&learner=a-b-c#top")).toBe("https://h.github.io/x/?run=spring#top");
  });
});

describe("reportingAllowed", () => {
  test("needs an entry, and the entry's api must match meta.enroll when present", () => {
    expect(reportingAllowed(null, undefined)).toBe(false);
    expect(reportingAllowed(ENTRY, undefined)).toBe(true);
    expect(reportingAllowed(ENTRY, "https://drawcast.anvil.app/")).toBe(true);
    expect(reportingAllowed(ENTRY, "https://someone-else.anvil.app")).toBe(false);
  });
});

describe("firstOpenInSession", () => {
  test("first open reports, a reload does not, no storage always reports", () => {
    const s = memoryStorage();
    expect(firstOpenInSession(CAST, s)).toBe(true);
    expect(firstOpenInSession(CAST, s)).toBe(false);
    expect(firstOpenInSession(CAST, null)).toBe(true);
  });
});

describe("sendEvent", () => {
  test("posts JSON as text/plain to <api>/_/api/event with the code", async () => {
    const f = fetchReturning(200, { ok: true });
    expect(await sendEvent(ENTRY, { kind: "opened", cast: CAST }, f)).toBe(true);
    const [url, init] = callOf(f);
    expect(url).toBe("https://drawcast.anvil.app/_/api/event");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>)["content-type"]).toBe("text/plain");
    expect(init.keepalive).toBe(true);
    expect(JSON.parse(init.body as string)).toEqual({ code: "fjell-rev-havn", kind: "opened", cast: CAST });
  });
  test("an answer carries item, step, question, attempts, expected and correct", async () => {
    const f = fetchReturning(200, { ok: true });
    await sendEvent(ENTRY, { kind: "answer", cast: CAST, item: 2, step: 4, question: "Which case?", given: ["dative", "genitive"], expected: "genitive", correct: true }, f);
    expect(JSON.parse(callOf(f)[1].body as string)).toEqual({
      code: "fjell-rev-havn", kind: "answer", cast: CAST, item: 2, step: 4, question: "Which case?", given: ["dative", "genitive"], expected: "genitive", correct: true,
    });
  });
  test("the attempts are trimmed to what the server accepts: the last 10, 2000 characters each", async () => {
    const f = fetchReturning(200, { ok: true });
    const tries = Array.from({ length: 12 }, (_, i) => `try-${i}`);
    await sendEvent(ENTRY, { kind: "answer", cast: CAST, item: 0, step: 1, question: "Q", given: tries, expected: "x", correct: false }, f);
    const sent = JSON.parse(callOf(f)[1].body as string) as { given: string[] };
    expect(sent.given).toEqual(tries.slice(2));
    expect(sent.given.length).toBe(10);
    const g = fetchReturning(200, { ok: true });
    await sendEvent(ENTRY, { kind: "answer", cast: CAST, item: 0, step: 1, question: "Q", given: ["a".repeat(3000)], expected: "b".repeat(3000), correct: false }, g);
    const long = JSON.parse(callOf(g)[1].body as string) as { given: string[]; expected: string };
    expect(long.given[0].length).toBe(2000);
    expect(long.expected.length).toBe(2000);
  });
  test("a bad cast key never becomes a request; failures return false", async () => {
    const f = fetchReturning(200, { ok: true });
    expect(await sendEvent(ENTRY, { kind: "opened", cast: "nope" }, f)).toBe(false);
    expect((f as unknown as ReturnType<typeof vi.fn>).mock.calls.length).toBe(0);
    expect(await sendEvent(ENTRY, { kind: "opened", cast: CAST }, fetchReturning(500, {}))).toBe(false);
    const thrower = vi.fn(async () => { throw new Error("offline"); }) as unknown as typeof fetch;
    expect(await sendEvent(ENTRY, { kind: "opened", cast: CAST }, thrower)).toBe(false);
  });
});

describe("readProgress", () => {
  test("GETs <api>/_/api/progress?code= and returns the body", async () => {
    const body = { name: "Kari", course: { key: COURSE, title: "Learn Russian", page: "https://h/x/" }, lectures: [] };
    const f = fetchReturning(200, body);
    expect(await readProgress("https://drawcast.anvil.app/", "fjell-rev-havn", f)).toEqual(body);
    expect(callOf(f)[0]).toBe("https://drawcast.anvil.app/_/api/progress?code=fjell-rev-havn");
  });
  test("a 404 or a throw is null", async () => {
    expect(await readProgress("https://x", "fjell-rev-havn", fetchReturning(404, { error: "code" }))).toBeNull();
    const thrower = vi.fn(async () => { throw new Error("offline"); }) as unknown as typeof fetch;
    expect(await readProgress("https://x", "fjell-rev-havn", thrower)).toBeNull();
  });
});
