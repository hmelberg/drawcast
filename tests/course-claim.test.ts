// The claim (teachers round, spec §3/§5) and the join-box checkbox's rule.
// Pure halves here; Task 3 appends the source guards for the DOM wiring.
import { describe, expect, test } from "vitest";
import { parseCourse } from "../src/course/document";
import { applyJoinBox, courseRegistration } from "../src/course/publish";
import { DEFAULT_ENROLL_API } from "../src/learn";
import { claimCourse, claimNote, courseClaim, nameNote, registerName, type ClaimOutcome, type CourseClaim } from "../src/names";

const REPO = { owner: "hmelberg", repo: "dcast" };

describe("applyJoinBox", () => {
  const DOC = "# Learn Russian\nslug: russian\n\n## A\nq\n";

  test("on writes the default app into a document without enroll:", () => {
    const out = applyJoinBox(DOC, true);
    expect(parseCourse(out).enroll).toBe(DEFAULT_ENROLL_API);
    expect(out).toContain(`enroll: ${DEFAULT_ENROLL_API}`);
    expect(out.indexOf("enroll:")).toBeLessThan(out.indexOf("## A"));
  });

  test("on leaves a custom enroll: URL alone — the checkbox only manages the default app", () => {
    const custom = "# T\nenroll: https://my-own.anvil.app\n\n## A\nq\n";
    expect(applyJoinBox(custom, true)).toBe(custom);
  });

  test("off removes the line, whatever URL it carried", () => {
    expect(parseCourse(applyJoinBox(applyJoinBox(DOC, true), false)).enroll).toBeUndefined();
    expect(applyJoinBox(applyJoinBox(DOC, true), false)).toBe(DOC);
    expect(applyJoinBox("# T\nenroll: https://my-own.anvil.app\n\n## A\nq\n", false)).toBe("# T\n\n## A\nq\n");
  });

  test("off on a document without enroll: is byte-identical", () => {
    expect(applyJoinBox(DOC, false)).toBe(DOC);
  });

  test("the api argument is what gets written", () => {
    expect(parseCourse(applyJoinBox(DOC, true, "https://other.anvil.app")).enroll).toBe("https://other.anvil.app");
  });
});

describe("courseClaim", () => {
  test("is the registration's target, title, page and lectures under the key", () => {
    const c = parseCourse("# Learn Russian\nslug: russian\n\n## A\nq\nstatus: done · file: 01-a.yaml\n");
    const reg = courseRegistration(c, REPO, "", "https://hmelberg.github.io/dcast/russian/")!;
    expect(courseClaim("k", reg)).toEqual({
      key: "k",
      course: "hmelberg/dcast/russian",
      title: "Learn Russian",
      page: "https://hmelberg.github.io/dcast/russian/",
      lectures: ["hmelberg/dcast/russian/01-a.yaml"],
    });
  });
});

describe("claimCourse", () => {
  const claim: CourseClaim = { key: "k", course: "hmelberg/dcast/russian", title: "T", page: "https://h/x/", lectures: [] };
  const answering = (status: number, calls: { url: string; init: RequestInit }[] = []): typeof fetch =>
    (async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(input), init: init ?? {} });
      return new Response(status === 200 ? '{"ok":true,"owned":true}' : '{"error":"x"}', { status });
    }) as typeof fetch;

  test("posts the claim as text/plain JSON to /_/api/course", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    await claimCourse("https://drawcast.anvil.app/", claim, answering(200, calls));
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://drawcast.anvil.app/_/api/course");
    expect(calls[0].init.method).toBe("POST");
    expect((calls[0].init.headers as Record<string, string>)["content-type"]).toBe("text/plain");
    expect(JSON.parse(calls[0].init.body as string)).toEqual(claim);
  });

  // Typed explicitly: tests are type-checked (tsconfig includes tests/), and
  // an untyped literal would infer (string | number)[][] for the rows.
  const statuses: [number, ClaimOutcome][] = [
    [200, "ok"],
    [403, "owner"],
    [401, "key"],
    [400, "invalid"],
    [429, "error"],
    [500, "error"],
  ];
  test.each(statuses)("maps %i to %s", async (status, outcome) => {
    expect(await claimCourse(DEFAULT_ENROLL_API, claim, answering(status))).toBe(outcome);
  });

  test("a network failure is an outcome, never a throw", async () => {
    const failing = (async () => {
      throw new TypeError("offline");
    }) as typeof fetch;
    expect(await claimCourse(DEFAULT_ENROLL_API, claim, failing)).toBe("error");
  });
});

describe("claimNote", () => {
  test("the spec's three notes, and two for the registry itself", () => {
    expect(claimNote("ok")).toBe(" · you own this course");
    expect(claimNote("owner")).toBe(" · this course is owned by another author — not claimed");
    expect(claimNote("key")).toBe(" · author key rejected");
    expect(claimNote("invalid")).toBe(" · course not claimed (the registry rejected the request)");
    expect(claimNote("error")).toBe(" · course not claimed (registry unreachable)");
  });
});

describe("registerName learns the registry's new 403", () => {
  // The Anvil side now answers 403 when a course name is registered by
  // someone who does not own the course. Without this arm the app calls that
  // "registry unreachable" — a permanent, explainable condition reported as a
  // network failure. It matters most in the window where the server round is
  // deployed and this one is not yet.
  test("403 is `owner`, and says so", async () => {
    const forbidding = (async () => new Response('{"error":"owner"}', { status: 403 })) as typeof fetch;
    const outcome = await registerName(DEFAULT_ENROLL_API, { key: "k", name: "learn-russian", kind: "course", target: "h/d/learn-russian" }, forbidding);
    expect(outcome).toBe("owner");
    expect(nameNote("owner", "learn-russian")).toBe(" · the name was not registered: this course is owned by another author");
  });
});
