# Design: Learners — enrolment, progress and answers through Anvil

Date: 2026-09-04. Status: draft for Hans's review. Companion to
`2026-08-30-courses-design.md` (courses, publishing, the `#gh=` viewer) and
`2026-09-04-view-counts-design.md` (the client transport pattern this reuses).

## Goals

- A person can **join a course** from its published overview page, with or
  without giving an email address, and receive a **course code**.
- drawcast reports, for a person who has a code: each lecture **opened**, each
  lecture **completed**, and every graded answer **verbatim** (quiz choice,
  typed answer, each retry).
- A **teacher** sees, in Anvil, per-run and per-learner progress and answers.
  A **learner** sees their own progress as ticks on the course page itself.
- The same mechanism serves a self-study course (no teacher) and a taught
  course (one or more teachers, several runs of the same course).
- Simple to code and simple to use: no passwords for learners, one option
  line in the course document, one new client module, one Anvil app.

## Non-goals (this round)

- **Private courses.** Lectures stay on public GitHub. GitHub Pages cannot be
  made private below GitHub Enterprise Cloud, so privacy means Anvil-hosted
  YAML — phase 3, with its seams named in §10.
- **Save to Anvil.** After phase 3.
- **Learner accounts or passwords.** The code is the identity.
- **Time-based drip and reminders.** Phase 2 (Business plan has scheduled
  tasks); phase 1 sends only the welcome email.
- **Grading beyond right/wrong, certificates, LMS export.** The event shape
  (§4) keeps an xAPI-style export possible; nothing is built for it.
- **Abuse resistance beyond a per-IP counter.** The worst a forged code
  achieves is writing progress onto someone else's record.

## 0. What already exists — verified, not assumed

- **Answers land in one place per kind.** `src/render/player.ts:659` (quiz:
  `this.outcomes.set(index, …chosen === step.correct)`) and `:731` (ask:
  `this.outcomes.set(index, isRight(typed))`), each followed by
  `updateScoreVars()`. Auto paths (movies, gate-less players) answer
  correctly by construction; a live viewer's Skip counts as wrong.
- **The Player already exposes optional callbacks** (`onState`, `onStep`,
  `player.ts:36–37`); `PlayerState` is `"idle" | "playing" | "paused" |
  "done"`. Quiz/ask steps carry the `question` text, the `choices` and the
  `correct` index, or the `answer` string (`src/render/plan.ts:25–26`).
- **The playlist session knows when the LAST item finishes:** `showNextLink`
  in `src/playlist/session.ts:381–399` runs at that moment and, when
  `meta.next` is set, offers a real link that navigates with
  `location.reload()` — same origin, so browser storage survives it.
  `SessionOptions.onItemMounted(hd, item)` exists (`session.ts:73`).
- **The view counter is the transport template:** `src/views.ts` (never
  throw into playback, endpoint list, `text/plain` POST to stay a CORS-simple
  request, `keepalive`), called from `src/viewer.ts:253–261` with
  `castKeyFor(req.gh)` = `owner/repo/path`.
- **The viewer parses hash params** at `src/viewer.ts:95–109`
  (`mode`, `style`, `advance`, `speed`).
- **The course page is static HTML with no script**
  (`src/course/page.ts:49–60`); `lectureHref(base, owner, repo, path)` builds
  `<base>/#gh=owner/repo/path`; `viewerBase` defaults to
  `https://drawcast.app/` (`src/store.ts:195`). The page therefore usually
  lives on a **different origin** (`hmelberg.github.io`) from the player.
- **Course-level `key: value` lines become `course.context`**
  (`src/course/document.ts:154`) and are injected into every lecture's LLM
  request; per-lecture option lines go to `lecture.options`. `formatCourse`
  writes context back one key per line.
- **`publishCourse` already rewrites lecture YAML meta** (`meta.next`,
  `src/course/publish.ts:98–112`) and writes `index.html` per course
  (`:123`); `playlist.ts:51` types `meta.next`.
- **The viewer's control bar has a "More controls" fold menu**
  (`src/ui/controls.ts:824`).
- **Anvil conventions in this workspace:** `send2me` is an Anvil app repo
  owned by Anvil's GitHub sync (`anvil.yaml` with `db_schema`, `client_code/`,
  `server_code/`, `tests/`); `microdata-api` exposes HTTP endpoints from
  `server_code/` and stubs `anvil.*` in `conftest.py` for pytest. Anvil does
  **not** pull from GitHub automatically: Hans opens the editor and accepts
  the pull, choosing **source code** when the schema changed
  (`memory: project_send2me`).
- Hans's Anvil plan is **Business**: custom from-address, scheduled tasks,
  background tasks are all available.

## 1. Identity — the course code

An **enrolment** is one row: run, code, name (optional), email (optional),
created, last seen. The code is the learner's whole identity.

- **Generated server-side**, three words from a 1024-word list of short
  Norwegian nouns spelled with `a–z` only (so it types on any keyboard and
  survives any URL), joined by hyphens: `fjell-rev-havn`. ~10⁹ combinations.
  Uniqueness is **guaranteed**, not probabilistic: the server looks the code
  up before answering and draws again on a collision.
- **Case-insensitive on input**, trimmed; the page and the viewer lower-case
  before storing or sending.
- **Where it lives in the browser:** `localStorage["drawcast.learners"]`, a
  map from **course key** to `{ code, name, api }`. The course key is the
  lecture's cast key minus its file name — `owner/repo/<dir>/<slug>` — so a
  browser can be in two courses at once without the codes fighting. `api` is
  the Anvil app's base URL (§3), stored at enrolment so that events go to the
  app that issued the code and nowhere else.
- **Two origins remember it.** The course page stores it under its origin
  and appends `&learner=<code>` to every lecture link it renders. The viewer
  stores it under its own origin the first time it sees `&learner=` — with
  `api` taken from the loaded playlist's `meta.enroll` (§2) — and
  immediately removes the parameter with `history.replaceState`, so a copied
  address never carries someone's code. From then on every lecture in that
  course is attributed automatically, including the drawn Next link.
- **Another machine:** paste the code once (viewer menu, §5) or open the
  email link again. No passwords, no recovery flow — email *is* the recovery.

## 2. Joining — the course page

The course document gets one reserved top-level line:

```
# Causal Inference
enroll: https://drawcast-anvil.anvil.app
```

- `enroll` is **pulled out of `course.context`** into `course.enroll` by
  `parseCourse` and written back by `formatCourse`; it is the only reserved
  course-level key. Without it nothing on the page or in the YAML changes.
- The value is the Anvil app's base URL. Every endpoint derives from it
  (`<base>/_/api/enroll`, `/event`, `/progress`, `/forget`), so one line
  configures everything and another author can point at their own app.
- `publishCourse` bakes the **course key** (`owner/repo/<dir>/<slug>`) and the
  base URL into the page as `data-course` / `data-enroll` attributes on the
  join box, so the page's script never parses its own links to learn who it
  is.
- `publishCourse` copies it into each lecture as `meta.enroll` (next to
  `meta.next`) so a lecture opened straight from an email link — phase 2's
  drip — still knows where events go. `playlist.ts` types and round-trips
  `meta.enroll` like `meta.next`.

With `enroll` set, `coursePage` renders a **join box** under the intro and an
**inline script** (Pages serves static files; no external JS, no CSP):

- Fields: name, email, both optional in the markup; a **Join** button. The
  server decides whether email is required for this run (§3) and answers
  `400 {error:"email"}`, which the page shows as "This course needs an email
  address." Optional `?run=<slug>` in the page URL selects a run; absent, the
  server picks the run flagged default.
- On success the page shows: **"Your course code is `fjell-rev-havn`."** With
  an email: "We sent it to you as well." Without: "Write it down — it is your
  only key." It stores the entry, rewrites lecture links, and switches to
  the progress view.
- **Progress view** (any visit with a stored code): `GET /_/api/progress?code=`
  and, per lecture, `○` opened / `✓` completed / `3/4` when the lecture had
  graded questions. This *is* the learner's progress page; no Anvil page
  for learners.
- **Forget me** (link shown when a code is stored): `POST /_/api/forget`
  removes the enrolment and its events, then clears the local entry.
- **One sentence of privacy** under the form: what is stored (name, email,
  answers), who sees it (you and the course's teachers), and that "Forget
  me" deletes it. The Anvil app is hosted in the UK.
- The script is authored as a string constant in `src/course/enrol-script.ts`
  and exercised in tests through jsdom with a stubbed `fetch`.

## 3. The Anvil app

A **new Anvil app in a new GitHub repo** — proposal `hmelberg/drawcast-anvil`
(name is Hans's call). Setup is Hans's, once, in the Anvil editor: create the
app, enable **Data Tables, Users, Email**, connect GitHub sync to the new
repo. Everything after that is code in the repo and a manual pull.

### Tables (`anvil.yaml` db_schema)

| table | columns |
|---|---|
| `courses` | key (course key, unique), title, page_url, created |
| `runs` | course (link), slug, title, start, `default` (bool), `open` (bool), `require_email` (bool), `drip` (`none` \| `on_complete` \| `all`), teachers (link → Users, multiple) |
| `enrollments` | run (link), code (unique), name, email, created, last_seen |
| `events` | enrollment (link), kind, cast, step, question, given (simple object), correct (bool), at |
| `hits` | ip, bucket, window_start, n — the per-IP counter |

A course row is **created on first enrolment**, together with an open default
run — the author never sets anything up in Anvil for a self-study course. A
teacher later edits the run (require email, close, add teachers) or opens a
second run for a cohort.

### Endpoints

All `@anvil.server.http_endpoint(..., enable_cors=True)`, JSON body sent as
`text/plain` (CORS-simple, no preflight — the view counter's trick), JSON
answers, `Cache-Control: no-store`.

| endpoint | in | out |
|---|---|---|
| `POST /_/api/enroll` | `{course, title, page, run?, name?, email?}` | `{code, name, email_sent}`; `400 {error:"email"}` when the run requires one |
| `POST /_/api/event` | `{code, kind, cast, step?, question?, given?, correct?}` | `{ok:true}`; updates `last_seen`; `404` unknown code |
| `GET /_/api/progress?code=` | — | `{name, course, lectures:[{cast, opened, completed, answers:[{step, question, given, correct}]}]}` |
| `POST /_/api/forget` | `{code}` | `{ok:true}`; deletes enrolment + events |

Per-IP budgets from `anvil.server.request.remote_address`, sliding hour:
enroll 20, event 2000 (a lecture hall behind one NAT — the same reasoning as
the view counter), progress 200, forget 20. Over budget → `429`.

### Email

`anvil.email.send` on enrolment when an email was given: the code, the course
page link with `&learner=`, the forget link. From-address on Hans's domain
once its DNS is set (Business plan). Phase 2 adds `drip`.

### Teacher dashboard (Anvil forms)

Users service, **teachers only**; Hans creates teacher accounts (no open
signup). Forms: Courses → Runs → **Run view**: a grid of learners × lectures
(`○`/`✓` and score), click a learner for their answers verbatim, and a
per-question column "% correct" so weak questions stand out. Run settings
(open, default, require email, drip, teachers). **Export CSV** of the run's
events via a server function returning media.

### Tests

pytest with `anvil.*` stubbed as in `microdata-api/conftest.py`: code format
and collision retry; enrol rules (email required, run selection, course
auto-create); progress aggregation (opened/completed any-of, latest answer
per step wins); hit-counter windows. Forms are not unit-tested (Anvil DOM).

## 4. Events — what drawcast sends

A new client module `src/learn.ts`, sibling of `views.ts` and under the same
rule: nothing here may throw into playback; every failure returns `null`.

| kind | when | payload beyond `{code, cast}` |
|---|---|---|
| `opened` | first time this browser session opens the cast (own session marker, `drawcast.learned:`) | — |
| `completed` | the last item of the playlist reaches `done` — the point `showNextLink` runs | — |
| `answer` | a **live viewer's** answer lands (never movies, never gate-less players) | `step` (index), `question`, `given` (string[] — every attempt, verbatim), `correct` |

- **Which questions report:** every `quiz`, and every `ask` that has an
  `answer` (check mode). An `ask` without `answer` (collect mode: a name, a
  number for the figure) is personal input, not a graded answer, and is
  **not** sent. No per-question flag — the rule is derivable.
- **Quiz:** `given` is `["<chosen option's text>"]`, or `[]` on Skip (which
  the player already scores as wrong). **Ask with retry:** the attempts are
  collected in the retry loop and sent once when the outcome lands, so one
  event per question landing, all wrong tries preserved.
- `given` entries are capped at 2000 characters client-side.
- Reported only when `learners[courseKey]` exists **and** its `api` equals
  the playlist's `meta.enroll` when that is present — the code goes to the
  app that issued it, whatever a YAML says.

### Hooks

- `Player` gains `onAnswer?(a: { index; kind: "quiz" | "ask"; question;
  given: string[]; correct: boolean })`, called right after each
  `outcomes.set` — only on the live path (`quizGate`/`askGate` present and
  `autoAnswers` false).
- `SessionOptions` gains `onDone?()`, called once per mount at
  `showNextLink`'s call site when the finished item is the last one —
  whether or not `meta.next` is set.
- `viewer.ts` wires both, plus `opened` next to `recordView`.

## 5. The viewer menu

In `#gh=` viewer mode only (the editor has no course context), the More
menu gets one entry:

- With a code for this course: **🎓 fjell-rev-havn** (or the name). Opens a
  small dialog: *Use another code* (paste field) and *Stop reporting*
  (removes the entry).
- Without: **Course code…** → the paste field. Pasting stores the entry with
  `api` from `meta.enroll` (so a lecture must carry `meta.enroll` for a
  pasted code to work — it does, from `publishCourse`).

## 6. Files

drawcast:

- `src/course/document.ts` — `course.enroll`, reserved key, format round-trip.
- `src/course/page.ts` + new `src/course/enrol-script.ts` — join box, progress
  view, forget, link rewriting.
- `src/course/publish.ts`, `src/playlist/playlist.ts` — `meta.enroll`.
- new `src/learn.ts` — storage map, course key, `&learner=` parse/strip,
  `sendEvent`, `readProgress`.
- `src/render/player.ts` — `onAnswer`; `src/playlist/session.ts` — `onDone`.
- `src/viewer.ts` — wiring; `src/ui/controls.ts` — menu entry + dialog.
- Tests: `tests/learn.test.ts`, `tests/course-enrol.test.ts`,
  `tests/ask-player.test.ts` (onAnswer cases), a session `onDone` test,
  document/publish round-trip tests.

Anvil (`hmelberg/drawcast-anvil`): `server_code/api.py` (endpoints),
`server_code/codes.py` (word list + generator), `server_code/progress.py`
(aggregation), `server_code/limits.py`, `server_code/mail.py`, forms under
`client_code/`, `tests/` with `conftest.py`.

## 7. Delivery order

1. Anvil app: tables, `codes.py`, `enroll`/`event`/`progress`/`forget`, tests.
   Hans creates the app + repo and pulls. Smoke with curl.
2. drawcast: `learn.ts`, `onAnswer`, `onDone`, viewer wiring, menu — the
   player reports against the live app.
3. Course document `enroll`, `meta.enroll`, the page's join box and progress
   view. Publish one real course; Hans joins with and without email.
4. Teacher dashboard forms.
5. Phase 2: `drip` (on_complete / all), a reminder scheduled task, adding an
   email later from the page.

## 8. Testing

Unit as listed in §6 and §3. End-to-end, by hand, on one published course:
join without email → play a lecture → answer a quiz wrongly, then an ask
with two tries → finish → the course page shows `✓ 1/2` and the Anvil grid
shows the verbatim attempts; join with email on a second browser → welcome
mail arrives → its link attributes the next lecture; Forget me empties both.

## 9. Decisions and risks

- **Email optional at the mechanism, required per run.** A self-study run
  accepts anonymous learners; a taught run flips `require_email`. One form,
  one boolean.
- **Course rows self-create.** No Anvil setup per course. Junk rows from a
  stray POST are deletable and cost nothing.
- **Regenerated lectures shift step indices.** Events store the question
  text beside the index, and reports key by `(cast, step)` but display the
  text; a regenerated lecture simply starts new rows.
- **Anvil pull is manual** (known from send2me and microdata-api). Every
  Anvil delivery ends with "pull in the editor, choose source code".
- **The code is bearer-style.** Sharing a lecture link never leaks it
  (stripped on arrival); sharing the code itself lets someone write to your
  record. Accepted for a progress tracker.
- **Personal data.** Name, email and verbatim answers are stored in the UK
  on Anvil; the page says so in one sentence and "Forget me" deletes.

## 10. Phase 3 — private courses (seams only)

- **Publish private:** a fourth publish target posting each lecture's YAML to
  `POST /_/api/cast` (Anvil Files/Media), replacing `publishCourse`'s GitHub
  writes through the one seam the courses spec named.
- **Viewer source:** `#anvil=<app>/<course>/<lecture>` next to `gdoc`,
  `gdrive`, `gh`; the fetch carries the learner's code and the endpoint
  refuses without a valid enrolment in an open run.
- **Course page:** served by Anvil at `<base>/course/<slug>`, same markup as
  `coursePage`, so the join box and progress view are shared code.
- **Save to Anvil** afterwards, as a private draft store beside Drive.
