# Teachers and ownership — drawcast client Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publishing a course with an author key claims it in the Anvil registry (so the publisher owns it in the teacher dashboard) before any name is registered, and a checkbox in the Share panel decides whether the published course page carries the join box.

**Architecture:** Two pure additions carry the rules — `removeCourseOption` in the course document module and `applyJoinBox` in the publish module (writes or removes the `enroll:` line, touching only the default app's URL) — plus `claimCourse`/`claimNote`/`courseClaim` in `src/names.ts` beside `registerName`. The Share panel's Link page grows one course-only checkbox seeded from the document; `src/ui/course.ts` applies it to the text before publishing and calls the claim after the commit lands, gating name registration on the claim's outcome. DOM code is pinned by source-text tests, as everywhere in this suite.

**Tech Stack:** TypeScript, Vite, vitest 3 with `environment: "node"` (no jsdom — DOM code is tested by source-text guards, e.g. `tests/views-publish.test.ts`). Node 26 (global `fetch`/`Response` available in tests).

**Spec:** `docs/superpowers/specs/2026-09-04-teachers-ownership-design.md` — §0 (what exists), §5 (this side), §6–§7 (files, tests). The server side is the sibling plan `/Users/hom/Documents/GitHub/drawcast-anvil/docs/superpowers/plans/2026-09-04-teachers-anvil.md` (Task 3 there defines `POST /_/api/course`).

## Global Constraints

- Repo `/Users/hom/Documents/GitHub/drawcast`, work on branch **`teachers`** cut from `main` at `7b30a52`. Netlify builds `main` with `npm test && npm run build`, so every commit must keep `npx vitest run` green (4260+ tests) and `npx tsc --noEmit` clean. Commit named files explicitly (never `git add -A`; another session may share the checkout).
- Requests to Anvil are **CORS-simple**: POST bodies are JSON with `content-type: text/plain`; the registry is always `DEFAULT_ENROLL_API = "https://drawcast.anvil.app"` from `src/learn.ts`; endpoints are `<api>/_/api/<path>` via `apiBase()`.
- The claim endpoint's contract (from the Anvil plan): `POST /_/api/course` body `{ key, course, title?, page?, lectures? }` → `200 {ok, owned}` | `401 {error:"key"}` | `403 {error:"owner"}` | `400 {error:<field>}`.
- Status notes are appended to the publish line exactly as the spec words them: `· you own this course` / `· this course is owned by another author — not claimed` / `· author key rejected`.
- Nothing about a claim or a name may turn a successful publish into a failed one: every network outcome is a note at the end of the status line, bounded by `AbortSignal.timeout(10_000)`.
- Course-level reserved keys stay exactly two: `enroll` and `name` (`parseCourse` in `src/course/document.ts`). The join-box checkbox only ever writes `DEFAULT_ENROLL_API`; a custom `enroll:` URL typed by the author is left alone when the box is on and removed when it is off.
- Commit messages end with:
  ```
  Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01XrM7jfgworX2hhNLuZt5FN
  ```

## File Structure

| file | responsibility |
|---|---|
| `src/course/document.ts` | `removeCourseOption(text, key)` beside `setCourseOption`; shared `headerEnd` |
| `src/course/publish.ts` | `applyJoinBox(text, on, api?)` — the checkbox's rule over the document text |
| `src/names.ts` | `CourseClaim`, `ClaimOutcome`, `claimCourse`, `claimNote`, `courseClaim`; an `"owner"` arm on `registerName`/`nameNote` |
| `src/ui/share.ts` | `ShareDoc.joinBox`, the "Allow sign-up on the course page" checkbox, `allowSignup` in the publish choices |
| `src/ui/course.ts` | `joinBox` in `doc()`, `applyJoinBox` before `publishCourse`, the claim before the name |
| `src/main.ts` | Settings → Publishing help text for the author key |
| `tests/course-document.test.ts` | `removeCourseOption` |
| `tests/course-claim.test.ts` (new) | `claimCourse`/`claimNote`/`courseClaim`, `applyJoinBox`, source guards for share/course/main |

---

### Task 1: `removeCourseOption`

**Files:**
- Modify: `src/course/document.ts:192-216` (`setCourseOption` and a new sibling), `tests/course-document.test.ts`

**Interfaces:**
- Produces: `removeCourseOption(text: string, key: string): string` — removes the course-level `key:` option from the header (everything before the first `##`), leaving every other line byte-identical; a `key: v · other: w` line loses only its `key` part; no-op when absent; never touches a lecture's own `key:` line.

- [ ] **Step 1: Write the failing tests**

In `tests/course-document.test.ts`, extend the import to `import { referencedLectureIds, formatCourse, parseCourse, removeCourseOption, setCourseOption, setLectureStatus } from "../src/course/document";` and append after the `setCourseOption` describe:

```ts
describe("removeCourseOption", () => {
  const WITH = setCourseOption(DOC, "enroll", "https://drawcast.anvil.app");

  it("removes the header key and nothing else", () => {
    const out = removeCourseOption(WITH, "enroll");
    expect(out).not.toContain("enroll:");
    expect(out).toBe(DOC);
    expect(parseCourse(out).enroll).toBeUndefined();
  });

  it("is a no-op when the key is absent", () => {
    expect(removeCourseOption(DOC, "enroll")).toBe(DOC);
  });

  it("drops only its own part of a shared option line", () => {
    const text = "# T\nenroll: https://x.y · name: learn\n\n## A\nq\n";
    const out = removeCourseOption(text, "enroll");
    expect(out).toBe("# T\nname: learn\n\n## A\nq\n");
    expect(parseCourse(out).name).toBe("learn");
    const other = removeCourseOption("# T\nname: learn · enroll: https://x.y\n\n## A\nq\n", "enroll");
    expect(other).toBe("# T\nname: learn\n\n## A\nq\n");
  });

  it("never touches a lecture's own option of the same name", () => {
    const text = "# T\nenroll: https://x.y\n\n## A\nq\nenroll: keep-me\n";
    const out = removeCourseOption(text, "enroll");
    expect(out).toBe("# T\n\n## A\nq\nenroll: keep-me\n");
    expect(parseCourse(out).lectures[0].options.enroll).toBe("keep-me");
  });

  it("set then remove round-trips the document", () => {
    expect(removeCourseOption(setCourseOption(DOC, "enroll", "https://drawcast.anvil.app"), "enroll")).toBe(DOC);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/course-document.test.ts`
Expected: FAIL — `removeCourseOption` is not exported.

- [ ] **Step 3: Implement**

In `src/course/document.ts`, add a shared header helper above `setCourseOption` and use it there, then add the remover:

```ts
/** The header ends where the first lecture (`##`) begins. */
function headerEnd(lines: string[]): number {
  const firstLecture = lines.findIndex((l) => {
    const h = HEADING_RE.exec(l.trim());
    return h !== null && h[1].length === 2;
  });
  return firstLecture === -1 ? lines.length : firstLecture;
}
```
In `setCourseOption`, replace the four lines computing `firstLecture`/`end` with `const end = headerEnd(lines);`.

Append after `setCourseOption`:
```ts
/**
 * Remove a course-level `key:` option from the header without reformatting
 * anything else — the inverse of setCourseOption. A line carrying several
 * options ("enroll: … · name: …") loses only this key's part; a lecture's
 * own option of the same name is never touched.
 */
export function removeCourseOption(text: string, key: string): string {
  const lines = text.split("\n");
  const end = headerEnd(lines);
  const keyRe = new RegExp(`^\\s*${key}\\s*:`);
  const out: string[] = [];
  lines.forEach((line, i) => {
    if (i >= end) {
      out.push(line);
      return;
    }
    const parts = line.split("·");
    if (!parts.some((p) => keyRe.test(p))) {
      out.push(line);
      return;
    }
    const kept = parts.map((p) => p.trim()).filter((p) => p !== "" && !keyRe.test(p));
    if (kept.length > 0) out.push(kept.join(" · "));
  });
  return out.join("\n");
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/course-document.test.ts && npx tsc --noEmit`
Expected: PASS, clean.

- [ ] **Step 5: Commit**

```bash
git add src/course/document.ts tests/course-document.test.ts
git commit -m "feat(course): removeCourseOption — the inverse of setCourseOption, header only"
```

---

### Task 2: `applyJoinBox`, and the claim in `src/names.ts`

**Files:**
- Modify: `src/course/publish.ts` (one exported helper after `courseRegistration`), `src/names.ts` (after `registerName`/`nameNote`)
- Create: `tests/course-claim.test.ts`

**Interfaces:**
- Consumes: `removeCourseOption` (Task 1), `DEFAULT_ENROLL_API` from `src/learn.ts`, `Registration` from `src/names.ts`, `apiBase` from `src/learn.ts`.
- Produces:
  ```ts
  // src/course/publish.ts
  export function applyJoinBox(text: string, on: boolean, api?: string): string;
  // src/names.ts
  export interface CourseClaim { key: string; course: string; title?: string; page?: string; lectures?: string[] }
  export type ClaimOutcome = "ok" | "owner" | "key" | "invalid" | "error";
  export function courseClaim(key: string, reg: Omit<Registration, "key">): CourseClaim;
  export async function claimCourse(api: string, claim: CourseClaim, fetchImpl?: typeof fetch): Promise<ClaimOutcome>;
  export function claimNote(outcome: ClaimOutcome): string;
  // widened in this task:
  export async function registerName(api: string, reg: Registration, fetchImpl?: typeof fetch): Promise<"ok" | "taken" | "owner" | "key" | "invalid" | "error">;
  export function nameNote(outcome: "ok" | "taken" | "owner" | "key" | "invalid" | "error", name: string): string;
  ```

- [ ] **Step 1: Write the failing tests**

Create `tests/course-claim.test.ts`:
```ts
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
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/course-claim.test.ts`
Expected: FAIL — `applyJoinBox`, `claimCourse`, `claimNote`, `courseClaim` are not exported.

- [ ] **Step 3: Implement**

`src/course/publish.ts` — change the two imports to
```ts
import { parseCourse, removeCourseOption, setCourseOption, setLectureStatus, type Course } from "./document";
import { apiBase, DEFAULT_ENROLL_API } from "../learn";
```
and add after `courseRegistration`:
```ts
/**
 * The Share panel's "Allow sign-up on the course page" box, applied to the
 * document text before a publish (teachers round, spec §5). On: write the
 * default app's URL unless the author already typed an `enroll:` of their
 * own — the box manages the default app only, never someone's own backend.
 * Off: remove the line, whatever it carried, so the page loses its join box.
 */
export function applyJoinBox(text: string, on: boolean, api: string = DEFAULT_ENROLL_API): string {
  const has = parseCourse(text).enroll !== undefined;
  if (on) return has ? text : setCourseOption(text, "enroll", api);
  return has ? removeCourseOption(text, "enroll") : text;
}
```

`src/names.ts` — append:
```ts
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

export type ClaimOutcome = "ok" | "owner" | "key" | "invalid" | "error";

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
    default:
      return " · course not claimed (registry unreachable)";
  }
}
```

Still in `src/names.ts`, widen the existing name-registration pair by one arm — the Anvil round now answers `403` when a course name is registered by someone who does not own the course, and without this the app calls a permanent, explainable condition "registry unreachable". In `registerName`, after the `409` line add `if (res.status === 403) return "owner";`. Widen `registerName`'s promise type and `nameNote`'s parameter type from `"ok" | "taken" | "key" | "invalid" | "error"` to include `"owner"`. In `nameNote`'s switch, after the `"taken"` case add:

```ts
    case "owner":
      return " · the name was not registered: this course is owned by another author";
```

`src/ui/course.ts` gates name registration on the claim (Task 3), so a course publish rarely reaches it — but `src/main.ts`'s cast publish shares this function, and any client deployed before this round hits it directly.

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/course-claim.test.ts tests/course-document.test.ts tests/names.test.ts tests/names-register.test.ts && npx tsc --noEmit`
Expected: PASS, clean.

- [ ] **Step 5: Commit**

```bash
git add src/course/publish.ts src/names.ts tests/course-claim.test.ts
git commit -m "feat(course): applyJoinBox; claimCourse/claimNote/courseClaim beside registerName"
```

---

### Task 3: The checkbox, the claim on publish, and the help text

**Files:**
- Modify: `src/ui/share.ts:53-93` (`ShareDoc`), `:120` (`ShareDeps.publish`), `:457-483` (checkbox rows and the Publish click), `:1076-1080` (`prepPanels`); `src/ui/course.ts:28` (imports), `:849-908` (`publish`), `:936-944` (the claim), `:1037-1058` (`doc()`); `src/main.ts:1778` (help text); `tests/course-claim.test.ts` (append source guards)

**Interfaces:**
- Consumes: `applyJoinBox`, `claimCourse`, `claimNote`, `courseClaim` (Task 2).
- Produces: `ShareDoc.joinBox?: boolean`; `ShareDeps.publish` choices gain `allowSignup?: boolean` (undefined for `subject: "drawcast"`); checkbox id `share-allow-signup`. `main.ts`'s `publishDrawcast` needs no change (its parameter type is a supertype of the choices object — extra optional keys are assignable).

- [ ] **Step 1: Append the failing source guards to `tests/course-claim.test.ts`**

Add `import { readFileSync } from "node:fs";` as the FIRST line of the file (tests are type-checked with `noUnusedLocals`, so the import arrives with its first use), then append:

```ts
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

  test("the claim runs after the commit landed and BEFORE the name, which is registered only for a course the key owns", () => {
    const after = course.slice(course.indexOf("await publishCourse("));
    expect(after).toMatch(/claimCourse\(DEFAULT_ENROLL_API, courseClaim\(authorKey, reg\)/);
    expect(after.indexOf("claimCourse(")).toBeGreaterThan(after.indexOf("render();"));
    expect(after.indexOf("claimCourse(")).toBeLessThan(after.indexOf("registerName("));
    expect(after).toMatch(/claimNote\(/);
    expect(after).toMatch(/if \(claimed === "ok"\)[^\n]*registerName\(/);
  });

  test("Settings → Publishing says what the key does now", () => {
    expect(main).toMatch(/makes you the owner of the course in the teacher dashboard/);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/course-claim.test.ts`
Expected: the four new tests FAIL.

- [ ] **Step 3: Implement `src/ui/share.ts`**

In `ShareDoc`, after `publishedViews?: boolean;` add:
```ts
  /**
   * Whether the course document carries an `enroll:` line, i.e. whether the
   * published course page shows the join box (learners round). Seeds the
   * "Allow sign-up" checkbox; course only — undefined for a drawcast.
   */
  joinBox?: boolean;
```
In `ShareDeps.publish`, extend the choices type to
```ts
  publish: (choices: { bake: boolean; embedImages: boolean; slug?: string; allowComments?: boolean; countViews?: boolean; allowSignup?: boolean }) => Promise<void>;
```
and add to its doc comment: "`allowSignup` is the course-only join-box choice (teachers round): true writes `enroll: <default app>` into the course document before publishing, false removes the line; undefined for `subject: "drawcast"`."

After `refreshCountViewsChoice` add:
```ts
  // "Allow sign-up on the course page" (teachers round, spec §5): a course
  // only. On, the publish writes `enroll: <default app>` into the course
  // document; off, it removes the line. An author running their own Anvil
  // app keeps whatever URL they typed — applyJoinBox only ever writes the
  // default. Seeded from the document itself, so a republish shows what the
  // page currently does, and a new course starts with it off.
  const signupCb = h("input", { type: "checkbox", id: "share-allow-signup" }) as HTMLInputElement;
  const signupLabel = h(
    "label",
    { class: "publish-choice", for: "share-allow-signup" },
    signupCb,
    h("span", {}, "Allow sign-up on the course page"),
    h("div", { class: "hint" }, "the course page gets a join box: learners get a course code, and you see their progress and answers in the teacher dashboard"),
  );
  function refreshSignupChoice(doc: ShareDoc, subject: "drawcast" | "course"): void {
    signupLabel.hidden = subject !== "course";
    signupCb.checked = doc.joinBox === true;
  }
```
Change the `linkPanel` line to `const linkPanel = h("div", { class: "share-panel" }, linkSubjectLine, publishNameRow, ...linkChoices.rows, commentsLabel, countViewsLabel, signupLabel);`.

In the `publishGo` click handler add to `choices`:
```ts
      allowSignup: deps.subject === "course" ? signupCb.checked : undefined,
```
In `prepPanels`, after `refreshCountViewsChoice(doc);` add `refreshSignupChoice(doc, current.subject);`.

- [ ] **Step 4: Implement `src/ui/course.ts`**

Imports: change line 9 to `import { applyJoinBox, courseRegistration, publishCourse } from "../course/publish";` and line 28 to `import { claimCourse, claimNote, courseClaim, nameNote, registerName } from "../names";`.

`doc()` (inside `shareBtn`'s `openShare`): after `publishedViews,` add
```ts
          // The join box's current state, straight from the document (spec §5).
          joinBox: course.enroll !== undefined,
```

`publish`: change the signature to
```ts
  async function publish({ bake, embedImages, allowComments, countViews, allowSignup }: { bake: boolean; embedImages: boolean; slug?: string; allowComments?: boolean; countViews?: boolean; allowSignup?: boolean }): Promise<void> {
```
Replace `const course = parseCourse(doc.value);` with
```ts
    // The join-box choice is applied to the TEXT first, so the copy that goes
    // out and the copy written back (out.text) agree on the enroll: line. The
    // editor's own document changes only when the commit lands, with the rest
    // of the bookkeeping below.
    const text = allowSignup === undefined ? doc.value : applyJoinBox(doc.value, allowSignup);
    const course = parseCourse(text);
```
and in the `publishCourse({` call replace `text: doc.value,` with `text,`.

Replace the claim/name block (from `let nameSuffix = "";` through the closing `}` of `if (authorKey && reg) {`) with:
```ts
      let nameSuffix = "";
      const authorKey = getAuthorKey();
      const reg = authorKey ? courseRegistration(parseCourse(out.text), repo, settings.coursesDir, out.courseUrl) : null;
      if (authorKey && reg) {
        const bounded: typeof fetch = (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(10_000) });
        // The claim FIRST (teachers round, spec §5): publishing with a key is
        // what makes the author the course's owner in the teacher dashboard,
        // and a name may only be registered by the owner — so the name step
        // never runs for a course this key does not own.
        const claimed = await claimCourse(DEFAULT_ENROLL_API, courseClaim(authorKey, reg), bounded);
        nameSuffix = claimNote(claimed);
        if (claimed === "ok") nameSuffix += nameNote(await registerName(DEFAULT_ENROLL_API, { key: authorKey, ...reg }, bounded), reg.name);
      }
```
Keep the comment block above it ("Only now, with the commit landed…") — it still describes why this runs after bookkeeping.

- [ ] **Step 5: Implement `src/main.ts`**

Replace the author-key help line
```ts
      h("div", { class: "settings-note" }, "Registers drawcast.app/#<name> links when you publish. Optional."),
```
with
```ts
      h(
        "div",
        { class: "settings-note" },
        "Publishing with an author key makes you the owner of the course in the teacher dashboard (drawcast.anvil.app — sign up there, the key is on the Author key panel) and registers drawcast.app/#<name> links. Optional.",
      ),
```

- [ ] **Step 6: Verify**

Run: `npx vitest run tests/course-claim.test.ts tests/names-register.test.ts tests/views-publish.test.ts tests/publish-embed.test.ts && npx tsc --noEmit && npx vitest run`
Expected: all pass (the existing `names-register` guards — `registerName(DEFAULT_ENROLL_API,` after `render();`, `AbortSignal.timeout(10_000)` — still hold), tsc clean.

- [ ] **Step 7: Commit**

```bash
git add src/ui/share.ts src/ui/course.ts src/main.ts tests/course-claim.test.ts
git commit -m "feat(course): claim the course on publish before the name; Allow sign-up checkbox; key help text"
```

---

### Task 4: Whole-branch review, merge, push

Not a subagent task — the controller does this after Tasks 1–3 are approved and the Anvil plan is merged.

- [ ] **Step 1:** `npx tsc --noEmit && npx vitest run && npm run build` green on `teachers`.
- [ ] **Step 2:** Dispatch the whole-branch review (`git diff main...teachers`) against spec §5; fix findings in one wave, each fix its own commit.
- [ ] **Step 3:** In the spec, change `Status: draft for Hans's review` to `Status: approved 2026-09-04; implemented (round A) — Anvil plan docs/superpowers/plans/2026-09-04-teachers-anvil.md in drawcast-anvil, client plan 2026-09-04-teachers-drawcast.md`. Commit `docs(spec): teachers and ownership — approved and implemented`.
- [ ] **Step 4:** `git fetch origin` (another session may have pushed to `main`); `git checkout main && git merge --no-ff teachers -m "Merge teachers: claim on publish, Allow sign-up checkbox"` then `git push origin main`; `git ls-remote origin main` shows the merge commit. Netlify builds `main`.
- [ ] **Step 5:** Report to Hans: pushed and live on https://drawcast.app; what remains by hand is spec §7 (two accounts: A publishes and owns, B sees nothing, A adds B by email, B publishing the same key gets "owned by another author", Hans as admin sees both) — after his Anvil pull ("source code").
