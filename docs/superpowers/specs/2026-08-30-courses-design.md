# Design: Courses — a series of drawcasts from one editable plan

*2026-08-30. Decisions made in brainstorming with Hans, after auditing what
the app already does (§0). Stages A and B only; C and D are ROADMAP entries.*

## Goals

1. **Turn one description of a course into N multi-part drawcasts.** "A course
   in causal inference, master level, ten lectures" becomes ten narrated
   drawcasts, each ~5 minutes, each its own video.
2. **The plan is an editable text document.** The author reads it, rewrites the
   questions, reorders lectures, and re-runs. Generation is **resumable**: a
   lecture already made is not made again, and any one lecture can be redone.
3. **The series is a course, not ten unrelated videos.** Shared notation, a
   running example, and knowledge of what earlier lectures covered go into
   every lecture's request.
4. **Optionally publish the whole course to the author's own public GitHub
   repo** as one commit, with an overview page students can open and per-lecture
   links that survive regeneration.
5. **GitHub is optional.** A course is fully usable without it.

## Non-goals

- **Batch video/YouTube export.** Export stays a per-drawcast action. Recording
  is real-time `MediaRecorder` in the tab (`export/video.ts`); ten lectures is
  ~an hour of unattended recording with no resume, which is its own project.
- **Batch translation.** It already exists in the upload dialog; a course × N
  languages multiplies everything.
- **Clickable next/previous inside a video.** The link target does not exist
  until after publishing, and a burnt-in URL goes stale on reorder. The
  end-card carries the next lecture's *title* only (§6).
- **Drive publishing.** A seam is left (§8), no implementation.
- **A course catalogue, likes, comments.** ROADMAP (§14).
- **A module level above lectures.** See §1.
- **Private repos.** See §9.

## 0. What already exists — verified, not assumed

Most of this feature is a promotion of machinery that is already here.

- **A drawcast is already a series.** `playlist/playlist.ts` parses a
  multi-document YAML stream separated by `---`, with a `{playlist: …}` header,
  `{chapter: …}` group markers, a generated title page and chapter cards, and
  `exportSequence()` as the single description of what a viewer sees.
- **Batch generation already works, one level down.** `#playlist` / `#parts=N`
  runs one outline call (`llm/outline.ts`) then one ordinary `generateSpec` per
  part in parallel, with bridging lines between parts
  (`buildPartRequest`). The orchestrator is `generateMulti` (`main.ts:2070`).
  The outline is **invisible and unusable on its own** — it is produced and
  consumed in the same call.
- **The enrichment vocabulary already exists.** `llm/tags.ts` defines
  `#why #controversy #history #facts #proscons #pun #fun #human #quiz #ask
  #click #socratic #qa #debate #story #provoke`, plus `#basic/#advanced`,
  `#norwegian/#english` and `#veryshort…#verylong`, each with a prompt fragment
  and a fabrication guardrail. `MAX_PARTS = 6`.
- **Fetching from GitHub already works.** `scenes/remote-packs.ts` fetches
  `raw.githubusercontent.com` in production, so CORS is proven for this origin.
- **The viewer only knows `#gdoc=`.** `viewer.ts` fetches Google's public
  export endpoint, then `parsePlaylistText` → validate → mount. Only the fetch
  differs for a new source.

Three findings that constrain the design rather than help it:

- **`SavedDrawing` has no `driveFileId`** (`store.ts:208`). The id lives only on
  the open document in memory. Regenerating a lecture in a later session would
  create a *new* Drive file, and any published link would point at the old
  version forever. This is the decisive argument for GitHub over Drive (§9).
- **`saveDrawing()` writes localStorage with no `try`/`catch`** (`store.ts:227`).
  `appendLog` has quota handling with halving; the library has none. Batch
  generation is the first thing that will realistically hit the ~5 MB quota, and
  it would throw after the run has already spent forty AI calls. Fixed in §7.
- **`netlify/lib/rate-limit.mts` calls `getStore()` without
  `consistency: "strong"`.** Netlify Blobs is eventually consistent by default,
  so the password limiter may not be counting at all. Out of scope here — it
  blocks the catalogue (§14), not A or B — but recorded so it is not
  rediscovered later.

**Ruling:** build the course as a new *document type* and a new *runner* over
the existing generator, not as a new generator.

## 1. The hierarchy — exactly three authored depths

The engine has one grouping level inside a drawcast and no sub-grouping. The
document grammar must not accept structure that cannot be rendered.

| Depth | Meaning | Renders as |
|---|---|---|
| `#` | Course | The overview page's title |
| `##` | **Lecture — one drawcast, one video** | A playlist |
| `###` | Chapter inside that lecture | `{chapter: …}` → `makeChapterCard` |

- **`####` and deeper are rejected with a warning**, and the heading's text is
  kept as a question line so nothing the author wrote is lost. There is no
  sub-chapter card; a format that silently swallows structure is a trap.
- **A `---` line is tolerated and ignored.** The generator emits it along with
  the `##` heading because it reads better, but `##` is the normative boundary,
  so there is exactly one rule when the two disagree.
- **No module level.** Grouping lectures under "Part 1: Foundations" only
  matters past ~15 lectures and only affects the overview page. Making the
  middle level optional would move the video boundary depending on how deep a
  document happens to go — an ambiguity paid on every document forever. When it
  is needed it arrives with no ambiguity as an ordinary option line,
  `part: Foundations`, grouping on the overview page and never touching
  generation.

**Heading vs. tag disambiguation:** a line matching `/^#{1,6}\s+/` is a
heading; a line whose first token is `#word` is a tag line. `# Causal
Inference` is a title, `#why #quiz` is tags. This rule is load-bearing and gets
its own test.

## 2. The course document

Plain text the author owns. The planner writes it, the author edits it, the
runner reads it back and writes status into it.

```markdown
# Causal Inference
level: advanced · minutes: 5 · language: norwegian
notation: Y(1)/Y(0), D treatment, X covariates
example: job training (NSW)

A master-level introduction to identification strategies.

---
## Potential outcomes
What is a counterfactual outcome?
Why are ATE and ATT different quantities?
Why is this called a missing-data problem?
#why #parts=4
status: done · id: a3f9c1 · file: potential-outcomes.yaml · 2026-08-30

---
## Difference-in-differences
What does the parallel-trends assumption claim, and when does it break?
What is the 2×2 estimator geometrically?
Where did the minimum-wage debate go wrong?
#controversy #quiz #parts=4
```

**Parse rules** (`course/document.ts`):

- `# X` → course title. A second one is a warning; the first wins.
- Between the title and the first `##`: `key: value` lines (optionally joined by
  `·`) become the **shared context map**; remaining prose becomes the intro.
- `## X` → a new lecture.
- Inside a lecture: `### X` → a chapter; a tag line → that lecture's tags; a
  `key: value` line → that lecture's options (overriding the course context);
  every other non-empty line → **a question** (a leading `- ` is stripped).
- `status:` is an option like any other, written by the runner (§5).

**Unknown keys are context, not errors.** Only `level`, `minutes`, `language`
and `status` are mechanical; every other key is passed to the model as prose
context. This makes the format forgiving, at the cost of a typo'd
`levl: advanced` becoming context instead of a level. Accepted.

The number of parts comes from the `#parts=N` **tag**, never from a key, so it
is parsed in one place — `tags.ts` already does it.

**Taste in the planner, deference in the runner.** A brief phrased as 2–4
answerable questions — and why/how questions above all — is both better to edit
and more actionable than a topic label, so that is what the planner is pushed
toward (§3). Its output is a draft the teacher edits, which is exactly where
opinions belong.

`buildLectureRequest` (§4) has none. It hands the model the lecture's lines as
"the teacher's notes … read them as they are written: some are questions to
answer, some are things to explain, some are material to show" — permitting
without instructing. Classifying the lines for the model would make it perform a
category rather than serve the content, and how a line is written is itself the
signal. By then the teacher has already decided; the runner's job is to serve
that, including topics they chose deliberately. A lecture with nothing under it
falls back to its title.

Modes that need saying out loud ride on tags, not on the prose frame — `#data`
marks a lecture whose figure *is* the content (a distribution, a comparison, a
series), so it sits on the lecture that chose it instead of in a framing that
applies to all of them. The revision prompt is told to leave a teacher's topics
as topics rather than converting them back.

```ts
export interface CourseLecture {
  title: string;
  questions: string[];
  chapters: string[];                 // ### headings; empty when flat
  tags: string[];                     // raw drawcast tags, e.g. ["#why", "#parts=4"]
  options: Record<string, string>;    // level, minutes, language, part, …
  status?: LectureStatus;
}
export interface LectureStatus {
  state: "pending" | "done" | "failed";
  id?: string;                        // library id of the generated drawcast
  file?: string;                      // file name inside the published folder
  ts?: string;
  error?: string;
}
export interface Course {
  title: string;
  context: Record<string, string>;
  intro?: string;
  lectures: CourseLecture[];
  warnings: string[];
}
```

`formatCourse(course)` round-trips: parse → format → parse is stable, and
formatting a course the author edited by hand preserves their questions
verbatim. Tested both directions.

## 3. The planner

One LLM call: free-form request → course document. New prompt file
`src/llm/prompts/course-v1.md`, distilled from `STYLE.md` the same way
`author-v1.md` is, plus:

- **Emit questions, not topics.** 2–4 answerable questions per lecture.
- **Assign tags per lecture** from the `tags.ts` vocabulary, which is handed to
  the model in the system message. This is what gives a course *texture*:
  `#history` on the origins lecture, `#controversy` where a real debate exists,
  `#quiz` every third lecture.
- **Vary the texture.** Never the same enrichment tag on two consecutive
  lectures; `#pun` on at most a third of them.
- **Carry the fabrication guardrail** from `tags.ts` verbatim: never invent a
  controversy, quote, or statistic — assign `#controversy` only where a genuine
  debate exists.
- **Chapters are the exception.** Normally emit only `#` and `##`; add `###`
  chapters only for a lecture near the ten-minute ceiling. A chapter card costs
  a hard break, and two breaks in a five-minute lecture is one too many.
- **Fill the shared context**: notation, a running example, level, language.

Structured output with a flat schema, and the shape restated in the system
message, mirroring `OUTLINE_SCHEMA` — the client degrades to plain JSON per
session, and the model must still know what to return. `normalizeCourse()` is
tolerant in the same way `normalizeOutline` is: a lecture needs only a title to
survive.

`MAX_LECTURES = 20`.

## 4. Shared course context — the thing that makes it a course

`buildLectureRequest(course, index)` composes, per lecture:

- the course title and this lecture's questions;
- the shared context map (notation, running example) as plain lines;
- **the full lecture list with titles**, marked with which are before and after
  this one — the same device `buildPartRequest` already uses one level down;
- for lecture *i* > 0: "Lectures 1–*i* have already covered …; do not
  re-introduce them, build on them";
- the lecture's tags, appended as the tag text the ordinary parser expects, so
  `tags.ts` fragments apply unchanged;
- author-declared chapters, when present, passed into the outline call.

Ten independently generated drawcasts on causal inference will otherwise use
three different symbols for the treatment effect and re-introduce potential
outcomes five times. This block is the difference, and it is only prompt text.

## 5. The runner

`course/run.ts`, driving the **existing** multi-part path.

**Factoring first:** `generateMulti`'s core moves out of `main.ts` into
`llm/multi.ts` as `generateParts(request, opts) → { outline, specs, failed }`.
`#playlist` and the course runner then share one implementation instead of the
runner copying 80 lines. `main.ts` keeps only status reporting.

- **One global concurrency gate** (`llm/limit.ts`, a small semaphore, default 4
  in-flight `generateSpec` calls) shared by both levels. Per-level limits
  multiply: 3 lectures × 6 parts is 18 concurrent calls and a rate-limit wall.
- **Chapters** declared by the author are passed into `buildOutlineMessages`,
  which currently returns a flat part list. It gains an optional chapter list
  and distributes parts among them; the returned outline carries the chapter a
  part belongs to, and the runner emits `{chapter: …}` entries between items.
- **Status is written back into the document** after each lecture, not at the
  end. A run interrupted at lecture 7 leaves 6 lectures marked `done`.
- **"Generate" means "generate what is missing."** A lecture with
  `status: done` is skipped. Each lecture also has its own regenerate action,
  which clears its status and runs only it.
- **Failure is per lecture.** A failed lecture records `state: failed` with the
  error and the run continues; the summary names which failed.
- **Cost preview before the button.** lectures × (1 outline + parts) calls,
  shown with the estimate, and checked against the existing usage ledger
  (`ANTHROPIC_MONTHLY_TOKEN_CAP`, `loadUsage`). A run whose estimate would
  exceed the monthly cap is refused, not started and aborted halfway.
- **Runtime estimate after generation.** Count speak lines per lecture with
  `collectSpeakLines` (`export/video.ts`) times a seconds-per-line constant
  **calibrated against one real export during implementation**, not guessed
  here. Lectures over ten minutes are flagged in the document, not rejected.

## 6. The next-card

`makeNextCard({ next, index, total })` joins `makeTitlePage` and
`makeChapterCard` in `playlist.ts`, and the runner appends it as the last
**item** of every lecture except the last. Because it is an ordinary spec it
plays identically live, in the `#gh=` viewer, and in a video export — the same
reason the other cards are specs and not DOM overlays.

It shows the next lecture's title and "Lecture *i+1* of *n*". No URL.

## 7. Storage

A course is a library entry alongside drawcasts:

```ts
export interface SavedCourse {
  id: string;
  title: string;
  /** The course document, verbatim. */
  text: string;
  /** owner/repo/dir this course was last published to, when it has been. */
  target?: string;
  ts: string;
}
```

**The quota fix ships with stage A.** `saveDrawing` and `saveCourse` wrap the
write in `try`/`catch` and, on `QuotaExceededError`, surface a real error to
the caller instead of throwing into the void mid-run. The runner reports which
lecture could not be stored and leaves its status `failed`, so the work is
re-runnable rather than silently lost.

## 8. The publishing seam

```ts
export interface PublishTarget {
  /** Write the whole course; returns the public URL of each file written. */
  publish(files: PublishFile[]): Promise<Map<string, string>>;
}
```

One implementation in v1: GitHub. Drive is *mechanically* possible
(`saveSpec()` in a loop, no picker) but has two unpaid costs — per-file manual
sharing, and the missing `driveFileId` in the library (§0) — so it is left
unbuilt behind this interface, not designed around.

## 9. Publishing to GitHub

**The author's own repo, their own token.** There is no shared repo, so there
is no shared credential to protect: the token is the user's own credential for
their own repository, stored locally exactly as the API key already is. The
server-side publish endpoint considered earlier only made sense under a shared
repo and is not built.

**Settings** (localStorage, beside `apiKey`): `githubToken`, `githubRepo`
(`owner/repo`), `coursesDir` (default `courses`). The token field says: a
fine-grained PAT, **one** repository, `Contents: read and write` only, with an
expiry date. Note in the UI that localStorage is per origin — a token entered
on `drawcast.app` does not exist on `hmelberg.github.io`.

**Layout — folders in one repo, not a repo per course.** GitHub Pages serves a
whole repository as one site, so folders are enough and one Pages activation
covers every course:

```
hmelberg/kurs/
  courses/                            ← coursesDir, default "courses"
    courses.json                      manifest (titles + published file lists)
    index.html                        list of this repo's courses
    causal-inference/
      course.md                       the plan — the repo is the source of truth
      index.html                      the overview page
      potential-outcomes.yaml
      difference-in-differences.yaml
```

Publishing `course.md` alongside the lectures closes the loop: a published
course can be opened and re-run from the repo.

**File names are permanent.** A lecture's file is `<slug of title>.yaml`,
slugged ASCII-folded and lowercased, with `-2`, `-3` … appended on collision.
It is recorded in the lecture's `status:` line on first publish and **never
recomputed**: renaming a lecture changes only its displayed title, and
reordering changes only the overview page. This is what makes a published link
permanent, and it is why the name carries no position number — an `01-` prefix
would become a lie on the first reorder.

**Two hard requirements, stated once in the UI:**

- **The repo must be public.** `raw.githubusercontent.com` does not serve
  private repositories unauthenticated, so the viewer could not fetch a lecture;
  Pages on a private repo needs a paid plan. Everything published is public,
  including figures.
- **Pages must be enabled once** — github.com renders HTML as source. Note the
  nuance: **`#gh=` lecture links work without Pages** (they are raw fetches);
  only the overview page needs it.

**Preflight**, before the first publish: `GET /repos/{owner}/{repo}` — refuse
with a clear message if it is missing or `private`. Repository metadata is
readable by any fine-grained token with access to the repo, so this needs no
permission beyond the one we ask for.

**Pages is not probed.** `GET /repos/{o}/{r}/pages` requires *admin*
permission, which a `Contents`-only token deliberately does not have — it would
answer 403 whether or not Pages is on, so the check could only mislead.
Instead, the first successful publish shows the one-time Pages instruction
alongside the two URLs, and says plainly that the lecture links already work
while the overview page waits on Pages.

**One atomic commit** via the Git Data API — five calls regardless of file
count, instead of one commit and one sha fetch per file:

1. `GET /git/ref/heads/{branch}` → commit sha
2. `GET /git/commits/{sha}` → tree sha
3. `POST /git/trees` with `base_tree` and entries
   `{path, mode: "100644", type: "blob", content}` — content inline as UTF-8,
   which is all we write
4. `POST /git/commits` `{message, tree, parents: [sha]}`
5. `PATCH /git/refs/heads/{branch}`

Message: `drawcast: publish course "<title>"`.

**Deletions.** `courses.json` records the file list published for each course.
A republish diffs it and includes removed paths in the tree with `sha: null`, so
a deleted lecture stops being linkable instead of lingering as an orphan.

**Branch.** Read from the repo's default branch rather than assuming `main`.

## 10. The overview page

Generated by `course/page.ts` from the course document, so it cannot drift:

- One self-contained HTML file — inline `<style>`, no external CSS or JS, no
  build step. It can be pasted into an LMS as easily as it can be hosted.
- Course title, intro, then per lecture: number, title as a link, and its
  questions as the description. No extra AI call — the text is already there.
- The link is `{viewerBase}#gh={owner}/{repo}/{path}`. `viewerBase` is a setting
  (default `https://drawcast.app/`) because the GitHub Pages deploy exists too.
- A repo-root `index.html` listing this repo's courses is generated from
  `courses.json` by the same code.
- The same generator backs a **Download** button in the app, so an unpublished
  course still yields a plan document — with the honest limitation that without
  a host there are no links.

**Escaping is a test, not a detail.** A lecture titled with `<` or `&` must not
break the page.

## 11. The `#gh=` viewer mode

`viewer.ts` gains one source. `parseViewerHash` accepts
`#gh=owner/repo/path/to/file.yaml` (and `#gh-…`, matching the `#gdoc-` form),
alongside the existing `&style= &mode= &speed= &advance=`.

- Fetch `https://raw.githubusercontent.com/{owner}/{repo}/HEAD/{path}` — `HEAD`
  rather than a branch, so links carry no branch name and survive a rename.
- Then identical to the `#gdoc=` path: `parsePlaylistText` → `validateSpec` per
  item → mount.
- Reject paths containing `..` and paths not ending in `.yaml`/`.yml`/`.json`/
  `.txt` — better errors, smaller surface.
- The error message names the two likely causes: the repo is private, or the
  path is wrong.
- **Known caveat, stated in the publish confirmation:** the raw CDN caches for
  a few minutes, so a just-published lecture can 404 or serve the previous
  version briefly.

No generic `#url=` mode. `#gh=` is shorter for students and does not turn
drawcast.app into a renderer for arbitrary remote content.

## 12. Files

New:

```
src/course/document.ts     parse/format the course document
src/course/plan.ts         planner call: schema, messages, normalize
src/course/run.ts          batch orchestration, status write-back, resume
src/course/page.ts         overview HTML (course + repo root)
src/publish/github.ts      preflight, tree commit, manifest diff
src/llm/multi.ts           generateParts, extracted from main.ts
src/llm/limit.ts           global concurrency gate
src/llm/prompts/course-v1.md
src/ui/course.ts           the course panel
```

Changed: `playlist.ts` (`makeNextCard`), `llm/outline.ts` (optional chapters),
`store.ts` (`SavedCourse`, quota guard), `viewer.ts` (`#gh=`), `main.ts` (thin
hook; `generateMulti` reduced to status reporting).

`main.ts` is 3498 lines. Nothing in this feature is allowed to grow it beyond
the panel hook.

## 13. Testing

`vitest`, `tests/*.test.ts`, in the existing style. Network is mocked; the pure
functions carry the weight.

- **document**: parse/format round-trip; heading-vs-tag disambiguation
  (`# Title` vs `#why`); `####` warns and keeps its text; status round-trip;
  unknown keys become context; `---` ignored; hand-edited questions preserved
  verbatim.
- **plan**: `normalizeCourse` tolerance, mirroring the `normalizeOutline` tests.
- **run**: resume skips `done`; regenerate-one clears and re-runs one; a failed
  lecture records the error and the run continues; the concurrency gate never
  exceeds its limit; the cost preview refuses a run over the monthly cap.
- **github**: tree payload shape; path building; manifest diff produces
  `sha: null` deletions; preflight refuses a private or missing repo; slugging
  folds non-ASCII and resolves collisions; **a recorded file name survives a
  lecture rename and a reorder** — the test that protects permanent links.
- **page**: HTML escaping; links use `viewerBase` and the published path.
- **viewer**: `#gh=` and `#gh-` parse; `..` and wrong extensions rejected.

## 14. Delivery order

**Stage A — make the course, no GitHub.** §1–§7 plus the `generateParts`
extraction and the quota fix. Ends with: a course document you can plan, edit,
generate, resume, and save; N drawcasts in the library.

**Stage B — publish it.** §8–§11. Ends with: one commit, an overview page, and
`#gh=` links.

A stands alone — sharing works as it does today. Ship A, run one real course
through it, then start B.

**ROADMAP entries, not built here:**

- **C — catalogue.** "Share this course" opens a prefilled issue on a catalogue
  repo (a link with query parameters; no backend, no token). An Action builds a
  static index from labelled issues, 👍 reactions serve as likes, and an issue
  *is* a comment thread. An unlabelled issue simply does not appear, so nothing
  is required of the maintainer — this is what makes it work without an editor.
  PRs are rejected as a model for exactly that reason. The one real limit:
  liking or commenting needs a GitHub account. Anonymous likes are where a
  Netlify function plus Blobs would earn its place — and where the
  `consistency: "strong"` fix from §0 becomes load-bearing.
- **D — comments.** giscus on the **overview page**, one thread per course, not
  per lecture: ten empty comment sections under ten videos read as abandoned,
  and `viewer.ts` stays free of third-party scripts.
