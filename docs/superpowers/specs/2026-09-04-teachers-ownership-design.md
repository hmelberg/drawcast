# Design: Teachers and ownership — a course belongs to whoever published it

Date: 2026-09-04. Status: draft for Hans's review. Round A after the learners
round (`2026-09-04-learners-design.md`, delivered the same day). Round B
(credits for paying users) is sketched separately in
`2026-09-04-credits-sketch.md` and is NOT part of this spec.

## Goals

- A teacher sees **only the courses they own or were added to**. Nobody has
  to approve anyone: publishing a course with an author key IS becoming its
  owner.
- Anyone can create an account (Google, Microsoft or email) and gets an
  author key automatically. Learners still never log in; the course code stays
  their identity.
- An owner can add other teachers to a run by email.
- Hans is admin and sees everything, set once by hand.
- A checkbox in drawcast's course panel decides whether a published course
  page carries the join box.

## Non-goals

- Learner login through Anvil (a door that issues the code) — deferred until
  credits (round B) make an account page exist anyway.
- Credits, Stripe, proxying API calls — round B.
- Ownership of single published drawcasts (`casts/`): they have no dashboard.
- Transferring ownership, deleting courses from the dashboard — the Anvil
  Data Tables editor does both.

## 0. What already exists — verified in the delivered round

- `users` has `author_key`; the dashboard's `_user()` gate accepts any
  `enabled` user (`server_code/dashboard_server.py`), which is the hole this
  round closes. `anvil.yaml` now has `allow_signup: true`,
  `enable_automatically: true`, `allow_remember_me: true`, email login only.
- `courses` rows are auto-created by the first anonymous enrolment
  (`api.py _course_row`, fill-only, never overwrite) and by the author-key
  protected `POST /_/api/name` (overwrite). There is no owner column.
- `runs.teachers` is a `link_multiple → users` column, recorded, never read.
- drawcast registers a name after a successful course publish
  (`src/ui/course.ts`, `courseRegistration` in `src/course/publish.ts`) only
  when `getAuthorKey()` is set; `registerName` in `src/names.ts` maps
  401/409/400. `courseRegistration` already computes `title`, `page`,
  `lectures` (cast keys in order) and the course key.
- The join box appears only when the course document has an `enroll:` line
  (`course.enroll`, reserved key; `publishCourse` copies it to `meta.enroll`).
  `setCourseOption(text, key, value)` edits the header text surgically.
- The course panel's publish handler already has per-publish choices
  (comments, count views) — the natural home for one more checkbox.

## 1. Who is a teacher

Nobody is granted "teacher". Access is derived:

- **Owner:** `courses.owner` (new, `link_single → users`). Set when an
  author-key holder publishes the course (§3). First to publish an unowned
  key owns it; a later publisher with a different key gets `403 owner`.
- **Teacher on a run:** a user listed in `runs.teachers`, added by the owner
  (or admin) by email in the dashboard (§4).
- **Admin:** `users.admin` (new bool), set by Hans in the table once, sees and
  edits everything.

A user who owns nothing and is on no run sees an empty dashboard with the
hint "Publish a course from drawcast with your author key to see it here."

Signup stays open and automatic (`enable_automatically: true` is now safe:
an enabled user with no courses sees nothing). `my_author_key()` creates a
key on first call so a fresh account never has to press "Make a new key".

## 2. Schema

| table | change |
|---|---|
| `courses` | `+ owner` (`link_single → users`), `+ lectures` (`simpleObject`: cast keys in course order — the dashboard's lecture axis; today it is inferred from events or a name row) |
| `users` | `+ admin` (`bool`) |

## 3. The claim: `POST /_/api/course`

Author-key protected (like `POST /name`), budget bucket `course` 60/h/IP.

```
{ key: <author key>, course: <course key>, title, page, lectures: [cast keys] }
→ 200 { ok: true, owned: true }
→ 401 { error: "key" }      unknown/disabled author key
→ 403 { error: "owner" }    the course is owned by someone else
→ 400 { error: <field> }    parser errors, as elsewhere
```

Rules, inside one transaction:
- no row → create it with `owner = author`, title, page, lectures;
- row with `owner is None` → claim it, overwrite title/page/lectures;
- row owned by the caller → overwrite title/page/lectures;
- row owned by another → 403, nothing written.

`POST /name` for `kind: "course"` calls the same claim helper first, so a
name can only be registered by the course's owner (or claim an unowned
course). `/enroll`'s fill-only auto-create stays (a course published without
a key still works for learners; it simply has no dashboard until claimed).

## 4. Dashboard access

`_user()` stays the login gate; a new `_course_access(user, course)` is
`user["admin"] or course["owner"] == user or user in any run.teachers of the
course`. Every callable that takes a run or course id checks it and raises
`PermissionDenied` otherwise. `list_courses()` returns only accessible
courses (admin: all).

New callables, owner or admin only:
- `add_teacher(run_id, email)` — finds the `users` row by email (404 "no
  account with that email — ask them to sign up first"), appends to
  `runs.teachers`.
- `remove_teacher(run_id, email)`.

`RunForm` gets a **Teachers** card: the list, an email box and Add/Remove.
`Form1`'s empty state carries the hint from §1.

## 5. drawcast: claiming on publish, and the join-box checkbox

- After `publishCourse` succeeds and `getAuthorKey()` is set, drawcast calls
  `POST /_/api/course` (new `claimCourse` in `src/names.ts` next to
  `registerName`, same `text/plain` + 10 s timeout) BEFORE name registration,
  so the name step never runs for a course the author does not own. Outcome
  notes appended to the status: "· you own this course" / "· this course is
  owned by another author — not claimed" / "· author key rejected".
- Course panel: a checkbox **Allow sign-up on the course page** beside the
  existing publish choices. Checked → `setCourseOption(text, "enroll",
  DEFAULT_ENROLL_API)` before publishing; unchecked → the `enroll:` line is
  removed. Initial state = whether `course.enroll` is set. Default for a new
  course: off. (An author running their own Anvil app types the URL into the
  document as before; the checkbox only manages the default app.)
- Settings → Publishing help text: "Publishing with an author key makes you
  the owner of the course in the teacher dashboard."

## 6. Files

Anvil (`drawcast-anvil`): `anvil.yaml` (+2 columns), `server_code/parsers.py`
(`parse_course_claim`), `server_code/api.py` (`_claim_course` transaction,
`http_course`, `_name_set` uses the claim), `server_code/limits.py` (+`course`
bucket 60), `server_code/dashboard_server.py` (`_course_access`, filters,
`add_teacher`/`remove_teacher`, auto-key), `client_code/RunForm` (Teachers
card), `client_code/Form1` (empty state), README, tests for parsers/limits.

drawcast: `src/names.ts` (`claimCourse`, `claimNote`), `src/ui/course.ts`
(claim call + checkbox), `src/course/document.ts` (a `removeCourseOption`
beside `setCourseOption` if none exists), tests.

## 7. Testing

Unit: claim parser; access rule as a pure function `course_access(user_id,
is_admin, owner_id, teacher_ids)`; the checkbox's option write/remove round
trip. By hand: two accounts — A publishes with its key and sees the course;
B sees an empty dashboard; A adds B by email to the run; B sees that course
only; B publishing the same course key gets "owned by another author"; Hans
as admin sees both.

## 8. Decisions and risks

- **Derived, not granted.** No approval step anywhere; the author key is the
  proof of authorship. Cost: junk accounts can create junk courses they alone
  see, at 60/h/IP.
- **First publisher wins an unowned key.** A course auto-created by an
  enrolment before any publish belongs to whoever publishes it first with a
  key. Acceptable: publishing normally precedes enrolment.
- **Teachers by email require an existing account.** Simpler than invite
  links; the hint says so.
- **Learners unchanged.** Codes, optional name/email; a learner login door is
  round B's account page, if ever.
