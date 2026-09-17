// The claim (teachers round, spec §3/§5) and the Join-door checkbox's rule.
// Pure halves here; Task 3 appends the source guards for the DOM wiring.
import { readFileSync } from "node:fs";
import { prettyCopies } from "../src/ui/share";
import { describe, expect, test } from "vitest";
import { parseCourse } from "../src/course/document";
import { applyJoinDoor, courseRegistration } from "../src/course/publish";
import { DEFAULT_ENROLL_API } from "../src/learn";
import { claimCourse, claimNote, courseClaim, nameNote, registerName, type ClaimOutcome, type CourseClaim } from "../src/names";

const REPO = { owner: "hmelberg", repo: "dcast" };

describe("applyJoinDoor", () => {
  const DOC = "# Learn Russian\nslug: russian\n\n## A\nq\n";

  test("on writes the default app into a document without enroll:", () => {
    const out = applyJoinDoor(DOC, true);
    expect(parseCourse(out).enroll).toBe(DEFAULT_ENROLL_API);
    expect(out).toContain(`enroll: ${DEFAULT_ENROLL_API}`);
    expect(out.indexOf("enroll:")).toBeLessThan(out.indexOf("## A"));
  });

  test("on leaves a custom enroll: URL alone — the checkbox only manages the default app", () => {
    const custom = "# T\nenroll: https://my-own.anvil.app\n\n## A\nq\n";
    expect(applyJoinDoor(custom, true)).toBe(custom);
  });

  test("off removes the line, whatever URL it carried", () => {
    expect(parseCourse(applyJoinDoor(applyJoinDoor(DOC, true), false)).enroll).toBeUndefined();
    expect(applyJoinDoor(applyJoinDoor(DOC, true), false)).toBe(DOC);
    expect(applyJoinDoor("# T\nenroll: https://my-own.anvil.app\n\n## A\nq\n", false)).toBe("# T\n\n## A\nq\n");
  });

  test("off on a document without enroll: is byte-identical", () => {
    expect(applyJoinDoor(DOC, false)).toBe(DOC);
  });

  test("the api argument is what gets written", () => {
    expect(parseCourse(applyJoinDoor(DOC, true, "https://other.anvil.app")).enroll).toBe("https://other.anvil.app");
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

describe("the Join-door checkbox and the claim are wired (source guards — no jsdom here)", () => {
  const share = readFileSync(new URL("../src/ui/share.ts", import.meta.url), "utf8");
  const course = readFileSync(new URL("../src/ui/course.ts", import.meta.url), "utf8");
  const main = readFileSync(new URL("../src/main.ts", import.meta.url), "utf8");

  test("Share offers the box for a course only, seeded from the document, and sends the choice", () => {
    expect(share).toMatch(/id: "share-allow-signup"/);
    // The label names what the page carries now — a door, not the join box
    // the identity round removed — and the old wording is gone with it.
    expect(share).toMatch(/Join door on the course page/);
    expect(share).not.toMatch(/Allow sign-up/);
    expect(share).toMatch(/signupLabel\.hidden = subject !== "course"/);
    expect(share).toMatch(/signupCb\.checked = doc\.joinDoor === true/);
    expect(share).toMatch(/allowSignup: deps\.subject === "course" \? signupCb\.checked : undefined/);
    expect(share).toMatch(/joinDoor\?:\s*boolean/);
  });

  // F2: unchecking the Join door deletes the course document's `enroll:` line
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
    expect(course).toMatch(/joinDoor: course\.enroll !== undefined/);
    expect(course).toMatch(/enrollUrl: course\.enroll/); // F2 — what unchecking would delete
    const publishFn = course.slice(course.indexOf("async function publish("), course.indexOf("function showLinks("));
    expect(publishFn).toMatch(/applyJoinDoor\(doc\.value, allowSignup\)/);
    expect(publishFn.indexOf("applyJoinDoor(")).toBeLessThan(publishFn.indexOf("await preparePublish("));
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
    // A name under the (paid) floor is never sent, and is reported as short, not invalid.
    expect(publishFn).toMatch(/if \(isPayable\(reg\.name\)\)/);
    expect(publishFn).toMatch(/why: normalizeName\(reg\.name\) !== null \? "short" : "invalid"/);
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

// The course's door name as a Publish field (name round, 2026-09-17): what
// the author types binds to the `name:` option — the short address
// drawcast.app/#<name> — and NEVER to `slug:`, the folder every published
// link and the Anvil course key hang off.
import { applyCourseName } from "../src/course/publish";

describe("applyCourseName", () => {
  const PUBLISHED = "# Micro I\nslug: micro-i\n---\n## Supply\nWhy?\n";
  test("writes a typed name that differs from the slug as the name: option", () => {
    const out = applyCourseName(PUBLISHED, "Micro-Economics-1", "micro-i");
    expect(out).toContain("name: micro-economics-1");
    expect(out).toContain("slug: micro-i");
  });
  test("never touches slug:, whatever is typed", () => {
    const out = applyCourseName(PUBLISHED, "somewhere-else", "micro-i");
    expect(parseCourse(out).context.slug).toBe("micro-i");
  });
  test("a name equal to the slug removes a stale override rather than writing a redundant one", () => {
    const withName = applyCourseName(PUBLISHED, "micro-economics-1", "micro-i");
    const back = applyCourseName(withName, "micro-i", "micro-i");
    expect(back).not.toContain("name:");
    expect(back).toBe(PUBLISHED);
  });
  test("nothing typed, or the name already in force, leaves the document byte-identical", () => {
    expect(applyCourseName(PUBLISHED, undefined, "micro-i")).toBe(PUBLISHED);
    expect(applyCourseName(PUBLISHED, "", "micro-i")).toBe(PUBLISHED);
    const withName = applyCourseName(PUBLISHED, "micro-economics-1", "micro-i");
    expect(applyCourseName(withName, "micro-economics-1", "micro-i")).toBe(withName);
  });
  test("on a first publish (no slug yet) the title's own slug is the default and writes nothing", () => {
    const fresh = "# Micro I\n---\n## Supply\nWhy?\n";
    expect(applyCourseName(fresh, "micro-i", undefined)).toBe(fresh);
    expect(applyCourseName(fresh, "intro-micro", undefined)).toContain("name: intro-micro");
  });
});

describe("courseDoorName — what the Publish field is prefilled with", () => {
  test("is the name: override when set, else the slug, else the title's slug", async () => {
    const { courseDoorName } = await import("../src/course/publish");
    expect(courseDoorName(parseCourse("# Micro I\nslug: micro-i\nname: intro-micro\n"))).toBe("intro-micro");
    expect(courseDoorName(parseCourse("# Micro I\nslug: micro-i\n"))).toBe("micro-i");
    expect(courseDoorName(parseCourse("# Micro I\n"))).toBe("micro-i");
  });
});

describe("the Pretty link panel — wiring (pretty-link round, 2026-09-18)", () => {
  const share = readFileSync(new URL("../src/ui/share.ts", import.meta.url), "utf8");
  const panel = readFileSync(new URL("../src/ui/course.ts", import.meta.url), "utf8");
  const main = readFileSync(new URL("../src/main.ts", import.meta.url), "utf8");
  test("Pretty link is a rail row for both subjects, with its own panel and Buy button", () => {
    expect(share).toMatch(/\{ id: "pretty", label: "Pretty link", action: "Buy", offered: \(\) => true, ready: \(\) => true, reason: "", courses: true \}/);
    expect(share).toMatch(/pretty: prettyPanel/);
    expect(share).toMatch(/pretty: prettyGo/);
    expect(share).toMatch(/void current\.buyPrettyLink\(\{ name, target \}\)/);
  });
  test("the registry Check lives on the Pretty panel alone; Link's and the server's Name fields name files, not addresses", () => {
    expect(share.match(/buildNameCheck\(/g)?.length).toBe(2); // the definition and the one call
    expect(share).toMatch(/const prettyCheck = buildNameCheck\(prettyNameInput, \(\) => current\.subject\)/);
    expect(share).toContain('publishNameRow.hidden = current.subject === "course"');
    expect(share).not.toContain("serverNameCheck");
    expect(share).not.toContain("NAME_HINT_COURSE");
  });
  test("the panel's terms and price line say the rule; the free direct link is named", () => {
    expect(share).toMatch(/prettyTerms[\s\S]*?one-time contribution[\s\S]*?no refund once the name is registered/);
    expect(share).toMatch(/20 USD up to 5 characters, 10 USD up to 7, 5 USD from 8/);
    expect(share).toMatch(/the direct link you already have stays free/);
  });
  test("no name is registered automatically at a publish any more — GitHub or server (the freebie lived there until 181305a)", () => {
    expect(main).not.toContain("castRegistration(");
    const gh = main.slice(main.indexOf("async function publishDrawcast("), main.indexOf("async function publishServerCast("));
    expect(gh).not.toContain("registerName(");
    expect(gh).toContain("until commit 181305a");
    const srv = main.slice(main.indexOf("async function publishServerCast("), main.indexOf("async function buyPrettyLink("));
    expect(srv).not.toContain("registerName(");
    expect(srv).toContain("doc.serverCast = out.cast;");
  });
  test("the editor buys a cast's name for the chosen copy, and re-points a name already owned for free", () => {
    const buy = main.slice(main.indexOf("async function buyPrettyLink("), main.indexOf("// ---------- video export ----------"));
    expect(buy).toMatch(/kind: "cast" as const, target: choice\.target/);
    expect(buy).toMatch(/startNamePayment\(DEFAULT_ENROLL_API, \{ \.\.\.reg, return: location\.href\.split\("#"\)\[0\] \}\)/);
    expect(buy).toMatch(/started === "yours"[\s\S]*registerName\(DEFAULT_ENROLL_API, reg\)/);
    expect(main).toMatch(/buyPrettyLink: \(choice\) => buyPrettyLink\(choice\)/);
  });
  test("the course panel binds the bought name to name: (never slug:), points at the course page, and has no Pay button of its own", () => {
    expect(panel).toMatch(/buyPrettyLink: async \(\{ name \}\) =>[\s\S]*applyCourseName\(doc\.value, name, slug\)[\s\S]*courseRegistration\([\s\S]*startNamePayment\(/);
    expect(panel).toMatch(/copies: \(\(\) =>[\s\S]*courseKeyFor\(repo, joinPath\(deps\.settings\.coursesDir, slug\)\)/);
    expect(panel).not.toContain("offerPayment");
    expect(panel).not.toMatch(/setCourseOption\([^)]*"slug"/);
    expect(panel).toMatch(/pay: "unregistered"/);
  });
  test("the editor reads Stripe's return marker at start-up, says what happened, and clears it", () => {
    expect(main).toMatch(/const paidReturn = paidInHash\(location\.hash\)/);
    expect(main).toMatch(/history\.replaceState\(null, "", location\.pathname \+ location\.search\)/);
  });
});

describe("prettyCopies — what a pretty link can point at", () => {
  const settings = { githubRepo: "hm/casts", coursesDir: "courses" };
  test("a drawcast's copies are derived from what the document records, GitHub first", () => {
    expect(prettyCopies({ publishedAs: "supply", serverCast: "anvil/supply/supply.yaml", drivePublishedId: "1AbC_defGH-ijkLMN" }, settings, "drawcast")).toEqual([
      { label: "GitHub copy (hm/casts)", target: "hm/casts/courses/casts/supply.yaml" },
      { label: "drawcast server copy", target: "anvil/supply/supply.yaml" },
      { label: "Google Drive copy", target: "gdrive/1AbC_defGH-ijkLMN" },
    ]);
  });
  test("nothing published means nothing to point at; a GitHub copy needs a repo in Settings", () => {
    expect(prettyCopies({}, settings, "drawcast")).toEqual([]);
    expect(prettyCopies({ publishedAs: "supply" }, { githubRepo: "", coursesDir: "" }, "drawcast")).toEqual([]);
  });
  test("a course names its own copies (its page)", () => {
    expect(prettyCopies({ copies: [{ label: "the course page", target: "hm/casts/courses/micro-i" }] }, settings, "course")).toEqual([{ label: "the course page", target: "hm/casts/courses/micro-i" }]);
    expect(prettyCopies({}, settings, "course")).toEqual([]);
  });
});
