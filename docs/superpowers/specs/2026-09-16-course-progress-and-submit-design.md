# Course progress: enrolment, activity signals, the outbox, hand-in, and what the teacher sees

Date: 2026-09-16, revised 2026-09-17. Status: design agreed in conversation (Hans), not planned, not built.
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
  awaited; never reaches playback. A network failure is silent: that
  answer never arrives.
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

1. **Sending to the server requires a signed-in, enrolled account.**
   Anything else has no teacher to reach. The record stays local for
   everyone.
2. **No Submit button.** An enrolled student's answers already arrive as
   they are given (revised 2026-09-17: "if the course automatically
   submits data, do we need a submit button?" — no). What the button was for
   is covered otherwise: the back-fill by the outbox (§3), the deadline mark
   by a run-level hand-in flag (§4), seeing your own answers by the account
   home.
3. **One event channel, one endpoint.** Streaming and back-fill send the
   same events to the same endpoint, which accepts one event or a list. The
   server dedupes both the same way: latest answer per (enrolment, cast,
   item, step), attempts kept. No separate submit endpoint.
4. **The local record is the outbox.** Each entry carries `sent`; unsent
   entries are resent at the next open and at join. That is why the record
   stays for enrolled students too.
5. **Activity is reported as events**, same channel, same gate, same
   never-awaited rule.
6. **The uuid per drawcast is parked** in ROADMAP (Phase C); the cast path
   stays the identity in this round.

## 2. Activity signals

What a teacher can reasonably use, and no more. Every event carries the
account (from the token), the cast, and `at`.

| kind | when | fields |
|---|---|---|
| `opened` | first open of a cast in a browser session (exists) | — |
| `item` | an item ends (done, jump, navigation, or the page hides) | `item`, `title`, `visible_secs` (item on screen with the tab visible), `playing_secs` (player not paused), `done` (bool) |
| `answer` | a live answer (exists) | + `secs` (shipped 2026-09-16), `at` |
| `completed` | the last item reaches done (exists) | — |
| `handed_in` | the hand-in button, runs with the flag only (§4) | — |

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

**Gate and cost.** Only a signed-in, enrolled account reports; a refused
cast stops for the page load; nothing is awaited. One `item` event per item
view, so a 20-lecture course of 6 items each is ~120 rows per learner.

## 3. The outbox

- `AnswerRecord` gains `sent?: string` (the ISO time the server took it).
  An answer event is written to the record first, then sent; on `ok` the
  entry is stamped. `failed` leaves it unsent; `refused` stops the sweep
  for this page load, as today.
- **The sweep**: on viewer mount with a reporter, and right after a
  successful join, every unsent entry for this cast goes in one batch to
  the event endpoint. Stamped on `ok`. A batch is capped at 500 entries.
- **Join from a lecture link.** `&join=<run>` on a lecture address enrols
  the signed-in account in that run on open (signed out: the handshake
  first, the parameter survives the return), then runs the sweep. "Open
  this link" is the whole onboarding for a class. The parameter is stripped
  with `history.replaceState` like the old learner code was.
- The `item` events do not go through the record — a lost minute is not
  worth a row in localStorage; answers are.

## 4. Hand-in (runs that ask for it)

A run setting, `handin: off | on`, with an optional `due` date. Off (the
default): no button anywhere. On:

- The last item's end poster gets *Hand in* beside the Next link (the
  control bar stays as it is; a spec is also a movie, and nothing is ever
  drawn into it). Pressing it runs the sweep, then sends `handed_in`. The
  poster then reads *Handed in ✓ <time>*, from a local marker and from the
  server's progress when the two disagree.
- The teacher's cell shows the hand-in time and, with `due`, late/on time.
- No dialog, no name field: the account is the identity. (Earlier draft's
  "edit the prefilled name" is dropped — an alias weakens the link between
  account and answers, and the teacher already knows the account's name.)

## 5. What the teacher sees (Anvil)

The Run view grid stays the unit. Additions:

- Per cell: score as today, plus **time** (Σ `playing_secs` for the lecture)
  and, on hand-in runs, the **hand-in mark** with the date.
- Per learner (click): the timeline — opened, items with minutes, answers
  with seconds and attempts, completed, handed in; last seen.
- Per question column: "% correct" as today, plus **median seconds** and
  **attempts** (a question that takes three tries is a different kind of
  hard from one that takes long). Grouped by the answer's `id` — the
  `store:` name when the author gave one, else `_answers.N` — so a
  rephrased question keeps its history across cohorts when it was named.
- Run summary: learners, active in the last 7 days, median minutes per
  lecture, and on hand-in runs the hand-in rate.
- CSV export gains the new columns; a second export of `item` rows for
  anyone who wants to do their own analysis.

Schema: `events` gains `item_title`, `visible_secs`, `playing_secs`,
`done`, `secs` (nullable); kinds gain `item`, `handed_in`; the dedupe rule
on `answer` (latest per enrolment, cast, item, step; attempts merged).
`runs` gains `handin` (bool) and `due` (date, nullable). The event endpoint
accepts a list. Nothing else changes.

## 6. Delivery order

1. Client: `item` events from the session (visibility + player state);
   `learn.ts` types and a list-accepting `sendEvents`; the outbox (`sent`
   stamp, the sweep on mount and join); `&join=<run>`. Tests: a pure
   counter helper and the outbox sweep with a stubbed fetch, plus source
   guards for the wiring. Ships before the server: it ignores unknown
   kinds and reads only the fields it knows (`expected` is sent today
   without being in the contract) — a list body needs the server, so the
   sweep sends one event per call until 2 lands.
2. Anvil: the new columns, the dedupe rule, the list body, `runs.handin`
   and `due`, Run view columns, CSV. Hans applies.
3. Client: the hand-in button on the end poster, shown only when the
   lecture's progress answer says the run has `handin` on.
4. Docs: the join page's privacy sentence; README teacher section.

## 7. Open

- Cumulative score across items, and the outline telling later parts which
  names earlier parts stored (both from the stored-answers spec §4).
- The uuid per drawcast (ROADMAP Phase C).
- Whether a learner should see the class median next to their own seconds.
  Not now; it is a page on the account home when it comes.
