# Course progress: enrolment, Submit, activity signals, and what the teacher sees

Date: 2026-09-16. Status: design agreed in conversation (Hans, 2026-09-16), not planned, not built.
Builds on: `2026-09-04-learners-design.md` (runs, enrolments, events, the
teacher dashboard), `2026-09-04-teachers-ownership-design.md` (the claim on
publish, the sign-up checkbox), `2026-09-05-private-publishing-and-learner-
identity-design.md` (one account, the redirect handshake, join in one click),
`2026-09-15-stored-answers-design.md` (the local record, `secs`, `id`).

## 0. What already exists — verified in the client code, assumed on Anvil

- **Publishing an enrollable course.** Sign in once (Settings → Publishing,
  the redirect handshake). Publish the course document from Share → Publish;
  the publish claims the course for the account (`POST /_/api/course`) and
  registers its lecture paths. The course panel's checkbox *Allow sign-up on
  the course page* writes the `enroll:` line, which publish bakes into the
  page and into every lecture as `meta.enroll`. Making an already published
  course joinable is: tick the box, republish. One republish, no editing.
- **Cohorts.** A course has runs (slug, title, start, `open`, `join:
  anyone|approval`, `drip`, teachers); an enrolment belongs to a run; the
  join request carries an optional run slug, absent = the default run. The
  same course in 2027 is a second run, never a second publish. Closing
  enrolment is the run's `open` flag in the dashboard — instant, no
  republish. `access: open|signed-in|enrolled` on the course gates
  WATCHING on the drawcast server (locked to open on GitHub).
- **Joining.** Signed in: one click, no form. Signed out: *Sign in to join*,
  the handshake returns to the same place. Approval runs answer `pending`.
- **Reporting.** The viewer streams `opened` (once per browser session),
  every live `answer` (item, step, id, question, attempts, expected,
  correct, secs) and `completed` to `<enroll>/_/api/event` under the
  account's token, and stops for this page load on a 401/403. Never
  awaited; never reaches playback.
- **The record.** Every answer is appended locally per cast
  (`render/record.ts`), whoever the viewer is.
- **The dashboard** (Anvil forms, teachers only): Courses → Runs → Run view,
  a grid of learners × lectures with ○/✓ and score, a learner's answers
  verbatim on click, a per-question "% correct" column, run settings, CSV
  export of the run's events. Learners see their own progress and answer
  review on the account home.

Not verified from here: the dashboard's run-creation and default-run
controls, the catalogue and the account home. Check before promising a
colleague a second cohort.

## 1. Rulings

1. **Sending answers to the server requires a signed-in, enrolled account.**
   Anything else has no teacher to reach. The record stays local for
   everyone.
2. **Submit is small.** Enrolled students already stream every answer, so
   Submit adds exactly three things: a deliberate act ("hand in", a mark the
   teacher can treat as a deadline), the back-fill of answers given before
   the student signed in or joined, and the complete set with seconds.
3. **Sign in and join happen inside the Submit flow** when missing, through
   the existing handshake and join call, with a resume marker so the dialog
   comes back after the redirect.
4. **Reuse the Anvil structure.** No new answers format: submitted answers
   become `events` rows under the account's enrolment, upserted on
   (enrolment, cast, item, step), tagged with a submission id. The Run view,
   progress and CSV keep working; they gain columns.
5. **Activity is reported as events too**, same channel, same gate
   (enrolled account), same never-awaited rule.
6. **The uuid per drawcast is parked** in ROADMAP (Phase C); the cast path
   stays the identity in this round.

## 2. Submit

**Where.** The player control bar's `trailing` slot (next to 🎓 and Share),
shown when this browser's record for the cast is non-empty. Also on the
end poster of the last item, beside the Next link — the moment most
students will use. Never inside the drawing: a spec is also a movie, and a
drawn button would export dead into the video.

**The dialog** shows the record (question, your answer, ✓/✗, seconds) — the
"My answers" panel for free and the consent moment — and one button whose
label is the next step:

| state | button | action |
|---|---|---|
| signed out | *Sign in to hand in* | store `drawcast.submit.resume:<cast>`; run the handshake; on return with a token, reopen the dialog |
| signed in, not enrolled | *Join <course> and hand in* | `joinCourse`; `pending` → "Awaiting approval from the course's teachers", no send |
| enrolled | *Hand in* | `POST /_/api/submit` |
| no `meta.enroll` on the playlist | *Copy as text* | the record as plain text; nothing else — no mail, no file |

**What is sent.** The whole record for this cast (it survives sittings), a
submission id minted on the first press and stored with the record, the
cast key, the account token. A second press sends the same id: the server
updates, never duplicates. The server keeps the latest answer per (item,
step) and the attempts as they are.

**Endpoint.** `POST /_/api/submit {key, cast, submission, answers:[{item,
step, id, question, given, expected, correct, secs?, at}]}` → `{ok, received,
state}`; `401` bad token, `403` not enrolled in a run of this course (the
client offers the join), `429` rate. Capped at 500 answers. Idempotent on
`submission`.

**After.** The dialog says "Handed in — N answers", and the record entry is
marked submitted (id + time) so the button reads *Handed in ✓ · hand in
again* afterwards.

## 3. Activity signals

What a teacher can reasonably use, and no more. Every event carries the
account (from the token), the cast, and `at`.

| kind | when | fields |
|---|---|---|
| `opened` | first open of a cast in a browser session (exists) | — |
| `item` | an item ends (done, jump, navigation, or the page hides) | `item`, `title`, `visible_secs` (item on screen with the tab visible), `playing_secs` (player not paused), `done` (bool) |
| `answer` | a live answer (exists) | + `secs` (shipped 2026-09-16) |
| `completed` | the last item reaches done (exists) | — |
| `submitted` | Submit succeeds | `submission`, `answers` (count) |

**Signed-in time** is the server's already: `tokens.last_used` moves on
every call, and sign-in is a row. No client event needed.

**Measuring `item`.** The session counts visible seconds with
`document.visibilityState` and playing seconds from the player's state
callbacks; the counter closes on item change, on `pagehide`, and on
`visibilitychange → hidden` (sent with `keepalive`, the same trick
`completed` uses on the last frame). Seconds are integers. A jump back into
an item opens a new counter; the teacher's view sums per item. Scrubbing and
speed changes are not events — the sum of playing seconds already says
whether a lecture was watched or skimmed.

**Not collected, deliberately:** mouse movement, focus per second, the
answer text before it is given, anything from the editor (the editor has no
course context and reports nothing). The privacy sentence on the join
page lists what is stored: name, address, answers, when and how long you
watched, and that *Forget me* deletes it all.

**Gate and cost.** Same as today: only a signed-in, enrolled account
reports; a refused cast stops for the page load; nothing is awaited. One
`item` event per item view, so a 20-lecture course of 6 items each is ~120
rows per learner — trivial.

## 4. What the teacher sees (Anvil)

The Run view grid stays the unit. Additions:

- Per cell: score as today, plus **time** (Σ `playing_secs` for the lecture)
  and a **handed-in mark** with the date when a `submitted` event exists.
- Per learner (click): the timeline — opened, items with minutes, answers
  with seconds and attempts, completed, handed in; last seen.
- Per question column: "% correct" as today, plus **median seconds** — the
  slow question is the hard one.
- Run summary: learners, active in the last 7 days, median minutes per
  lecture, hand-in rate.
- CSV export gains the new columns; a second export of `item` rows for
  anyone who wants to do their own analysis.

Schema: `events` gains `item_title`, `visible_secs`, `playing_secs`,
`done`, `secs`, `submission` (nullable); kinds gain `item`, `submitted`.
Nothing else changes.

## 5. Delivery order

1. Client: `item` events from the session (visibility + player state),
   `submitted` on success; `learn.ts` types; tests as source guards plus a
   pure counter helper with unit tests. Ships with a server that ignores
   unknown kinds (it reads only what it knows — `expected` is sent today
   without being in the contract).
2. Anvil: `secs` and the new columns; `/_/api/submit`; the two new kinds
   accepted; Run view columns; CSV. Hans applies.
3. Client: the Submit dialog and the resume-after-handshake marker; the
   end-poster button. Needs 2 for the `403 → join` path.
4. Docs: the join page's privacy sentence; README teacher section.

## 6. Open

- Whether a signed-in student may edit the prefilled name at hand-in (the
  account's name is the identity; allowing an alias weakens the link).
- Cumulative score across items, and the outline telling later parts which
  names earlier parts stored (both from the stored-answers spec §4).
- The uuid per drawcast (ROADMAP Phase C).
