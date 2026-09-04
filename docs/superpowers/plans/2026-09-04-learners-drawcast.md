# Learners — drawcast client Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** drawcast remembers a learner's course code, reports opened/completed/answer events to the Anvil app, gives the course page a join box with progress and answer review, and resolves `drawcast.app/#learn-russian` names.

**Architecture:** One new pure client module (`src/learn.ts`, the twin of `src/views.ts`) holds storage, parsing and transport; the Player gains an `onAnswer` callback and the playlist session an `onDone`, which `viewer.ts` wires to `sendEvent`. The course document grows two reserved keys (`enroll`, `name`), `publishCourse` copies `meta.enroll` into each lecture and bakes the course key into the page, and the page carries an inline script (`src/course/enrol-script.ts`) that is evaluated in tests against a tiny fake DOM. Names are a third branch in `entry.ts` plus a resolve step in the viewer; registration happens after a successful publish using an author key kept like the GitHub token.

**Tech Stack:** TypeScript, Vite, vitest 3 with `environment: "node"` (NO jsdom — DOM code is tested by source-text guards as in `tests/views-viewer.test.ts`, or by evaluating scripts against a fake), js-yaml. Node 26.

**Spec:** `docs/superpowers/specs/2026-09-04-learners-design.md` — §1, §2, §4, §5, §7. Server side (already planned): `/Users/hom/Documents/GitHub/drawcast-anvil/docs/superpowers/plans/2026-09-04-learners-anvil.md`.

## Global Constraints

- Repo `/Users/hom/Documents/GitHub/drawcast`, branch `main`. Netlify builds `main` with `npm test && npm run build`, so every commit must keep `npx vitest run` green and `npx tsc --noEmit` clean.
- Nothing in `src/learn.ts` may throw into playback: every failure path returns `null`/`false` (the `views.ts` rule).
- Requests to Anvil are **CORS-simple**: POST bodies are JSON sent with `content-type: text/plain`; GETs carry no custom headers.
- Endpoints derive from one base: `<api>/_/api/enroll`, `/event`, `/progress`, `/forget`, `/name`. The registry for names is always `DEFAULT_ENROLL_API = "https://drawcast.anvil.app"`.
- Course key = cast key minus its file name. Cast key = `owner/repo/path` (`castKeyFor` in `src/views.ts`).
- Storage: `localStorage["drawcast.learners"]` = JSON map courseKey → `{ code, api, name }`.
- Code rule: `^[a-z]{3,7}-[a-z]{3,7}-[a-z]{3,7}$`, lower-cased on input. Name rule and reserved prefixes verbatim from spec §7 (mirrored in `server_code/names.py`).
- Two approved deviations from the spec text, both simplifications: (1) the 🎓 control is a `trailing` button in the control bar (`ControlsOptions.trailing`, the existing extension point) rather than an entry in the fold menu; (2) a name defaults to the publish **slug** (`course.context.slug`, `out.slug` for casts) and `name:` in the course document is an override. Spec §5/§7 are updated in Task 11.
- Commit messages end with:
  ```
  Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01XrM7jfgworX2hhNLuZt5FN
  ```

## File Structure

| file | responsibility |
|---|---|
| `src/learn.ts` (new) | code rule, course key, storage map, `&learner=` parse/strip, `sendEvent`, `readProgress`, `reportingAllowed` |
| `src/render/player.ts` | `AnswerEvent`, `PlayerCallbacks.onAnswer`, fired at both answer sites |
| `src/playlist/session.ts` | `SessionOptions.onAnswer`/`onDone`, chained in the per-item callbacks |
| `src/playlist/playlist.ts` | `PlaylistMeta.enroll` read/write |
| `src/course/document.ts` | `course.enroll`, `course.name` reserved keys |
| `src/course/publish.ts` | `meta.enroll` per lecture; `courseKeyFor`, `lectureCastKeys`; page gets learn data |
| `src/course/page.ts` + `src/course/enrol-script.ts` (new) | join box, progress ticks, answer review, forget, link rewriting |
| `src/viewer.ts` | `learner` param, storage, event wiring, 🎓 button, `runNamed` |
| `src/names.ts` (new) | name rule, reserved prefixes, `isNameHash`, `resolveName`, `registerName`, `ghHashFor` |
| `src/entry.ts` | third branch for names |
| `src/store.ts`, `src/main.ts`, `src/ui/course.ts` | author key setting; registration after publish |
| tests | `learn.test.ts`, `answer-events.test.ts`, `learn-session.test.ts`, `learn-meta.test.ts`, `course-enroll.test.ts`, `course-enroll-publish.test.ts`, `course-join-page.test.ts`, `learn-viewer.test.ts`, `names.test.ts`, `names-entry.test.ts`, `names-register.test.ts` |

---

### Task 1: `src/learn.ts` — the client module

**Files:**
- Create: `src/learn.ts`, `tests/learn.test.ts`

**Interfaces:**
- Produces (all exported):
  ```ts
  export const LEARNERS_KEY = "drawcast.learners";
  export const DEFAULT_ENROLL_API = "https://drawcast.anvil.app";
  export const CODE_RE: RegExp;
  export interface LearnerEntry { code: string; api: string; name?: string | null }
  export type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;
  export function normalizeCode(raw: string | null | undefined): string | null;
  export function courseKeyOf(castKey: string): string;
  export function apiBase(url: string): string;
  export function readLearners(storage: StorageLike | null): Record<string, LearnerEntry>;
  export function learnerFor(storage: StorageLike | null, courseKey: string): LearnerEntry | null;
  export function saveLearner(storage: StorageLike | null, courseKey: string, entry: LearnerEntry): void;
  export function forgetLearner(storage: StorageLike | null, courseKey: string): void;
  export function learnerParam(url: string): string | null;
  export function stripLearnerParam(url: string): string;
  export function reportingAllowed(entry: LearnerEntry | null, enroll: string | undefined): entry is LearnerEntry;
  export function firstOpenInSession(castKey: string, storage: Pick<Storage, "getItem" | "setItem"> | null): boolean;
  export interface AnswerPayload { step: number; question: string; given: string[]; expected: string; correct: boolean }
  export type LearnEvent = { kind: "opened" | "completed"; cast: string } | ({ kind: "answer"; cast: string } & AnswerPayload);
  export async function sendEvent(entry: LearnerEntry, ev: LearnEvent, fetchImpl?: typeof fetch): Promise<boolean>;
  export interface ProgressLecture { cast: string; opened: boolean; completed: boolean; answers: { step: number; question: string | null; given: string[]; expected: string | null; correct: boolean }[] }
  export interface Progress { name: string | null; course: { key: string; title: string; page: string }; lectures: ProgressLecture[] }
  export async function readProgress(api: string, code: string, fetchImpl?: typeof fetch): Promise<Progress | null>;
  ```

- [ ] **Step 1: Write the failing tests**

`tests/learn.test.ts`:
```ts
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
  test("an answer carries step, question, attempts, expected and correct", async () => {
    const f = fetchReturning(200, { ok: true });
    await sendEvent(ENTRY, { kind: "answer", cast: CAST, step: 4, question: "Which case?", given: ["dative", "genitive"], expected: "genitive", correct: true }, f);
    expect(JSON.parse(callOf(f)[1].body as string)).toEqual({
      code: "fjell-rev-havn", kind: "answer", cast: CAST, step: 4, question: "Which case?", given: ["dative", "genitive"], expected: "genitive", correct: true,
    });
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
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/learn.test.ts`
Expected: FAIL — cannot resolve `../src/learn`.

- [ ] **Step 3: Write `src/learn.ts`**

```ts
// Learners, client side (spec §1, §4): the course code a browser remembers
// per course, and the three events the player reports. Same rule as
// views.ts — nothing here may ever throw into playback; every failure path
// returns null/false and the drawing goes on.

export const LEARNERS_KEY = "drawcast.learners";
export const DEFAULT_ENROLL_API = "https://drawcast.anvil.app";
/** Mirrors codes.CODE_RE in drawcast-anvil/server_code/codes.py. */
export const CODE_RE = /^[a-z]{3,7}-[a-z]{3,7}-[a-z]{3,7}$/;
/** Mirrors the cast-key rule in netlify/lib/view-key.mts (and src/views.ts). */
const CAST_KEY_RE = /^[\w.-]+\/[\w.-]+\/(?!.*\.\.)[\w./-]+\.(ya?ml|json|txt)$/;
const OPENED_PREFIX = "drawcast.learned:";
const LEARNER_PARAM_RE = /([?&#])learner=([^&#]*)&?/;

export interface LearnerEntry {
  code: string;
  /** The Anvil app that issued the code — events go there and nowhere else. */
  api: string;
  name?: string | null;
}

export type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export function normalizeCode(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") return null;
  const s = raw.trim().toLowerCase().split(/\s+/).join("-");
  return CODE_RE.test(s) ? s : null;
}

/** owner/repo/<dir>/<slug> — the cast key without its file name. */
export function courseKeyOf(castKey: string): string {
  return castKey.replace(/\/[^/]*$/, "");
}

export function apiBase(url: string): string {
  return url.replace(/\/+$/, "");
}

export function readLearners(storage: StorageLike | null): Record<string, LearnerEntry> {
  if (!storage) return {};
  try {
    const parsed: unknown = JSON.parse(storage.getItem(LEARNERS_KEY) ?? "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, LearnerEntry>) : {};
  } catch {
    return {};
  }
}

function writeLearners(storage: StorageLike | null, map: Record<string, LearnerEntry>): void {
  if (!storage) return;
  try {
    storage.setItem(LEARNERS_KEY, JSON.stringify(map));
  } catch {
    /* no storage — the code lives for this page only */
  }
}

export function learnerFor(storage: StorageLike | null, courseKey: string): LearnerEntry | null {
  const entry = readLearners(storage)[courseKey];
  return entry && typeof entry.code === "string" && typeof entry.api === "string" ? entry : null;
}

export function saveLearner(storage: StorageLike | null, courseKey: string, entry: LearnerEntry): void {
  const map = readLearners(storage);
  map[courseKey] = { code: entry.code, api: apiBase(entry.api), name: entry.name ?? null };
  writeLearners(storage, map);
}

export function forgetLearner(storage: StorageLike | null, courseKey: string): void {
  const map = readLearners(storage);
  delete map[courseKey];
  writeLearners(storage, map);
}

/** The code riding a URL, in the hash (viewer) or the query (course page). */
export function learnerParam(url: string): string | null {
  const m = LEARNER_PARAM_RE.exec(url);
  return m ? normalizeCode(decodeURIComponent(m[2])) : null;
}

/** The same URL without the learner parameter — a copied link never carries a code. */
export function stripLearnerParam(url: string): string {
  return url
    .replace(/([?&#])learner=[^&#]*&/, "$1") // another parameter follows: keep the delimiter for it
    .replace(/[?&]learner=[^&#]*(?=#|$)/, ""); // last in its segment: drop it with its delimiter
}

/** Events go to the app that issued the code, whatever a YAML says. */
export function reportingAllowed(entry: LearnerEntry | null, enroll: string | undefined): entry is LearnerEntry {
  if (!entry) return false;
  return enroll === undefined || apiBase(enroll) === apiBase(entry.api);
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
  step: number;
  question: string;
  /** Every attempt, verbatim; [] for a skipped quiz. */
  given: string[];
  expected: string;
  correct: boolean;
}

export type LearnEvent = { kind: "opened" | "completed"; cast: string } | ({ kind: "answer"; cast: string } & AnswerPayload);

export async function sendEvent(entry: LearnerEntry, ev: LearnEvent, fetchImpl: typeof fetch = fetch): Promise<boolean> {
  if (!CAST_KEY_RE.test(ev.cast)) return false;
  try {
    const res = await fetchImpl(`${apiBase(entry.api)}/_/api/event`, {
      method: "POST",
      // text/plain keeps this a simple request: no preflight, and keepalive
      // lets a `completed` fired on the last frame outlive the tab.
      headers: { "content-type": "text/plain" },
      body: JSON.stringify({ code: entry.code, ...ev }),
      keepalive: true,
    });
    return res.ok;
  } catch {
    return false;
  }
}

export interface ProgressLecture {
  cast: string;
  opened: boolean;
  completed: boolean;
  answers: { step: number; question: string | null; given: string[]; expected: string | null; correct: boolean }[];
}

export interface Progress {
  name: string | null;
  course: { key: string; title: string; page: string };
  lectures: ProgressLecture[];
}

export async function readProgress(api: string, code: string, fetchImpl: typeof fetch = fetch): Promise<Progress | null> {
  try {
    const res = await fetchImpl(`${apiBase(api)}/_/api/progress?code=${encodeURIComponent(code)}`);
    if (!res.ok) return null;
    return (await res.json()) as Progress;
  } catch {
    return null;
  }
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run tests/learn.test.ts`
Expected: all pass. If `stripLearnerParam` fails one of the four shapes, fix the replacer (it must yield exactly the four expected strings) — do not weaken the test.

- [ ] **Step 5: Commit**

```bash
git add src/learn.ts tests/learn.test.ts
git commit -m "feat(learn): the learner client — codes, storage map, events, progress"
```

---

### Task 2: `Player.onAnswer`

**Files:**
- Modify: `src/render/player.ts:35-38` (PlayerCallbacks), `:641-675` (quiz), `:676-743` (ask)
- Create: `tests/answer-events.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface AnswerEvent { index: number; kind: "quiz" | "ask"; question: string; given: string[]; expected: string; correct: boolean }
  export interface PlayerCallbacks { onState?(state: PlayerState): void; onStep?(completed: number, total: number): void; onAnswer?(answer: AnswerEvent): void }
  ```
  Fired only on the live path: quiz when `!this.autoAnswers && this.quizGate !== null`; ask when `!this.autoAnswers && this.askGate !== null` and the step has an `answer` (collect-mode asks return before judging and never fire).

- [ ] **Step 1: Write the failing tests**

`tests/answer-events.test.ts`:
```ts
import { describe, expect, test } from "vitest";
import { Player, type AnswerEvent } from "../src/render/player";
import { planCommands } from "../src/render/plan";
import { SpeechManager } from "../src/render/speech";
import type { Command } from "../src/spec/types";

globalThis.requestAnimationFrame ??= ((cb: FrameRequestCallback) =>
  setTimeout(() => cb(performance.now()), 5) as unknown as number) as typeof requestAnimationFrame;

class SilentSpeech extends SpeechManager {
  override get available(): boolean { return false; }
  override speak(): Promise<void> { return Promise.resolve(); }
  override cancel(): void {}
}

function makePlayer(commands: Command[]) {
  const player = new Player(planCommands(commands, []), new Map(), new SilentSpeech(), null, { mode: "narrated" });
  const events: AnswerEvent[] = [];
  player.callbacks = { onAnswer: (a) => events.push(a) };
  return { player, events };
}

const QUIZ: Command = { quiz: { question: "Which?", choices: ["dative", "genitive"], correct: 2 } };

describe("quiz answers", () => {
  test("a live wrong answer reports the chosen text, the expected text and false", async () => {
    const { player, events } = makePlayer([QUIZ]);
    player.quizGate = async () => 0;
    await player.play();
    expect(events).toEqual([{ index: 0, kind: "quiz", question: "Which?", given: ["dative"], expected: "genitive", correct: false }]);
  });
  test("a live right answer reports true", async () => {
    const { player, events } = makePlayer([QUIZ]);
    player.quizGate = async () => 1;
    await player.play();
    expect(events[0]).toMatchObject({ given: ["genitive"], correct: true });
  });
  test("skip reports no attempt and false", async () => {
    const { player, events } = makePlayer([QUIZ]);
    player.quizGate = async () => null;
    await player.play();
    expect(events[0]).toMatchObject({ given: [], correct: false });
  });
  test("a gate-less player (movie, embed) reports nothing", async () => {
    const { player, events } = makePlayer([QUIZ]);
    await player.play();
    expect(events).toEqual([]);
  });
  test("autoAnswers reports nothing even with a gate", async () => {
    const { player, events } = makePlayer([QUIZ]);
    player.autoAnswers = true;
    player.quizGate = async () => 0;
    await player.play();
    expect(events).toEqual([]);
  });
});

describe("ask answers", () => {
  test("every attempt is kept, verbatim, and the outcome is the last one", async () => {
    const { player, events } = makePlayer([{ ask: { question: "Case?", answer: "genitive", retry: true, wrong: "No." } }]);
    const tries = ["dativ", "Genitive"];
    player.askGate = async () => tries.shift() ?? null;
    await player.play();
    expect(events).toEqual([{ index: 0, kind: "ask", question: "Case?", given: ["dativ", "Genitive"], expected: "genitive", correct: true }]);
  });
  test("a wrong answer without retry reports one attempt and false", async () => {
    const { player, events } = makePlayer([{ ask: { question: "Case?", answer: "genitive" } }]);
    player.askGate = async () => "dative";
    await player.play();
    expect(events[0]).toMatchObject({ given: ["dative"], correct: false });
  });
  test("collect mode (no answer) is personal input and never reports", async () => {
    const { player, events } = makePlayer([{ ask: { question: "Your name?", store: "name", default: "friend" } }]);
    player.askGate = async () => "Kari";
    await player.play();
    expect(events).toEqual([]);
  });
  test("the auto path reports nothing", async () => {
    const { player, events } = makePlayer([{ ask: { question: "Case?", answer: "genitive" } }]);
    await player.play();
    expect(events).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/answer-events.test.ts`
Expected: FAIL — `events` stay empty / `AnswerEvent` not exported.

- [ ] **Step 3: Add the callback and fire it**

In `src/render/player.ts`, replace lines 35–38 with:
```ts
/** One graded answer from a LIVE viewer (never a movie's auto path): what
 *  was chosen or typed, every attempt in order, and what would have been
 *  right. The viewer forwards these to the learner endpoint (src/learn.ts). */
export interface AnswerEvent {
  /** The step index — the question's slot in this drawcast's plan. */
  index: number;
  kind: "quiz" | "ask";
  question: string;
  given: string[];
  expected: string;
  correct: boolean;
}

export interface PlayerCallbacks {
  onState?(state: PlayerState): void;
  onStep?(completed: number, total: number): void;
  onAnswer?(answer: AnswerEvent): void;
}
```

In the quiz case, after line 660 (`this.updateScoreVars();`) insert:
```ts
        if (!this.autoAnswers && this.quizGate !== null) {
          this.callbacks.onAnswer?.({
            index,
            kind: "quiz",
            question: step.question,
            given: chosen === null ? [] : [step.choices[chosen]],
            expected: step.choices[step.correct],
            correct: chosen === step.correct,
          });
        }
```

In the ask case: after line 682 (`let typed: string | null;`) add `const attempts: string[] = [];`. After line 709 (`typed = await this.askGate(signal, step);`) add `if (typed !== null) attempts.push(typed);`. Inside the retry loop, after line 727 (`typed = await this.askGate(signal, step);`) add `if (typed !== null) attempts.push(typed);`. After line 732 (`this.updateScoreVars();`) insert:
```ts
        if (!this.autoAnswers && this.askGate !== null) {
          this.callbacks.onAnswer?.({ index, kind: "ask", question: step.question, given: attempts, expected: answer, correct: isRight(typed) });
        }
```

- [ ] **Step 4: Run to verify pass, then the whole suite and tsc**

Run: `npx vitest run tests/answer-events.test.ts && npx tsc --noEmit && npx vitest run`
Expected: all pass. If the widget/auto branch at 683 pushes an attempt, it must not — only the two `askGate` calls push.

- [ ] **Step 5: Commit**

```bash
git add src/render/player.ts tests/answer-events.test.ts
git commit -m "feat(player): onAnswer callback with every live attempt and the expected answer"
```

---

### Task 3: session `onAnswer` / `onDone`

**Files:**
- Modify: `src/playlist/session.ts:72-81` (SessionOptions), `:363-375` (callback chain)
- Create: `tests/learn-session.test.ts`

**Interfaces:**
- Produces: `SessionOptions.onAnswer?(answer: AnswerEvent, item: PlaylistItem): void;` and `SessionOptions.onDone?(): void;` — `onDone` fires once per mount, when the LAST item reaches `"done"`, regardless of `meta.next`.

- [ ] **Step 1: Write the failing source-text test**

`tests/learn-session.test.ts`:
```ts
// The session's learner hooks. mountPlaylist needs a DOM (no jsdom here), so
// this guards the wiring by source text, as tests/views-viewer.test.ts does.
import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

const src = readFileSync(new URL("../src/playlist/session.ts", import.meta.url), "utf8").replace(/^\s*\/\/.*$/gm, "");

describe("session learner hooks", () => {
  test("onAnswer is chained after the previous callback and passes the item", () => {
    expect(src).toMatch(/onAnswer\?\(answer: AnswerEvent, item: PlaylistItem\): void/);
    expect(src).toMatch(/onAnswer: \(a\) => \{\s*prev\.onAnswer\?\.\(a\);\s*opts\.onAnswer\?\.\(a, items\[i\]\);/);
  });
  test("onDone fires inside the done branch, only for the last item, once", () => {
    expect(src).toMatch(/onDone\?\(\): void/);
    const done = src.indexOf('if (s === "done") {');
    const fire = src.indexOf("opts.onDone?.()");
    expect(done).toBeGreaterThan(0);
    expect(fire).toBeGreaterThan(done);
    expect(src).toMatch(/if \(i === items\.length - 1 && !doneReported\) \{\s*doneReported = true;\s*opts\.onDone\?\.\(\);/);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/learn-session.test.ts`
Expected: FAIL.

- [ ] **Step 3: Wire it**

In `src/playlist/session.ts` add the import `import type { AnswerEvent } from "../render/player";` (beside the existing render imports at the top of the file). Extend `SessionOptions` after `onItemMounted` (line 73):
```ts
  /** A live viewer answered a quiz/ask in the current item (spec §4). */
  onAnswer?(answer: AnswerEvent, item: PlaylistItem): void;
  /** The LAST item finished — once per mount, whether or not meta.next is set. */
  onDone?(): void;
```

Declare `let doneReported = false;` beside the session's other `let` state (near where `idx`/`handle` are declared in `mountPlaylist`). Replace lines 363–375 with:
```ts
    const prev = hd.timeline.callbacks;
    hd.timeline.callbacks = {
      onState: (s) => {
        prev.onState?.(s);
        if (s === "done") {
          void onItemDone();
          showNextLink();
          if (i === items.length - 1 && !doneReported) {
            doneReported = true;
            opts.onDone?.();
          }
        } else {
          host.querySelector(".cs-nextlink")?.remove();
        }
      },
      onStep: prev.onStep,
      onAnswer: (a) => {
        prev.onAnswer?.(a);
        opts.onAnswer?.(a, items[i]);
      },
    };
```

- [ ] **Step 4: Verify**

Run: `npx vitest run tests/learn-session.test.ts && npx tsc --noEmit && npx vitest run`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/playlist/session.ts tests/learn-session.test.ts
git commit -m "feat(session): onAnswer and onDone hooks for the viewer"
```

---

### Task 4: `meta.enroll`

**Files:**
- Modify: `src/playlist/playlist.ts:15-60` (PlaylistMeta), `:114-146` (readMeta), `:267-281` (isSingle), `:294-306` (formatPlaylist)
- Create: `tests/learn-meta.test.ts`

**Interfaces:**
- Produces: `PlaylistMeta.enroll?: string` — the Anvil base URL, written onto the PUBLISHED copy by `publishCourse` (Task 6), round-tripped like `next`.

- [ ] **Step 1: Write the failing test**

`tests/learn-meta.test.ts`:
```ts
import { describe, expect, test } from "vitest";
import { formatPlaylist, isSingle, parsePlaylistText } from "../src/playlist/playlist";

const ITEM = "title: One\nelements: []\ncommands: []\n";

describe("meta.enroll", () => {
  test("reads, keeps a single item from being single, and writes back", () => {
    const text = `playlist:\n  enroll: https://drawcast.anvil.app\n---\n${ITEM}`;
    const p = parsePlaylistText(text);
    expect(p.meta.enroll).toBe("https://drawcast.anvil.app");
    expect(isSingle(p)).toBe(false);
    expect(formatPlaylist(p, "yaml")).toMatch(/enroll: https:\/\/drawcast\.anvil\.app/);
  });
  test("a non-string is ignored", () => {
    const p = parsePlaylistText(`playlist:\n  enroll: 5\n---\n${ITEM}`);
    expect(p.meta.enroll).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/learn-meta.test.ts`
Expected: FAIL — `meta.enroll` undefined.

- [ ] **Step 3: Implement**

In `PlaylistMeta` after `next` (line 51) add:
```ts
  /**
   * The learner backend (spec §2): the Anvil base URL from the course
   * document's `enroll:` line, written onto the PUBLISHED copy by
   * publishCourse so a lecture opened straight from an email link still
   * knows where events go. The viewer only reports when the stored code
   * came from this very app.
   */
  enroll?: string;
```
In `readMeta` after the `next` block (line 125) add `if (typeof raw.enroll === "string") meta.enroll = raw.enroll;`. In `isSingle` add `playlist.meta.enroll === undefined &&` after the `next` line (276). In `formatPlaylist` after line 302 add `if (playlist.meta.enroll !== undefined) header.enroll = playlist.meta.enroll;`.

- [ ] **Step 4: Verify**

Run: `npx vitest run tests/learn-meta.test.ts && npx vitest run`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/playlist/playlist.ts tests/learn-meta.test.ts
git commit -m "feat(playlist): meta.enroll rides the published copy"
```

---

### Task 5: `enroll` and `name` in the course document

**Files:**
- Modify: `src/course/document.ts:33-40` (Course), `:150-156` (option branch), `:167-172` (formatCourse)
- Create: `tests/course-enroll.test.ts`

**Interfaces:**
- Produces: `Course.enroll?: string`, `Course.name?: string`. Both are pulled OUT of `course.context` (which is injected into every lecture's LLM request) and written back by `formatCourse`. `setCourseOption(text, "enroll", …)` keeps working unchanged (it edits the header text).

- [ ] **Step 1: Write the failing test**

`tests/course-enroll.test.ts`:
```ts
import { describe, expect, test } from "vitest";
import { formatCourse, parseCourse } from "../src/course/document";

const DOC = `# Learn Russian
enroll: https://drawcast.anvil.app
name: learn-russian
level: beginner

Six short lectures.

## Cases
What is a case?
`;

describe("reserved course keys", () => {
  test("enroll and name leave the context and land on the course", () => {
    const c = parseCourse(DOC);
    expect(c.enroll).toBe("https://drawcast.anvil.app");
    expect(c.name).toBe("learn-russian");
    expect(c.context).toEqual({ level: "beginner" });
  });
  test("format → parse is stable", () => {
    const c = parseCourse(DOC);
    const again = parseCourse(formatCourse(c));
    expect(again.enroll).toBe(c.enroll);
    expect(again.name).toBe(c.name);
    expect(again.context).toEqual(c.context);
    expect(formatCourse(c)).toMatch(/^enroll: https:\/\/drawcast\.anvil\.app$/m);
  });
  test("a lecture-level enroll line is an ordinary lecture option", () => {
    const c = parseCourse("# T\n## L\nenroll: nope\n");
    expect(c.enroll).toBeUndefined();
    expect(c.lectures[0].options).toEqual({ enroll: "nope" });
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/course-enroll.test.ts`
Expected: FAIL — `c.enroll` undefined, context holds it.

- [ ] **Step 3: Implement**

In `Course` (line 33) add after `context`:
```ts
  /** Learner backend base URL (spec §2) — reserved, never context. */
  enroll?: string;
  /** Name override for drawcast.app/#<name> (spec §7); defaults to the slug. */
  name?: string;
```
Replace lines 152–155 (the `for (const [key, value] of options)` loop body) with:
```ts
      for (const [key, value] of options) {
        if (current) current.options[key] = value;
        else if (key === "enroll") course.enroll = value;
        else if (key === "name") course.name = value;
        else course.context[key] = value;
      }
```
In `formatCourse` after line 171 (the context loop) add:
```ts
  if (course.enroll) out.push(`enroll: ${course.enroll}`);
  if (course.name) out.push(`name: ${course.name}`);
```

- [ ] **Step 4: Verify**

Run: `npx vitest run tests/course-enroll.test.ts tests/course-document.test.ts && npx tsc --noEmit`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/course/document.ts tests/course-enroll.test.ts
git commit -m "feat(course): enroll and name are reserved course keys, kept out of context"
```

---

### Task 6: publish — `meta.enroll` per lecture, course key, page data

**Files:**
- Modify: `src/course/publish.ts:57-130` (buildPublishPlan), `src/course/page.ts:21-26` (PageLink) and `:62-76` (coursePage signature only — the box itself is Task 7)
- Create: `tests/course-enroll-publish.test.ts`

**Interfaces:**
- Produces (exported from `src/course/publish.ts`):
  ```ts
  export function courseKeyFor(repo: { owner: string; repo: string }, dir: string): string; // `${owner}/${repo}/${dir}`
  export function lectureCastKeys(course: Course, repo: { owner: string; repo: string }, coursesDir: string): string[]; // published lectures in order, from status.file
  ```
  `PageLink.cast?: string` (the cast key of a published lecture). `coursePage(course, links, learn?: { courseKey: string; enroll: string })` — third argument; when present Task 7 renders the join box.
- Consumes: `apiBase` from `src/learn.ts`; `course.enroll` (Task 5); `meta.enroll` (Task 4).

- [ ] **Step 1: Write the failing test**

`tests/course-enroll-publish.test.ts`:
```ts
import { describe, expect, test } from "vitest";
import { parseCourse } from "../src/course/document";
import { buildPublishPlan, courseKeyFor, lectureCastKeys } from "../src/course/publish";
import { emptyManifest } from "../src/publish/github";
import { parsePlaylistText } from "../src/playlist/playlist";

const REPO = { owner: "hmelberg", repo: "dcast" };
const YAML = "title: One\nelements: []\ncommands: []\n";

function plan(text: string) {
  const course = parseCourse(text);
  return buildPublishPlan({ course, text, repo: REPO, coursesDir: "", viewerBase: "https://drawcast.app/", manifest: emptyManifest(), lectureYaml: () => YAML });
}

describe("publishing a course with enroll", () => {
  const text = "# Learn Russian\nslug: learn-russian\nenroll: https://drawcast.anvil.app/\n\n## Cases\nq\n\n## Verbs\nq\n";

  test("every lecture's published copy carries meta.enroll, normalised", () => {
    const p = plan(text);
    const lectures = p.files.filter((f) => f.path.endsWith(".yaml"));
    expect(lectures.length).toBe(2);
    for (const f of lectures) expect(parsePlaylistText(f.content).meta.enroll).toBe("https://drawcast.anvil.app");
  });
  test("the page carries the course key and the api, and each lecture its cast key", () => {
    const html = plan(text).files.find((f) => f.path === "learn-russian/index.html")!.content;
    expect(html).toContain('data-course="hmelberg/dcast/learn-russian"');
    expect(html).toContain('data-enroll="https://drawcast.anvil.app"');
    expect(html).toMatch(/data-cast="hmelberg\/dcast\/learn-russian\/[^"]+\.yaml"/);
  });
  test("without enroll nothing changes", () => {
    const p = plan("# Plain\nslug: plain\n\n## L\nq\n");
    expect(parsePlaylistText(p.files.find((f) => f.path.endsWith(".yaml"))!.content).meta.enroll).toBeUndefined();
    expect(p.files.find((f) => f.path === "plain/index.html")!.content).not.toContain("data-enroll");
  });
});

describe("keys", () => {
  test("courseKeyFor joins owner, repo and the course folder", () => {
    expect(courseKeyFor(REPO, "learn-russian")).toBe("hmelberg/dcast/learn-russian");
    expect(courseKeyFor(REPO, "courses/learn-russian")).toBe("hmelberg/dcast/courses/learn-russian");
  });
  test("lectureCastKeys lists published lectures in order and skips unpublished ones", () => {
    const c = parseCourse("# T\nslug: t\n\n## A\nq\nstatus: done · file: 01-a.yaml\n\n## B\nq\n\n## C\nq\nstatus: done · file: 03-c.yaml\n");
    expect(lectureCastKeys(c, REPO, "")).toEqual(["hmelberg/dcast/t/01-a.yaml", "hmelberg/dcast/t/03-c.yaml"]);
    expect(lectureCastKeys(c, REPO, "courses")).toEqual(["hmelberg/dcast/courses/t/01-a.yaml", "hmelberg/dcast/courses/t/03-c.yaml"]);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/course-enroll-publish.test.ts`
Expected: FAIL — `courseKeyFor` not exported / no `data-enroll`.

- [ ] **Step 3: Implement**

In `src/course/publish.ts` add the import `import { apiBase } from "../learn";` and these exports (below `joinPath`):
```ts
/** The learner backend's course identity: the published folder (spec §1). */
export function courseKeyFor(repo: { owner: string; repo: string }, dir: string): string {
  return `${repo.owner}/${repo.repo}/${dir}`;
}

/** Cast keys of the lectures that have a published file, in course order. */
export function lectureCastKeys(course: Course, repo: { owner: string; repo: string }, coursesDir: string): string[] {
  const dir = joinPath(coursesDir, course.context.slug ?? "");
  return course.lectures.flatMap((l) => (l.status?.file ? [`${courseKeyFor(repo, dir)}/${l.status.file}`] : []));
}
```
Inside `buildPublishPlan`, before the per-lecture loop, compute `const enroll = course.enroll ? apiBase(course.enroll) : undefined;`. In the loop, after the `meta.next` if/else (lines 107–113) add:
```ts
    if (enroll) parsed.meta.enroll = enroll;
    else delete parsed.meta.enroll;
```
and give the pushed link its cast key: `links.push({ title: lecture.title, questions: lecture.questions, href: lectureHref(...), cast: `${courseKeyFor(repo, dir)}/${name}` });`. Replace the `index.html` line (123) with:
```ts
  files.push({ path: joinPath(dir, "index.html"), content: coursePage(course, links, enroll ? { courseKey: courseKeyFor(repo, dir), enroll } : undefined) });
```
In `src/course/page.ts`: add `cast?: string;` to `PageLink`; change the signature to `export function coursePage(course: Course, links: PageLink[], learn?: { courseKey: string; enroll: string }): string` and, for now, render `data-cast` on published links and, when `learn` is set, a placeholder `<section class="join" data-course="…" data-enroll="…"></section>` before the `<ol>` (Task 7 fills the box in):
```ts
      const head = link.href
        ? `<a class="t" href="${escapeHtml(link.href)}"${link.cast ? ` data-cast="${escapeHtml(link.cast)}"` : ""}>${escapeHtml(link.title)}</a>`
        : `<span class="t">${escapeHtml(link.title)}</span> <span class="soon">not published yet</span>`;
      ...
      return `<li${link.cast ? ` data-cast="${escapeHtml(link.cast)}"` : ""}><span class="n">${i + 1}</span>${head}${questions}</li>`;
```
and
```ts
  const join = learn ? `<section class="join" data-course="${escapeHtml(learn.courseKey)}" data-enroll="${escapeHtml(learn.enroll)}" data-title="${escapeHtml(course.title)}"></section>` : "";
  return page(course.title, `<h1>${escapeHtml(course.title)}</h1>\n${intro}\n${join}\n<ol>\n${items}\n</ol>`);
```

- [ ] **Step 4: Verify**

Run: `npx vitest run tests/course-enroll-publish.test.ts tests/course-publish.test.ts tests/course-page.test.ts && npx tsc --noEmit`
Expected: all pass (the existing page test must not have pinned the exact `<li>` markup; if it did, update that assertion to accept the optional `data-cast`).

- [ ] **Step 5: Commit**

```bash
git add src/course/publish.ts src/course/page.ts tests/course-enroll-publish.test.ts
git commit -m "feat(publish): meta.enroll per lecture, course key and cast keys on the page"
```

---

### Task 7: the join box and its script

**Files:**
- Create: `src/course/enrol-script.ts`, `tests/course-join-page.test.ts`
- Modify: `src/course/page.ts` (the `join` section + `<script>`, styles)

**Interfaces:**
- Produces: `export const ENROL_SCRIPT: string` — plain ES2017, no modules, self-invoking; touches only `document.querySelector(".join")`, `document.getElementById(id)`, `document.querySelectorAll("[data-cast]")`, element `.getAttribute/.setAttribute/.textContent/.innerHTML/.value/.hidden/.addEventListener`, `localStorage`, `fetch`, `location`, `history`. The page markup (in `coursePage`) uses these ids: `join-form`, `join-name`, `join-email`, `join-button`, `join-status`, `join-you`, `join-code`, `join-progress-note`, `join-forget`, `join-switch`, `join-switch-box`, `join-switch-input`, `join-switch-button`.

- [ ] **Step 1: Write the failing tests**

`tests/course-join-page.test.ts`:
```ts
// The course page's join box and its inline script, run against a fake DOM
// just big enough for the handful of calls the script makes.
import { describe, expect, test, vi } from "vitest";
import { parseCourse } from "../src/course/document";
import { coursePage } from "../src/course/page";
import { ENROL_SCRIPT } from "../src/course/enrol-script";

const COURSE = parseCourse("# Learn Russian\nslug: learn-russian\nenroll: https://drawcast.anvil.app\n\n## Cases\nq\n\n## Verbs\nq\n");
const LINKS = [
  { title: "Cases", questions: [], href: "https://drawcast.app/#gh=hmelberg/dcast/learn-russian/01-cases.yaml", cast: "hmelberg/dcast/learn-russian/01-cases.yaml" },
  { title: "Verbs", questions: [], href: "https://drawcast.app/#gh=hmelberg/dcast/learn-russian/02-verbs.yaml", cast: "hmelberg/dcast/learn-russian/02-verbs.yaml" },
];
const LEARN = { courseKey: "hmelberg/dcast/learn-russian", enroll: "https://drawcast.anvil.app" };

class El {
  attrs: Record<string, string> = {};
  textContent = "";
  innerHTML = "";
  value = "";
  hidden = false;
  handlers: Record<string, ((e: { preventDefault(): void }) => void)[]> = {};
  constructor(public id: string, attrs: Record<string, string> = {}) { this.attrs = attrs; }
  getAttribute(k: string) { return this.attrs[k] ?? null; }
  setAttribute(k: string, v: string) { this.attrs[k] = v; }
  addEventListener(type: string, fn: (e: { preventDefault(): void }) => void) { (this.handlers[type] ??= []).push(fn); }
  fire(type: string) { for (const fn of this.handlers[type] ?? []) fn({ preventDefault() {} }); }
}

function fakeDom(join: El | null, casts: El[]) {
  const byId: Record<string, El> = {};
  for (const id of ["join-form", "join-name", "join-email", "join-button", "join-status", "join-you", "join-code", "join-progress-note", "join-forget", "join-switch", "join-switch-box", "join-switch-input", "join-switch-button"]) byId[id] = new El(id);
  return {
    byId,
    document: {
      querySelector: (sel: string) => (sel === ".join" ? join : null),
      getElementById: (id: string) => byId[id] ?? null,
      querySelectorAll: (sel: string) => (sel === "[data-cast]" ? casts : []),
    },
  };
}

function memoryStorage() {
  const data: Record<string, string> = {};
  return { getItem: (k: string) => data[k] ?? null, setItem: (k: string, v: string) => { data[k] = v; }, removeItem: (k: string) => { delete data[k]; }, data };
}

async function run(opts: { search?: string; storage?: ReturnType<typeof memoryStorage>; fetch?: typeof fetch; join?: boolean }) {
  const join = opts.join === false ? null : new El("join", { "data-course": LEARN.courseKey, "data-enroll": LEARN.enroll, "data-title": "Learn Russian" });
  const casts = LINKS.map((l) => new El("cast", { "data-cast": l.cast, href: l.href }));
  const dom = fakeDom(join, casts);
  const storage = opts.storage ?? memoryStorage();
  const replaced: string[] = [];
  const location = { search: opts.search ?? "", pathname: "/dcast/learn-russian/", hash: "", origin: "https://hmelberg.github.io", href: "https://hmelberg.github.io/dcast/learn-russian/" + (opts.search ?? "") };
  const history = { replaceState: (_: unknown, __: string, url: string) => replaced.push(url) };
  const fetchImpl = opts.fetch ?? (vi.fn(async () => new Response("{}", { status: 404 })) as unknown as typeof fetch);
  new Function("document", "localStorage", "fetch", "location", "history", ENROL_SCRIPT)(dom.document, storage, fetchImpl, location, history);
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
  return { ...dom, casts, storage, replaced, fetchImpl };
}

describe("the page markup", () => {
  test("renders the join box, the privacy line and the script only with learn data", () => {
    const html = coursePage(COURSE, LINKS, LEARN);
    expect(html).toContain('id="join-form"');
    expect(html).toContain("Forget me");
    expect(html).toContain("<script>");
    expect(html).toMatch(/we store your name, email and answers/i);
    const plain = coursePage(COURSE, LINKS);
    expect(plain).not.toContain("<script>");
    expect(plain).not.toContain('class="join"');
  });
});

describe("the script", () => {
  test("does nothing on a page without a join box", async () => {
    const r = await run({ join: false });
    expect(r.storage.data).toEqual({});
  });

  test("an arriving ?learner= code is stored under the course, stripped from the URL, and added to lecture links", async () => {
    const r = await run({ search: "?learner=Fjell-Rev-Havn" });
    expect(JSON.parse(r.storage.data["drawcast.learners"])[LEARN.courseKey]).toEqual({ code: "fjell-rev-havn", api: LEARN.enroll, name: null });
    expect(r.replaced).toEqual(["/dcast/learn-russian/"]);
    expect(r.casts[0].getAttribute("href")).toBe(LINKS[0].href + "&learner=fjell-rev-havn");
    expect(r.byId["join-form"].hidden).toBe(true);
    expect(r.byId["join-you"].hidden).toBe(false);
    expect(r.byId["join-code"].textContent).toBe("fjell-rev-havn");
  });

  test("joining posts name and email, shows the code, and stores it", async () => {
    const f = vi.fn(async (url: string) => new Response(JSON.stringify(url.endsWith("/enroll") ? { code: "havn-ulv-bok", name: "Kari", email_sent: true } : { name: "Kari", course: {}, lectures: [] }), { status: 200 })) as unknown as typeof fetch;
    const r = await run({ fetch: f });
    r.byId["join-name"].value = "Kari";
    r.byId["join-email"].value = "kari@example.com";
    r.byId["join-form"].fire("submit");
    await new Promise((res) => setTimeout(res, 0));
    await new Promise((res) => setTimeout(res, 0));
    const [url, init] = (f as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://drawcast.anvil.app/_/api/enroll");
    expect((init.headers as Record<string, string>)["content-type"]).toBe("text/plain");
    expect(JSON.parse(init.body as string)).toEqual({ course: LEARN.courseKey, title: "Learn Russian", page: "https://hmelberg.github.io/dcast/learn-russian/", run: null, name: "Kari", email: "kari@example.com" });
    expect(r.byId["join-code"].textContent).toBe("havn-ulv-bok");
    expect(r.byId["join-status"].textContent).toMatch(/sent it to you/i);
    expect(JSON.parse(r.storage.data["drawcast.learners"])[LEARN.courseKey].code).toBe("havn-ulv-bok");
  });

  test("a run in the page URL travels with the enrolment", async () => {
    const f = vi.fn(async () => new Response(JSON.stringify({ code: "a-b-c", name: null, email_sent: false }), { status: 200 })) as unknown as typeof fetch;
    const r = await run({ fetch: f, search: "?run=spring" });
    r.byId["join-form"].fire("submit");
    await new Promise((res) => setTimeout(res, 0));
    expect(JSON.parse(((f as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit])[1].body as string).run).toBe("spring");
    await new Promise((res) => setTimeout(res, 0));
    expect(r.byId["join-status"].textContent).toMatch(/write it down/i);
  });

  test("the server's email requirement is shown, not swallowed", async () => {
    const f = vi.fn(async () => new Response(JSON.stringify({ error: "email" }), { status: 400 })) as unknown as typeof fetch;
    const r = await run({ fetch: f });
    r.byId["join-form"].fire("submit");
    await new Promise((res) => setTimeout(res, 0));
    await new Promise((res) => setTimeout(res, 0));
    expect(r.byId["join-status"].textContent).toMatch(/needs an email address/i);
  });

  test("with a stored code the progress view marks lectures and unfolds answers", async () => {
    const storage = memoryStorage();
    storage.data["drawcast.learners"] = JSON.stringify({ [LEARN.courseKey]: { code: "fjell-rev-havn", api: LEARN.enroll, name: "Kari" } });
    const progress = { name: "Kari", course: {}, lectures: [
      { cast: LINKS[0].cast, opened: true, completed: true, answers: [{ step: 2, question: "Which case?", given: ["dative", "genitive"], expected: "genitive", correct: true }, { step: 5, question: "Gender?", given: ["m"], expected: "f", correct: false }] },
      { cast: LINKS[1].cast, opened: true, completed: false, answers: [] },
    ] };
    const f = vi.fn(async () => new Response(JSON.stringify(progress), { status: 200 })) as unknown as typeof fetch;
    const r = await run({ storage, fetch: f });
    expect(((f as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string])[0]).toBe("https://drawcast.anvil.app/_/api/progress?code=fjell-rev-havn");
    expect(r.casts[0].innerHTML).toContain("✓ 1/2");
    expect(r.casts[1].innerHTML).toContain("○");
    expect(r.casts[0].innerHTML).toContain("Which case?");
    expect(r.casts[0].innerHTML).toContain("dative → genitive");
    expect(r.casts[0].innerHTML).toContain("expected: f");
    expect(r.casts[0].innerHTML).not.toContain("<script");
  });

  test("forget posts the code, clears storage and shows the form again", async () => {
    const storage = memoryStorage();
    storage.data["drawcast.learners"] = JSON.stringify({ [LEARN.courseKey]: { code: "fjell-rev-havn", api: LEARN.enroll, name: null } });
    const f = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 })) as unknown as typeof fetch;
    const r = await run({ storage, fetch: f });
    r.byId["join-forget"].fire("click");
    await new Promise((res) => setTimeout(res, 0));
    await new Promise((res) => setTimeout(res, 0));
    const forget = (f as unknown as ReturnType<typeof vi.fn>).mock.calls.find((c) => (c[0] as string).endsWith("/forget"))!;
    expect(JSON.parse((forget[1] as RequestInit).body as string)).toEqual({ code: "fjell-rev-havn" });
    expect(JSON.parse(storage.data["drawcast.learners"])).toEqual({});
    expect(r.byId["join-form"].hidden).toBe(false);
  });

  test("use another code stores what was pasted", async () => {
    const r = await run({});
    r.byId["join-switch-input"].value = " Havn-Ulv-Bok ";
    r.byId["join-switch-button"].fire("click");
    await new Promise((res) => setTimeout(res, 0));
    expect(JSON.parse(r.storage.data["drawcast.learners"])[LEARN.courseKey].code).toBe("havn-ulv-bok");
    expect(r.byId["join-you"].hidden).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/course-join-page.test.ts`
Expected: FAIL — cannot resolve `enrol-script`.

- [ ] **Step 3: Write `src/course/enrol-script.ts`**

```ts
// The course page's inline script (spec §2). Plain ES2017 in a string —
// the page is static HTML on Pages with no build step — kept tiny and
// touching only a handful of DOM calls so tests/course-join-page.test.ts can
// run it against a fake document. Its storage key and shape are the same
// as src/learn.ts's (LEARNERS_KEY, {code, api, name}) because the player
// on drawcast.app reads what this page wrote when both share an origin.

export const ENROL_SCRIPT = String.raw`(function () {
  var box = document.querySelector(".join");
  if (!box) return;
  var api = (box.getAttribute("data-enroll") || "").replace(/\/+$/, "");
  var course = box.getAttribute("data-course") || "";
  var KEY = "drawcast.learners";
  var CODE_RE = /^[a-z]{3,7}-[a-z]{3,7}-[a-z]{3,7}$/;
  function $(id) { return document.getElementById(id); }
  function store() { try { return localStorage; } catch (e) { return null; } }
  function read() { var s = store(); if (!s) return {}; try { var v = JSON.parse(s.getItem(KEY) || "{}"); return v && typeof v === "object" ? v : {}; } catch (e) { return {}; } }
  function write(map) { var s = store(); if (!s) return; try { s.setItem(KEY, JSON.stringify(map)); } catch (e) {} }
  function entry() { var e = read()[course]; return e && typeof e.code === "string" ? e : null; }
  function save(code, name) { var m = read(); m[course] = { code: code, api: api, name: name || null }; write(m); }
  function forget() { var m = read(); delete m[course]; write(m); }
  function esc(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }
  function normalize(raw) { var s = String(raw || "").trim().toLowerCase().split(/\s+/).join("-"); return CODE_RE.test(s) ? s : null; }
  function post(path, body) {
    return fetch(api + "/_/api/" + path, { method: "POST", headers: { "content-type": "text/plain" }, body: JSON.stringify(body) })
      .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, body: j }; }, function () { return { ok: r.ok, body: {} }; }); });
  }
  function pageUrl() { return location.origin + location.pathname; }
  function runSlug() { var m = /[?&]run=([^&#]+)/.exec(location.search || ""); return m ? decodeURIComponent(m[1]) : null; }

  var arriving = /[?&]learner=([^&#]+)/.exec(location.search || "");
  if (arriving) {
    var code = normalize(decodeURIComponent(arriving[1]));
    if (code) save(code, (entry() || {}).name);
    try { history.replaceState(null, "", location.pathname + (location.hash || "")); } catch (e) {}
  }

  var casts = document.querySelectorAll("[data-cast]");
  function rewriteLinks(code) {
    for (var i = 0; i < casts.length; i++) {
      var a = casts[i];
      var href = a.getAttribute("href");
      if (href == null) continue;
      href = href.replace(/&learner=[^&]*/, "");
      a.setAttribute("href", href + "&learner=" + code);
    }
  }
  function mark(lecture) {
    var right = 0, total = lecture.answers.length;
    for (var i = 0; i < total; i++) if (lecture.answers[i].correct) right++;
    var sym = lecture.completed ? "✓" : lecture.opened ? "○" : "·";
    return { label: total ? sym + " " + right + "/" + total : sym, right: right, total: total };
  }
  function answersHtml(lecture) {
    var out = "<ol class=\"answers\">";
    for (var i = 0; i < lecture.answers.length; i++) {
      var a = lecture.answers[i];
      var given = a.given && a.given.length ? a.given.join(" → ") : "(skipped)";
      out += "<li>" + (a.correct ? "✓" : "✗") + " <b>" + esc(a.question) + "</b><br>you: " + esc(given) + "<br>expected: " + esc(a.expected) + "</li>";
    }
    return out + "</ol>";
  }
  function showProgress(e) {
    fetch(api + "/_/api/progress?code=" + encodeURIComponent(e.code)).then(function (r) { return r.ok ? r.json() : null; }).then(function (p) {
      if (!p) { $("join-progress-note").textContent = "Progress is unavailable right now."; return; }
      var byCast = {};
      for (var i = 0; i < p.lectures.length; i++) byCast[p.lectures[i].cast] = p.lectures[i];
      for (var j = 0; j < casts.length; j++) {
        var li = casts[j], lecture = byCast[li.getAttribute("data-cast")];
        if (!lecture) continue;
        var m = mark(lecture);
        li.innerHTML = "<span class=\"mark\" title=\"click for your answers\">" + esc(m.label) + "</span>" + li.innerHTML + (m.total ? "<div class=\"review\" hidden>" + answersHtml(lecture) + "</div>" : "");
      }
      $("join-progress-note").textContent = "✓ completed · ○ opened · click a score to review your answers";
    }, function () { $("join-progress-note").textContent = "Progress is unavailable right now."; });
  }
  function render() {
    var e = entry();
    $("join-form").hidden = !!e;
    $("join-you").hidden = !e;
    $("join-switch-box").hidden = true;
    if (e) {
      $("join-code").textContent = e.code;
      rewriteLinks(e.code);
      showProgress(e);
    }
  }

  $("join-form").addEventListener("submit", function (ev) {
    ev.preventDefault();
    $("join-status").textContent = "Joining…";
    var name = ($("join-name").value || "").trim() || null;
    var email = ($("join-email").value || "").trim() || null;
    var title = box.getAttribute("data-title") || course;
    post("enroll", { course: course, title: title, page: pageUrl(), run: runSlug(), name: name, email: email }).then(function (r) {
      if (!r.ok) {
        $("join-status").textContent = r.body && r.body.error === "email" ? "This course needs an email address." : r.body && r.body.error === "closed" ? "This course is not open for enrolment." : "Could not join — please try again.";
        return;
      }
      if (r.body.resent) { $("join-status").textContent = "You are already enrolled — we sent your code to your email again."; return; }
      save(r.body.code, name);
      $("join-status").textContent = r.body.email_sent ? "Your course code is below. We sent it to you as well." : "Your course code is below. Write it down — it is your only key.";
      render();
    }, function () { $("join-status").textContent = "Could not join — please try again."; });
  });
  $("join-forget").addEventListener("click", function (ev) {
    ev.preventDefault();
    var e = entry();
    if (!e) return;
    post("forget", { code: e.code }).then(function () { forget(); $("join-status").textContent = "Forgotten. Your data has been deleted."; render(); }, function () { $("join-status").textContent = "Could not reach the server — try again."; });
  });
  $("join-switch").addEventListener("click", function (ev) { ev.preventDefault(); $("join-switch-box").hidden = false; });
  $("join-switch-button").addEventListener("click", function (ev) {
    ev.preventDefault();
    var code = normalize($("join-switch-input").value);
    if (!code) { $("join-status").textContent = "That is not a course code (three words, like fjell-rev-havn)."; return; }
    save(code, null);
    $("join-status").textContent = "";
    render();
  });
  document.addEventListener && document.addEventListener("click", function (ev) {
    var t = ev.target;
    if (!t || !t.getAttribute || !t.classList || !t.classList.contains("mark")) return;
    var li = t.parentNode, review = li && li.querySelector && li.querySelector(".review");
    if (review) review.hidden = !review.hidden;
  });
  render();
})();`;
```

Note the last block guards `document.addEventListener` — the fake document has none, and a real one has; the answer unfold is a click on `.mark`.

- [ ] **Step 4: Render the box in `coursePage`**

Replace the placeholder `join` section from Task 6 with (still in `src/course/page.ts`):
```ts
  const join = learn
    ? `<section class="join" data-course="${escapeHtml(learn.courseKey)}" data-enroll="${escapeHtml(learn.enroll)}" data-title="${escapeHtml(course.title)}">
<form id="join-form">
  <b>Join this course</b>
  <input id="join-name" placeholder="Name (optional)" autocomplete="name">
  <input id="join-email" type="email" placeholder="Email (optional — lets you find your code again)" autocomplete="email">
  <button id="join-button" type="submit">Join</button>
  <p class="privacy">We store your name, email and answers so you and the course's teachers can see your progress. "Forget me" deletes all of it.</p>
</form>
<div id="join-you" hidden>
  <b>Your course code:</b> <code id="join-code"></code>
  <span class="small">— <a href="#" id="join-switch">use another code</a> · <a href="#" id="join-forget">Forget me</a></span>
  <p id="join-progress-note" class="small"></p>
</div>
<div id="join-switch-box" hidden><input id="join-switch-input" placeholder="fjell-rev-havn"> <button id="join-switch-button" type="button">Use this code</button></div>
<p id="join-status" class="small"></p>
</section>
<script>${ENROL_SCRIPT}</script>`
    : "";
```
Import `ENROL_SCRIPT` at the top of `page.ts`. Add to `STYLE`:
```
  .join { border: 1px solid rgba(128,128,128,0.35); border-radius: 8px; padding: 1rem; margin: 1rem 0; }
  .join input { font: inherit; padding: 0.35rem 0.5rem; margin: 0.25rem 0.25rem 0.25rem 0; max-width: 100%; }
  .join button { font: inherit; padding: 0.35rem 0.8rem; }
  .join .privacy, .join .small { font-size: 0.85rem; opacity: 0.7; margin: 0.5rem 0 0; }
  .mark { display: inline-block; min-width: 3.2rem; margin-right: 0.5rem; cursor: pointer; font-variant-numeric: tabular-nums; }
  .review { margin: 0.5rem 0 0 3.7rem; font-size: 0.9rem; }
  .review li { border: 0; padding: 0.25rem 0; list-style: none; }
```

- [ ] **Step 5: Verify**

Run: `npx vitest run tests/course-join-page.test.ts tests/course-page.test.ts tests/course-enroll-publish.test.ts && npx tsc --noEmit && npx vitest run`
Expected: all pass. The script test drives `submit`/`click` through `El.fire`, so every handler the test fires must be registered with `addEventListener` on the element returned by `getElementById`.

- [ ] **Step 6: Commit**

```bash
git add src/course/enrol-script.ts src/course/page.ts tests/course-join-page.test.ts
git commit -m "feat(course page): join box, progress ticks, answer review, forget me"
```

---

### Task 8: the viewer reports, and the 🎓 button

**Files:**
- Modify: `src/viewer.ts:32-44` (ViewerRequest), `:89-122` (parseViewerHash), `:249-300` (counting block + mount options)
- Create: `tests/learn-viewer.test.ts`
- Modify: `src/styles.css` (one rule for the popover, if `.menu-panel` needs a width)

**Interfaces:**
- Consumes: everything in `src/learn.ts`; `SessionOptions.onAnswer/onDone` (Task 3); `meta.enroll` (Task 4); `ControlsOptions.trailing`.
- Produces: `ViewerRequest.learner?: string`; `export function learnerButton(...)` (exported for the source-text test only).

- [ ] **Step 1: Write the failing tests**

`tests/learn-viewer.test.ts`:
```ts
import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { parseViewerHash } from "../src/viewer";

const src = readFileSync(new URL("../src/viewer.ts", import.meta.url), "utf8").replace(/^\s*\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");

describe("the learner param", () => {
  test("rides the hash and is normalised", () => {
    expect(parseViewerHash("#gh=hmelberg/dcast/learn-russian/01.yaml&learner=Fjell-Rev-Havn")?.learner).toBe("fjell-rev-havn");
    expect(parseViewerHash("#gh=hmelberg/dcast/learn-russian/01.yaml&learner=nope")?.learner).toBeUndefined();
    expect(parseViewerHash("#gh=hmelberg/dcast/learn-russian/01.yaml")?.learner).toBeUndefined();
  });
});

describe("the viewer reports to the learner backend", () => {
  test("it uses the client, never its own rules", () => {
    expect(src).toMatch(/from "\.\/learn"/);
    expect(src).toMatch(/reportingAllowed\(/);
    expect(src).toMatch(/saveLearner\(/);
  });
  test("an arriving code is stored before the URL is cleaned, and the cleanup uses replaceState", () => {
    const save = src.indexOf("saveLearner(");
    const strip = src.indexOf("history.replaceState");
    expect(save).toBeGreaterThan(0);
    expect(strip).toBeGreaterThan(save);
    expect(src).toMatch(/stripLearnerParam\(location\.href\)/);
  });
  test("opened, answer and completed are wired and never awaited", () => {
    expect(src).toMatch(/kind: "opened"/);
    expect(src).toMatch(/onAnswer: /);
    expect(src).toMatch(/onDone: /);
    expect(src).toMatch(/kind: "completed"/);
    expect(src).not.toMatch(/await\s+sendEvent/);
  });
  test("the button is a trailing control and only appears with a course backend or a stored code", () => {
    expect(src).toMatch(/fullscreenEl: figureHost, trailing/);
    expect(src).toMatch(/learnerButton\(/);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/learn-viewer.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

In `src/viewer.ts`:

Imports:
```ts
import {
  apiBase, courseKeyOf, firstOpenInSession, forgetLearner, learnerFor, normalizeCode, reportingAllowed, saveLearner, sendEvent, stripLearnerParam,
  type LearnerEntry,
} from "./learn";
```

`ViewerRequest` gains:
```ts
  /** A course code arriving on the link (spec §1); stored, then stripped from the URL. */
  learner?: string;
```
In `parseViewerHash`'s `common` object add `learner: normalizeCode(params.get("learner")) ?? undefined,`.

Add the button factory (module level, exported):
```ts
/**
 * The 🎓 control (spec §5): shows who this browser reports as for the
 * current course, lets a learner paste a code from their email, or stop.
 * A change reloads — the session captured the learner at mount, and a
 * reload is the honest way to re-wire everything.
 */
export function learnerButton(courseKey: string, entry: LearnerEntry | null, api: string | undefined, storage: Storage | null): HTMLElement {
  const btn = h("button", { class: "cs-bar-btn", title: entry ? `Reporting as ${entry.name ?? entry.code}` : "Course code…" }, "🎓");
  const panel = h("div", { class: "menu-panel learner-panel", hidden: "" });
  const root = h("span", { class: "menu" }, btn, panel);
  const status = h("div", { class: "learner-status" }, entry ? `You are ${entry.name ?? entry.code}` : "Paste the course code from your email:");
  const input = h("input", { class: "learner-input", placeholder: "fjell-rev-havn", value: "" }) as HTMLInputElement;
  const use = h("button", { class: "cs-bar-btn", type: "button" }, "Use this code");
  const stop = h("button", { class: "cs-bar-btn", type: "button", hidden: entry ? "" : "hidden" }, "Stop reporting");
  if (!entry) stop.remove();
  use.addEventListener("click", () => {
    const code = normalizeCode(input.value);
    if (!code) {
      status.textContent = "That is not a course code (three words, like fjell-rev-havn).";
      return;
    }
    saveLearner(storage, courseKey, { code, api: api ?? entry?.api ?? "", name: null });
    location.reload();
  });
  stop.addEventListener("click", () => {
    forgetLearner(storage, courseKey);
    location.reload();
  });
  panel.append(status, input, use, stop);
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    panel.hidden = !panel.hidden;
  });
  panel.addEventListener("click", (e) => e.stopPropagation());
  document.addEventListener("click", () => { panel.hidden = true; }, true);
  return root;
}
```
Beside `learnerButton`, add a tiny guard used below:
```ts
function safeLocalStorage(): Storage | null {
  try {
    return localStorage;
  } catch {
    return null;
  }
}
```

In `runViewer`, right after the counting block (after line 265, before `const settings = loadSettings();`) insert:
```ts
    // Learners (spec §1, §4): remember an arriving code, then report for the
    // course this cast belongs to — but only to the app that issued the code.
    let learner: LearnerEntry | null = null;
    let learnerCast = "";
    const trailing: HTMLElement[] = [];
    if (req.gh) {
      learnerCast = castKeyFor(req.gh);
      const courseKey = courseKeyOf(learnerCast);
      const local = safeLocalStorage();
      const enroll = playlist.meta.enroll ? apiBase(playlist.meta.enroll) : undefined;
      if (req.learner && enroll) {
        saveLearner(local, courseKey, { code: req.learner, api: enroll, name: learnerFor(local, courseKey)?.name ?? null });
        try {
          history.replaceState(null, "", stripLearnerParam(location.href));
        } catch {
          /* a copied address keeps the code; nothing else changes */
        }
      }
      const entry = learnerFor(local, courseKey);
      if (reportingAllowed(entry, enroll)) {
        learner = entry;
        const session = (() => {
          try {
            return sessionStorage;
          } catch {
            return null;
          }
        })();
        if (firstOpenInSession(learnerCast, session)) void sendEvent(learner, { kind: "opened", cast: learnerCast });
      }
      if (enroll || entry) trailing.push(learnerButton(courseKey, learner, enroll, local));
    }
    const reporter = learner;
```
and change the `mountPlaylist` options:
```ts
      controls: { speech, fullscreenEl: figureHost, trailing },
      onItemMounted: (hd) => attachParamsTray(figureHost, hd),
      onAnswer: reporter ? (a) => { void sendEvent(reporter, { kind: "answer", cast: learnerCast, step: a.index, question: a.question, given: a.given, expected: a.expected, correct: a.correct }); } : undefined,
      onDone: reporter ? () => { void sendEvent(reporter, { kind: "completed", cast: learnerCast }); } : undefined,
      advanceOverride: req.advance,
```
Add to `src/styles.css` (beside the existing `.menu-panel` rule):
```css
.learner-panel { min-width: 16rem; display: flex; flex-direction: column; gap: 0.4rem; padding: 0.6rem; }
.learner-input { font: inherit; padding: 0.3rem 0.5rem; }
```

- [ ] **Step 4: Verify**

Run: `npx vitest run tests/learn-viewer.test.ts tests/views-viewer.test.ts tests/course-gh-viewer.test.ts && npx tsc --noEmit && npx vitest run && npm run build`
Expected: all pass, build clean.

- [ ] **Step 5: Smoke by hand (record the result in the ledger)**

`npx vite --port 5178`, open `http://localhost:5178/#gh=hmelberg/dcast/<a published lecture>&learner=fjell-rev-havn` in a browser with the Anvil app live: the address bar loses `&learner=`, `localStorage["drawcast.learners"]` holds the entry, the network tab shows a `text/plain` POST to `/_/api/event` with `kind: "opened"`, answering a quiz posts `kind: "answer"`, finishing posts `kind: "completed"`, and 🎓 shows the code. Without `meta.enroll` on the lecture (an old publish) no button and no requests.

- [ ] **Step 6: Commit**

```bash
git add src/viewer.ts src/styles.css tests/learn-viewer.test.ts
git commit -m "feat(viewer): remember the course code, report opened/answer/completed, the 🎓 control"
```

---

### Task 9: `src/names.ts`

**Files:**
- Create: `src/names.ts`, `tests/names.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export const NAME_RE: RegExp;                    // source === "^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?(?:/[a-z0-9-]{1,20})?$"
  export const RESERVED_PREFIXES: readonly string[]; // ["gh","gdoc","gdrive","url","anvil","api","name","course","learner"]
  export function normalizeName(raw: string | null | undefined): string | null;
  export function nameInHash(hash: string): string | null;   // "#learn-russian/3&mode=silent" → "learn-russian/3"; null for #gh=…, #, ""
  export function isNameHash(hash: string): boolean;
  export function ghHashFor(hash: string, target: string): string; // "#learn-russian/3&mode=silent" + "o/r/p.yaml" → "#gh=o/r/p.yaml&mode=silent"
  export interface Resolved { kind: "cast" | "course"; target: string; page: string | null }
  export async function resolveName(api: string, name: string, fetchImpl?: typeof fetch): Promise<Resolved | null>;
  export interface Registration { key: string; name: string; kind: "cast" | "course"; target: string; page?: string; title?: string; lectures?: string[] }
  export async function registerName(api: string, reg: Registration, fetchImpl?: typeof fetch): Promise<"ok" | "taken" | "key" | "invalid" | "error">;
  ```

- [ ] **Step 1: Write the failing tests**

`tests/names.test.ts`:
```ts
import { describe, expect, test, vi } from "vitest";
import { ghHashFor, isNameHash, nameInHash, normalizeName, registerName, resolveName, NAME_RE, RESERVED_PREFIXES } from "../src/names";

function fetchReturning(status: number, body: unknown): typeof fetch {
  return vi.fn(async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;
}
const calls = (f: typeof fetch) => (f as unknown as ReturnType<typeof vi.fn>).mock.calls as [string, RequestInit][];

describe("the rule is the server's rule", () => {
  test("regex source and reserved prefixes are pinned to server_code/names.py", () => {
    expect(NAME_RE.source).toBe("^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?(?:\\/[a-z0-9-]{1,20})?$");
    expect([...RESERVED_PREFIXES]).toEqual(["gh", "gdoc", "gdrive", "url", "anvil", "api", "name", "course", "learner"]);
  });
  test("accepts and normalises", () => {
    expect(normalizeName(" Learn-Russian ")).toBe("learn-russian");
    expect(normalizeName("learn-russian/3")).toBe("learn-russian/3");
  });
  test("rejects reserved prefixes with or without a dash, and malformed names", () => {
    for (const bad of ["gh", "gh-x", "GDRIVE-abc", "url/1", "anvil-x", "api", "name-x", "course", "learner-1", "-x", "x-", "a b", "a=b", "", null]) expect(normalizeName(bad)).toBeNull();
  });
});

describe("hash helpers", () => {
  test("nameInHash takes the first segment and ignores parameters", () => {
    expect(nameInHash("#learn-russian")).toBe("learn-russian");
    expect(nameInHash("#Learn-Russian/3&mode=silent&learner=a-b-c")).toBe("learn-russian/3");
    expect(nameInHash("#gh=o/r/p.yaml")).toBeNull();
    expect(nameInHash("#gh-o/r/p.yaml")).toBeNull();
    expect(nameInHash("#")).toBeNull();
    expect(nameInHash("")).toBeNull();
    expect(nameInHash("#mode=silent")).toBeNull();
  });
  test("isNameHash", () => {
    expect(isNameHash("#learn-russian")).toBe(true);
    expect(isNameHash("#gh=o/r/p.yaml")).toBe(false);
    expect(isNameHash("")).toBe(false);
  });
  test("ghHashFor swaps the name for the target and keeps the rest", () => {
    expect(ghHashFor("#learn-russian/3&mode=silent", "o/r/03.yaml")).toBe("#gh=o/r/03.yaml&mode=silent");
    expect(ghHashFor("#learn-russian", "o/r/03.yaml")).toBe("#gh=o/r/03.yaml");
  });
});

describe("resolveName", () => {
  test("GETs /_/api/name?n= and returns the body", async () => {
    const f = fetchReturning(200, { kind: "cast", target: "o/r/p.yaml", page: null });
    expect(await resolveName("https://drawcast.anvil.app/", "learn-russian/3", f)).toEqual({ kind: "cast", target: "o/r/p.yaml", page: null });
    expect(calls(f)[0][0]).toBe("https://drawcast.anvil.app/_/api/name?n=learn-russian%2F3");
  });
  test("404 or a throw is null", async () => {
    expect(await resolveName("https://x", "nope", fetchReturning(404, { error: "unknown" }))).toBeNull();
    expect(await resolveName("https://x", "nope", vi.fn(async () => { throw new Error("offline"); }) as unknown as typeof fetch)).toBeNull();
  });
});

describe("registerName", () => {
  const reg = { key: "k", name: "learn-russian", kind: "course" as const, target: "o/r/learn-russian", page: "https://h/x/", title: "T", lectures: ["o/r/learn-russian/01.yaml"] };
  test("POSTs text/plain JSON and maps statuses", async () => {
    const f = fetchReturning(200, { ok: true });
    expect(await registerName("https://drawcast.anvil.app", reg, f)).toBe("ok");
    const [url, init] = calls(f)[0];
    expect(url).toBe("https://drawcast.anvil.app/_/api/name");
    expect((init.headers as Record<string, string>)["content-type"]).toBe("text/plain");
    expect(JSON.parse(init.body as string)).toEqual(reg);
    expect(await registerName("https://x", reg, fetchReturning(409, { error: "taken" }))).toBe("taken");
    expect(await registerName("https://x", reg, fetchReturning(401, { error: "key" }))).toBe("key");
    expect(await registerName("https://x", reg, fetchReturning(400, { error: "name" }))).toBe("invalid");
    expect(await registerName("https://x", reg, fetchReturning(500, {}))).toBe("error");
  });
  test("an invalid name never becomes a request", async () => {
    const f = fetchReturning(200, { ok: true });
    expect(await registerName("https://x", { ...reg, name: "gh-x" }, f)).toBe("invalid");
    expect(calls(f).length).toBe(0);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/names.test.ts`
Expected: FAIL — cannot resolve `../src/names`.

- [ ] **Step 3: Write `src/names.ts`**

```ts
// Names — drawcast.app/#learn-russian (spec §7). A name is a pointer kept
// in the Anvil registry; this module knows the rule, reads a name out of a
// hash, swaps it for the resolved target, and registers one after a
// publish. The rule and RESERVED_PREFIXES mirror drawcast-anvil's
// server_code/names.py — tests/names.test.ts pins both.

import { apiBase } from "./learn";

export const NAME_RE = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?(?:\/[a-z0-9-]{1,20})?$/;
/** May not start a name, with or without a trailing dash: `gh-…` is an alias of `gh=…` in the viewer. */
export const RESERVED_PREFIXES = ["gh", "gdoc", "gdrive", "url", "anvil", "api", "name", "course", "learner"] as const;

export function normalizeName(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") return null;
  const name = raw.trim().toLowerCase();
  if (!NAME_RE.test(name)) return null;
  const base = name.split("/", 1)[0];
  for (const p of RESERVED_PREFIXES) if (base === p || base.startsWith(p + "-")) return null;
  return name;
}

/** The name segment of a hash: everything after "#" up to the first "&". */
export function nameInHash(hash: string): string | null {
  if (!hash.startsWith("#")) return null;
  const first = hash.slice(1).split("&", 1)[0];
  if (first.includes("=")) return null;
  return normalizeName(decodeURIComponent(first));
}

export function isNameHash(hash: string): boolean {
  return nameInHash(hash) !== null;
}

/** The same hash with the name replaced by its resolved gh target. */
export function ghHashFor(hash: string, target: string): string {
  const rest = hash.slice(1).split("&").slice(1);
  return `#gh=${target}${rest.length ? "&" + rest.join("&") : ""}`;
}

export interface Resolved {
  kind: "cast" | "course";
  target: string;
  page: string | null;
}

export async function resolveName(api: string, name: string, fetchImpl: typeof fetch = fetch): Promise<Resolved | null> {
  try {
    const res = await fetchImpl(`${apiBase(api)}/_/api/name?n=${encodeURIComponent(name)}`);
    if (!res.ok) return null;
    const body = (await res.json()) as Partial<Resolved>;
    if ((body.kind !== "cast" && body.kind !== "course") || typeof body.target !== "string") return null;
    return { kind: body.kind, target: body.target, page: typeof body.page === "string" ? body.page : null };
  } catch {
    return null;
  }
}

export interface Registration {
  key: string;
  name: string;
  kind: "cast" | "course";
  target: string;
  page?: string;
  title?: string;
  lectures?: string[];
}

export async function registerName(api: string, reg: Registration, fetchImpl: typeof fetch = fetch): Promise<"ok" | "taken" | "key" | "invalid" | "error"> {
  if (normalizeName(reg.name) !== reg.name) return "invalid";
  try {
    const res = await fetchImpl(`${apiBase(api)}/_/api/name`, {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body: JSON.stringify(reg),
    });
    if (res.ok) return "ok";
    if (res.status === 409) return "taken";
    if (res.status === 401) return "key";
    if (res.status === 400) return "invalid";
    return "error";
  } catch {
    return "error";
  }
}
```

- [ ] **Step 4: Verify**

Run: `npx vitest run tests/names.test.ts && npx tsc --noEmit`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/names.ts tests/names.test.ts
git commit -m "feat(names): the name rule, hash helpers, resolve and register"
```

---

### Task 10: `#learn-russian` boots the viewer

**Files:**
- Modify: `src/entry.ts` (whole file), `src/viewer.ts` (add `runNamed`)
- Create: `tests/names-entry.test.ts`

**Interfaces:**
- Produces: `export async function runNamed(hash: string): Promise<void>` in `src/viewer.ts`; `entry.ts` routes name hashes to it.
- Consumes: `isNameHash`, `nameInHash`, `ghHashFor`, `resolveName` (Task 9), `DEFAULT_ENROLL_API` (Task 1), `parseViewerHash`/`runViewer`.

- [ ] **Step 1: Write the failing source-text test**

`tests/names-entry.test.ts`:
```ts
import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

const entry = readFileSync(new URL("../src/entry.ts", import.meta.url), "utf8");
const viewer = readFileSync(new URL("../src/viewer.ts", import.meta.url), "utf8").replace(/^\s*\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");

describe("entry routes names", () => {
  test("gh/gdoc/gdrive first, then names, then the app", () => {
    const gh = entry.indexOf("(gdoc|gh|gdrive)[=-]");
    const named = entry.indexOf("isNameHash(hash)");
    const app = entry.indexOf('import("./main")');
    expect(gh).toBeGreaterThan(0);
    expect(named).toBeGreaterThan(gh);
    expect(app).toBeGreaterThan(named);
    expect(entry).toMatch(/runNamed\(hash\)/);
  });
});

describe("runNamed", () => {
  test("resolves against the registry, redirects courses, plays casts through parseViewerHash", () => {
    expect(viewer).toMatch(/export async function runNamed\(hash: string\)/);
    expect(viewer).toMatch(/resolveName\(DEFAULT_ENROLL_API, name\)/);
    expect(viewer).toMatch(/kind === "course"/);
    expect(viewer).toMatch(/location\.replace\(/);
    expect(viewer).toMatch(/parseViewerHash\(ghHashFor\(hash, resolved\.target\)\)/);
    expect(viewer).toMatch(/No drawcast called/);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/names-entry.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

`src/entry.ts` becomes:
```ts
// Entry router: #gdoc=<google-doc-id>, #gdrive=<google-drive-file-id>, or
// #gh=<owner>/<repo>/<path> boots the standalone share viewer (a single
// player, no editor/AI); a bare #<name> (spec §7) resolves the name first
// and then boots the same viewer; anything else loads the two-mode app.
// Code-split so shared-link viewers never download the editor or the Anthropic SDK.

import { isNameHash } from "./names";

const hash = location.hash;
if (/[#&](gdoc|gh|gdrive)[=-]/.test(hash)) {
  void import("./viewer").then(({ parseViewerHash, runViewer }) => {
    const req = parseViewerHash(hash);
    if (req) void runViewer(req);
  });
} else if (isNameHash(hash)) {
  void import("./viewer").then(({ runNamed }) => runNamed(hash));
} else {
  void import("./main");
}

// Entering/leaving a share view requires a reload (the app builds eagerly).
window.addEventListener("hashchange", () => location.reload());

export {};
```

In `src/viewer.ts` add the imports `import { ghHashFor, nameInHash, resolveName } from "./names";` and `DEFAULT_ENROLL_API` to the `./learn` import, then the function:
```ts
/**
 * A named link (spec §7): ask the registry what the name points at, then
 * carry on exactly as if the target had been in the hash. The address bar
 * keeps the name — replaceState would not fire hashchange, but there is
 * nothing to gain from rewriting it either.
 */
export async function runNamed(hash: string): Promise<void> {
  const name = nameInHash(hash);
  const status = h("p", { class: "viewer-status" }, "Looking up the name…");
  document.body.append(status);
  const resolved = name ? await resolveName(DEFAULT_ENROLL_API, name) : null;
  if (!resolved) {
    status.textContent = `No drawcast called "${name ?? hash}".`;
    status.classList.add("error");
    return;
  }
  if (resolved.kind === "course") {
    if (resolved.page) location.replace(resolved.page);
    else status.textContent = "This course has no page to open.";
    return;
  }
  status.remove();
  const req = parseViewerHash(ghHashFor(hash, resolved.target));
  if (req) await runViewer(req);
}
```
(If `runViewer` builds its own status element with a class other than `viewer-status`, use that class so the look matches.)

- [ ] **Step 4: Verify**

Run: `npx vitest run tests/names-entry.test.ts && npx tsc --noEmit && npx vitest run && npm run build`
Expected: all pass. Check `dist/` still splits the viewer from the app (`ls dist/assets` shows separate chunks, as before).

- [ ] **Step 5: Commit**

```bash
git add src/entry.ts src/viewer.ts tests/names-entry.test.ts
git commit -m "feat(names): #<name> resolves through the registry and boots the viewer"
```

---

### Task 11: author key + registration after publish + spec touch-up

**Files:**
- Modify: `src/store.ts:15-30` (KEYS), `:278-283` (SETTINGS_TABS), `:298-305` (accessors); `src/main.ts:1607-1610` and `:1752-1757` (settings input), `:4085-4106` (publishDrawcast); `src/ui/course.ts:897-925` (after publishCourse); `src/course/publish.ts` (one helper); `docs/superpowers/specs/2026-09-04-learners-design.md` §5, §7
- Create: `tests/names-register.test.ts`

**Interfaces:**
- Produces: `getAuthorKey(): string`, `setAuthorKey(key: string): void` in `src/store.ts`; `courseRegistration(course: Course, repo, coursesDir, pageUrl): Registration | null` in `src/course/publish.ts` (null when the course has no slug); `castRegistration(slug, repo, castsDir, page): Registration` in `src/publish/cast.ts`. Both omit `key`; the caller adds it.

- [ ] **Step 1: Write the failing tests**

`tests/names-register.test.ts`:
```ts
import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { parseCourse } from "../src/course/document";
import { courseRegistration } from "../src/course/publish";
import { castRegistration } from "../src/publish/cast";
import { SETTINGS_TABS } from "../src/store";

const REPO = { owner: "hmelberg", repo: "dcast" };

describe("registrations", () => {
  test("a course registers under name: when set, else under its slug, with page, title and lecture keys", () => {
    const c = parseCourse("# Learn Russian\nslug: russian\nname: learn-russian\n\n## A\nq\nstatus: done · file: 01-a.yaml\n\n## B\nq\n");
    expect(courseRegistration(c, REPO, "", "https://hmelberg.github.io/dcast/russian/")).toEqual({
      name: "learn-russian", kind: "course", target: "hmelberg/dcast/russian", page: "https://hmelberg.github.io/dcast/russian/", title: "Learn Russian", lectures: ["hmelberg/dcast/russian/01-a.yaml"],
    });
    const plain = parseCourse("# T\nslug: t\n\n## A\nq\n");
    expect(courseRegistration(plain, REPO, "courses", "https://h/x/")?.name).toBe("t");
    expect(courseRegistration(plain, REPO, "courses", "https://h/x/")?.target).toBe("hmelberg/dcast/courses/t");
    expect(courseRegistration(parseCourse("# No slug yet\n"), REPO, "", "https://h/")).toBeNull();
  });
  test("a cast registers under its slug", () => {
    expect(castRegistration("did", REPO, "casts", "https://hmelberg.github.io/dcast/casts/")).toEqual({
      name: "did", kind: "cast", target: "hmelberg/dcast/casts/did.yaml", page: "https://hmelberg.github.io/dcast/casts/",
    });
  });
});

describe("the author key lives beside the GitHub token", () => {
  test("settings tab", () => {
    expect(SETTINGS_TABS.find((t) => t.id === "publishing")!.fields).toContain("authorKey");
  });
  test("both publishers register after the commit landed, with the key, and report the outcome", () => {
    const main = readFileSync(new URL("../src/main.ts", import.meta.url), "utf8");
    const course = readFileSync(new URL("../src/ui/course.ts", import.meta.url), "utf8");
    for (const src of [main, course]) {
      expect(src).toMatch(/getAuthorKey\(\)/);
      expect(src).toMatch(/registerName\(DEFAULT_ENROLL_API,/);
      expect(src).toMatch(/nameNote\(/);
    }
    expect(main.indexOf("registerName(")).toBeGreaterThan(main.indexOf("await publishCast("));
    expect(course.indexOf("registerName(")).toBeGreaterThan(course.indexOf("await publishCourse("));
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/names-register.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

`src/store.ts`: add `authorKey: "drawcast.authorkey",` to `KEYS` after `githubToken`; add `"authorKey"` after `"githubToken"` in the publishing tab's `fields`; add after `setGithubToken`:
```ts
/**
 * The author key from the drawcast Anvil dashboard (spec §7): lets a publish
 * register its name in the drawcast.app registry. Same shape as the GitHub
 * token — a personal credential, never a shared one.
 */
export function getAuthorKey(): string {
  return localStorage.getItem(KEYS.authorKey) ?? "";
}

export function setAuthorKey(key: string): void {
  if (key) localStorage.setItem(KEYS.authorKey, key);
  else localStorage.removeItem(KEYS.authorKey);
}
```

`src/course/publish.ts`: add (exported)
```ts
import type { Registration } from "../names";

/** What a course publish registers (spec §7): `name:` if set, else the slug. */
export function courseRegistration(course: Course, repo: { owner: string; repo: string }, coursesDir: string, pageUrl: string): Omit<Registration, "key"> | null {
  const slug = course.context.slug;
  if (!slug) return null;
  return {
    name: course.name ?? slug,
    kind: "course",
    target: courseKeyFor(repo, joinPath(coursesDir, slug)),
    page: pageUrl,
    title: course.title,
    lectures: lectureCastKeys(course, repo, coursesDir),
  };
}
```
`src/publish/cast.ts`: add (exported)
```ts
import type { Registration } from "../names";

export function castRegistration(slug: string, repo: RepoRef, castsDir: string, page: string): Omit<Registration, "key"> {
  return { name: slug, kind: "cast", target: `${repo.owner}/${repo.repo}/${joinPath(castsDir, `${slug}.yaml`)}`, page };
}
```
`src/names.ts`: add the one-line note helper both publishers use:
```ts
/** The status suffix after a publish (spec §7). */
export function nameNote(outcome: "ok" | "taken" | "key" | "invalid" | "error", name: string): string {
  switch (outcome) {
    case "ok": return ` · also at https://drawcast.app/#${name}`;
    case "taken": return ` · the name "${name}" is taken by someone else (set name: in the document to pick another)`;
    case "key": return " · name not registered: the author key was rejected (Settings → Publishing)";
    case "invalid": return ` · "${name}" is not a valid name`;
    default: return " · name not registered (registry unreachable)";
  }
}
```

`src/main.ts`: beside `githubTokenInput` (line 1607) add
```ts
const authorKeyInput = h("input", { type: "password", placeholder: "from the drawcast Anvil dashboard", autocomplete: "off" }) as HTMLInputElement;
authorKeyInput.value = getAuthorKey();
authorKeyInput.addEventListener("change", () => {
  setAuthorKey(authorKeyInput.value.trim());
});
```
and where the settings dialog lists `"githubToken"` with `githubTokenInput` (lines 1752/1757) add the sibling entry `"authorKey"` / `authorKeyInput` with the label `Author key` and the help line "Registers drawcast.app/#<name> links when you publish. Optional." Import `getAuthorKey, setAuthorKey` from `./store`, `registerName, nameNote, DEFAULT_ENROLL_API` — `DEFAULT_ENROLL_API` from `./learn`, the others from `./names` — and `castRegistration` from `./publish/cast`. In `publishDrawcast`, after `doc.publishedViews = countViews !== false;` (line 4100) add:
```ts
    let note = "";
    const authorKey = getAuthorKey();
    if (authorKey) {
      const reg = castRegistration(out.slug, repo, joinPath(settings.coursesDir, "casts"), out.pagesUrl);
      note = nameNote(await registerName(DEFAULT_ENROLL_API, { key: authorKey, ...reg }), reg.name);
    }
```
and append `${note}` to the success status string on line 4106.

`src/ui/course.ts`: after `published.add(settings.githubRepo);` (the line following `firstTime`) add:
```ts
      let nameSuffix = "";
      const authorKey = getAuthorKey();
      const reg = authorKey ? courseRegistration(parseCourse(out.text), repo, settings.coursesDir, out.courseUrl) : null;
      if (authorKey && reg) nameSuffix = nameNote(await registerName(DEFAULT_ENROLL_API, { key: authorKey, ...reg }), reg.name);
```
and append `${nameSuffix}` to the success message that names `out.courseUrl` further down. Add the imports (`getAuthorKey` from `../store`, `registerName, nameNote` from `../names`, `DEFAULT_ENROLL_API` from `../learn`, `courseRegistration` from `../course/publish`, `parseCourse` from `../course/document` if not already imported).

Spec touch-up (`docs/superpowers/specs/2026-09-04-learners-design.md`): in §5 replace "the More menu gets one entry" with "the control bar gets one trailing 🎓 button (the `trailing` extension point)"; in §7 "Where the name is chosen" add: "The name defaults to the publish slug (`course.context.slug`, or the cast's slug); `name:` in the course document overrides it. Registration needs the author key in Settings → Publishing; without one, publishing simply skips names."

- [ ] **Step 4: Verify**

Run: `npx vitest run tests/names-register.test.ts && npx tsc --noEmit && npx vitest run && npm run build`
Expected: all pass. Then by hand: paste an author key from the Anvil dashboard into Settings → Publishing, publish a cast, and confirm the status ends with `also at https://drawcast.app/#<slug>` and that the link plays.

- [ ] **Step 5: Commit**

```bash
git add src/store.ts src/main.ts src/ui/course.ts src/course/publish.ts src/publish/cast.ts src/names.ts docs/superpowers/specs/2026-09-04-learners-design.md tests/names-register.test.ts
git commit -m "feat(names): author key setting, registration after publish, spec touch-up"
```
