# Design: Private publishing, one drawcast account, and a catalogue

Date: 2026-09-05. Status: draft for Hans's review. Successor to
`2026-09-04-learners-design.md` (whose §11 named four seams and left them
unbuilt — this is those seams, measured) and
`2026-09-04-teachers-ownership-design.md` (ownership by author key, which
this generalises into a session token).

**Rewritten twice the same day.** The first version made a three-word learner
code the identity and an account optional (`b5e1cd9`). Hans chose the other
way round — one account, three ways to sign in — which deletes more than it
adds (`e06abf8`). This version adds what a publisher decides: whether the
work is **listed**, who may **watch** it, how someone **gets in**, and
whether enrolment brings **mail over time**.

## Goals

- An author can publish a drawcast — and later a whole course — **to the
  drawcast server** instead of GitHub or Drive, where it is served only to
  people entitled to it.
- `drawcast.app/#spanish` is **one address** whether the thing behind it is
  public or private, a course or a single cast.
- **One account.** Signing in on the drawcast server means being signed in in
  the app, without the user having to think about how — and without anyone
  copying a key between two windows.
- **The existence of a work and the availability of its content are separate
  decisions.** A closed course can still be findable; a listed course can
  still be shut.
- **A catalogue of everything made with drawcast**, so a course has somewhere
  to be found and a community has somewhere to form.
- Enrolment is **one click** for someone signed in — or a **request** a
  teacher approves, when the course wants that.
- **Baked voice stays possible** on the drawcast server — the quality is
  worth the bytes — as a choice per course.

## Non-goals

- **Learner codes.** Deleted as a user-facing concept — §11.
- **Anonymous progress.** An open work can be watched by anyone; being
  followed requires an account.
- **A player hosted inside Anvil** — weighed and deferred, §11.
- **Credits and payment** (round B, `2026-09-04-credits-sketch.md`).
- **DRM.** A gate decides who gets the file; what they do with it afterwards
  is not this design's business.
- **Search ranking, recommendations, comments on the catalogue.** §6 lists
  what v1 holds back and why.
- **"Save to drawcast"** — a private draft store beside Drive. Named as a
  round in §12 so it stops being a footnote; not designed here.

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
- **But `req.gh` gates two things** the new source must also reach: view
  counting (`viewer.ts:366`) and progress reporting (`:382–413`).
- **Drive cannot be private.** The viewer fetches Drive files with an API key
  (`viewer.ts:233`), which serves public files only.
- **An Anvil session cannot gate a cross-origin fetch.**
  `ENDPOINT = dict(cross_site_session=False, enable_cors=True)` (`api.py:30`),
  and the alternative rests on a third-party cookie Safari blocks and Chrome
  is removing. **A redirect handshake is first-party at every hop and is
  therefore the mechanism** (§1).
- **An account already implies a publishing credential.** `my_author_key()`
  mints one on first call (`dashboard_server.py:233`); this design turns that
  single column into a table of revocable tokens.
- **A course row already exists for anything published with a credential.**
  `POST /course` stores key, title, page and the ordered lecture keys
  (teachers spec §3) — which is most of a catalogue entry already.
- **Single published drawcasts have no row.** The teachers spec excluded
  them deliberately ("they have no dashboard"); §6 gives them one.
- **View counting already exists, in Netlify Blobs**, not Anvil
  (`netlify/functions/views.mts`), read publicly by key — the view-counts
  ROADMAP note already anticipates "any dashboard is just a client of that
  URL".
- **Anvil Business has scheduled tasks** (learners spec §0), which is what
  drip mail needs (§10).
- **`runs.drip` exists and is never read** — `none | on_complete | all`,
  written by `new_run` and the dashboard, acted on nowhere.
- **Social login is three flags.** `anvil.yaml` has `use_email: true`,
  `use_google/use_facebook/use_microsoft: false`, with all three services
  installed; `allow_signup: true`, `enable_automatically: true`,
  `confirm_email: true`, `remember_me_days: 30`.
- **One dashboard assumption will rot.** `_user_by_email` scans the whole
  `users` table, commented "the table holds teachers only, so the scan is a
  handful of rows" (`dashboard_server.py:99–101`). Open signup breaks that.
- **The name registry exists.** `POST /name`, `GET /name?n=`, the rule and
  `RESERVED_PREFIXES = gh, gdoc, gdrive, url, anvil, api, name, course,
  learner` (`names.ts:11`), mirrored in `names.py` and pinned by
  `tests/names.test.ts`. A bare `#word` is looked up; a first segment
  containing `=` never is (`nameInHash`, `names.ts:26`).
- **`ENROL_SCRIPT` duplicates `learn.ts` on purpose** — a static Pages page
  has no bundler to import from (`course/enrol-script.ts:8–10`). 180 lines of
  ES5 that this design deletes.

## 1. One account, and a handshake nobody sees

The whole difficulty in this feature is that the app and the server are two
origins, so a session cookie cannot travel between them (§0). A **redirect
handshake** can, because each hop is first-party:

1. The app needs a credential and has none. It sends the browser to
   `drawcast.anvil.app/#signin?return=<url>`.
2. On the server — where the session lives — the person is recognised, or
   signs in.
3. The server mints a **one-time token** (single use, 5 minutes) and redirects
   back to `<return>&t=<token>`.
4. The app `POST /_/api/redeem {token}` → a long-lived **session token**,
   stores it, and strips `t` from the address.

**When the server session is alive, step 2 shows nothing.** The round trip is
two redirects and a blink; the person experiences having been signed in
already. When it is not alive, they get the sign-in screen — on the server,
where it belongs.

**The token, never the secret, travels in the URL.** A long-lived credential
in a fragment would land in browser history — the mistake giscus made with
its return URL (fixed 2026-09-04, `b0fefbf`). `return` is checked against an
allowlist of origins; an open redirect here would hand tokens to whoever
asked.

**What that rule actually covers — narrowed in round 0, after it was broken
by accident.** The rule was written about **an address a person sees**: one
that lands in browser history, gets copied out of a location bar, or is
pasted into a message. It is not a rule about every query string in
existence, and reading it that way is what made round 0 build
`POST /name/check` — a read, expressed as a write — to avoid a `?key=`.

Three calls do carry the session token in a query string:
`GET /cast`, `GET /cast/audio` and `POST /cast/audio`. That is deliberate.
A custom header would make each one a non-simple CORS request and buy a
preflight round trip on the path that fetches a lecture; a POST for the
audio would forfeit the `ETag` that makes the second play free. Neither URL
is ever shown, copied, or navigated to — they are `fetch` calls whose
addresses no person handles.

**The cost, stated rather than hidden:** those tokens land in the server's
access logs. A log reader is already inside the trust boundary, and a
token is revocable from the dashboard, so the exposure is bounded and
recoverable — but it is real, and it is the reason `/name/check` stays a
POST rather than being "simplified" to match its neighbours.

**Three ways to sign in, one credential.** Password, Google/Microsoft, or an
**emailed link** — `POST /_/api/login {email}` mails a one-time token that
redeems exactly like the others. The magic link survives as a way to *sign
in*, not as a second identity.

**"Author key" disappears from the vocabulary.** The app says *Sign in* and
*Signed in as …*; the token is an implementation detail. `users.author_key`
becomes a `tokens` table with one row per browser — revocable individually,
with a last-used stamp, so "sign out everywhere" is a real button. The
endpoints keep taking a bearer secret in the body, so `POST /course` and
`POST /name` change where the secret comes from, not their shape.

**The editor never requires an account.** Writing, drawing, generating,
saving locally and publishing to GitHub or Drive all work signed out, exactly
as today. Signing in is required for the drawcast server, for names, for
listing and for progress.

## 2. What a person is

```
users         (Anvil Users) · email · name · admin · created
tokens        secret (unique) · user → · created · last_used · label
enrollments   user → · run → · state (pending|active|rejected) · created · last_seen · drip_index · drip_at
events        enrollment → · kind · cast · item · step · question · given · expected · correct · at
stars         user → · work → · at
```

There is **no learners table**. Everyone who is followed has an account, so
an enrolment links a `users` row to a `runs` row and nothing else is needed.
`events` is unchanged, which is why the teacher dashboard, the progress
aggregation and the CSV export survive this round untouched.

`enrollments.code`, `learners.code`, `words.py` (1032 lines) and `codes.py`
are deleted. So is `runs.require_email` — the account has an address.

**No migration.** There are no real learners yet; the rows go.

## 3. Getting in

For someone signed in, joining is **one click**: the name and the address
already exist, so there is no form. For someone signed out, the button says
*Sign in to join* and the handshake returns them to the same place.

`POST /_/api/enroll {course, run?}` authorises from the token. The run must
be open, or the answer names the teacher to ask.

**When the run wants approval** (§5), the enrolment is created `pending`, the
teachers get a mail, and the applicant sees *Awaiting approval from the
course's teachers*. A teacher approves or declines in the run's dashboard;
either way the applicant is told. A `rejected` row is kept rather than
deleted, so the same person does not silently re-apply every week.

`POST /_/api/forget {course?}` leaves one course, or deletes the account's
enrolments and events entirely. Signing out is a different thing again and
says so: it clears this browser, not the record.

## 4. Storage: two objects per cast

A cast on the drawcast server is stored as **two objects**, never one:

| object | size | column | served |
|---|---|---|---|
| spec | ~10 KB | text | gated on every request, `Cache-Control: no-store` |
| audio | 0–7 MB | Media (blob) | unguessable URL, long `max-age`, fetched once per device |

A text column is right for the spec — 10 KB costs nothing to serialise — and
wrong for the audio, where megabytes would pass through Anvil's runtime on
every read. The measurement is the argument: the teaching content is 1 % of
the bytes, so gating the part that matters is cheap, and the expensive part
is identical for every viewer and belongs in their browser cache.

**The player never learns about the split.** `fetchAnvilText()` fetches both
and concatenates them into exactly the text `parsePlaylistText` already
expects (`spec` + `\n---\naudio:`). With no baked audio the second fetch is
skipped. No change to the parser, to `speech.prefetch`, or to mount order.

**Serving the blob — decided in round 0, against this section's first
instinct.** The plan was a **302 to the Media object's own URL**, so the
bytes would never pass through server code. Round 0 rejected it and
**streams the blob through the gated endpoint** instead, with an `ETag` on
the cast's `updated` stamp and `Cache-Control: private, no-cache`, so a
second play costs a conditional request and a 304 rather than a transfer.

Three reasons, in the order they matter:

- **A media URL is an ungated address.** Unguessable, but it answers to
  anyone who has it, forever — which is precisely what the gate exists to
  prevent for a cast whose whole point is that it is private. The capability
  URL was an acceptable trade for a public course and is not one here.
- **`immutable` would have been a lie.** A cast key is stable across
  republishes, so a long `max-age` on that URL serves last month's narration
  for as long as it lasts.
- **CORS on a cross-origin redirect to a storage host is not knowable in
  advance**, and a design that has to be discovered by deploying it is worse
  than one that cannot fail that way.

The cost is honest: every first play of a lecture's audio spends Anvil CPU
and bandwidth on the bytes. §15's quota question therefore matters more, not
less, and round 0's measurement records the streamed cost rather than
choosing between two paths.

**Baked audio is a choice per course, default on — on the server too.** It
was default off there until round 0 measured the quota
(`docs/superpowers/plans/2026-09-05-round-0-measurements.md`): 100 GB of
storage, a million rows, and no metered egress on any tier, so the 2.4 GB
below costs nothing — while unbaked audio makes every student's browser
synthesise every lecture through cloud TTS, once per student per lecture.
Baking pays once, at publish. The publish dialog's existing narration choice
applies to the new target unchanged. The arithmetic the author is choosing
between:

> A 30-student cohort through the HTA course, baked, is **≈ 2.4 GB egress**
> (30 × 17 × 4.8 MB), once per student per lecture with the audio cached.
> The same course unbaked is ≈ 7 MB in total, with the voice made in the
> browser at play time.

**Cast keys.** A server-hosted cast is keyed `anvil/<course-slug>/<file>.yaml`.
It matches `CAST_KEY_RE`, and `courseKeyOf` yields `anvil/<course-slug>` — so
the course key, the events, the progress aggregation and the dashboard grid
all keep working unmodified.

## 5. Four questions the publisher answers

One "private?" flag would be a lie, because four different things are being
decided. Each gets its own control, each with an obvious default:

| # | question | field | default |
|---|---|---|---|
| 1 | May others know this exists? | `listed: on \| off` | **on** |
| 2 | Who can watch it? | `access: open \| signed-in \| enrolled` | `open` |
| 3 | How does someone get in? | `join: anyone \| approval` | `anyone` |
| 4 | Do enrolled people get mail over time? | `drip: none \| interval \| on_complete` | `none` |

**They are independent, and that is the point.** A course may be listed and
closed — found in the catalogue, entered only by request. A course may be
unlisted and open — anyone with the link, nobody else. Listing publishes the
*title, summary and author*, never the lectures; question 2 alone decides the
content.

**The target constrains question 2.** On GitHub, `access` can only be `open`,
because the files are public and no amount of UI changes that. On the
drawcast server all three are free. In one line: **on GitHub, sign-up buys
progress. On the drawcast server it buys progress and a door.**

**Question 3 only appears when question 2 says `enrolled`,** and therefore
only on the drawcast server. Approving people into a course whose files are
public would be theatre.

**Question 4 only appears when people can enrol at all** — §10.

**One truth, two editors.** All four live on the **server**, not in the course
document. A teacher changes them in the dashboard at any time — closing
enrolment mid-course, unlisting a work, turning on approval — and the change
takes effect at once, for everyone, without republishing anything.

The document's `listed:`, `access:`, `join:` and `drip:` keys are the
**seed**: applied when the course row is first created, ignored on every
publish after that. `formatCourse` still round-trips them, so a course can be
recreated from its document.

The publish dialog therefore **reads the current settings from the server**
when it opens — it is already talking to the server for the name check — and
shows the live state rather than the document's memory of it. Changing a
control there is an explicit edit that writes through, exactly as the
dashboard's does. When the server cannot be reached, the dialog falls back to
the document's values, says so, and publishing changes no setting.

The alternative — the document winning on every publish — means a
republished lecture silently re-opens an enrolment a teacher closed two weeks
earlier. That is the kind of surprise that costs a teacher their trust in the
whole tool, and it is why these four are the server's and not the file's.

**GitHub locks `access` to `open` in both editors.** A teacher able to set
`enrolled` on a course whose lectures are public files would believe the door
was shut when it was not. The control is therefore shown disabled, with the
reason spelled out: *these lectures are public files on GitHub — move the
course to the drawcast server to close it.*

## 6. The catalogue

Everything published with a credential already leaves a row on the server
(§0), so the catalogue is mostly a flag and a public read.

**One table, two kinds.** A single published drawcast becomes a `courses` row
with `kind: cast` and no runs, rather than a second table with its own
ownership, listing and naming rules. It is a small abuse of the name and it
keeps the claim, the name registry and the catalogue query in one place.

New columns on `courses`: `kind`, `listed`, `summary`, `topics`,
`published_at`, `stars_count`.

`GET /_/api/catalogue?sort=&q=&page=` — public, cacheable, returns only
`listed` rows: title, summary, author display name, topics, kind, whether it
is open or needs enrolment, and where to go. A closed course appears with
*Request access* rather than *Open*, which is exactly the reason listing and
access are separate.

**The page lives on the server**, beside the account home (§8) — it is a
list, and `dash.py` already renders lists.

**Stars need an account**, which is why they are worth having: one row per
(user, work), toggled by `POST /_/api/star`, denormalised into `stars_count`
for sorting.

**v1 sorts by date and stars. Views wait.** Counting lives in Netlify Blobs
for GitHub-hosted casts and would live in Anvil for server-hosted ones — two
sources to merge before "sort by views" means anything. Merging them is a
cleanup, not a feature, and it should not hold up the catalogue. Search in v1
is a plain substring match over title, summary and topics.

**Held back deliberately:** ranking, recommendations, comments, and any
notion of a featured list. A catalogue that can be gamed needs rules about
gaming; a list sorted by date and stars does not.

## 7. The viewer: a fourth source

`#anvil=<course-slug>/<file>` next to `gh`, `gdoc` and `gdrive`, resolved
against the default server; `&app=<base>` overrides it for an author running
their own. In practice most links are names — `drawcast.app/#spanish/3` — and
the registry's answer carries the server's base along with the target, so the
raw form is the fallback, not the address people see.

The fetch sends the session token and gets the spec back, then the audio blob
if the document has one. `castKeyFor` gains the Anvil case so counting and
progress reporting — both currently gated on `req.gh` — keep working.

`meta.next` may cross the boundary: a free GitHub lecture pointing at a
private one. The 403 must render as *"This lecture is part of <course> —
join to watch"* with a link, never as a generic fetch error.

## 8. Resolving a name, and where each page lives

`GET /_/api/name?n=spanish` answers a **pointer, not content** —
`{kind, target, page, api}`, a few hundred bytes, public and cacheable. The
app then fetches from wherever it points: `raw.githubusercontent.com` for a
public cast, the gated endpoint for a private one. Mixing lookup and delivery
would make one endpoint both public and secret at once.

| host | pages |
|---|---|
| **drawcast.app** | the editor; a course view; every lecture |
| **drawcast.anvil.app** | the account home — your courses and your progress — the catalogue, and for teachers the dashboard that exists today |
| **GitHub Pages** | a static shop window for a public course |

**A public course's page stays static.** The published `index.html` becomes
title, intro, lecture list and one button — no script at all, so
`ENROL_SCRIPT` is deleted whole, and with it the mark rendering, the
`innerHTML` rebuild, the three staleness guards and the link rewriting.
`#spanish` may simply redirect there. That was impossible in the previous
version of this design, where the page had to carry a join box and progress
marks; with the account home on the server, it carries neither.

**A private course has no such page**, so the app renders the course view
itself from server data — reusing `coursePage`'s markup, which is a pure
string builder. One implementation, two hosts.

Keeping the static page matters for one reason: hash routes get no link
previews and no indexing, so for an open course that page is the thing you
share, and the thing a search engine can find.

## 9. What the author does

- **Settings → Publishing** replaces the author-key field with **Sign in** /
  *Signed in as hans@…*, and a *Sign out everywhere* that revokes tokens.
- **Share → Publish** gains a third target beside GitHub and Google Drive.
  It requires being signed in, because storage belongs to an account.
- The four questions from §5, shown as four controls. One that cannot apply
  at all is hidden (`join` when nobody enrols); one the target forbids is
  shown disabled with its reason (`access` on GitHub).
- Per-lecture `#free` marks a preview lecture in a private course: it
  publishes to GitHub and plays without an account, while the rest go to the
  server.

**Checking a name.** The name field gains a **Check** button beside it.
Availability needs no new endpoint — `GET /_/api/name?n=` already answers
`404 {"error":"unknown"}` for a free name — but telling *yours* from
*someone else's* needs the token, and a credential must never travel in a
query string (§1). So the check is `POST /_/api/name/check {name}` with a
`text/plain` body like every other write here, answering **free**, **yours**
(republishing moves the pointer) or **taken**.

On the button, never on keystrokes: the name-lookup budget is 600/h/IP
(`limits.py`), and check-as-you-type would spend it on one impatient author.

**A check is advice, not a reservation.** Nothing is held between the check
and the publish, and registration still answers `409` when someone got there
first. Holding a name on check would need an expiry and would invite exactly
the squatting an account requirement exists to limit.

**Names shorter than 8 characters are refused for now** — `MIN_NAME_LENGTH`
in `names.ts`, mirrored in `names.py`, pinned by `tests/names.test.ts`. Short
names are the valuable ones in a global first-come namespace, and giving them
away before the namespace has a policy is the one mistake that cannot be
undone. Three details:

- The floor applies to the **base segment only**, so a course's derived
  lecture names (`spanish/1`) keep their one-character suffix.
- It applies at **registration, not resolution**: a name already registered
  keeps resolving, so no published link dies when the floor lands.
- When a course's default name — the publish slug — falls under the floor,
  registration is **skipped with a note on the status line** and the publish
  goes through, exactly as it does today when there is no credential at all.
  A publish must not fail over a name.

**`me` joins `RESERVED_PREFIXES`**, so a course cannot take the account
home's own address if it ever moves into the app.

**Removing a work.** The dashboard deletes a course or a single cast —
**owner or admin only**, never a teacher who was added to a run: editing a
run's settings and destroying the course are different powers.

Deleting takes the stored spec and audio, the runs, the enrolments and the
events. Three things the confirmation has to say, because each is a way to
be wrong about what just happened:

- **Progress dies with it.** If any run has learners, the dialog says how
  many and offers the CSV export first — the export already exists.
- **GitHub is untouched.** For a work published there, deleting removes the
  row, the listing and the dashboard entry; the lectures stay in the repo,
  because drawcast never had the right to rewrite someone's history. The
  wording says so rather than implying a wider reach than it has.
- **The name outlives the work.** Its `names` row is kept, pointing at
  nothing, and resolves to *this drawcast has been removed* — it is **not**
  returned to the pool. Releasing `spanish` the moment a course is deleted
  would let the next registrant inherit every link already shared, which is
  a hijack with extra steps. The owner may re-point the name at another work
  or delete it explicitly, and that is the only way it becomes free.

Unlisting (§5) is the reversible half of this and should be the first thing
offered: a work that should merely stop being found does not need deleting.

## 10. Drip mail

`runs.drip` has existed since the learners round and has never been read
(§0). It becomes real here, with one added field, `runs.drip_days` (default
7), and two on the enrolment: `drip_index` and `drip_at`.

- `interval` — the next lecture's link every `drip_days` days.
- `on_complete` — the next lecture's link when the previous one is finished,
  which the `completed` event already reports.
- `none` — nothing.

A **daily scheduled task** (Anvil Business, §0) finds enrolments whose next
drip is due, sends one mail, and advances the index. It stops at the last
lecture, and it never sends to a `pending` or `rejected` enrolment.

The mail carries a plain link — `drawcast.app/#spanish/3`. No token rides
along: the account is the identity and the browser is either signed in or one
silent handshake away. That is a straight simplification over the code era,
where every mailed link had to carry `?learner=`.

**Every drip mail carries an unsubscribe link** that sets `drip_optout` on
that enrolment — per course, not per person, because opting out of one
course's mail is not opting out of another's. Bulk mail also wants the
from-address on Hans's own domain (Business plan) before the first send.

## 11. Alternatives weighed and rejected

- **Learner codes** (the first version of this file). A three-word code as
  the identity, with the account optional. It worked, and it cost: a second
  identity the API had to understand, a join box on a static page, an
  email-matching rule when a login met an existing code, "forget me on this
  device" beside "forget me", and 1032 lines of word list. An account gives
  the same recovery through a mechanism that has to exist anyway. **The
  price is anonymous progress**, which is accepted: an open work can still
  be watched by anyone, it is simply not followed.
- **Google Drive for private casts.** The viewer's Drive fetch uses an API
  key, which reads public files only (§0). Private Drive means OAuth in the
  player and a Google account per student, shared file by file.
- **A private GitHub repo.** `raw.githubusercontent.com` needs a token for
  private repos, and no student can hold one. Proxying through the server
  with the author's token puts the server in the path anyway, having added a
  dependency without removing one. Flipping a public repo private also kills
  every link already shared.
- **A separate table for single casts.** Ownership, naming, listing and the
  catalogue query would each need two code paths. `kind: cast` on `courses`
  costs one column.
- **A course-page renderer on the server.** A second implementation of
  `coursePage`, in Python, to keep in step with the TypeScript one. The app
  renders the private case instead (§8).
- **A player hosted inside Anvil.** Genuinely attractive: same origin as the
  session, so no token crosses anything. Rejected **for now** because it is a
  second front-end deployment — not just `dist-engine`, which xplainer
  already vendors, but the playlist session, the control bar, the quiz gates,
  captions and the TTS key vending that today lives in Netlify functions —
  kept in step by hand at every release. **This design is a subset of it:**
  storage, endpoints and gate are identical, so choosing it later moves the
  front end and nothing else.

## 12. Delivery order

**Round 0 — one private cast, and the handshake.** The `tokens` table
replacing `users.author_key`; `#signin` / `redeem` / `signout`; Sign in in
Settings; storage (§4); `POST /_/api/cast` and the gated read; the `#anvil=`
source; name registration with Check and the floor. No enrolment, no courses.
Output is a private drawcast at `drawcast.app/#navn` that only its author can
open — and the three measurements everything after depends on: upload of a
5–7 MB body, whether a Media URL is directly servable, and what a baked
lecture costs to serve.

**Round 1 — accounts, enrolment and the four questions.** One-click join and
approval (§3, §5), the account home on the server, the GitHub page reduced to
static, `ENROL_SCRIPT` deleted, social login enabled. The dashboard gains the
settings card that edits `access`, `join` and `drip` on a live course, and
the delete that only an owner sees (§9).

**Round 2 — the catalogue.** `kind`, `listed`, summary and topics; the public
listing endpoint; the catalogue page; stars; unlisting from the same settings
card. Small, and worth its own round because it is the first thing a stranger
sees.

**Round 3 — private courses.** Many lectures, `#free` previews, `enrolled` as
a real gate, the dashboard unchanged because the cast key never changed.

**Round 4 — drip mail** (§10), which needs the scheduled task and the sender
domain.

**Round 5 — Save to drawcast.** A private draft store beside Drive: the same
`POST /cast` with a draft flag, listed in the library.

## 13. Testing

Unit — server: token mint, redeem, single use, expiry, revocation; `return`
allowlisting; the access rule as a pure function of (access, run open,
enrolment state, owner); the approval transitions; cast-key parsing for the
`anvil/` shape; the catalogue query returning only `listed` rows; the name
floor and the `me` reservation, pinned equal to the TypeScript rule.

Unit — drawcast: `parseViewerHash` for `#anvil=`; `fetchAnvilText`'s
concatenation with and without audio; the redeem branch and the `t=` strip;
`listed` / `access` / `join` / `drip` round-tripping through
`parseCourse`/`formatCourse`.

By hand, round 0: publish one baked lecture privately; open it signed in;
open it in a second browser and be sent to sign-in; measure first byte and
total for the spec and for the audio against the same lecture on GitHub.

By hand, round 1: sign in with Google on a fresh browser and land back where
you started without seeing a form; join a course in one click; request access
to an approval course and be approved from the dashboard; answer a quiz
wrongly; see it on the account home and in the teacher's grid.

## 14. Decisions and risks

- **Listing defaults to on, including for closed courses.** That is what
  makes the catalogue useful, and it is the surprising default of the four —
  a private course's *existence* becomes public unless the author says
  otherwise. The publish dialog must therefore say plainly what gets listed:
  title, summary and author, never the lectures. One click turns it off.
- **An account is now required to be followed.** The cost of deleting codes.
- **Open signup becomes the intent**, reversing what the teachers round
  deliberately kept narrow (`allow_signup` and `enable_automatically` are
  already true; social login is three more flags). A reversal, not a silent
  flag flip — it belongs on round 1's checklist.
- **`confirm_email: true` adds a round trip** for people signing up by email.
  Google and Microsoft skip it, and a magic link proves the address anyway;
  worth turning off, deliberately.
- **The `users` table stops being teachers only.** `_user_by_email`'s
  full-table scan must be re-read against a table with student rows in it.
- **A catalogue is a moderation surface.** The moment strangers can list
  things, someone lists something that should not be there. v1's answer is
  that `users.admin` can unlist any row, and that nothing is featured or
  ranked. That is enough for a community of colleagues and not enough for a
  public product.
- **Drip mail is bulk mail.** Unsubscribe per enrolment, a sender on Hans's
  own domain, and a scheduled task that cannot double-send if it runs twice.
- **Deletion is the one irreversible button** in a tool that otherwise only
  adds. Owner-only, a confirmation that counts the learners whose records
  go with it, an export offered first, and unlisting presented as the
  reversible alternative.
- **A gate is not DRM.** After the check the browser holds the YAML.
- **The server becomes the single point of failure for private playback.**
  Public courses keep GitHub's CDN.
- **Baked audio is the author's bandwidth** — 2.4 GB per cohort for a baked
  20-lecture course (§4).
- **The 8-character floor buys time; it is not a policy.**
- **Anvil's pull stays manual.** Every delivery ends with "pull in the
  editor, choose source code".

## 15. Open

- **The Anvil plan's storage and bandwidth quota.** Ten baked courses are
  ≈ 0.8 GB stored and a few GB of transfer per cohort. This number has to
  come from Hans's plan page before round 0 is worth starting.
- **Names.** The third publish target is called "the drawcast server"
  throughout as a placeholder. The list probably reads **GitHub · Google
  Drive · drawcast**; the four controls probably read *Show in the catalogue*
  / *Who can watch* / *How people join* / *Send lectures by mail*. Hans's
  call.
