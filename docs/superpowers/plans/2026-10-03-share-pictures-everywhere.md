# Share delivery 3: pictures from every publish — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every public cast and course lecture published from Claude Code (`scripts/cast.mjs push`) gets the same `<file>.png` picture the app commits, and a course's link card shows its first lecture's picture.

**Architecture:** The app already draws the picture with `posterForPlaylistText` (`src/export/snapshot.ts`). It renders in a browser, so the script draws it in one. `scripts/cast.mjs` starts its own Vite server and headless Chromium, opens the existing dev harness `frames.html`, and calls a new `window.__poster(text)` that returns the PNG as base64. `push` feeds those bytes into the same plan builders the app uses: `buildCastPlan({ poster })` and `lecturePosters(plan, poster)`. Change detection learns to compare binary files. The card function (`netlify/functions/card.mts`) points a course's card at its first lecture's picture.

**Tech Stack:** Node ESM script (`scripts/cast.mjs`), Vite `createServer`, playwright-core with the headless shell that `cast.mjs` already finds (`browser()`), TypeScript (`src/dev/frames.ts`, `netlify/functions/card.mts`), vitest.

**Spec:** `docs/superpowers/specs/2026-10-02-share-design.md` §7 (7.1 Claude Code publishes; the course picture was agreed with the user on 2026-10-03: "course card uses the first lecture's picture"). Builds on deliveries 1–2, already on branch `share` (04156ea9).

## Global Constraints

- Work in the worktree `.claude/worktrees/share` (branch `share`). Other sessions work in the main checkout: never edit, stash or commit there.
- One picture per cast, made only by `posterForPlaylistText`: the author's `poster:` image if it can be fetched, otherwise the finished drawing of the last content part. 1000×750 PNG. No second drawing rule.
- File name: `posterPathFor(path)`, the `.yaml` path with `.png`, next to the cast or lecture.
- Public only. A private push (`origin.private`) draws nothing; `lockPrivate` still deletes old posters, as today. Unlisted public casts get pictures.
- A missing picture never stops a push. If the browser or server can't start, or a drawing fails, push goes ahead without that picture and prints one line: `No picture drawn (<reason>) — the link keeps its old picture, or shows a plain card.`
- Every public push redraws the picture for every cast or lecture file it writes, so a revision never leaves an old ending.
- A picture that is byte-identical to the one on GitHub is not a change. A new or different picture *is* a real change, so `pull` then `push` adds pictures to an older repo. That replaces the spec's separate `pictures` command: same result, no new command.
- Run muted: launch Chromium with `--mute-audio`, and the harness never plays.
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- No pushes to GitHub, deploys or publishes without the user's go-ahead. Live checks use `push --dry-run` or `--no-push`.

## Review Focus

1. **A course whose first lecture has no picture yet.** Example: a lecture still `pending`, or the poster file is missing. The course card falls back to the generic picture, not a broken image. Test in Task 3.
2. **A push from outside the repo** (the portable skill), where there's no Vite and no Chromium. The push still succeeds and prints the one-line note. Test in Task 2 with the drawer throwing.
3. **Re-pushing an unchanged cast.** It must not push again just because the PNG was redrawn: identical bytes are not a change. Test in Task 2 (`fileChanges` with equal bytes).
4. **A private course or cast.** No `.png` may enter the plan. `lockLectureFiles` would refuse a `.png`, and a picture would show locked content. Test in Task 2: `picturesFor` is never called when `private` is true.
5. **A cast whose drawing throws or hangs** (a code element, a remote image). A per-cast time limit gives null for that cast and the others still get theirs. Test in Task 1 (timeout → null).

---

### Task 1: Draw pictures from the script

**Files:**
- Modify: `src/dev/frames.ts` (add `window.__poster`)
- Create: `scripts/pictures.mjs` (`drawPictures`)
- Modify: `scripts/cast.mjs` (a `poster` subcommand that draws one cast's picture to a file, for checks by hand)
- Test: `tests/pictures.test.ts`

**Interfaces:**
- Produces:
  - `window.__poster(text: string): Promise<string | null>` in the dev harness. Returns the base64 PNG of `posterForPlaylistText(text)`, or null.
  - `export async function drawPictures(texts, opts?)` in `scripts/pictures.mjs`:
    - `texts: string[]`: published YAML texts.
    - `opts: { root?: string; launch?: () => Promise<Browser>; perCastMs?: number }`, with defaults `root = process.cwd()`, `launch` = the `browser()` lookup copied from `cast.mjs`, and `perCastMs = 30000`.
    - Returns `Promise<{ pictures: (Uint8Array | null)[]; note: string | null }>`. `pictures[i]` belongs to `texts[i]`. `note` is the one-line reason when nothing could be drawn at all, else null.
  - `export function decodePicture(b64: string | null): Uint8Array | null`
  - `cast.mjs poster <cast.yaml> <out.png>`

- [ ] **Step 1: Write the failing tests** (the pure parts, with an injected launcher; the real browser is checked by hand in Step 6)

```ts
// tests/pictures.test.ts
// Pictures drawn by the script (spec 2026-10-02-share-design §7.1): the
// pure parts of drawPictures — order kept, failures are nulls, a launcher
// that cannot start is one note and no pictures, never a throw.
import { describe, expect, test } from "vitest";
import { decodePicture, drawPictures } from "../scripts/pictures.mjs";

const PNG = Buffer.from([137, 80, 78, 71]).toString("base64");

function fakeLaunch(answers: Record<string, string | null | "throw" | "hang">) {
  return async () => ({
    newPage: async () => ({
      goto: async () => undefined,
      waitForFunction: async () => undefined,
      evaluate: async (_fn: unknown, text: string) => {
        const a = answers[text];
        if (a === "throw") throw new Error("boom");
        if (a === "hang") return new Promise(() => undefined);
        return a ?? null;
      },
    }),
    close: async () => undefined,
  });
}

describe("decodePicture", () => {
  test("base64 to bytes; null and empty are null", () => {
    expect(decodePicture(PNG)).toEqual(new Uint8Array([137, 80, 78, 71]));
    expect(decodePicture(null)).toBeNull();
    expect(decodePicture("")).toBeNull();
  });
});

describe("drawPictures", () => {
  test("one picture per text, in order; a failed or empty drawing is null", async () => {
    const out = await drawPictures(["a", "b", "c"], { launch: fakeLaunch({ a: PNG, b: "throw", c: null }), serve: async () => ({ url: "http://x/", close: async () => undefined }) });
    expect(out.pictures).toEqual([new Uint8Array([137, 80, 78, 71]), null, null]);
    expect(out.note).toBeNull();
  });
  test("a drawing that hangs is cut off and null; the next still draws", async () => {
    const out = await drawPictures(["slow", "a"], { launch: fakeLaunch({ slow: "hang", a: PNG }), perCastMs: 50, serve: async () => ({ url: "http://x/", close: async () => undefined }) });
    expect(out.pictures[0]).toBeNull();
    expect(out.pictures[1]).toEqual(new Uint8Array([137, 80, 78, 71]));
  });
  test("no browser: every picture null, one note, no throw", async () => {
    const out = await drawPictures(["a", "b"], { launch: async () => { throw new Error("no headless Chromium — run: npx playwright-core install chromium-headless-shell"); }, serve: async () => ({ url: "http://x/", close: async () => undefined }) });
    expect(out.pictures).toEqual([null, null]);
    expect(out.note).toMatch(/^no headless Chromium/);
  });
  test("no server: the same", async () => {
    const out = await drawPictures(["a"], { launch: fakeLaunch({ a: PNG }), serve: async () => { throw new Error("vite missing"); } });
    expect(out.pictures).toEqual([null]);
    expect(out.note).toBe("vite missing");
  });
  test("nothing to draw starts nothing", async () => {
    let started = false;
    const out = await drawPictures([], { launch: async () => { started = true; throw new Error("x"); }, serve: async () => { started = true; throw new Error("x"); } });
    expect(out).toEqual({ pictures: [], note: null });
    expect(started).toBe(false);
  });
});
```

`serve` is a second injectable: `() => Promise<{ url: string; close(): Promise<void> }>`. By default it starts Vite (Step 3). Add it to the `opts` type above.

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run tests/pictures.test.ts`
Expected: FAIL, because `../scripts/pictures.mjs` does not exist.

- [ ] **Step 3: Write `scripts/pictures.mjs`**

```js
// scripts/pictures.mjs — the picture a published cast shows on its link card
// (spec 2026-10-02-share-design §7.1), drawn for Claude Code publishes the way
// the app draws it: posterForPlaylistText, in a browser, through the dev
// harness's window.__poster. A picture is never worth a failed push: any
// trouble is a null (one cast) or a note (all of them).
import { existsSync, readdirSync } from "node:fs";
import { createServer as netServer } from "node:net";

export function decodePicture(b64) {
  if (!b64) return null;
  return new Uint8Array(Buffer.from(b64, "base64"));
}

/** cast.mjs browser()'s lookup — Playwright's own headless shell cache. */
async function defaultLaunch() {
  const { chromium } = await import("playwright-core");
  const home = process.env.HOME ?? process.env.USERPROFILE ?? "";
  const cache = process.env.PLAYWRIGHT_BROWSERS_PATH
    ?? (process.platform === "darwin" ? `${home}/Library/Caches/ms-playwright`
      : process.platform === "win32" ? `${process.env.LOCALAPPDATA}/ms-playwright`
      : `${process.env.XDG_CACHE_HOME ?? `${home}/.cache`}/ms-playwright`);
  const shells = existsSync(cache) ? readdirSync(cache).filter((d) => d.startsWith("chromium_headless_shell")).sort() : [];
  if (!shells.length) throw new Error("no headless Chromium — run: npx playwright-core install chromium-headless-shell");
  const dir = `${cache}/${shells.at(-1)}`;
  const sub = readdirSync(dir).find((d) => d.startsWith("chrome-headless-shell"));
  const exe = process.platform === "win32" ? "chrome-headless-shell.exe" : "chrome-headless-shell";
  return chromium.launch({ executablePath: `${dir}/${sub}/${exe}`, args: ["--mute-audio"] });
}

function freePort() {
  return new Promise((ok, fail) => {
    const s = netServer();
    s.once("error", fail);
    s.listen(0, "127.0.0.1", () => {
      const { port } = s.address();
      s.close(() => ok(port));
    });
  });
}

/** Vite on a free local port, serving the repo (frames.html and src/). */
function defaultServe(root) {
  return async () => {
    const { createServer } = await import("vite");
    const port = await freePort();
    const server = await createServer({ root, logLevel: "error", server: { host: "127.0.0.1", port, strictPort: true } });
    await server.listen();
    return { url: `http://127.0.0.1:${port}/`, close: () => server.close() };
  };
}

function within(ms, p) {
  return Promise.race([p, new Promise((ok) => setTimeout(() => ok(null), ms))]);
}

export async function drawPictures(texts, opts = {}) {
  if (texts.length === 0) return { pictures: [], note: null };
  const launch = opts.launch ?? defaultLaunch;
  const serve = opts.serve ?? defaultServe(opts.root ?? process.cwd());
  const perCastMs = opts.perCastMs ?? 30000;
  let server = null;
  let browser = null;
  try {
    server = await serve();
    browser = await launch();
    const page = await browser.newPage({ viewport: { width: 1000, height: 750 } });
    await page.goto(`${server.url}frames.html`);
    await page.waitForFunction(() => typeof window.__poster === "function", null, { timeout: 60000 });
    const pictures = [];
    for (const text of texts) {
      const b64 = await within(perCastMs, page.evaluate((t) => window.__poster(t), text).catch(() => null));
      pictures.push(decodePicture(b64));
    }
    return { pictures, note: null };
  } catch (err) {
    return { pictures: texts.map(() => null), note: String(err?.message ?? err).split("\n")[0] };
  } finally {
    await browser?.close().catch(() => undefined);
    await server?.close().catch(() => undefined);
  }
}
```

- [ ] **Step 4: Add `window.__poster` to the harness**

In `src/dev/frames.ts`:
- Add `__poster: (text: string) => Promise<string | null>;` to the `declare global { interface Window { … } }` block.
- Add the import `import { posterForPlaylistText } from "../export/snapshot";`.
- After `window.__frames = …`, add:

```ts
/**
 * The picture a published cast shows on its link card (spec 2026-10-02-
 * share-design §7.1), for scripts/pictures.mjs: the app's own
 * posterForPlaylistText, as base64 — or null when nothing could be drawn.
 */
window.__poster = async (text) => {
  await ensureEnabledPacks(Object.keys(PACK_DEFS));
  const bytes = await posterForPlaylistText(text);
  if (!bytes) return null;
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
};
```

`ensureEnabledPacks` and `PACK_DEFS` are already imported in this file (line 59).

- [ ] **Step 5: Run the tests**

Run: `npx vitest run tests/pictures.test.ts && npx tsc --noEmit`
Expected: PASS, no type errors. If `tsc` does not check `.mjs` but vitest needs types for the import, add a `// @ts-expect-error` only if vitest's TS check complains. Look at how `tests/cast-github.test.ts` imports `../scripts/cast-github.mjs` and follow that.

- [ ] **Step 6: A `poster` subcommand, and check a real drawing by eye**

In `scripts/cast.mjs`, add to the `commands` table (beside `frames`):

```js
  // node scripts/cast.mjs poster <cast.yaml> <out.png> — the picture its link card will show
  async poster([file, out]) {
    if (!file || !out) throw new Error("usage: cast.mjs poster <cast.yaml> <out.png>");
    const { drawPictures } = await import("./pictures.mjs");
    const { pictures, note } = await drawPictures([readFileSync(resolve(ROOT, file), "utf8")], { root: ROOT });
    if (!pictures[0]) throw new Error(`No picture drawn (${note ?? "the drawing failed"})`);
    writeFileSync(resolve(ROOT, out), pictures[0]);
    console.log(`wrote ${out} (${pictures[0].length} bytes)`);
  },
```

Add a usage line in the header comment block, next to the other commands:
`//   node scripts/cast.mjs poster <cast.yaml> <out.png>   the picture the cast's link card shows (drawn as the app draws it)`

Then run it on a bundled course lecture and look at the file:

```bash
node scripts/cast.mjs poster docs/courses/qaly/01-what-is-a-qaly.yaml dev-casts/qaly-01.png
```

Expected: `wrote dev-casts/qaly-01.png (… bytes)`. Open it with the Read tool: a 1000×750 drawing of the lecture's last page, not blank and not an error. `dev-casts/` is gitignored, so don't commit the PNG.

- [ ] **Step 7: Commit**

```bash
git add scripts/pictures.mjs src/dev/frames.ts scripts/cast.mjs tests/pictures.test.ts
git commit -m "Pictures: draw a cast's link-card picture from the script, as the app does

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 2: `push` commits the pictures

**Files:**
- Modify: `scripts/cast-github.mjs` (add `fileChanges`)
- Modify: `scripts/cast.mjs` (the `push` command's plan building and its change detection; the header comment for `push`)
- Modify: `.claude/skills/drawcast/SKILL.md` (one sentence on pictures and on adding them to an older repo)
- Test: `tests/cast-github.test.ts` (add a `fileChanges` describe block)

**Interfaces:**
- Consumes (Task 1): `drawPictures(texts, { root }) → { pictures, note }`.
- Consumes (existing): `buildCastPlan({ …, poster })` (`src/publish/cast.ts`, adds `posterPathFor(path)` with `bytes`), `lecturePosters(plan, poster)` (`src/course/publish.ts:419`, returns `PublishFile[]` with `bytes`), `posterPathFor`.
- Produces: `export function fileChanges(files, deletions, readAt)` in `scripts/cast-github.mjs`:
  - `files: { path: string; content: string; bytes?: Uint8Array }[]`
  - `deletions: string[]`
  - `readAt: (path: string) => Buffer | null`, the file's bytes at upstream.
  - Returns `{ changes: [kind: "new" | "changed" | "deleted", path: string][]; real: [kind, path][] }`.
  - Changes are compared by bytes (`bytes` if present, else UTF-8 of `content`).
  - `real` drops the bookkeeping files (manifests, READMEs, index pages, the claim) exactly as today. PNGs are real.

- [ ] **Step 1: Write the failing tests**

Append to `tests/cast-github.test.ts` (and add `fileChanges` to its import from `../scripts/cast-github.mjs`):

```ts
describe("fileChanges (cast.mjs push)", () => {
  const png = (n: number) => new Uint8Array([137, 80, 78, n]);
  const at = (files: Record<string, string | Uint8Array>) => (p: string) => (p in files ? Buffer.from(files[p] as string | Uint8Array) : null);

  it("text and pictures are compared by their bytes", () => {
    const files = [
      { path: "casts/a.yaml", content: "same" },
      { path: "casts/a.png", content: "", bytes: png(1) },
      { path: "casts/b.yaml", content: "new text" },
      { path: "casts/b.png", content: "", bytes: png(2) },
      { path: "casts/c.png", content: "", bytes: png(3) },
    ];
    const { changes, real } = fileChanges(files, [], at({ "casts/a.yaml": "same", "casts/a.png": png(1), "casts/b.yaml": "old text", "casts/b.png": png(9) }));
    expect(changes).toEqual([["changed", "casts/b.yaml"], ["changed", "casts/b.png"], ["new", "casts/c.png"]]);
    expect(real).toEqual(changes);
  });

  it("an identical redrawn picture is no change, so an unchanged cast is nothing to push", () => {
    const { changes, real } = fileChanges([{ path: "casts/a.yaml", content: "x" }, { path: "casts/a.png", content: "", bytes: png(1) }], [], at({ "casts/a.yaml": "x", "casts/a.png": png(1) }));
    expect(changes).toEqual([]);
    expect(real).toEqual([]);
  });

  it("a picture alone is a real change — pull then push adds pictures to an older repo", () => {
    const { real } = fileChanges([{ path: "q/01.yaml", content: "x" }, { path: "q/01.png", content: "", bytes: png(1) }, { path: "q/README.md", content: "r2" }], [], at({ "q/01.yaml": "x", "q/README.md": "r1" }));
    expect(real).toEqual([["new", "q/01.png"]]);
  });

  it("bookkeeping files alone are not real; deletions are", () => {
    const { changes, real } = fileChanges(
      [{ path: "casts/casts.json", content: "2" }, { path: "q/index.html", content: "2" }, { path: ".drawcast/claim", content: "n" }],
      ["q/01.png"],
      at({ "casts/casts.json": "1", "q/index.html": "1" }),
    );
    expect(changes.map(([, p]) => p)).toEqual(["casts/casts.json", "q/index.html", ".drawcast/claim", "q/01.png"]);
    expect(real).toEqual([["deleted", "q/01.png"]]);
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run tests/cast-github.test.ts`
Expected: FAIL, because `fileChanges` is not exported.

- [ ] **Step 3: Write `fileChanges`**

Append to `scripts/cast-github.mjs`:

```js
/** Bookkeeping a publish rewrites every time: on its own it is no change
 *  (the manifests' dates, READMEs, index pages, the registry claim). */
const BOOKKEEPING_RE = /(^|\/)(courses\.json|casts\.json|index\.html|README\.md|\.drawcast\/claim)$/;

/**
 * What a push would change against upstream (cast.mjs push), compared by
 * bytes — a redrawn picture identical to GitHub's is no change, a new or
 * different one is (spec 2026-10-02-share-design §7.1: pull then push adds
 * pictures to an older repo). `real` is what is worth a commit.
 */
export function fileChanges(files, deletions, readAt) {
  const changes = [];
  for (const f of files) {
    const now = readAt(f.path);
    const want = f.bytes ? Buffer.from(f.bytes) : Buffer.from(f.content, "utf8");
    if (now === null) changes.push(["new", f.path]);
    else if (!now.equals(want)) changes.push(["changed", f.path]);
  }
  for (const p of deletions) changes.push(["deleted", p]);
  return { changes, real: changes.filter(([, p]) => !BOOKKEEPING_RE.test(p)) };
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run tests/cast-github.test.ts`
Expected: PASS.

- [ ] **Step 5: Use it in `push`, and draw the pictures**

In `scripts/cast.mjs`:

(a) Add a binary reader beside `readAtCommit` (around line 321), leaving the text one unchanged:

```js
function readBytesAtCommit(clone, commit, path) {
  const r = spawnSync("git", ["-C", clone, "show", `${commit}:${path}`], { maxBuffer: 1 << 30 });
  return r.status === 0 ? r.stdout : null;
}
```

(b) Replace the "What would change" block in `push` with:

```js
    const { changes, real } = fileChanges(files.files, files.deletions, (p) => readBytesAtCommit(clone, upstream, p));
```

Keep the `console.log` of `changes` and the `if (!real.length)` and `if (dry)` lines after it. Add `fileChanges` to the existing import from `./cast-github.mjs`.

(c) `drawAll`: one browser session per push, for every public cast or lecture it writes. Declare it above `const files = await withVite(…)`:

```js
    // The link-card pictures (spec 2026-10-02-share-design §7.1): one browser
    // session for every public cast or lecture this push writes. Never a
    // reason to stop a push — what cannot be drawn is said once.
    let pictureNote = null;
    const drawAll = async (texts) => {
      const { drawPictures } = await import("./pictures.mjs");
      const { pictures, note } = await drawPictures(texts, { root: ROOT });
      if (note) pictureNote = note;
      else if (pictures.some((p) => p === null)) pictureNote = `${pictures.filter((p) => p === null).length} of ${pictures.length} could not be drawn`;
      return new Map(texts.map((t, i) => [t, pictures[i]]));
    };
```

(d) A public **cast**. In the `origin.kind === "cast"` branch, draw before `buildCastPlan` (only when not private) and pass the bytes in:

```js
        const picture = origin.private ? null : (await drawAll([text])).get(text) ?? null;
        const plan = buildCastPlan({ title, text, slug, previousSlug: slug, repo, castsDir: origin.castsDir, viewerBase: origin.viewerBase, index: indexText ? parseCastIndex(indexText) : emptyCastIndex(), poster: picture });
```

(e) A public **course**. Replace `if (!origin.private) return { files: plan.files, deletions: plan.deletions };` with one drawing pass over every lecture YAML in the plan, then the app's own `lecturePosters`:

```js
      if (!origin.private) {
        const { lecturePosters } = await load("/src/course/publish.ts");
        const lectureTexts = [...plan.fileOf.values()]
          .map((name) => plan.files.find((f) => f.path === name || f.path.endsWith(`/${name}`))?.content)
          .filter((t) => typeof t === "string");
        const drawn = await drawAll(lectureTexts);
        const posters = await lecturePosters(plan, async (yaml) => drawn.get(yaml) ?? null);
        return { files: [...plan.files, ...posters], deletions: plan.deletions };
      }
```

`withVite` (middleware mode, for `ssrLoadModule`) and `drawPictures`' own Vite server (listening, for the browser) are separate servers; both close when their work ends.

(f) After the `console.log` of changes, print the note when there is one:

```js
    if (pictureNote) console.log(`No picture drawn (${pictureNote}) — the link keeps its old picture, or shows a plain card.`);
```

`withVite` (middleware mode, for `ssrLoadModule`) and `drawPictures`' own Vite server (listening, for the browser) are separate servers. Both are closed when their work ends.

(g) Update the `push` lines in the header comment: "…regenerates what the app's publish would (course page, READMEs, manifests, end pages, **link-card pictures**) and commits it". Add a line: "Pictures: every public cast/lecture written gets `<file>.png` (cast.mjs poster draws one by hand); a repo published before pictures existed gets them with `pull` then `push`."

- [ ] **Step 6: The private and no-browser paths, pinned**

Add to `tests/pictures.test.ts` a test that reads `scripts/cast.mjs` as text. It is a source-level guard, the same kind `tests/no-bundled-secrets.test.ts` uses. It asserts that every `drawAll(` call sits behind a private check:

```ts
import { readFileSync } from "node:fs";

test("push draws pictures only for public casts and courses", () => {
  const src = readFileSync("scripts/cast.mjs", "utf8");
  const calls = [...src.matchAll(/drawAll\(/g)].length;
  expect(calls).toBeGreaterThanOrEqual(2);
  // cast branch: guarded inline; course branch: inside `if (!origin.private) {`
  expect(src).toMatch(/origin\.private \? null : \(await drawAll\(\[text\]\)\)/);
  expect(src).toMatch(/if \(!origin\.private\) \{\s*const \{ lecturePosters \}[\s\S]{0,400}drawAll\(lectureTexts\)/);
});
```

- [ ] **Step 7: Check it with a dry run against the real test repo**

```bash
node scripts/cast.mjs pull https://github.com/hmelberg/drawcast-skill-test/tree/main/casts dev-casts/pic-cast
node scripts/cast.mjs push dev-casts/pic-cast --dry-run
```

Expected: the change list shows `new casts/my-test-cast.png`. It does not say "Nothing to push", because the picture is a real change. It ends with `(dry run — nothing written)`. Run the same `push --dry-run` again: the PNG still shows as `new`, because GitHub still has none. That is right.

Check the `pull` argument form in `cast.mjs`'s header first. If `casts/` is not a valid pull target for a single cast, pull the cast file URL `https://github.com/hmelberg/drawcast-skill-test/blob/main/casts/my-test-cast.yaml`. `understanding-the-qaly` is a private course, so a dry run of it must list **no** `.png`. Pull it too and check.

- [ ] **Step 8: Skill docs and spec**

In `.claude/skills/drawcast/SKILL.md`, where `push` is described, add one sentence: "A public push also commits each cast's link-card picture (`<file>.png`, drawn the way the app draws it); to give an older published repo its pictures, `pull` it and `push` again." Check whether the portable skill build (`scripts/build-skill.mjs`) copies a different SKILL text. If so, it needs no change: outside the repo, pictures are skipped with the note.

In the spec `docs/superpowers/specs/2026-10-02-share-design.md`, §7.1 "Backfill" and §9 item 3: replace the `pictures` command with "`pull` then `push` adds the pictures (a new picture is a real change)". Add to §7: "A course's card uses its first lecture's picture."

- [ ] **Step 9: Run the tests, type-check, commit**

Run: `npx vitest run tests/cast-github.test.ts tests/pictures.test.ts && npx tsc --noEmit`
Expected: PASS, clean.

```bash
git add scripts/cast.mjs scripts/cast-github.mjs tests/cast-github.test.ts tests/pictures.test.ts .claude/skills/drawcast/SKILL.md docs/superpowers/specs/2026-10-02-share-design.md
git commit -m "Push: public casts and lectures get their link-card picture; pictures compared by bytes

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 3: A course's card shows its first lecture's picture

**Files:**
- Modify: `netlify/functions/card.mts` (`find()`, course branch)
- Test: `tests/card-endpoint.test.ts`

**Interfaces:**
- Consumes (existing in `card.mts`): `firstLectureFile(md)`, `posterUrlFor(owner, repo, path)`, `rawUrl`, `LOCKED_RE`, and the crawler path's `posterExists` (og:image is `/card/<name>.png` at 1000×750 when the picture exists, else `/share-card.png` at 1200×630).
- Behaviour: when the first lecture's file is found, read, and not locked, the course's `Found` carries `poster: posterUrlFor(k.owner, k.repo, \`${k.path}/${file}\`)`. Otherwise there is no poster and the generic picture is used, as today. `/card/<course>.png` then streams that lecture's picture through the same path as a cast's.

- [ ] **Step 1: Write the failing tests**

In `tests/card-endpoint.test.ts`, the `deps()` fixture's `resolve` already answers `qaly` as `{ kind: "course", target: "ann/casts/courses/qaly" }`. Read the current fixture first: the fix wave changed `course.md` handling and may already serve a lecture `status:` line. Then add:

```ts
describe("a course's picture is its first lecture's", () => {
  const MD = "# QALY basics\n\nWhat a QALY is.\n\n---\n## Lecture one\nstatus: done · file: 01-intro.yaml\n";
  const LECTURE = "playlist:\n  title: Lecture one\n";
  const course = (over: Partial<CardDeps> = {}) =>
    deps({
      fetchText: async (url) => (url.endsWith("courses/qaly/course.md") ? MD : url.endsWith("courses/qaly/01-intro.yaml") ? LECTURE : null),
      fetchImage: async (url) => (url.endsWith("courses/qaly/01-intro.png") ? new Response(new Uint8Array([137, 80, 78, 71]), { headers: { "content-type": "image/png" } }) : null),
      ...over,
    });

  test("the card names the course and shows the lecture's picture", async () => {
    const html = await (await handleCardRequest(get("/c/qaly", FB), course())).text();
    expect(html).toContain('og:title" content="QALY basics"');
    expect(html).toContain('og:image" content="https://drawcast.app/card/qaly.png"');
    expect(html).toContain('og:image:width" content="1000"');
  });
  test("/card/qaly.png streams the first lecture's picture", async () => {
    const d = course();
    const res = await handleCardRequest(get("/card/qaly.png", FB), d);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
  });
  test("no picture beside the lecture: the generic picture, not a broken one", async () => {
    const html = await (await handleCardRequest(get("/c/qaly", FB), course({ fetchImage: async () => null }))).text();
    expect(html).toContain('og:image" content="https://drawcast.app/share-card.png"');
  });
  test("a lecture with no file yet: the generic picture", async () => {
    const html = await (await handleCardRequest(get("/c/qaly", FB), course({ fetchText: async (url) => (url.endsWith("course.md") ? "# QALY basics\n\nWhat a QALY is.\n\n---\n## Lecture one\nstatus: pending\n" : null) }))).text();
    expect(html).toContain('og:title" content="QALY basics"');
    expect(html).toContain('og:image" content="https://drawcast.app/share-card.png"');
  });
  test("a lecture whose text can't be read: no picture streamed", async () => {
    const res = await handleCardRequest(get("/card/qaly.png", FB), course({ fetchText: async (url) => (url.endsWith("course.md") ? MD : null) }));
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("https://drawcast.app/share-card.png");
  });
});
```

Match the `status:` line format to what `firstLectureFile` accepts. Read it in `card.mts` and copy a line it parses. The `·` separator above is the app's (`src/course/document.ts` `formatStatus`). Keep the existing tests that cover a locked first lecture (generic card) passing.

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run tests/card-endpoint.test.ts`
Expected: the new picture tests FAIL (og:image is `/share-card.png`). The "no picture" and "no file" tests may already pass.

- [ ] **Step 3: Give the course its first lecture's poster**

In `find()`'s course branch, change the lecture block to:

```ts
    const file = firstLectureFile(md!);
    if (file) {
      const lecture = await deps.fetchText(rawUrl(k.owner, k.repo, `${k.path}/${file}`), signal);
      if (lecture !== null && LOCKED_RE.test(lecture)) return null;
      // The course's own picture is its first lecture's (spec 2026-10-02-
      // share-design §7, agreed 2026-10-03) — only once that lecture's text
      // was read and is not locked, the same rule a cast's picture follows.
      if (lecture !== null) return { text, poster: posterUrlFor(k.owner, k.repo, `${k.path}/${file}`) };
    }
    return { text };
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run tests/card-endpoint.test.ts tests/share-card.test.ts && npx tsc --noEmit`
Expected: PASS, clean.

- [ ] **Step 5: Commit**

```bash
git add netlify/functions/card.mts tests/card-endpoint.test.ts
git commit -m "Share cards: a course shows its first lecture's picture

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## After the tasks

- Full suite and `tsc` once.
- Report to the user: the `poster` drawing they can look at (`dev-casts/qaly-01.png`), and the dry-run change lists for the public test cast (a new `.png`) and the private course (none).
- Ask before any real `push` to `hmelberg/drawcast-skill-test`, and before merging, pushing or deploying `share`.
