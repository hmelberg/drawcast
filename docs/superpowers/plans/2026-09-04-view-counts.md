# View counts implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Count how often each published drawcast and course lecture is played, show the number in the player, and let the author read every count for a repo from a public JSON URL.

**Architecture:** The player already runs on origins we own (`drawcast.app`, `hmelberg.github.io`) while published files are inert YAML in the author's repo, so counting happens in the viewer, keyed by the content path `owner/repo/path.yaml`. Each view writes one empty Netlify Blob — writes never read, so concurrent views cannot lose hits — and totals are derived by counting keys, with past days folded into a per-cast rollup so reads stay bounded. Counting is a publish-time flag (`meta.views`) carried in the published file; off means the client never calls.

**Tech Stack:** TypeScript, Vitest (`environment: "node"`, no jsdom), Netlify Functions (`.mts`), `@netlify/blobs` v11.

**Spec:** `docs/superpowers/specs/2026-09-04-view-counts-design.md`

## Global Constraints

- **No new dependencies.** `@netlify/blobs` is already in `dependencies`.
- **`npm test` must stay green** — it gates the Netlify build (`netlify.toml` runs `npm test && npm run build`).
- **Tests run in node with no DOM.** `h()` from `src/ui/dom.ts` throws `ReferenceError: document is not defined` outside a browser. Every piece of logic worth testing must be a pure export that takes its dependencies as parameters; DOM wiring is verified by source-text assertion (`tests/viewer-packs.test.ts` is the model) or in a browser.
- **Dependency injection is the house pattern for anything touching Blobs or the network** — see `netlify/lib/rate-limit.mts` (`LimiterOptions.store`) and `src/keys.ts` (`endpoints`, `fetchImpl`). Follow it so every task is testable without Netlify or a network.
- **Blobs consistency:** `get` supports `{ consistency: "strong" }`; **`list` does not** — listing is always eventually consistent. Never assume a just-written key appears in the next list.
- **Cast key charset:** `owner/repo/path`, where path matches the viewer's own `DOC_PATH_RE` (`src/viewer.ts:97`): no `..`, and an extension of `.yaml`, `.yml`, `.json` or `.txt`. Publishing always writes `.yaml`, but the viewer accepts all four, and a key the viewer can reach must be a key the counter accepts.
- **Comments explain why, not what** — match the surrounding files, which document the reasoning and the bugs that motivated it.
- **Commit after every task** with a conventional-commit subject.

---

## File structure

| File | Responsibility |
|---|---|
| `netlify/lib/view-key.mts` (new) | Pure key algebra: validate a cast key, encode it into one Blobs path segment, build and parse hit/rollup keys. No I/O. |
| `netlify/lib/view-store.mts` (new) | Recording and counting against an injected store: `recordHit`, `countCast`, `countRepo`, compaction. No HTTP. |
| `netlify/functions/views.mts` (new) | HTTP only: CORS, method/route dispatch, request parsing, JSON responses. Delegates to the two libs. |
| `src/views.ts` (new) | Client: endpoint list, session dedupe, `recordView`/`readViewCount`, and the `meta.views` reading. |
| `src/viewer.ts` (modify) | One call site after the playlist parses; a `.viewer-meta` row under the figure holding the badge. |
| `src/playlist/playlist.ts` (modify) | `views?: boolean` on `PlaylistMeta`. |
| `src/styles.css` (modify) | `.viewer-meta` and `.viewer-views`. |

Library code lives in `netlify/lib/` rather than `netlify/functions/` **on purpose**: every module in the functions directory is published as its own public endpoint (`netlify/lib/rate-limit.mts:3-4`).

---

## Task 1: Key algebra

**Files:**
- Create: `netlify/lib/view-key.mts`
- Test: `tests/view-key.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `isValidCastKey(key: string): boolean`, `encodeCastKey(key: string): string`, `hitPrefix(enc: string): string`, `hitKey(enc: string, day: string, id: string): string`, `rollupKey(enc: string): string`, `repoHitPrefix(owner: string, repo: string): string`, `repoRollupPrefix(owner: string, repo: string): string`, `castKeyOfRollup(blobKey: string): string`, `dayOfHitKey(blobKey: string): string | null`, `castKeyOfHitKey(blobKey: string): string | null`, `dayString(ms: number): string`, `courseFolderOf(castKey: string): string`.

- [ ] **Step 1: Write the failing test**

Create `tests/view-key.test.ts`:

```ts
// Key algebra for view counting. Pure — no Blobs, no network.
import { describe, expect, test } from "vitest";
import {
  castKeyOfHitKey,
  castKeyOfRollup,
  courseFolderOf,
  dayOfHitKey,
  dayString,
  encodeCastKey,
  hitKey,
  hitPrefix,
  isValidCastKey,
  repoHitPrefix,
  repoRollupPrefix,
  rollupKey,
} from "../netlify/lib/view-key.mts";

describe("isValidCastKey", () => {
  test("accepts what the viewer itself can open", () => {
    expect(isValidCastKey("hmelberg/kurs/casts/did.yaml")).toBe(true);
    expect(isValidCastKey("hmelberg/kurs/courses/causal/did.yml")).toBe(true);
    expect(isValidCastKey("h-m.b/re-po.x/a/b/c.json")).toBe(true);
    expect(isValidCastKey("hmelberg/kurs/notes.txt")).toBe(true);
  });

  test("rejects traversal, wrong extensions and short paths", () => {
    expect(isValidCastKey("hmelberg/kurs/../secrets.yaml")).toBe(false);
    expect(isValidCastKey("hmelberg/kurs/did.exe")).toBe(false);
    expect(isValidCastKey("hmelberg/did.yaml")).toBe(false);
    expect(isValidCastKey("/hmelberg/kurs/did.yaml")).toBe(false);
    expect(isValidCastKey("")).toBe(false);
  });

  test("rejects a key long enough to threaten the 600-byte Blobs key limit", () => {
    expect(isValidCastKey(`a/b/${"x".repeat(400)}.yaml`)).toBe(false);
  });

  test("rejects characters that would change meaning once encoded", () => {
    expect(isValidCastKey("hmelberg/kurs/a b.yaml")).toBe(false);
    expect(isValidCastKey("hmelberg/kurs/a%2Fb.yaml")).toBe(false);
  });
});

describe("blob key construction", () => {
  const key = "hmelberg/kurs/casts/did.yaml";
  const enc = "hmelberg%2Fkurs%2Fcasts%2Fdid.yaml";

  test("a cast key becomes exactly one path segment", () => {
    expect(encodeCastKey(key)).toBe(enc);
    expect(encodeCastKey(key)).not.toContain("/");
  });

  test("hit and rollup keys are built from the encoded segment", () => {
    expect(hitPrefix(enc)).toBe(`h/${enc}/`);
    expect(hitKey(enc, "2026-09-04", "abc")).toBe(`h/${enc}/2026-09-04/abc`);
    expect(rollupKey(enc)).toBe(`r/${enc}`);
  });

  test("a repo prefix matches every cast in that repo and nothing else", () => {
    expect(hitKey(enc, "2026-09-04", "abc").startsWith(repoHitPrefix("hmelberg", "kurs"))).toBe(true);
    expect(rollupKey(enc).startsWith(repoRollupPrefix("hmelberg", "kurs"))).toBe(true);
    expect(hitKey(enc, "2026-09-04", "abc").startsWith(repoHitPrefix("hmelberg", "kur"))).toBe(false);
  });

  test("keys parse back into a cast key and a day", () => {
    expect(castKeyOfHitKey(`h/${enc}/2026-09-04/abc`)).toBe(key);
    expect(dayOfHitKey(`h/${enc}/2026-09-04/abc`)).toBe("2026-09-04");
    expect(castKeyOfRollup(`r/${enc}`)).toBe(key);
    expect(dayOfHitKey("h/nonsense")).toBeNull();
  });
});

describe("dayString", () => {
  test("is UTC, so a day means the same thing everywhere", () => {
    expect(dayString(Date.UTC(2026, 8, 4, 23, 30))).toBe("2026-09-04");
    expect(dayString(Date.UTC(2026, 8, 5, 0, 30))).toBe("2026-09-05");
  });

  test("sorts chronologically as a string, which compaction relies on", () => {
    expect(dayString(Date.UTC(2026, 8, 4)) < dayString(Date.UTC(2026, 8, 5))).toBe(true);
  });
});

describe("courseFolderOf", () => {
  test("groups lectures by the folder the course publishes into", () => {
    expect(courseFolderOf("hmelberg/kurs/courses/causal/did.yaml")).toBe("courses/causal");
    expect(courseFolderOf("hmelberg/kurs/casts/did.yaml")).toBe("casts");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/view-key.test.ts`
Expected: FAIL — `Failed to resolve import "../netlify/lib/view-key.mts"`.

- [ ] **Step 3: Write the implementation**

Create `netlify/lib/view-key.mts`:

```mts
// Key algebra for view counting. Pure: no Blobs, no network, no dates beyond
// formatting — so every rule here is testable without a platform.
//
// Layout, with <enc> = the cast key percent-encoded into ONE path segment:
//   h/<enc>/<YYYY-MM-DD>/<uuid>   one recorded view, empty body
//   r/<enc>                        rollup: {"2026-09-01": 12, …}
//
// One segment matters: it makes "every cast in this repo" a plain string
// prefix, because encodeURIComponent touches only "/" in a legal cast key.

/**
 * The path half must match what the VIEWER will open — `DOC_PATH_RE` in
 * src/viewer.ts. A key the viewer can reach but the counter rejects would be
 * a drawcast that silently never counts, which is worse than a loud 400.
 */
const CAST_KEY_RE = /^[\w.-]+\/[\w.-]+\/(?!.*\.\.)[\w./-]+\.(ya?ml|json|txt)$/;

/** Netlify caps Blobs keys at 600 bytes; a real key is nearer 100 because
 *  slugs are capped at 40 chars (src/publish/github.ts). 300 leaves room for
 *  the prefix, date and uuid without letting anyone bloat the store. */
const MAX_CAST_KEY_BYTES = 300;

export function isValidCastKey(key: string): boolean {
  if (!key || key.length > MAX_CAST_KEY_BYTES) return false;
  return CAST_KEY_RE.test(key);
}

export function encodeCastKey(key: string): string {
  return encodeURIComponent(key);
}

export function hitPrefix(enc: string): string {
  return `h/${enc}/`;
}

export function hitKey(enc: string, day: string, id: string): string {
  return `h/${enc}/${day}/${id}`;
}

export function rollupKey(enc: string): string {
  return `r/${enc}`;
}

export function repoHitPrefix(owner: string, repo: string): string {
  return `h/${encodeURIComponent(`${owner}/${repo}/`)}`;
}

export function repoRollupPrefix(owner: string, repo: string): string {
  return `r/${encodeURIComponent(`${owner}/${repo}/`)}`;
}

export function castKeyOfRollup(blobKey: string): string {
  return decodeURIComponent(blobKey.slice("r/".length));
}

/** `h/<enc>/<day>/<id>` → the cast key, or null if the shape is wrong. */
export function castKeyOfHitKey(blobKey: string): string | null {
  const parts = blobKey.split("/");
  if (parts.length !== 4 || parts[0] !== "h") return null;
  return decodeURIComponent(parts[1]);
}

export function dayOfHitKey(blobKey: string): string | null {
  const parts = blobKey.split("/");
  if (parts.length !== 4 || parts[0] !== "h") return null;
  return /^\d{4}-\d{2}-\d{2}$/.test(parts[2]) ? parts[2] : null;
}

/** UTC, so "today" is one thing worldwide, and ISO so string order is date
 *  order — compaction compares days with `<`. */
export function dayString(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** The folder a cast publishes into: the course slug for a lecture, `casts`
 *  for a single drawcast. Per-course totals are just this grouping. */
export function courseFolderOf(castKey: string): string {
  const parts = castKey.split("/").slice(2);
  parts.pop();
  return parts.join("/");
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/view-key.test.ts`
Expected: PASS, 9 tests.

- [ ] **Step 5: Commit**

```bash
git add netlify/lib/view-key.mts tests/view-key.test.ts
git commit -m "feat(views): key algebra for view counting"
```

---

## Task 2: Recording and counting

**Files:**
- Create: `netlify/lib/view-store.mts`
- Test: `tests/view-store.test.ts`

**Interfaces:**
- Consumes: everything Task 1 produces.
- Produces:
  - `interface ViewStore { get(key, opts): Promise<unknown>; set(key, value): Promise<unknown>; setJSON(key, value): Promise<unknown>; list(opts): Promise<{ blobs: { key: string }[] }>; delete(key): Promise<unknown> }`
  - `interface ViewOptions { store?: () => ViewStore; now?: () => number; uuid?: () => string; deleteBudget?: number }`
  - `recordHit(castKey: string, o?: ViewOptions): Promise<string>` — returns the blob key it wrote
  - `countCast(castKey: string, o?: ViewOptions & { assumeHit?: string }): Promise<{ total: number; days: Record<string, number> }>`
  - `recordAndCount(castKey: string, o?: ViewOptions): Promise<number>`
  - `countRepo(owner: string, repo: string, o?: ViewOptions): Promise<{ casts: { key: string; total: number; days: Record<string, number> }[]; courses: Record<string, number> }>`
  - `defaultStore(): ViewStore`

**Why counting works the way it does** (implement exactly this rule): a day present in the rollup is counted **from the rollup only**, and its raw keys are ignored. That is what makes compaction safe to interrupt — deletes can be half-finished, or duplicated by a concurrent request, without the total moving.

- [ ] **Step 1: Write the failing test**

Create `tests/view-store.test.ts`:

```ts
// Recording and counting views. Driven entirely through an injected fake
// store, the same way tests/rate-limit.test.ts drives the failure budget.
import { describe, expect, test, vi } from "vitest";
import { countCast, countRepo, defaultStore, recordAndCount, recordHit, type ViewStore } from "../netlify/lib/view-store.mts";
import { getStore } from "@netlify/blobs";

vi.mock("@netlify/blobs", () => ({ getStore: vi.fn(() => ({})) }));

function fakeStore() {
  const data = new Map<string, unknown>();
  const store: ViewStore = {
    get: async (key) => (data.has(key) ? data.get(key) : null),
    set: async (key, value) => { data.set(key, value); },
    setJSON: async (key, value) => { data.set(key, value); },
    list: async ({ prefix }) => ({ blobs: [...data.keys()].filter((k) => k.startsWith(prefix)).map((key) => ({ key })) }),
    delete: async (key) => { data.delete(key); },
  };
  return { store: () => store, data };
}

const KEY = "hmelberg/kurs/casts/did.yaml";
const DAY2 = Date.UTC(2026, 8, 4, 12);
const DAY3 = Date.UTC(2026, 8, 5, 12);

function opts(store: () => ViewStore, ms: number, seq = { n: 0 }) {
  return { store, now: () => ms, uuid: () => `id${seq.n++}` };
}

describe("recordHit", () => {
  test("writes one key per view and never reads first", async () => {
    const { store, data } = fakeStore();
    const seq = { n: 0 };
    await recordHit(KEY, opts(store, DAY2, seq));
    await recordHit(KEY, opts(store, DAY2, seq));
    expect([...data.keys()]).toEqual([
      "h/hmelberg%2Fkurs%2Fcasts%2Fdid.yaml/2026-09-04/id0",
      "h/hmelberg%2Fkurs%2Fcasts%2Fdid.yaml/2026-09-04/id1",
    ]);
  });

  test("an invalid key is refused rather than written", async () => {
    const { store, data } = fakeStore();
    await expect(recordHit("nope", opts(store, DAY2))).rejects.toThrow();
    expect(data.size).toBe(0);
  });
});

describe("recordAndCount", () => {
  test("counts the hit it just wrote, even when the listing has not caught up", async () => {
    // Blobs `list` is eventually consistent and offers no strong option, so
    // this is the normal case moments after a write — not an exotic one.
    const { store } = fakeStore();
    const blind: ViewStore = { ...store(), list: async () => ({ blobs: [] }) };
    expect(await recordAndCount(KEY, { store: () => blind, now: () => DAY2, uuid: () => "id0" })).toBe(1);
  });

  test("does not double-count once the listing does catch up", async () => {
    const { store } = fakeStore();
    expect(await recordAndCount(KEY, opts(store, DAY2))).toBe(1);
    expect(await recordAndCount(KEY, opts(store, DAY2, { n: 1 }))).toBe(2);
  });
});

describe("countCast", () => {
  test("counts raw hits before anything has been compacted", async () => {
    const { store } = fakeStore();
    const seq = { n: 0 };
    for (let i = 0; i < 3; i++) await recordHit(KEY, opts(store, DAY2, seq));
    const res = await countCast(KEY, opts(store, DAY2, seq));
    expect(res.total).toBe(3);
    expect(res.days).toEqual({ "2026-09-04": 3 });
  });

  test("a past day is rolled up on the next read, and today is left alone", async () => {
    const { store, data } = fakeStore();
    const seq = { n: 0 };
    for (let i = 0; i < 3; i++) await recordHit(KEY, opts(store, DAY2, seq));
    await recordHit(KEY, opts(store, DAY3, seq));

    const first = await countCast(KEY, opts(store, DAY3, seq));
    expect(first.total).toBe(4);
    expect(data.get("r/hmelberg%2Fkurs%2Fcasts%2Fdid.yaml")).toEqual({ "2026-09-04": 3 });
    // Yesterday's raw keys survive this pass; today's are untouched either way.
    expect([...data.keys()].filter((k) => k.includes("2026-09-04")).length).toBe(3);
    expect([...data.keys()].filter((k) => k.includes("2026-09-05")).length).toBe(1);

    // Second read deletes the rolled-up raws, and the total does not move.
    const second = await countCast(KEY, opts(store, DAY3, seq));
    expect(second.total).toBe(4);
    expect([...data.keys()].filter((k) => k.includes("2026-09-04")).length).toBe(0);

    const third = await countCast(KEY, opts(store, DAY3, seq));
    expect(third.total).toBe(4);
    expect(third.days).toEqual({ "2026-09-04": 3, "2026-09-05": 1 });
  });

  test("a rolled-up day is counted from the rollup even while its raws linger", async () => {
    // Half-finished deletion — a delete budget ran out, or a concurrent
    // request is midway. The total must not double.
    const { store, data } = fakeStore();
    const seq = { n: 0 };
    for (let i = 0; i < 3; i++) await recordHit(KEY, opts(store, DAY2, seq));
    await countCast(KEY, { ...opts(store, DAY3, seq), deleteBudget: 0 });
    expect([...data.keys()].filter((k) => k.includes("2026-09-04")).length).toBe(3);
    expect((await countCast(KEY, { ...opts(store, DAY3, seq), deleteBudget: 0 })).total).toBe(3);
  });

  test("an unseen cast is zero, not an error", async () => {
    const { store } = fakeStore();
    expect((await countCast(KEY, opts(store, DAY2))).total).toBe(0);
  });
});

describe("countRepo", () => {
  test("totals every cast and groups them by publish folder", async () => {
    const { store } = fakeStore();
    const seq = { n: 0 };
    const lecture = "hmelberg/kurs/courses/causal/did.yaml";
    const other = "hmelberg/kurs/courses/causal/rdd.yaml";
    await recordHit(KEY, opts(store, DAY2, seq));
    for (let i = 0; i < 2; i++) await recordHit(lecture, opts(store, DAY2, seq));
    await recordHit(other, opts(store, DAY2, seq));

    const res = await countRepo("hmelberg", "kurs", opts(store, DAY2, seq));
    expect(res.casts.map((c) => [c.key, c.total])).toEqual([
      [KEY, 1],
      [lecture, 2],
      [other, 1],
    ]);
    expect(res.courses).toEqual({ casts: 1, "courses/causal": 3 });
  });

  test("another repo's counts are not visible", async () => {
    const { store } = fakeStore();
    await recordHit(KEY, opts(store, DAY2));
    const res = await countRepo("someone", "else", opts(store, DAY2));
    expect(res.casts).toEqual([]);
    expect(res.courses).toEqual({});
  });

  test("rolled-up casts with no raw hits left still appear", async () => {
    const { store } = fakeStore();
    const seq = { n: 0 };
    for (let i = 0; i < 2; i++) await recordHit(KEY, opts(store, DAY2, seq));
    await countCast(KEY, opts(store, DAY3, seq));
    await countCast(KEY, opts(store, DAY3, seq)); // deletes the raws
    const res = await countRepo("hmelberg", "kurs", opts(store, DAY3, seq));
    expect(res.casts).toEqual([{ key: KEY, total: 2, days: { "2026-09-04": 2 } }]);
  });
});

describe("the live store", () => {
  test("is read with strong consistency, since a stale rollup would lose views", () => {
    defaultStore();
    expect(getStore).toHaveBeenCalledWith({ name: "views", consistency: "strong" });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/view-store.test.ts`
Expected: FAIL — `Failed to resolve import "../netlify/lib/view-store.mts"`.

- [ ] **Step 3: Write the implementation**

Create `netlify/lib/view-store.mts`:

```mts
// View counting on Netlify Blobs.
//
// Blobs has no compare-and-set (see netlify/lib/rate-limit.mts), so a
// read-modify-write counter loses hits exactly when they arrive together —
// a class opening a lecture at the same moment. Every view is therefore its
// own key and totals are derived by counting keys: the write path never
// reads, so nothing can be lost.
//
// Reads would then grow with lifetime views, which is what compaction fixes:
// a day that is over gets folded into one rollup number and its raw keys are
// deleted, so a read only ever lists today.
import { getStore } from "@netlify/blobs";
import {
  castKeyOfHitKey,
  castKeyOfRollup,
  courseFolderOf,
  dayOfHitKey,
  dayString,
  encodeCastKey,
  hitKey,
  hitPrefix,
  isValidCastKey,
  repoHitPrefix,
  repoRollupPrefix,
  rollupKey,
} from "./view-key.mts";

const STORE_NAME = "views";

/** The slice of the Blobs API this needs — swapped for a fake in tests. */
export interface ViewStore {
  get(key: string, opts: { type: "json"; consistency: "strong" }): Promise<unknown>;
  set(key: string, value: string): Promise<unknown>;
  setJSON(key: string, value: unknown): Promise<unknown>;
  list(opts: { prefix: string }): Promise<{ blobs: { key: string }[] }>;
  delete(key: string): Promise<unknown>;
}

export interface ViewOptions {
  store?: () => ViewStore;
  now?: () => number;
  uuid?: () => string;
  /** Deletes attempted per compaction pass; the rest wait for the next read. */
  deleteBudget?: number;
}

export interface CastCount {
  total: number;
  days: Record<string, number>;
}

const DEFAULT_DELETE_BUDGET = 500;

/**
 * Strong consistency is load-bearing: compaction writes a rollup and then
 * deletes the raw keys it replaces, so a stale rollup read next to
 * already-deleted raws would silently lose those views. (`list` has no
 * consistency option at all — only `get` does — which is why the counting
 * rule below never trusts a listing to be complete.)
 */
export function defaultStore(): ViewStore {
  return getStore({ name: STORE_NAME, consistency: "strong" }) as unknown as ViewStore;
}

function settings(o: ViewOptions) {
  return {
    store: o.store ?? defaultStore,
    now: o.now ?? Date.now,
    uuid: o.uuid ?? (() => crypto.randomUUID()),
    deleteBudget: o.deleteBudget ?? DEFAULT_DELETE_BUDGET,
  };
}

/**
 * Record one view; returns the key written. No read first, so concurrent
 * views cannot overwrite each other.
 */
export async function recordHit(castKey: string, o: ViewOptions = {}): Promise<string> {
  if (!isValidCastKey(castKey)) throw new Error("invalid cast key");
  const { store, now, uuid } = settings(o);
  const enc = encodeCastKey(castKey);
  const key = hitKey(enc, dayString(now()), uuid());
  await store().set(key, "");
  return key;
}

async function readRollup(store: ViewStore, enc: string): Promise<Record<string, number>> {
  const raw = (await store.get(rollupKey(enc), { type: "json", consistency: "strong" })) as Record<string, number> | null;
  if (!raw || typeof raw !== "object") return {};
  const out: Record<string, number> = {};
  for (const [day, n] of Object.entries(raw)) if (typeof n === "number") out[day] = n;
  return out;
}

/** Raw hit keys for one cast, grouped by day. */
function groupByDay(blobs: { key: string }[]): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const b of blobs) {
    const day = dayOfHitKey(b.key);
    if (day) (out[day] ??= []).push(b.key);
  }
  return out;
}

/**
 * THE COUNTING RULE: a day present in the rollup is counted from the rollup
 * and its raw keys are ignored entirely.
 *
 * That is what makes compaction safe to interrupt. Deletes can be
 * half-finished (budget ran out) or duplicated (two readers compacting at
 * once) and the total never moves. The cost is a hit that lands for a day
 * already rolled up — only possible within moments of UTC midnight — which is
 * dropped rather than counted twice.
 */
function mergeDays(rollup: Record<string, number>, raw: Record<string, string[]>): Record<string, number> {
  const days: Record<string, number> = { ...rollup };
  for (const [day, keys] of Object.entries(raw)) if (days[day] === undefined) days[day] = keys.length;
  return days;
}

function totalOf(days: Record<string, number>): number {
  return Object.values(days).reduce((a, b) => a + b, 0);
}

/**
 * Fold finished days into the rollup, then delete what the rollup now covers.
 *
 * Writing and deleting are deliberately separate passes over separate days: a
 * day is written to the rollup on one read and its raws are deleted on a
 * later one. Two readers racing therefore compute the same number from the
 * same complete listing, so they write the same value — the race is benign in
 * a way an increment never is.
 */
async function compact(
  store: ViewStore,
  enc: string,
  rollup: Record<string, number>,
  raw: Record<string, string[]>,
  today: string,
  deleteBudget: number,
): Promise<void> {
  const past = Object.keys(raw).filter((d) => d < today);
  const fresh = past.filter((d) => rollup[d] === undefined);
  if (fresh.length > 0) {
    const merged = { ...rollup };
    for (const d of fresh) merged[d] = raw[d].length;
    await store.setJSON(rollupKey(enc), merged);
    return; // Deleting waits for the next read, once the rollup is durable.
  }
  let budget = deleteBudget;
  for (const d of past) {
    for (const key of raw[d]) {
      if (budget-- <= 0) return;
      await store.delete(key);
    }
  }
}

export async function countCast(castKey: string, o: ViewOptions & { assumeHit?: string } = {}): Promise<CastCount> {
  if (!isValidCastKey(castKey)) throw new Error("invalid cast key");
  const { store, now, deleteBudget } = settings(o);
  const s = store();
  const enc = encodeCastKey(castKey);
  const rollup = await readRollup(s, enc);
  const listed = (await s.list({ prefix: hitPrefix(enc) })).blobs;
  const raw = groupByDay(listed);
  // `list` is eventually consistent and has no strong option, so a hit
  // written moments ago may be missing from it. Counting it anyway is what
  // keeps a badge from showing a number lower than the view that just
  // produced it.
  if (o.assumeHit && !listed.some((b) => b.key === o.assumeHit)) {
    const day = dayOfHitKey(o.assumeHit);
    if (day) (raw[day] ??= []).push(o.assumeHit);
  }
  const days = mergeDays(rollup, raw);
  await compact(s, enc, rollup, raw, dayString(now()), deleteBudget);
  return { total: totalOf(days), days };
}

/**
 * Record a view and answer with the resulting count — the one call the POST
 * path makes, so the write and the read agree about the hit just written.
 */
export async function recordAndCount(castKey: string, o: ViewOptions = {}): Promise<number> {
  const assumeHit = await recordHit(castKey, o);
  return (await countCast(castKey, { ...o, assumeHit })).total;
}

export interface RepoCounts {
  casts: { key: string; total: number; days: Record<string, number> }[];
  courses: Record<string, number>;
}

/**
 * Every cast in one repo. Read-only on purpose: compaction belongs to the
 * per-cast path, which runs on every view and therefore keeps the store tidy
 * without the dashboard ever writing. That also lets this response be cached.
 */
export async function countRepo(owner: string, repo: string, o: ViewOptions = {}): Promise<RepoCounts> {
  const { store } = settings(o);
  const s = store();
  const hits = (await s.list({ prefix: repoHitPrefix(owner, repo) })).blobs;
  const rollups = (await s.list({ prefix: repoRollupPrefix(owner, repo) })).blobs;

  const rawByCast = new Map<string, { key: string }[]>();
  for (const b of hits) {
    const castKey = castKeyOfHitKey(b.key);
    if (castKey) rawByCast.set(castKey, [...(rawByCast.get(castKey) ?? []), b]);
  }
  const castKeys = new Set([...rawByCast.keys(), ...rollups.map((b) => castKeyOfRollup(b.key))]);

  const casts: RepoCounts["casts"] = [];
  for (const castKey of [...castKeys].sort()) {
    const rollup = await readRollup(s, encodeCastKey(castKey));
    const days = mergeDays(rollup, groupByDay(rawByCast.get(castKey) ?? []));
    casts.push({ key: castKey, total: totalOf(days), days });
  }

  const courses: Record<string, number> = {};
  for (const c of casts) {
    const folder = courseFolderOf(c.key);
    courses[folder] = (courses[folder] ?? 0) + c.total;
  }
  return { casts, courses };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/view-store.test.ts`
Expected: PASS, 10 tests.

- [ ] **Step 5: Commit**

```bash
git add netlify/lib/view-store.mts tests/view-store.test.ts
git commit -m "feat(views): append-only recording, counting and compaction"
```

---

## Task 3: The endpoint

**Files:**
- Create: `netlify/functions/views.mts`
- Test: `tests/views-endpoint.test.ts`

**Interfaces:**
- Consumes: `recordAndCount`, `countCast`, `countRepo` from Task 2; `isValidCastKey` from Task 1.
- Produces: `handleViewsRequest(req: Request, deps: ViewsDeps): Promise<Response>` and `interface ViewsDeps { record(key: string): Promise<number>; readCast(key: string): Promise<CastCount>; readRepo(owner: string, repo: string): Promise<RepoCounts> }`.

`record` returns the count rather than void: the write and the read-back have to agree about the hit just written, and only `recordAndCount` knows its key.

**Wire format note:** the POST body is `text/plain` containing the cast key, not JSON. `text/plain` is CORS-safelisted, so a cross-origin POST from the GitHub Pages deploy is a simple request with **no preflight** — one round trip instead of two, on the path that runs for every view.

- [ ] **Step 1: Write the failing test**

Create `tests/views-endpoint.test.ts`:

```ts
// The view-counting endpoint. Storage is injected, so this suite is about
// HTTP: routing, CORS, validation, and the response shape.
import { describe, expect, test } from "vitest";
import { handleViewsRequest, type ViewsDeps } from "../netlify/functions/views.mts";

const KEY = "hmelberg/kurs/casts/did.yaml";

function deps(over: Partial<ViewsDeps> = {}): ViewsDeps & { recorded: string[] } {
  const recorded: string[] = [];
  return {
    recorded,
    record: async (key) => { recorded.push(key); return 7; },
    readCast: async () => ({ total: 7, days: { "2026-09-04": 7 } }),
    readRepo: async () => ({ casts: [{ key: KEY, total: 7, days: { "2026-09-04": 7 } }], courses: { casts: 7 } }),
    ...over,
  };
}

function post(body: string, origin = "https://drawcast.app") {
  return new Request("https://drawcast.app/.netlify/functions/views", {
    method: "POST",
    headers: { "content-type": "text/plain", origin },
    body,
  });
}

const get = (query: string, origin = "https://drawcast.app") =>
  new Request(`https://drawcast.app/.netlify/functions/views${query}`, { headers: { origin } });

describe("recording a view", () => {
  test("records the key and answers with the new count", async () => {
    const d = deps();
    const res = await handleViewsRequest(post(KEY), d);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ count: 7 });
    expect(d.recorded).toEqual([KEY]);
  });

  test("a malformed key is refused and never recorded", async () => {
    const d = deps();
    const res = await handleViewsRequest(post("../../etc/passwd"), d);
    expect(res.status).toBe(400);
    expect(d.recorded).toEqual([]);
  });

  test("an unknown origin is refused, so curl cannot pad the numbers for free", async () => {
    const d = deps();
    const res = await handleViewsRequest(post(KEY, "https://evil.example"), d);
    expect(res.status).toBe(403);
    expect(d.recorded).toEqual([]);
  });

  test("the GitHub Pages deploy is allowed and gets its CORS header back", async () => {
    const res = await handleViewsRequest(post(KEY, "https://hmelberg.github.io"), deps());
    expect(res.status).toBe(200);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("https://hmelberg.github.io");
  });

  test("a preflight is answered without touching storage", async () => {
    const d = deps();
    const res = await handleViewsRequest(
      new Request("https://drawcast.app/.netlify/functions/views", { method: "OPTIONS", headers: { origin: "https://hmelberg.github.io" } }),
      d,
    );
    expect(res.status).toBe(204);
    expect(d.recorded).toEqual([]);
  });

  test("a storage failure never becomes a 500 the player has to handle", async () => {
    const res = await handleViewsRequest(post(KEY), deps({ record: async () => { throw new Error("blobs down"); } }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ count: null });
  });
});

describe("reading counts", () => {
  test("one cast, without recording anything", async () => {
    const d = deps();
    const res = await handleViewsRequest(get(`?cast=${encodeURIComponent(KEY)}`), d);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ count: 7 });
    expect(d.recorded).toEqual([]);
  });

  test("a whole repo, cached briefly so repeat reads do not relist", async () => {
    const res = await handleViewsRequest(get("?repo=hmelberg/kurs"), deps());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      casts: [{ key: KEY, total: 7, days: { "2026-09-04": 7 } }],
      courses: { casts: 7 },
    });
    expect(res.headers.get("Cache-Control")).toContain("max-age=60");
  });

  test("reads are public: no origin at all is fine", async () => {
    const res = await handleViewsRequest(
      new Request(`https://drawcast.app/.netlify/functions/views?repo=hmelberg/kurs`),
      deps(),
    );
    expect(res.status).toBe(200);
  });

  test("a malformed repo is a 400", async () => {
    expect((await handleViewsRequest(get("?repo=nope"), deps())).status).toBe(400);
  });

  test("neither cast nor repo is a 400", async () => {
    expect((await handleViewsRequest(get(""), deps())).status).toBe(400);
  });

  test("other methods are refused", async () => {
    const res = await handleViewsRequest(
      new Request("https://drawcast.app/.netlify/functions/views", { method: "DELETE" }),
      deps(),
    );
    expect(res.status).toBe(405);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/views-endpoint.test.ts`
Expected: FAIL — `Failed to resolve import "../netlify/functions/views.mts"`.

- [ ] **Step 3: Write the implementation**

Create `netlify/functions/views.mts`:

```mts
// View counting: one endpoint, no secrets, no auth.
//
//   POST  body = the cast key (text/plain)  → record one view, answer {count}
//   GET   ?cast=<key>                        → {count}, no write
//   GET   ?repo=<owner>/<name>               → every cast in that repo
//
// Reads are deliberately PUBLIC but KEYED: you must name a repo. drawcast.app
// is a shared viewer, so a "list everything" endpoint would expose other
// people's publishing; scoping to a named repo leaks nothing that is not
// already public on GitHub.
//
// text/plain for the POST body is not laziness: it is CORS-safelisted, so the
// GitHub Pages deploy's cross-origin POST is a simple request with no
// preflight — one round trip on the path that runs for every view.
import { countCast, countRepo, recordAndCount, type CastCount, type RepoCounts } from "../lib/view-store.mts";
import { isValidCastKey } from "../lib/view-key.mts";

export interface ViewsDeps {
  /** Records one view and answers with the resulting count. */
  record: (key: string) => Promise<number>;
  readCast: (key: string) => Promise<CastCount>;
  readRepo: (owner: string, repo: string) => Promise<RepoCounts>;
}

/**
 * Writes are origin-checked; reads are not. This is a speed bump, not a
 * boundary — anyone can forge an Origin header — but it costs nothing and
 * stops idle curl inflation. drawcast.app is listed even though it is
 * same-origin, because the check reads the header rather than trusting CORS.
 */
const ALLOWED_ORIGINS = [
  "https://drawcast.app",
  "https://hmelberg.github.io",
  "http://localhost:5173",
  "http://localhost:8888",
];

const REPO_RE = /^([\w.-]+)\/([\w.-]+)$/;

function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get("origin") ?? "";
  return {
    ...(ALLOWED_ORIGINS.includes(origin) ? { "Access-Control-Allow-Origin": origin } : {}),
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "content-type",
  };
}

const json = (body: unknown, status: number, headers: Record<string, string>) =>
  new Response(JSON.stringify(body), { status, headers: { ...headers, "content-type": "application/json" } });

export async function handleViewsRequest(req: Request, deps: ViewsDeps): Promise<Response> {
  const headers = corsHeaders(req);
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers });

  if (req.method === "POST") {
    const origin = req.headers.get("origin") ?? "";
    if (!ALLOWED_ORIGINS.includes(origin)) return json({ error: "origin" }, 403, headers);
    const key = (await req.text()).trim();
    if (!isValidCastKey(key)) return json({ error: "key" }, 400, headers);
    try {
      return json({ count: await deps.record(key) }, 200, headers);
    } catch {
      // A counting outage is not the player's problem: answer 200 with no
      // number so the badge simply stays hidden.
      return json({ count: null }, 200, headers);
    }
  }

  if (req.method !== "GET") return json({ error: "method" }, 405, headers);

  const url = new URL(req.url);
  const cast = url.searchParams.get("cast");
  const repo = url.searchParams.get("repo");

  if (cast) {
    if (!isValidCastKey(cast)) return json({ error: "key" }, 400, headers);
    try {
      return json({ count: (await deps.readCast(cast)).total }, 200, headers);
    } catch {
      return json({ count: null }, 200, headers);
    }
  }

  if (repo) {
    const m = REPO_RE.exec(repo);
    if (!m) return json({ error: "repo" }, 400, headers);
    const counts = await deps.readRepo(m[1], m[2]);
    return json(counts, 200, { ...headers, "Cache-Control": "public, max-age=60" });
  }

  return json({ error: "ask for ?cast= or ?repo=" }, 400, headers);
}

export default async (req: Request): Promise<Response> =>
  handleViewsRequest(req, {
    record: (key) => recordAndCount(key),
    readCast: (key) => countCast(key),
    readRepo: (owner, repo) => countRepo(owner, repo),
  });
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/views-endpoint.test.ts`
Expected: PASS, 12 tests. Fix the stray space in `.then` if the formatter flags it.

- [ ] **Step 5: Commit**

```bash
git add netlify/functions/views.mts tests/views-endpoint.test.ts
git commit -m "feat(views): the counting endpoint"
```

---

## Task 4: The client

**Files:**
- Create: `src/views.ts`
- Test: `tests/views-client.test.ts`

**Interfaces:**
- Consumes: the endpoint from Task 3 (over HTTP only).
- Produces: `VIEW_ENDPOINTS: string[]`, `countingEnabled(meta: { views?: boolean }): boolean`, `castKeyFor(gh: { owner: string; repo: string; path: string }): string`, `firstViewInSession(key: string, storage: Pick<Storage, "getItem" | "setItem"> | null): boolean`, `recordView(key, endpoints?, fetchImpl?): Promise<number | null>`, `readViewCount(key, endpoints?, fetchImpl?): Promise<number | null>`.

- [ ] **Step 1: Write the failing test**

Create `tests/views-client.test.ts`:

```ts
// The counting client. Every network call is injected, exactly as
// tests/keys.test.ts drives redeemPassword.
import { describe, expect, test, vi } from "vitest";
import { castKeyFor, countingEnabled, firstViewInSession, readViewCount, recordView } from "../src/views";

const KEY = "hmelberg/kurs/casts/did.yaml";

function fetchReturning(status: number, body: unknown): typeof fetch {
  return vi.fn(async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;
}

describe("countingEnabled", () => {
  test("a missing flag counts, so everything already published starts on deploy", () => {
    expect(countingEnabled({})).toBe(true);
    expect(countingEnabled({ views: true })).toBe(true);
  });

  test("an explicit false is the one thing that switches it off", () => {
    expect(countingEnabled({ views: false })).toBe(false);
  });
});

describe("castKeyFor", () => {
  test("is the same identity the published link already uses", () => {
    expect(castKeyFor({ owner: "hmelberg", repo: "kurs", path: "casts/did.yaml" })).toBe(KEY);
  });
});

describe("firstViewInSession", () => {
  function memoryStorage() {
    const data: Record<string, string> = {};
    return { getItem: (k: string) => data[k] ?? null, setItem: (k: string, v: string) => { data[k] = v; } };
  }

  test("the first view counts and a reload in the same tab does not", () => {
    const s = memoryStorage();
    expect(firstViewInSession(KEY, s)).toBe(true);
    expect(firstViewInSession(KEY, s)).toBe(false);
  });

  test("different casts are tracked separately", () => {
    const s = memoryStorage();
    expect(firstViewInSession(KEY, s)).toBe(true);
    expect(firstViewInSession("hmelberg/kurs/casts/rdd.yaml", s)).toBe(true);
  });

  test("no storage at all (private mode, or it throws) still counts the view", () => {
    expect(firstViewInSession(KEY, null)).toBe(true);
  });
});

describe("recordView", () => {
  test("posts the key as text/plain and returns the count", async () => {
    const f = fetchReturning(200, { count: 12 });
    expect(await recordView(KEY, ["/x"], f)).toBe(12);
    const [url, init] = (f as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/x");
    expect(init.method).toBe("POST");
    expect(init.body).toBe(KEY);
    // text/plain keeps this a simple request: no preflight on every view.
    expect((init.headers as Record<string, string>)["content-type"]).toBe("text/plain");
    expect(init.keepalive).toBe(true);
  });

  test("falls through to the next endpoint, like key vending does", async () => {
    const calls: string[] = [];
    const f = vi.fn(async (url: string) => {
      calls.push(url);
      if (url === "/a") return new Response("nope", { status: 404 });
      return new Response(JSON.stringify({ count: 3 }), { status: 200 });
    }) as unknown as typeof fetch;
    expect(await recordView(KEY, ["/a", "/b"], f)).toBe(3);
    expect(calls).toEqual(["/a", "/b"]);
  });

  test("a network error is silent — counting must never break playback", async () => {
    const f = vi.fn(async () => { throw new Error("offline"); }) as unknown as typeof fetch;
    expect(await recordView(KEY, ["/x"], f)).toBeNull();
  });

  test("a null count from a storage outage is not mistaken for zero", async () => {
    expect(await recordView(KEY, ["/x"], fetchReturning(200, { count: null }))).toBeNull();
  });

  test("an invalid key never leaves the browser", async () => {
    const f = fetchReturning(200, { count: 1 });
    expect(await recordView("nope", ["/x"], f)).toBeNull();
    expect(f).not.toHaveBeenCalled();
  });
});

describe("readViewCount", () => {
  test("asks for one cast without recording anything", async () => {
    const f = fetchReturning(200, { count: 9 });
    expect(await readViewCount(KEY, ["/x"], f)).toBe(9);
    const [url, init] = (f as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit | undefined];
    expect(url).toBe(`/x?cast=${encodeURIComponent(KEY)}`);
    expect(init?.method ?? "GET").toBe("GET");
  });

  test("failure is null, never a thrown error", async () => {
    expect(await readViewCount(KEY, ["/x"], fetchReturning(500, {}))).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/views-client.test.ts`
Expected: FAIL — `Failed to resolve import "../src/views"`.

- [ ] **Step 3: Write the implementation**

Create `src/views.ts`:

```ts
// View counting, client side. Nothing here may ever throw into playback: a
// counter that breaks a drawcast is worse than no counter, so every failure
// path returns null and the badge simply stays hidden.

/** Mirrors the cast-key rule in netlify/lib/view-key.mts. Checked here too so
 *  a malformed key never becomes a pointless request. */
const CAST_KEY_RE = /^[\w.-]+\/[\w.-]+\/(?!.*\.\.)[\w./-]+\.(ya?ml|json|txt)$/;

/**
 * Endpoints tried in order, the same shape as VENDING_ENDPOINTS in
 * src/keys.ts: same-origin first for the Netlify deploy and `netlify dev`,
 * then the absolute URL for the GitHub Pages deploy, which calls the
 * drawcast.app function cross-origin.
 */
export const VIEW_ENDPOINTS = [
  "/.netlify/functions/views",
  "https://drawcast.app/.netlify/functions/views",
];

const SESSION_PREFIX = "drawcast.viewed:";

/**
 * A missing flag counts. Everything published before this feature existed has
 * no `meta.views`, and those drawcasts should start counting when this
 * deploys rather than needing a republish.
 */
export function countingEnabled(meta: { views?: boolean }): boolean {
  return meta.views !== false;
}

export function castKeyFor(gh: { owner: string; repo: string; path: string }): string {
  return `${gh.owner}/${gh.repo}/${gh.path}`;
}

/**
 * True the first time this browser session sees a cast. A reload in the same
 * tab reads the count instead of adding one; a fresh visit counts again.
 * Storage can be absent or throw (private mode), and then the view counts —
 * under-counting is the wrong way to fail for something this trivial.
 */
export function firstViewInSession(key: string, storage: Pick<Storage, "getItem" | "setItem"> | null): boolean {
  if (!storage) return true;
  try {
    const marker = SESSION_PREFIX + key;
    if (storage.getItem(marker)) return false;
    storage.setItem(marker, "1");
    return true;
  } catch {
    return true;
  }
}

function countOf(body: unknown): number | null {
  const n = (body as { count?: unknown }).count;
  return typeof n === "number" ? n : null;
}

export async function recordView(
  key: string,
  endpoints: string[] = VIEW_ENDPOINTS,
  fetchImpl: typeof fetch = fetch,
): Promise<number | null> {
  if (!CAST_KEY_RE.test(key)) return null;
  for (const url of endpoints) {
    try {
      const res = await fetchImpl(url, {
        method: "POST",
        // text/plain is CORS-safelisted, so this stays a simple request and
        // costs no preflight on the path that runs for every view.
        headers: { "content-type": "text/plain" },
        body: key,
        keepalive: true,
      });
      if (!res.ok) continue;
      return countOf(await res.json());
    } catch {
      /* try the next endpoint */
    }
  }
  return null;
}

export async function readViewCount(
  key: string,
  endpoints: string[] = VIEW_ENDPOINTS,
  fetchImpl: typeof fetch = fetch,
): Promise<number | null> {
  if (!CAST_KEY_RE.test(key)) return null;
  for (const url of endpoints) {
    try {
      const res = await fetchImpl(`${url}?cast=${encodeURIComponent(key)}`);
      if (!res.ok) continue;
      return countOf(await res.json());
    } catch {
      /* try the next endpoint */
    }
  }
  return null;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/views-client.test.ts`
Expected: PASS, 12 tests.

- [ ] **Step 5: Commit**

```bash
git add src/views.ts tests/views-client.test.ts
git commit -m "feat(views): counting client with session dedupe"
```

---

## Task 5: Wire the viewer and show the badge

**Files:**
- Modify: `src/playlist/playlist.ts` — **four** places: `PlaylistMeta` (L15-51), `readMeta` (L105-135), `isSingle` (L254-267), `formatPlaylist` (L275-297)
- Modify: `src/viewer.ts:209` (add the meta row), `src/viewer.ts:243` (count after the title resolves)
- Modify: `src/styles.css` (`.viewer-meta`, `.viewer-views`)
- Test: `tests/views-viewer.test.ts`

**The four-place trap.** Adding a field to `PlaylistMeta` is not one edit. Miss `readMeta` and the flag never parses back out of the published file, so opt-out silently does nothing. Miss `isSingle` and a single-item drawcast is serialised as a bare spec with the header thrown away — same silent loss. `tests/comments-meta.test.ts` exists because `meta.comments` had to learn this; mirror it.

**Write the flag only when it is OFF.** `views: false` is written; `views: true` is never written. Publishing always-on would push every single-drawcast file from a bare spec into a `playlist:` header plus `---` separator — a change to the shape of every published file, for a value that is already the default. Absent means counting, which is also what makes already-published drawcasts start counting without a republish.

**Interfaces:**
- Consumes: `countingEnabled`, `castKeyFor`, `firstViewInSession`, `recordView`, `readViewCount` from Task 4.
- Produces: nothing new for later tasks.

**Placement:** the count fires after `parsePlaylistText` and the title assignment (`src/viewer.ts:243`) and **before** `mountPlaylist` (`src/viewer.ts:262`). Two reasons: the flag arrives with the playlist, and mounting takes seconds during which a visitor may leave. It is deliberately not awaited.

- [ ] **Step 1: Write the failing test**

Create `tests/views-viewer.test.ts`:

```ts
// The viewer's counting hook. runViewer itself cannot run under the node
// suite (no DOM: h() needs document, and mini-dom has no classList or
// addEventListener), so this guards the wiring by source text — the same
// technique as tests/viewer-packs.test.ts and tests/fullscreen-frame.test.ts.
import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { formatPlaylist, isSingle, parsePlaylistText } from "../src/playlist/playlist";

const viewer = readFileSync(new URL("../src/viewer.ts", import.meta.url), "utf8");
const withoutComments = viewer.replace(/^\s*\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");

describe("the viewer counts views", () => {
  test("it asks the client, rather than growing its own copy of the rules", () => {
    expect(withoutComments).toMatch(/from "\.\/views"/);
    expect(withoutComments).toMatch(/countingEnabled\(playlist\.meta\)/);
  });

  test("counting is gated on the published flag AND on being a GitHub cast", () => {
    // A local file or a Drive link has no published identity to count.
    expect(withoutComments).toMatch(/countingEnabled\(playlist\.meta\)\s*&&\s*req\.gh/);
  });

  test("the count fires before mountPlaylist, not after it", () => {
    const counted = withoutComments.indexOf("countingEnabled");
    const mounted = withoutComments.indexOf("await mountPlaylist");
    expect(counted).toBeGreaterThan(0);
    expect(counted).toBeLessThan(mounted);
  });

  test("it is never awaited, so a slow endpoint cannot delay the drawing", () => {
    expect(withoutComments).not.toMatch(/await\s+(recordView|readViewCount|showViewCount)/);
  });

  test("the badge lives in a meta row under the figure, not in the title", () => {
    expect(withoutComments).toMatch(/class: "viewer-meta"/);
    const wrap = /h\("div", \{ class: "viewer-wrap" \}([^)]*)\)/.exec(withoutComments);
    expect(wrap).not.toBeNull();
    const order = wrap![1];
    expect(order.indexOf("figureHost")).toBeLessThan(order.indexOf("metaEl"));
  });
});

// The flag has to survive the round trip the published file actually makes:
// set → formatPlaylist → committed YAML → parsePlaylistText in a stranger's
// browser. tests/comments-meta.test.ts is the model; meta.comments needed
// exactly these three guarantees.
describe("meta.views in the playlist header", () => {
  test("round-trips through serialize and parse", () => {
    const p = parsePlaylistText("title: T\nelements: []\ncommands: []");
    p.meta.views = false;
    expect(parsePlaylistText(formatPlaylist(p, "yaml")).meta.views).toBe(false);
  });

  test("a doc that opted out always keeps its header — isSingle is false", () => {
    const p = parsePlaylistText("title: T\nelements: []\ncommands: []");
    expect(isSingle(p)).toBe(true);
    p.meta.views = false;
    // Without this the header is dropped on serialize and the opt-out is lost.
    expect(isSingle(p)).toBe(false);
  });

  test("absent means counting, which is what an old published file has", () => {
    expect(parsePlaylistText("title: T\nelements: []\ncommands: []").meta.views).toBeUndefined();
  });

  test("a non-boolean is ignored with a warning rather than being fatal", () => {
    const p = parsePlaylistText('playlist: {views: "no"}\n---\ntitle: T\nelements: []\ncommands: []');
    expect(p.meta.views).toBeUndefined();
    expect(p.warnings.some((w) => w.includes("views"))).toBe(true);
  });
});

describe("the badge styles", () => {
  const css = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");

  test("the meta row and the count both have rules", () => {
    expect(css).toMatch(/\.viewer-meta\s*\{/);
    expect(css).toMatch(/\.viewer-views\s*\{/);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/views-viewer.test.ts`
Expected: FAIL — the first test fails on the missing `from "./views"` import.

- [ ] **Step 3: Add `views` to the playlist model — all four places**

**3a.** In `src/playlist/playlist.ts`, inside `PlaylistMeta` (after the `comments` field, around line 34):

```ts
  /**
   * Whether the published copy reports plays to the view counter. Written
   * onto the published COPY only, like `comments` — and written ONLY when
   * false: absent means counting, so everything published before this feature
   * existed is included without a republish, and an ordinary publish keeps
   * the file shape it has always had. Off is honoured by the player not
   * calling at all: nothing is recorded, rather than recorded and filtered.
   */
  views?: boolean;
```

**3b.** In `readMeta` (around line 118, after the `comments` block) — without this the flag never parses back and opt-out silently does nothing:

```ts
  if (raw.views !== undefined) {
    if (typeof raw.views === "boolean") meta.views = raw.views;
    else warnings.push(`playlist.views must be true or false (got ${JSON.stringify(raw.views)}) — counting`);
  }
```

**3c.** In `isSingle` (around line 260, beside the other `=== undefined` checks) — without this a single-item drawcast that opted out is serialised as a bare spec and the header is thrown away:

```ts
    playlist.meta.views === undefined &&
```

**3d.** In `formatPlaylist`'s header build (around line 288, beside `header.comments`):

```ts
  if (playlist.meta.views !== undefined) header.views = playlist.meta.views;
```

- [ ] **Step 4: Wire the viewer**

In `src/viewer.ts`, add to the imports (after the `./ui/tray` import, line 15):

```ts
import { castKeyFor, countingEnabled, firstViewInSession, readViewCount, recordView } from "./views";
```

Add the meta row next to the other chrome, immediately before the `footer` definition (line 203):

```ts
  // The count lives under the figure, where a viewer expects it — and where
  // the title is heading in the player round, so the row is built once.
  const viewsEl = h("span", { class: "viewer-views" });
  const metaEl = h("div", { class: "viewer-meta" }, viewsEl);
```

Change the append at line 209 to include it between the figure and the footer:

```ts
  app.append(h("div", { class: "viewer-wrap" }, titleEl, status, figureHost, metaEl, footer));
```

Then, immediately after the title block ends (line 243, before `const settings = loadSettings();`), add:

```ts
    // Counting: after the playlist is parsed, because the flag travels in the
    // file, and BEFORE mountPlaylist, which takes seconds a visitor may not
    // stay for. Never awaited — a counting outage must not delay a drawing.
    if (countingEnabled(playlist.meta) && req.gh) {
      const castKey = castKeyFor(req.gh);
      const session = (() => {
        try {
          return sessionStorage;
        } catch {
          return null; // Private mode can throw on access, not just on use.
        }
      })();
      const pending = firstViewInSession(castKey, session) ? recordView(castKey) : readViewCount(castKey);
      void pending.then((count) => {
        if (typeof count === "number") viewsEl.textContent = `${count.toLocaleString()} ${count === 1 ? "view" : "views"}`;
      });
    }
```

- [ ] **Step 5: Add the styles**

In `src/styles.css`, next to the other `.viewer-*` rules (after `.viewer-title`, around line 1029):

```css
/* The count sits under the figure, quiet by default: an empty row collapses,
   so a drawcast published with counting off shows nothing at all rather than
   a hole or an "N/A". */
.viewer-meta {
  display: flex;
  align-items: center;
  gap: 0.8rem;
  min-height: 0;
  padding: 0.35rem 0.1rem 0;
}
.viewer-views {
  font-size: 0.85rem;
  opacity: 0.65;
}
```

- [ ] **Step 6: Run the tests**

Run: `npx vitest run tests/views-viewer.test.ts && npm test`
Expected: both PASS.

- [ ] **Step 7: Commit**

```bash
git add src/viewer.ts src/views.ts src/playlist/playlist.ts src/styles.css tests/views-viewer.test.ts
git commit -m "feat(views): count a published play and show it under the figure"
```

---

## Task 6: The publish option

**Files:**
- Modify: `src/views.ts` (add `applyViewsFlag`)
- Modify: `src/ui/share.ts` — `ShareDoc` (L54-83), `ShareDeps.publish` (L118), the checkbox beside `commentsCb` (L435-454), `linkPanel` children (L455), the `publishGo` click handler (L457-466), `prepPanels` (L1061)
- Modify: `src/main.ts` — `Doc` (L207), restore/rebuild sites (L344, L349, L2568, L3318), autosave (L2676), `publishTextFor` (L3984-4014), the Drive call (L4149), `publishDrawcast` (L4061, L4078, L4093)
- Modify: `src/ui/course.ts` — `publish()` (L834), `yamlFor` (L874-880)
- Modify: `src/store.ts` — `SavedDrawing` (L372)
- Test: `tests/views-publish.test.ts`

**Interfaces:**
- Consumes: `countingEnabled` from Task 4, `PlaylistMeta.views` from Task 5.
- Produces: `applyViewsFlag<T extends { meta: { views?: boolean } }>(playlist: T, countViews: boolean): T`.

**Why a shared helper rather than a spread in each publisher.** `meta.comments` was set independently in `main.ts` and in `course.ts`, and the course path silently dropped the checkbox until someone noticed (see the comment at `src/ui/course.ts:865-870`). One exported rule, called from both, is how that stops happening twice.

**Seed the checkbox from the last publish.** `publishedComments` exists because a typo-fix republish must not silently strip a live page's comments; the mirror image applies here — a republish must not silently *start* counting a drawcast the author turned it off for. Same field shape, same carry sites.

**Trap:** `tests/publish-embed.test.ts:147-225` asserts on `publishTextFor`'s **source text**, slicing between `src.indexOf("async function publishTextFor")` and `src.indexOf("let lastBakeNote")`. Editing that function can break it textually even when the behaviour is right. Run that file explicitly.

- [ ] **Step 1: Write the failing test**

Create `tests/views-publish.test.ts`:

```ts
// The publish-time "Count views" choice. The DOM half is guarded by source
// text (no jsdom in this suite); the rule that matters is a pure helper both
// publishers call.
import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { applyViewsFlag } from "../src/views";
import { formatPlaylist, parsePlaylistText } from "../src/playlist/playlist";

describe("applyViewsFlag", () => {
  test("counting on writes nothing at all — the file keeps its usual shape", () => {
    const p = parsePlaylistText("title: T\nelements: []\ncommands: []");
    const out = applyViewsFlag(p, true);
    expect(out.meta.views).toBeUndefined();
    expect(formatPlaylist(out, "yaml")).not.toContain("views");
  });

  test("counting off writes the flag into the published copy", () => {
    const p = parsePlaylistText("title: T\nelements: []\ncommands: []");
    const out = applyViewsFlag(p, false);
    expect(out.meta.views).toBe(false);
    expect(parsePlaylistText(formatPlaylist(out, "yaml")).meta.views).toBe(false);
  });

  test("the author's own document is never touched — only the copy", () => {
    const p = parsePlaylistText("title: T\nelements: []\ncommands: []");
    applyViewsFlag(p, false);
    expect(p.meta.views).toBeUndefined();
  });
});

describe("both publishers use the one rule", () => {
  const main = readFileSync(new URL("../src/main.ts", import.meta.url), "utf8");
  const course = readFileSync(new URL("../src/ui/course.ts", import.meta.url), "utf8");
  const share = readFileSync(new URL("../src/ui/share.ts", import.meta.url), "utf8");

  test("a single drawcast applies it", () => {
    expect(main).toMatch(/applyViewsFlag\(/);
  });

  test("a course applies it too — the comments checkbox was dropped here once", () => {
    expect(course).toMatch(/applyViewsFlag\(/);
  });

  test("the choice reaches both through the same choices object", () => {
    expect(share).toMatch(/countViews/);
    expect(main).toMatch(/countViews/);
    expect(course).toMatch(/countViews/);
  });

  test("the box is offered in the Link panel and defaults on", () => {
    expect(share).toMatch(/id: "share-count-views"/);
    expect(share).toMatch(/countViewsCb\.checked = /);
  });

  test("the last publish seeds it, so a republish cannot silently re-enable counting", () => {
    expect(share).toMatch(/publishedViews/);
    expect(main).toMatch(/doc\.publishedViews = /);
    const store = readFileSync(new URL("../src/store.ts", import.meta.url), "utf8");
    expect(store).toMatch(/publishedViews\?:\s*boolean/);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/views-publish.test.ts`
Expected: FAIL — `applyViewsFlag` is not exported from `src/views.ts`.

- [ ] **Step 3: Add the shared rule**

Append to `src/views.ts`:

```ts
/**
 * Return the playlist a publish should send. Counting on writes nothing —
 * absent already means counting, and writing `views: true` would push every
 * single-drawcast file from a bare spec into a `playlist:` header for a value
 * that is the default.
 *
 * Exported and called by BOTH publishers on purpose. `meta.comments` was set
 * independently in main.ts and course.ts, and the course path silently
 * dropped the checkbox until someone noticed; one rule cannot drift.
 *
 * Never mutates: publish prepares a COPY, and the author's open document must
 * come out unchanged (P §3.4).
 */
export function applyViewsFlag<T extends { meta: { views?: boolean } }>(playlist: T, countViews: boolean): T {
  if (countViews) return playlist;
  return { ...playlist, meta: { ...playlist.meta, views: false } };
}
```

- [ ] **Step 4: Add the checkbox**

In `src/ui/share.ts`, add the seed field to `ShareDoc` (beside `publishedComments`, L64):

```ts
  /** Whether the last GitHub publish counted views — seeds the checkbox. */
  publishedViews?: boolean;
```

Widen `ShareDeps.publish`'s choices (L118):

```ts
  publish: (choices: { bake: boolean; embedImages: boolean; slug?: string; allowComments?: boolean; countViews?: boolean }) => Promise<void>;
```

After `refreshCommentsChoice` (L454), add the box — unlike comments it needs no setup, so it is never disabled:

```ts
  // "Count views": the published player reports plays to drawcast's counter.
  // Unlike comments this needs no setup, so it is never disabled — and it
  // defaults ON, with the last publish's answer winning when there is one, so
  // a republish cannot silently start counting a drawcast that opted out.
  const countViewsCb = h("input", { type: "checkbox", id: "share-count-views" }) as HTMLInputElement;
  const countViewsLabel = h(
    "label",
    { class: "publish-choice", for: "share-count-views" },
    countViewsCb,
    h("span", {}, "Count views"),
    h("div", { class: "hint" }, "the published page reports plays, so you can see how often it is watched"),
  );
  function refreshCountViewsChoice(doc: ShareDoc): void {
    countViewsCb.checked = doc.publishedViews !== false;
  }
```

Add it to the panel (L455):

```ts
  const linkPanel = h("div", { class: "share-panel" }, linkSubjectLine, publishNameRow, ...linkChoices.rows, commentsLabel, countViewsLabel);
```

Read it in the `publishGo` handler (L460-464):

```ts
    const choices = {
      ...linkChoices.choices(),
      slug: publishNameInput.value.trim() || undefined,
      allowComments: commentsCb.checked && !commentsCb.disabled,
      countViews: countViewsCb.checked,
    };
```

And refresh it in `prepPanels`, right after `refreshCommentsChoice(doc);` (L1061):

```ts
    refreshCountViewsChoice(doc);
```

- [ ] **Step 5: Thread it through the drawcast publisher**

In `src/store.ts`, beside `publishedComments` (L372):

```ts
  /** Whether the last GitHub publish counted views — seeds the checkbox so a republish cannot silently re-enable counting. */
  publishedViews?: boolean;
```

In `src/main.ts`, add the same field to `Doc` (after `publishedComments`, L208):

```ts
  /** Whether the last GitHub publish counted views. */
  publishedViews?: boolean;
```

Carry it everywhere `publishedComments` is carried — L344, L349, L2568, L3318 (add `publishedViews: saved.publishedViews` / `publishedViews: doc.publishedViews` beside the existing `publishedComments:` entry) and in the autosave payload at L2676:

```ts
      publishedViews: doc.publishedViews,
```

Add the parameter to `publishTextFor` (L3988), beside the other choices rather than after `previousText`:

```ts
  allowComments?: boolean,
  countViews = true,
```

Apply it where the comments meta is applied (after the `allowComments` block, L4014):

```ts
  source = applyViewsFlag(source, countViews);
```

Import it at the top of `src/main.ts`:

```ts
import { applyViewsFlag } from "./views";
```

Update the Drive call, which passes `previousText` positionally and must skip the new parameter (L4152). Drive files are never counted — the viewer only counts `req.gh` — so the value is irrelevant there and `true` (write nothing) is the right neutral:

```ts
    const text = await publishTextFor(ac.signal, bake, embedImages, undefined, true, () =>
      doc.drivePublishedId ? readFileText(doc.drivePublishedId) : Promise.resolve(null),
    );
```

In `publishDrawcast`, accept and pass it (L4061, L4078):

```ts
async function publishDrawcast({ bake, embedImages, slug, allowComments, countViews }: { bake: boolean; embedImages: boolean; slug?: string; allowComments?: boolean; countViews?: boolean }): Promise<void> {
```

```ts
    const text = await publishTextFor(ac.signal, bake, embedImages, allowComments, countViews !== false);
```

And record the answer beside the comments bookkeeping (L4093):

```ts
    doc.publishedViews = countViews !== false;
```

- [ ] **Step 6: Thread it through the course publisher**

In `src/ui/course.ts`, destructure it (L834):

```ts
  async function publish({ bake, embedImages, allowComments, countViews }: { bake: boolean; embedImages: boolean; slug?: string; allowComments?: boolean; countViews?: boolean }): Promise<void> {
```

Apply it in `yamlFor` so every lecture carries the same answer — note the existing early return, which must no longer skip the flag (L874-880):

```ts
      const yamlFor = (index: number): string | null => {
        const text = embeddedFor(index);
        if (text === null) return text;
        if (!commentsMeta && countViews !== false) return text;
        const parsed = parsePlaylistText(text);
        if (commentsMeta) parsed.meta.comments = commentsMeta;
        return formatPlaylist(applyViewsFlag(parsed, countViews !== false), "yaml");
      };
```

Import it:

```ts
import { applyViewsFlag } from "../views";
```

- [ ] **Step 7: Run the tests**

Run: `npx vitest run tests/views-publish.test.ts tests/publish-embed.test.ts tests/comments-meta.test.ts && npm test`
Expected: all PASS. `publish-embed.test.ts` is called out because it asserts on `publishTextFor`'s source text.

- [ ] **Step 8: Commit**

```bash
git add src/views.ts src/ui/share.ts src/ui/course.ts src/main.ts src/store.ts tests/views-publish.test.ts
git commit -m "feat(views): Count views as a publish choice, default on"
```

---

## Final verification

- [ ] **Full suite:** `npm test` — every test green (baseline before this work: 4009 tests in 201 files).
- [ ] **Build:** `npm run build` — `tsc` must be clean; the Netlify build runs `npm test && npm run build`.
- [ ] **Live smoke, in this order:**
  1. Publish a drawcast with **Count views** ticked. Open its `#gh=` link. The badge shows `1 view` under the figure.
  2. Reload the tab. Still `1 view` — the session dedupe read instead of recording.
  3. Open the same link in a private window. `2 views`.
  4. `https://drawcast.app/.netlify/functions/views?repo=<owner>/<repo>` lists the cast with `total: 2`, its per-day map, and a `courses` entry keyed `casts`.
  5. Republish with **Count views** unticked. Open the link in a fresh session: **no badge**, and the repo JSON total does not move. Confirm the published YAML contains `views: false`.
  6. Re-open Publish for that drawcast: the box is unticked, seeded from the last publish.
  7. Publish a course and open two lectures; both appear under the course's folder in `courses`.

## Deviations from the spec, to fold back in afterwards

Both are refinements found while planning; amend `docs/superpowers/specs/2026-09-04-view-counts-design.md` §7 and §9 once this ships.

1. **§7 says compaction runs in both read paths.** It runs in `countCast` only. The repo read stays read-only so its response can be cached, and per-cast reads happen on every view, which keeps the store compacted without the dashboard ever writing.
2. **§9 says `meta.views` is always written explicitly.** It is written only when false, so an ordinary publish does not change the shape of every published file. Absent still means counting.
