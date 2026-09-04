# Design: Private publishing and learner identity — casts in Anvil, one code per person

Date: 2026-09-05. Status: draft for Hans's review. Successor to
`2026-09-04-learners-design.md` (whose §11 named four seams and left them
unbuilt — this is those seams, measured) and `2026-09-04-teachers-ownership-design.md`
(ownership by author key, which this reuses as the publishing credential).

## Goals

- An author can publish a drawcast — and later a whole course — **to Anvil
  instead of GitHub**, where it is served only to people entitled to it.
- `drawcast.app/#russian` is **one address** for a course whether it is public
  or private. A closed one asks who you are; an open one just opens.
- A learner **identifies once on drawcast.app** and everything works from
  then on: the course view and every lecture in it.
- **One code per person**, not per course. Email required. An **account is
  optional** and works everywhere the code works.
- **Baked voice stays possible** for Anvil-published casts — the quality is
  worth the bytes — as a choice per course, not a default.
- The author key stops being a copy-paste ritual: one click, through a
  handshake that later serves student login unchanged.

## Non-goals

- **A player hosted inside Anvil.** Weighed and deferred — §9.
- **Student accounts as a second identity.** Login is a door to the code; the
  API knows one credential.
- **Credits and payment** (round B, `2026-09-04-credits-sketch.md`).
- **DRM.** A gate decides who gets the file. What they do with it afterwards
  is not this design's business.
- **Drip mail.** Still unbuilt from the learners spec; still not here.

## 0. What already exists — verified and measured, not assumed

Measured against `hmelberg/dcast` and the live Anvil app on 2026-09-05:

- **A published lecture is one self-contained text file.** Baked audio is
  appended as a second YAML document of base64 MP3 per narration line
  (`formatPublished`, `playlist.ts:338`; `AudioTrack.lines`, `:86`).
- **99 % of that file is audio.** `where-did-this-whole-enterprise-come.yaml`
  is 1.44 MB, of which the spec is **10 KB** and the audio 1.43 MB.
- **Sizes:** 66 files, 103 MB in the repo. Largest lecture 6.78 MB. The HTA
  course alone is 81 MB across 23 files. The causal-inference course —
  same kind of material, **no baked audio** — is 21 files totalling 0.4 MB.
- **GitHub has already refused a course of baked lectures:** 422 "input was
  too large to process" on a single tree body, Hans's live publish
  2026-09-02, which is why `commitFiles` uploads blobs first
  (`publish/github.ts:327`).
- **Anvil round-trip is 0.30–0.40 s** (`GET /_/api/name`, three calls) against
  0.24 s cold / **0.03 s warm** for `raw.githubusercontent.com`. Anvil's
  overhead is a fixed ~0.3 s per request, not a throughput problem.
- **A fourth viewer source is one branch.** `viewer.ts:340` is a single
  ternary over `req.gh / req.driveId / req.docId`; `parseViewerHash` is one
  regex per source.
- **The cast key can keep its shape.** `CAST_KEY_RE` (`learn.ts:11`) accepts
  `anvil/<course>/<file>.yaml`, so events, progress, the teacher grid,
  `meta.next` and the CSV export need no change at all.
- **But `req.gh` gates two things** the Anvil source must also reach: view
  counting (`viewer.ts:366`) and learner reporting (`:382–413`).
- **Drive cannot be private.** The viewer fetches Drive files with an API key
  (`viewer.ts:233`), which serves public files only.
- **An Anvil session cannot gate a cross-origin fetch.**
  `ENDPOINT = dict(cross_site_session=False, enable_cors=True)` (`api.py:30`),
  and the alternative rests on a third-party cookie Safari blocks and Chrome
  is removing. Bearer tokens are the mechanism across origins.
- **An account already implies an author key.** `my_author_key()` mints one on
  first call (`dashboard_server.py:233`).
- **Social login is three flags.** `anvil.yaml` has `use_email: true`,
  `use_google/use_facebook/use_microsoft: false`, with all three services
  installed; `allow_signup: true`, `enable_automatically: true`,
  `confirm_email: true`, `remember_me_days: 30`.
- **One dashboard assumption will rot.** `_user_by_email` scans the whole
  `users` table, commented "the table holds teachers only, so the scan is a
  handful of rows" (`dashboard_server.py:99–101`). Student signup breaks that.
- **`ENROL_SCRIPT` duplicates `learn.ts` on purpose** — a static Pages page has
  no bundler to import from (`course/enrol-script.ts:8–10`). 180 lines of ES5.
- **The name registry exists:** `POST /name`, `GET /name?n=`, reserved
  prefixes, ownership through the course claim (`src/names.ts`, `names.py`).

## 1. Storage: two objects per cast

An Anvil-published cast is stored as **two objects**, never one:

| object | size | column | served |
|---|---|---|---|
| spec | ~10 KB | text | gated on every request, `Cache-Control: no-store` |
| audio | 0–7 MB | Media (blob) | unguessable URL, long `max-age`, fetched once per device |

A text column is right for the spec — 10 KB costs nothing to serialise — and
wrong for the audio, where megabytes would pass through Anvil's runtime on
every read. That is the whole reason for the split.

Rationale is the measurement: the teaching content is 1 % of the bytes.
Gating the part that matters is cheap, and the expensive part is the same
bytes for every learner, so it should be cached by the browser rather than
re-authorised.

**The player never learns about the split.** `fetchAnvilText()` fetches both
and concatenates them into exactly the text `parsePlaylistText` already
expects (`spec` + `\n---\naudio:`). With no baked audio the second fetch is
skipped. No change to the parser, to `speech.prefetch`, or to mount order —
and no half-loaded state to debug.

**Serving the blob.** The gated endpoint answers with a **302 to the Media
object's own URL**, so the bytes never pass through server code and the
browser caches them across lectures and sessions. If Anvil's media URLs turn
out not to be directly servable, the fallback is to stream the blob through
the endpoint with a long `max-age` keyed by cast — same effect, more Anvil
CPU. Round 0 decides which.

**Baked audio is a choice per course, default off for a private course.**
The publish dialog's existing narration choice applies to the Anvil target
unchanged. The arithmetic the author is choosing between:

> A 30-student cohort through the HTA course, baked, is **≈ 2.4 GB egress**
> (30 × 17 × 4.8 MB), once per student per lecture with the audio cached.
> The same course unbaked is ≈ 7 MB in total, with the voice made in the
> browser at play time.

Neither is wrong. Baked wins on quality and works offline; unbaked wins on
storage, transfer and publish time. The author picks.

**Cast keys.** An Anvil-hosted cast is keyed `anvil/<course-slug>/<file>.yaml`.
It matches `CAST_KEY_RE`, and `courseKeyOf` yields `anvil/<course-slug>` —
so the course key, the events, the progress aggregation and the dashboard
grid all keep working unmodified.

## 2. Identity: one code per person

```
learners      code (unique) · email (unique, lowercased) · name · user → users (nullable) · created · last_seen
enrollments   learner → · run → · created · last_seen
events        enrollment → · (unchanged)
tokens        token (unique) · kind (author|learner) · user → · learner → · expires
```

- The three-word code keeps its format and its role as the only credential
  the API accepts.
- `enrollments` loses its `code` column and becomes the join row.
- **Email is required.** `runs.require_email` and its dashboard checkbox go
  away. The email is what makes recovery always possible, what lets a login
  be matched to an existing learner, and what turns the emailed link into a
  magic link.
- **No migration.** There are no real learners yet; the rows are dropped.
- Client-side, `localStorage["drawcast.learners"]` collapses from a map keyed
  by course to **one entry per Anvil app** (`{code, api, name}`) — a person in
  two courses on the same backend has one code.

`POST /event` changes its check from "does this cast belong to this
enrolment's course" to "is this person enrolled in a run of this cast's
course". No auto-enrolment: a free lecture watched by someone not enrolled
reports nothing, exactly as an anonymous viewer does today.

`POST /forget {code}` deletes the person, every enrolment and every event.
Separately, the app offers **"forget me on this device"**, which clears local
storage only. Two buttons, worded so they cannot be confused — a shared lab
machine makes that distinction matter.

## 3. Four ways in, none of them mandatory

1. **Remembered on this device** — the code in `localStorage` on drawcast.app.
   The daily path; no round trip anywhere.
2. **The link in the email** — `drawcast.app/#me=<code>`. New device, cleared
   browser, lost everything.
3. **The three words** — typed into the gate. Chosen to be memorable and
   typable on any keyboard; the way past an inbox on a lab machine.
4. **Logging in** — §4. Optional, and it ends in exactly the same place as
   the other three: a code in local storage.

**`me` joins `RESERVED_PREFIXES`** (`names.ts:11`, mirrored in `names.py` and
pinned by `tests/names.test.ts`). `#me=<code>` is safe on its own — a first
segment containing `=` is never read as a name (`nameInHash`, `names.ts:26`)
— but bare `#me` is, so a course called `me` would otherwise take the
learner's own page away from them.

## 4. One handshake, two users

Because a session cannot cross the origin boundary (§0), logging in is a way
to **fetch your credential**, not a way to be recognised:

1. drawcast.app sends the browser to
   `drawcast.anvil.app/#login?kind=<author|learner>&return=<url>`.
2. On Anvil — where the session is valid — the user logs in with email,
   Google or Microsoft (`allow_remember_me`, 30 days).
3. Anvil resolves the row for `kind`, mints a **one-time token** (single use,
   5-minute expiry, `tokens` table) and redirects back to
   `<return>&t=<token>`.
4. drawcast.app `POST /_/api/redeem {token}` → `{kind, key}` or `{kind, code}`,
   stores it, and strips the token from the address.

**The token, never the secret, travels in the URL.** A long-lived author key
in a fragment would land in browser history — the same class of mistake
giscus made with the return URL (fixed 2026-09-04, `b0fefbf`).

`return` is validated against an allowlist of origins (drawcast.app, the
Netlify preview, localhost) — an open redirect here would hand tokens to
whoever asked.

**Author and learner differ only in what the exchange returns.** Build it in
round 0 for the author key; round 1 adds a `kind` and a branch.

**Linking a login to a learner.** On `kind: learner`, find the row by `user`;
failing that by the account's email address; failing that create one and link
it. The email match is why §2 requires an email: without it, Kari logging in
with Google after enrolling by email becomes two people with half a history
each.

**Enrolling by logging in.** If the person arrives at a closed course's gate,
logs in, and is not enrolled: enrol them when the run is open; otherwise say
the course is closed and name the teacher's email. They clearly meant to join.

## 5. The gate

Two properties that are often confused and must stay separate:

- **`runs.open`** — may anyone still join? A closed run refuses new
  enrolments; its content may still be public and freely watchable.
- **private** — is the content in Anvil? A private cast is not served without
  a valid enrolment, whatever the run's state.

Access is one course-level value, `access: open | code | account`:

| value | behaviour |
|---|---|
| `open` | anyone may watch; a code, if present, still records progress |
| `code` | must present a code — by any of the four ways in |
| `account` | must be logged in to a real account (institutional or paid courses) |

Only `open` and `code` are needed now. `account` is one enum value, defined
here so the third case does not later arrive as a new mechanism.

The gate screen on `drawcast.app/#russian`, for a `code` course with nothing
stored:

> **Russisk for helseøkonomer** — this course is closed.
> Paste your code · Email me my link · Log in

## 6. The viewer: a fourth source

`#anvil=<course-slug>/<file>` next to `gh`, `gdoc` and `gdrive`, resolved
against the default app; `&app=<base>` overrides it for an author running
their own backend. In practice most links are names —
`drawcast.app/#russian/3` — and the registry's answer carries the app base
along with the target, so the raw form is the fallback, not the address
people see.

The fetch sends the code (or the author key) as a bearer parameter and gets
the spec back, then the audio blob if the document has one. `castKeyFor`
gains the Anvil case so counting and learner reporting — both currently
gated on `req.gh` — keep working.

`meta.next` may cross the boundary: a free GitHub lecture pointing at a
private Anvil one. The 403 must render as *"This lecture is part of
<course> — join to watch"* with a link to the gate, never as a generic
fetch error.

## 7. The door: what the GitHub page becomes

For a public course, the published `index.html` becomes **static** — title,
intro, lecture list, and one button "Open the course" →
`drawcast.app/#russian`. No script at all: `ENROL_SCRIPT` is deleted whole,
and with it the mark rendering, the `innerHTML` rebuild, the three staleness
guards and the link rewriting.

That keeps one property worth keeping: an indexable, shareable, JS-free page
that can be pasted into an LMS. Hash routes have neither link previews nor
indexing, so for an open course this page stays the thing you share.

A fully private course publishes no such page. Its address is `#russian`.

## 8. What the author does

- **Settings → Publishing** gains "Connect" beside the author key: one click
  through §4 instead of "log in, find the panel, copy, paste".
- **Share → Publish** gains a target: GitHub (today) or **Anvil (private)**.
  Anvil requires a key, because storage belongs to the course's owner.
- The course document gains `access:` beside `enroll:` and `name:` — a
  reserved key, kept out of `course.context`, written and removed by the
  publish dialog the way `applyJoinBox` already handles `enroll:`.
- Per-lecture `#free` marks a preview lecture in a private course: it
  publishes to GitHub and plays without a code, while the rest go to Anvil.

**Checking a name.** The publish dialog's name field gains a **Check** button
beside it. Availability needs no new endpoint — `GET /_/api/name?n=` already
answers `404 {"error":"unknown"}` for a free name — but telling *yours* from
*someone else's* needs the author key, and a key must never travel in a query
string (§4). So the check is `POST /_/api/name/check {name, key?}` with a
`text/plain` body like every other write here, answering **free**, **yours**
(republishing moves the pointer) or **taken**.

On the button, never on keystrokes: the name-lookup budget is 600/h/IP
(`limits.py`), and check-as-you-type would spend it on one impatient author.

**A check is advice, not a reservation.** Nothing is held between the check
and the publish, and registration still answers `409` when someone got there
first. Holding a name on check would need an expiry and would invite exactly
the squatting the author key exists to limit.

**Names shorter than 8 characters are refused for now** — `MIN_NAME_LENGTH`
in `names.ts`, mirrored in `names.py`, pinned by `tests/names.test.ts`. Short
names are the valuable ones in a global first-come namespace, and giving them
away before the namespace has a policy is the one mistake that cannot be
undone. Three details:

- The floor applies to the **base segment only**, so a course's derived
  lecture names (`learn-russian/1`) keep their one-character suffix.
- It applies at **registration, not resolution**: a name already registered
  keeps resolving, so no published link dies when the floor lands.
- When a course's default name — the publish slug — falls under the floor,
  registration is **skipped with a note on the status line** and the publish
  goes through, exactly as it does today when there is no author key at all.
  A publish must not fail over a name.

## 9. Alternatives weighed and rejected

- **Google Drive for casts.** The viewer's Drive fetch uses an API key, which
  reads public files only (§0). Private Drive means OAuth in the player and a
  Google account per student, shared file by file. Two access systems instead
  of one.
- **A private GitHub repo.** `raw.githubusercontent.com` needs a token for
  private repos, and no student can hold one. Proxying through Anvil with the
  author's token puts Anvil in the path anyway, having added a dependency
  without removing one. Flipping a public repo private also kills every link
  already shared.
- **Anvil-rendered course pages.** A second implementation of `coursePage`,
  in Python, to keep in step with the TypeScript one. Rejected in favour of
  rendering in the app (§5–§7), which also puts the page on the player's own
  origin and so removes the `&learner=` bridge.
- **A player hosted inside Anvil.** Genuinely attractive: same origin as the
  session, so a real login gates the content and no bearer token is needed.
  Rejected **for now** because it is a second front-end deployment — not just
  `dist-engine`, which xplainer already vendors, but the playlist session,
  the control bar, the quiz gates, captions and the TTS key vending that
  today lives in Netlify functions — kept in step by hand at every release.
  **This design is a subset of it:** the storage, the endpoints and the gate
  are identical, so choosing it later moves the front end and nothing else.

## 10. Delivery order

**Round 0 — one private cast.** Storage (§1), `POST /_/api/cast` and the
gated read, the `#anvil=` source (§6), name registration, and the author-key
handshake (§4, `kind: author`). No learners, no codes: the author key is the
only identity. Output is a private drawcast at `drawcast.app/#navn` that only
its author can open — and the three measurements the rest depends on: upload
of a 5–7 MB body, whether a Media URL is directly servable, and what a baked
lecture actually costs to serve.

**Round 1 — identity.** One code per person, email required, the course view
and `#me` in the app, the door (§7), the gate (§5), student login as a second
`kind` on the handshake.

**Round 2 — private courses.** Many lectures, `#free` previews, enrolment as
the gate, the dashboard unchanged because the cast key never changed.

## 11. Testing

Unit — Anvil: cast-key parsing and the `anvil/` shape; the access rule as a
pure function of (access value, run open, enrolment present, owner); token
mint/redeem including single use and expiry; `return` allowlisting. Unit —
drawcast: `parseViewerHash` for `#anvil=`, `fetchAnvilText`'s concatenation
with and without audio, the redeem branch, `access:` round-tripping through
`parseCourse`/`formatCourse`.

By hand, round 0: publish one baked lecture privately; open it as the author;
open it in a second browser and get the gate; measure first-byte and total
for the spec and for the audio, against the same lecture on GitHub.

By hand, round 1: join by email; open a lecture from the link; answer a quiz
wrongly; see it on `#me`; log in with Google on a second machine and land on
the same record; "forget me on this device" then paste the code back.

## 12. Decisions and risks

- **One code per person widens the blast radius.** A leaked code now reaches
  every course that person is in, not one. Accepted: the stake is course
  progress, and the code is stripped from every URL it arrives on.
- **A gate is not DRM.** After the check the browser holds the YAML. This
  stops link sharing, not file sharing.
- **Anvil becomes the single point of failure for private playback.** Public
  courses keep GitHub's CDN. Stated so it is a choice, not a discovery.
- **Baked audio is the author's bandwidth.** 2.4 GB per cohort for a baked
  20-lecture course (§1). Per-course choice, default off for private.
- **The `users` table stops being teachers only.** `_user_by_email`'s
  full-table scan must be re-read against a table with student rows in it.
- **Social login opens self-service signup.** `allow_signup` and
  `enable_automatically` are already true, so enabling Google or Microsoft
  widens the door the teachers round deliberately kept narrow. With
  publishing requiring an account, that is now the intent — but it is a
  reversal, and it belongs in round 1's checklist, not as a silent flag flip.
- **Anvil's pull stays manual.** Every Anvil delivery ends with "pull in the
  editor, choose source code".
- **The 8-character floor buys time; it is not a policy.** It stops the short
  names being spent before anyone has decided how a global first-come
  namespace should be governed — who may hold how many, whether an unused
  name lapses, whether short ones are ever sold or reserved. That decision is
  still open, and lowering the floor later costs one constant.

## 13. Open

**The Anvil plan's storage and bandwidth quota.** Ten baked courses are
≈ 0.8 GB stored and a few GB of transfer per cohort. Nothing in this design
changes shape if the quota is generous; if it is not, baked audio becomes the
exception rather than a per-course choice. This is the one number that has to
come from Hans's plan page before round 0 is worth starting.
