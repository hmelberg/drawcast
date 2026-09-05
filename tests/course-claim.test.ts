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
    expect(claimNote("key")).toBe(" · course not claimed: not signed in — sign in again from Settings → Publishing (drawcast account)");
    expect(claimNote("invalid")).toBe(" · course not claimed (the registry rejected the request)");
    expect(claimNote("rate")).toBe(" · course not claimed: too many were made in the last hour — try again later");
    expect(claimNote("error")).toBe(" · course not claimed (registry unreachable)");
  });
});

describe("nameNote and claimNote cover every outcome (switches are exhaustive — tsc is the real backstop; this is the runtime one)", () => {
  // Typed to the exact union each function accepts: a literal that isn't a
  // member of the union fails to compile, so the array can't contain a
  // stale or invented outcome. It is NOT exhaustive over the union, though —
  // a member added to the union elsewhere without growing this array would
  // compile fine here. That direction is caught by the `never` guard in
  // src/names.ts, not by this array; this test only checks that the
  // outcomes it does list produce distinct, non-empty notes.
  type NameOutcome = Parameters<typeof nameNote>[0];
  const NAME_OUTCOMES: readonly NameOutcome[] = ["ok", "taken", "owner", "key", "invalid", "rate", "error"];
  const CLAIM_OUTCOMES: readonly ClaimOutcome[] = ["ok", "owner", "key", "invalid", "rate", "error"];

  test("every nameNote outcome produces a distinct, non-empty note", () => {
    const notes = NAME_OUTCOMES.map((o) => nameNote(o, "learn-russian"));
    for (const note of notes) expect(note.length).toBeGreaterThan(0);
    expect(new Set(notes).size).toBe(NAME_OUTCOMES.length);
  });

  test("every claimNote outcome produces a distinct, non-empty note", () => {
    const notes = CLAIM_OUTCOMES.map((o) => claimNote(o));
    for (const note of notes) expect(note.length).toBeGreaterThan(0);
    expect(new Set(notes).size).toBe(CLAIM_OUTCOMES.length);
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

  // F2: unchecking the join box deletes the course document's `enroll:` line
  // — the only record of an author's own Anvil backend. The hint has to name
  // that URL before the delete, not after — and, since the identity round,
  // say what that server gets: nothing. The viewer sends a learner's session
  // token to the drawcast server and nowhere else, so a server of the
  // author's own is not reported to, and the page gets no Join link.
  test("Share names the author's own enroll URL in the hint and says it is not reported to, so unchecking is never silent and the line never oversells (F2)", () => {
    expect(share).toMatch(/enrollUrl\?:\s*string/);
    expect(share).toMatch(/import \{ DEFAULT_ENROLL_API \} from "\.\.\/learn"/);
    expect(share).toMatch(/doc\.enrollUrl && doc\.enrollUrl !== DEFAULT_ENROLL_API/);
    expect(share).toMatch(/enroll: \$\{doc\.enrollUrl\} names a server of your own/);
    expect(share).toMatch(/reports progress to the drawcast server only/);
    expect(share).toMatch(/unchecking removes the line from the course document/);
    expect(share).not.toMatch(/your own app: /);
    // The default hint says where progress goes too, and no longer speaks of a code.
    expect(share).toMatch(/SIGNUP_HINT_DEFAULT =\s*"[^"]*go to the drawcast server/);
    expect(share).not.toMatch(/course code/);
    // The hint is re-derived per document, like the checkbox itself — not set
    // once at build time.
    const refresh = share.slice(share.indexOf("function refreshSignupChoice("), share.indexOf("const linkPanel ="));
    expect(refresh).toMatch(/signupHint\.textContent =/);
  });

  test("the course panel seeds the box from enroll: and applies the choice to the text BEFORE publishing", () => {
    expect(course).toMatch(/joinBox: course\.enroll !== undefined/);
    expect(course).toMatch(/enrollUrl: course\.enroll/); // F2 — what unchecking would delete
    const publishFn = course.slice(course.indexOf("async function publish("), course.indexOf("function showLinks("));
    expect(publishFn).toMatch(/applyJoinBox\(doc\.value, allowSignup\)/);
    expect(publishFn.indexOf("applyJoinBox(")).toBeLessThan(publishFn.indexOf("await preparePublish("));
    // The text handed to the publish is the one the choice was applied to.
    expect(publishFn).toMatch(/const publishArgs: PublishArgs = \{\s*text,/);
    expect(publishFn).toMatch(/preparePublish\(publishArgs\)/);
    expect(publishFn).toMatch(/commitPublish\(publishArgs, prepared, door\)/);
  });

  test("the claim and the name run BETWEEN the reads and the commit, claim first, the name on \"ok\" or an unresolved \"error\" — never on an explicit non-owning answer (F1)", () => {
    const publishFn = course.slice(course.indexOf("async function publish("), course.indexOf("function showLinks("));
    const prepare = publishFn.indexOf("await preparePublish(");
    const claim = publishFn.indexOf("claimCourse(");
    const name = publishFn.indexOf("registerName(");
    const commit = publishFn.indexOf("await commitPublish(");
    expect(prepare).toBeGreaterThan(0);
    // `accountToken`, not `token`: in this scope `token` is the GitHub one.
    expect(publishFn).toMatch(/claimCourse\(DEFAULT_ENROLL_API, courseClaim\(accountToken, reg\)/);
    expect(claim).toBeGreaterThan(prepare);
    expect(name).toBeGreaterThan(claim);
    expect(commit).toBeGreaterThan(name);
    expect(publishFn).toMatch(/claimNote\(/);
    expect(publishFn).toMatch(/claimed === "ok" \|\| claimed === "error"/);
  });

  test("the page's door is built ONLY from a name that came back ok — a taken name would send a learner into a stranger's run", () => {
    const publishFn = course.slice(course.indexOf("async function publish("), course.indexOf("function showLinks("));
    expect(publishFn).toMatch(/let door: Door = \{ name: null, why: "signed-out" \};/);
    expect(publishFn).toMatch(/door = named === "ok" \? \{ name: reg\.name, app: settings\.viewerBase \} : \{ name: null, why: DOORLESS\[named\] \};/);
    // A name under the floor is never sent, and is reported as short, not invalid.
    expect(publishFn).toMatch(/if \(isRegistrable\(reg\.name\)\)/);
    expect(publishFn).toMatch(/names need at least \$\{MIN_NAME_LENGTH\} characters/);
    expect(publishFn).toMatch(/why: short \? "short" : "invalid"/);
    // A refused claim is a doorless page too, with the claim's own reason.
    expect(publishFn).toMatch(/why: claimed === "owner" \? "owner" : claimed === "key" \? "signed-out" : "unreachable"/);
    // The registry's every non-ok answer has a reason — the map is total over the union (tsc), and it never maps anything to a door.
    expect(course).toMatch(/const DOORLESS: Record<Exclude<Awaited<ReturnType<typeof registerName>>, "ok">, DoorlessReason> = \{/);
  });

  test("Settings → Publishing says what signing in does now, and no longer speaks of an author key", () => {
    expect(main).toMatch(/own your courses in the teacher dashboard/);
    expect(main).not.toMatch(/author key/i);
  });

  test("the two 401 notes tell the reader what to do — sign in again — and neither speaks of an author key", () => {
    // The credential that was rejected is a session token the app holds
    // after signing in; the Settings row is called "drawcast account". Copy
    // that named the old key told the reader to look for a field that is no
    // longer there.
    const names = readFileSync(new URL("../src/names.ts", import.meta.url), "utf8");
    expect(names).not.toMatch(/author key/i);
    expect(nameNote("key", "learn-russian")).toMatch(/sign in again from Settings → Publishing/);
    expect(claimNote("key")).toMatch(/sign in again from Settings → Publishing/);
  });
});
