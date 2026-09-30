// Final-review fix wave, registry delivery 2 (private courses and drawcasts).
//
// I1b — the server's word on privacy wins over local state: a publish the app
//       can predict asks /register/quote first; server-private + local-public
//       publishes LOCKED unless the author explicitly confirmed making it
//       public in Share. A course loaded from GitHub with locked lectures is
//       private locally.
// M1  — Share re-quotes Private when the Name/Folder fields change (blur).
// M2  — Share's course quote/pay and the publish count the same lectures.
// M3  — the locked door never builds "#<Title With Spaces>".
// I4  — SKILL.md: private BEFORE the first push.
//
// share.ts / main.ts / ui/course.ts are DOM code the node suite can't run, so
// their wiring is pinned by reading the source (as tests/share-private.test.ts
// does); the decisions themselves are pure helpers with behaviour tests.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { castLockedInRepo, courseLockedInRepo, privateLectureCount, publishPrivacy, hasBuiltLecture } from "../src/private-doc";
import { LOCK_HEADER } from "../src/crypto/lecture-lock";
import { importCourse } from "../src/course/load";
import { parseCourse } from "../src/course/document";
import { privateRequest } from "../src/ui/share";

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const between = (src: string, start: string, end: string) => src.slice(src.indexOf(start), src.indexOf(end, src.indexOf(start)));

const quote = (priv: boolean) => ({ due: 0, currency: "usd", paidLectures: 1, private: priv, owner: "you" as const, name: null });

describe("publishPrivacy (I1b): what a GitHub publish actually does", () => {
  it("local private stays private whatever the server says", () => {
    expect(publishPrivacy(true, quote(false), false)).toEqual({ private: true, upgraded: false });
    expect(publishPrivacy(true, "error", false)).toEqual({ private: true, upgraded: false });
  });
  it("server private, local public, not confirmed → private (locked), and says it was upgraded", () => {
    expect(publishPrivacy(false, quote(true), false)).toEqual({ private: true, upgraded: true });
  });
  it("server private, local public, explicitly confirmed public → public", () => {
    expect(publishPrivacy(false, quote(true), true)).toEqual({ private: false, upgraded: false });
  });
  it("server public, or no answer (signed out, error, key) → the local state", () => {
    expect(publishPrivacy(false, quote(false), false)).toEqual({ private: false, upgraded: false });
    expect(publishPrivacy(false, "error", false)).toEqual({ private: false, upgraded: false });
    expect(publishPrivacy(false, "key", false)).toEqual({ private: false, upgraded: false });
    expect(publishPrivacy(false, null, false)).toEqual({ private: false, upgraded: false });
  });
});

describe("I1b: publishDrawcast asks the server before a plain publish", () => {
  const src = read("src/main.ts");
  const body = between(src, "async function publishDrawcast(", "\n}\n");
  it("takes Share's confirmPublic and runs publishPrivacy on a quote before the private lock / commit", () => {
    expect(body).toContain("confirmPublic");
    const quoteAt = body.indexOf("quotePrivate(");
    const verdictAt = body.indexOf("publishPrivacy(");
    const lockAt = body.indexOf("await privateCastLock(");
    expect(quoteAt).toBeGreaterThan(0);
    expect(verdictAt).toBeGreaterThan(quoteAt);
    expect(lockAt).toBeGreaterThan(verdictAt);
    expect(body.indexOf("publishCast(")).toBeGreaterThan(verdictAt);
  });
});

describe("I1b: the course publish asks the server before a plain publish", () => {
  const src = read("src/ui/course.ts");
  const body = between(src, "async function publish(", "\n  }\n");
  it("runs publishPrivacy before the course text is decided private or not", () => {
    expect(body).toContain("confirmPublic");
    const verdictAt = body.indexOf("publishPrivacy(");
    expect(verdictAt).toBeGreaterThan(0);
    expect(verdictAt).toBeLessThan(body.indexOf("const text = isPrivate"));
    expect(body.indexOf("quotePrivate(")).toBeLessThan(verdictAt);
  });
});

describe("I1b: Share learns the server's privacy and guards unticking it", () => {
  const share = read("src/ui/share.ts");
  it("prepPanels probes the server even when the box opens unticked", () => {
    const prep = between(share, "function prepPanels(): void {", "function refresh(deps: ShareDeps): void {");
    expect(prep).toContain("probeServerPrivate();");
    expect(prep).toContain("confirmedPublic = false;");
  });
  it("a server-private answer ticks the box (unless the author confirmed public)", () => {
    const probe = between(share, "function probeServerPrivate(): void {", "privateCb.addEventListener(");
    expect(probe).toContain("quotePrivate(");
    expect(probe).toMatch(/serverPrivate && !privateCb\.checked && !confirmedPublic/);
    expect(probe).toContain("privateCb.checked = true;");
  });
  it("unticking a server-private item asks, and re-ticks on a no", () => {
    const change = between(share, 'privateCb.addEventListener("change"', "privatePayBtn.addEventListener(");
    expect(change).toContain('confirm("Make public: the next publish will be readable by anyone")');
    expect(change).toContain("privateCb.checked = true;");
    expect(change).toContain("confirmedPublic = true;");
  });
  it("Publish carries the confirmation into the choices", () => {
    const click = between(share, 'publishGo.addEventListener("click"', "});");
    expect(click).toContain("confirmPublic: !privateCb.checked && confirmedPublic,");
  });
});

describe("I1b: a course loaded from GitHub with locked lectures is private locally", () => {
  const text = "# QALYs\n---\n## What a QALY is\nWhy?\n";
  it("importCourse writes private: true into the stored course.md when any lecture was locked", () => {
    const out = importCourse({ text, yamlByFile: {}, courseId: "c1", updated: "2026-09-30T00:00:00.000Z", locked: true });
    expect(parseCourse(out.course.text).private).toBe(true);
  });
  it("…and leaves the text verbatim otherwise", () => {
    const out = importCourse({ text, yamlByFile: {}, courseId: "c1", updated: "2026-09-30T00:00:00.000Z" });
    expect(out.course.text).toBe(text);
  });
  it("loadCoursesFromGithub tells importCourse whether a lecture came back locked", () => {
    const body = between(read("src/main.ts"), "async function loadCoursesFromGithub(", "\n}\n");
    expect(body).toContain("isLocked(yaml)");
    expect(body).toMatch(/importCourse\(\{[^}]*locked/);
  });
});

describe("M1: Share re-quotes Private when the Name/Folder field changes", () => {
  const share = read("src/ui/share.ts");
  it("the Name and Folder blur listeners refresh the quote and the server probe", () => {
    const name = between(share, 'publishNameInput.addEventListener("blur"', "});");
    const folder = between(share, 'publishFolderInput.addEventListener("blur"', "});");
    for (const l of [name, folder]) {
      expect(l).toContain("refreshPrivateLine();");
      expect(l).toContain("probeServerPrivate();");
    }
  });
  it("still exactly one input listener and two buildNameCheck( calls; no keyup/keydown", () => {
    expect(share.match(/addEventListener\("input"/g)).toHaveLength(1);
    expect(share.match(/buildNameCheck\(/g)).toHaveLength(2);
    expect(share).not.toContain('addEventListener("keyup"');
    expect(share).not.toContain('addEventListener("keydown"');
  });
});

describe("M2: one lecture count for Share's quote/pay and the publish", () => {
  const library = [{ id: "a" }, { id: "b" }];
  const course = parseCourse(
    "# C\n---\n## One\nstatus: done · id: a\nQ?\n\n## Two\nstatus: done · id: b\nQ?\n\n## Three\nQ?\n",
  );
  it("counts only lectures with a saved, generated file — never an unbuilt one", () => {
    expect(course.lectures.length).toBe(3);
    expect(course.lectures.map((l) => hasBuiltLecture(l, library))).toEqual([true, true, false]);
    expect(privateLectureCount(course, library)).toBe(2);
    expect(privateLectureCount(course, [])).toBe(1); // clamped: the registry wants 1–200
  });
  it("privateRequest prices privateLectures when given, not the whole outline", () => {
    const req = privateRequest({ title: "C", folder: "courses/c", lectureCount: 3, privateLectures: 2 }, { githubRepo: "a/b", coursesDir: "courses" }, "course", "");
    expect(req!.lectures).toBe(2);
  });
  it("ui/course.ts feeds both Share (privateLectures) and the publish's quote from privateLectureCount", () => {
    const src = read("src/ui/course.ts");
    expect(src).toContain("privateLectures: privateLectureCount(course, loadLibrary()),");
    const body = between(src, "async function publish(", "\n  }\n");
    expect(body).toContain("hasBuiltLecture(");
    expect(body).toMatch(/const lectures = privateLectureCount\(course, library\);/);
  });
});

describe("M3: the locked door names the item by its free name, never a spaced title", () => {
  it("item-key.ts reads the 403's name", () => {
    expect(read("src/item-key.ts")).toMatch(/body\.name/);
  });
  it("lockedDoor hands courseDoor the free name (or the item) and shows the title as the heading", () => {
    const viewer = read("src/viewer.ts");
    const fn = between(viewer, "export function lockedDoor(", "\n}\n");
    expect(fn).not.toContain("courseDoor(door.title || door.item");
    expect(fn).toContain("courseDoor(door.name || door.item");
  });
});

describe("I4: SKILL.md makes it private BEFORE the first push", () => {
  const skill = read(".claude/skills/drawcast/SKILL.md");
  const section = between(skill, "## Private (locked on GitHub", "\nPulling a private");
  it("no longer says 'Only for something already pushed' for Private", () => {
    expect(section).not.toContain("Only for something already pushed");
    expect(section).toMatch(/after `publish-target`/);
    expect(section).toMatch(/before the first `push`/i);
  });
  it("warns that an already-public item's earlier versions stay readable, and how to avoid it", () => {
    expect(section).toMatch(/history/);
    expect(section).toMatch(/new folder/);
  });
});

// Round 2 (approved by Hans): I1b must fail CLOSED when the quote cannot run
// (signed out, "key", Anvil down) — the repo itself says whether the item is
// locked, read before the private/public decision in both flows.
describe("I1b round 2: the repo's own locked files decide, whatever the quote says", () => {
  const locked = `${LOCK_HEADER}\nitem: a/b/c\n`;
  const reader = (files: Record<string, string>) => async (path: string) => files[path] ?? null;

  it("publishPrivacy: repo locked + no quote (signed out / key / error) → private; confirmed public → public", () => {
    expect(publishPrivacy(false, null, false, true)).toEqual({ private: true, upgraded: true });
    expect(publishPrivacy(false, "key", false, true)).toEqual({ private: true, upgraded: true });
    expect(publishPrivacy(false, "error", false, true)).toEqual({ private: true, upgraded: true });
    expect(publishPrivacy(false, null, true, true)).toEqual({ private: false, upgraded: false });
    expect(publishPrivacy(false, null, false, false)).toEqual({ private: false, upgraded: false });
  });

  it("castLockedInRepo: a locked file at the predicted path is locked; plain, missing or unreadable is not", async () => {
    expect(await castLockedInRepo(reader({ "courses/casts/x.yaml": locked }), "courses/casts/x.yaml")).toBe(true);
    expect(await castLockedInRepo(reader({ "courses/casts/x.yaml": "title: x\n" }), "courses/casts/x.yaml")).toBe(false);
    expect(await castLockedInRepo(reader({}), "courses/casts/x.yaml")).toBe(false);
    expect(await castLockedInRepo(async () => { throw new Error("offline"); }, "courses/casts/x.yaml")).toBe(false);
  });

  it("courseLockedInRepo: the published course.md says private, or its first published lecture is locked", async () => {
    const dir = "courses/q";
    const md = (priv: boolean) => `# Q\n${priv ? "private: true\n" : ""}---\n## One\nstatus: done · id: a · file: one.yaml\nQ?\n`;
    expect(await courseLockedInRepo(reader({ "courses/q/course.md": md(true) }), dir)).toBe(true);
    expect(await courseLockedInRepo(reader({ "courses/q/course.md": md(false), "courses/q/one.yaml": locked }), dir)).toBe(true);
    expect(await courseLockedInRepo(reader({ "courses/q/course.md": md(false), "courses/q/one.yaml": "title: one\n" }), dir)).toBe(false);
    expect(await courseLockedInRepo(reader({}), dir)).toBe(false);
    expect(await courseLockedInRepo(async () => { throw new Error("offline"); }, dir)).toBe(false);
  });

  it("publishDrawcast reads the PREDICTED cast path from the repo — signed in or not — before the decision and the lock/commit", () => {
    const body = between(read("src/main.ts"), "async function publishDrawcast(", "\n}\n");
    const readAt = body.indexOf("castLockedInRepo(");
    const verdictAt = body.indexOf("publishPrivacy(");
    expect(readAt).toBeGreaterThan(0);
    expect(verdictAt).toBeGreaterThan(readAt);
    expect(body.indexOf("await privateCastLock(")).toBeGreaterThan(verdictAt);
    expect(body.indexOf("publishCast(")).toBeGreaterThan(verdictAt);
    // The read is not gated on the account token: signed out still reads it.
    expect(body.slice(Math.max(0, readAt - 400), readAt)).not.toMatch(/if \(!isPrivate && accountToken\)/);
    expect(body).toMatch(/privateCastTarget\(repo, castsDir, slug, doc\.publishedAs, doc\.title\)/);
    // Signed out, privateCastLock refuses — never a plaintext commit.
    expect(between(read("src/main.ts"), "async function privateCastLock(", "\n}\n")).toContain('if (!accountToken) return "Not published: sign in to publish privately');
  });

  it("the course publish reads its published course.md (when it has a slug) before the decision", () => {
    const body = between(read("src/ui/course.ts"), "async function publish(", "\n  }\n");
    const readAt = body.indexOf("courseLockedInRepo(");
    expect(readAt).toBeGreaterThan(0);
    expect(body.indexOf("publishPrivacy(")).toBeGreaterThan(readAt);
    expect(body.indexOf("publishPrivacy(")).toBeLessThan(body.indexOf("const text = isPrivate"));
    expect(body).toContain('say("Not published: sign in to publish privately (Settings → Publishing).", "error");');
  });
});

describe("M round 2: a Make-public confirmation never carries over to another item", () => {
  const share = read("src/ui/share.ts");
  it("probeServerPrivate resets confirmedPublic whenever the probed target changes", () => {
    const probe = between(share, "function probeServerPrivate(): void {", "privateCb.addEventListener(");
    expect(probe).toMatch(/if \(target !== probedTarget\) \{\s*confirmedPublic = false;\s*probedTarget = target;/);
    expect(probe.indexOf("probedTarget = target;")).toBeLessThan(probe.indexOf("const token = getToken();"));
  });
  it("still exactly one input listener and two buildNameCheck( calls; no keyup/keydown", () => {
    expect(share.match(/addEventListener\("input"/g)).toHaveLength(1);
    expect(share.match(/buildNameCheck\(/g)).toHaveLength(2);
    expect(share).not.toContain('addEventListener("keyup"');
  });
});
