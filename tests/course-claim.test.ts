// The claim (teachers round, spec §3/§5) and the join-box checkbox's rule.
// Pure halves here; Task 3 appends the source guards for the DOM wiring.
import { readFileSync } from "node:fs";
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
    [429, "rate"],
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
  test("the spec's three notes, the registry's own two, and the rate limit", () => {
    expect(claimNote("ok")).toBe(" · you own this course");
    expect(claimNote("owner")).toBe(" · this course is owned by another author — not claimed");
    expect(claimNote("key")).toBe(" · author key rejected");
    expect(claimNote("invalid")).toBe(" · course not claimed (the registry rejected the request)");
    expect(claimNote("rate")).toBe(" · course not claimed: too many were made in the last hour — try again later");
    expect(claimNote("error")).toBe(" · course not claimed (registry unreachable)");
  });
});

describe("registerName learns the registry's new 403", () => {
  // The Anvil side now answers 403 when a course name is registered by
  // someone who does not own the course. Without this arm the app calls that
  // "registry unreachable" — a permanent, explainable condition reported as a
  // network failure. It matters most in the window where the server round is
  // deployed and this one is not yet.
  test("403 is `owner`, and says so — worded for both callers (F4: registerName is shared with the cast publish)", async () => {
    const forbidding = (async () => new Response('{"error":"owner"}', { status: 403 })) as typeof fetch;
    const outcome = await registerName(DEFAULT_ENROLL_API, { key: "k", name: "learn-russian", kind: "course", target: "h/d/learn-russian" }, forbidding);
    expect(outcome).toBe("owner");
    expect(nameNote("owner", "learn-russian")).toBe(" · the name was not registered: you do not own what it points at");
  });

  // F5: the documented contract includes 429 {"error":"rate"} — folding it
  // into "error" reports a temporary, actionable condition as a permanent,
  // unexplainable one.
  test("429 is `rate`, and says so", async () => {
    const limiting = (async () => new Response('{"error":"rate"}', { status: 429 })) as typeof fetch;
    const outcome = await registerName(DEFAULT_ENROLL_API, { key: "k", name: "learn-russian", kind: "course", target: "h/d/learn-russian" }, limiting);
    expect(outcome).toBe("rate");
    expect(nameNote("rate", "learn-russian")).toBe(" · name not registered: too many were made in the last hour — try again later");
  });
});

describe("the join-box checkbox and the claim are wired (source guards — no jsdom here)", () => {
  const share = readFileSync(new URL("../src/ui/share.ts", import.meta.url), "utf8");
  const course = readFileSync(new URL("../src/ui/course.ts", import.meta.url), "utf8");
  const main = readFileSync(new URL("../src/main.ts", import.meta.url), "utf8");

  test("Share offers the box for a course only, seeded from the document, and sends the choice", () => {
    expect(share).toMatch(/id: "share-allow-signup"/);
    expect(share).toMatch(/Allow sign-up on the course page/);
    expect(share).toMatch(/signupLabel\.hidden = subject !== "course"/);
    expect(share).toMatch(/signupCb\.checked = doc\.joinBox === true/);
    expect(share).toMatch(/allowSignup: deps\.subject === "course" \? signupCb\.checked : undefined/);
    expect(share).toMatch(/joinBox\?:\s*boolean/);
  });

  test("the course panel seeds the box from enroll: and applies the choice to the text BEFORE publishing", () => {
    expect(course).toMatch(/joinBox: course\.enroll !== undefined/);
    const publishFn = course.slice(course.indexOf("async function publish("), course.indexOf("function showLinks("));
    expect(publishFn).toMatch(/applyJoinBox\(doc\.value, allowSignup\)/);
    expect(publishFn.indexOf("applyJoinBox(")).toBeLessThan(publishFn.indexOf("await publishCourse("));
    // The text handed to publishCourse is the one the choice was applied to.
    expect(publishFn).toMatch(/publishCourse\(\{\s*text,/);
  });

  test("the claim runs after the commit landed and BEFORE the name, which is registered on \"ok\" or an unresolved \"error\" — never on an explicit non-owning answer (F1)", () => {
    const after = course.slice(course.indexOf("await publishCourse("));
    expect(after).toMatch(/claimCourse\(DEFAULT_ENROLL_API, courseClaim\(authorKey, reg\)/);
    expect(after.indexOf("claimCourse(")).toBeGreaterThan(after.indexOf("render();"));
    // F3: the condition and the ordering are pinned as two separate
    // assertions, neither coupled to how the statement wraps across lines —
    // the ordering assertion alone already carries the real guarantee (claim
    // before name), and the condition assertion just needs the text to exist
    // somewhere in the function, not glued to `registerName(` on one line.
    expect(after.indexOf("claimCourse(")).toBeLessThan(after.indexOf("registerName("));
    expect(after).toMatch(/claimNote\(/);
    expect(after).toMatch(/claimed === "ok" \|\| claimed === "error"/);
  });

  test("Settings → Publishing says what the key does now", () => {
    expect(main).toMatch(/makes you the owner of the course in the teacher dashboard/);
  });
});
