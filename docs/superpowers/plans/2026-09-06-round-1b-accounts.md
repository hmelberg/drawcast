# Round 1b — approval, the gate, the account home, and the link as the whole email path — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A learner can be let into a private drawcast — by one click or by a teacher's approval — and watch it; can see and leave what they follow; and can sign up and sign in by a mailed link with no password anywhere.

**Architecture:** Round 1a made the session token the learner's identity. This round makes enrolment *mean* something: `access` moves from the cast to its course and `access.cast_read` learns what the reader is to that course (enrolled, teacher, admin, owner); `/enroll` gains approval through a `join` setting on the run; the dashboard decides requests and edits both settings; an account home on the server shows what an account follows and lets it leave. The sign-in page becomes a chooser — three providers and a mailed link — and the link creates the account when the address is unknown, so `use_email` (the password) goes off. The client learns three things: a join can be pending, a refused cast is a door rather than an error, and the publish dialog's *Who can watch* sends nothing unless the author chooses.

**Tech Stack:** Python 3 + Anvil Works + pytest (drawcast-anvil); TypeScript + Vite + Vitest (drawcast). No new dependencies.

**Spec:** `docs/superpowers/specs/2026-09-05-private-publishing-and-learner-identity-design.md` — §1 (the link as the whole email path), §3 (approval; leaving), §5 (where the four live; absence means keep), §8 (the account home), §12 (round 1b), §14 (no password). Read `docs/superpowers/plans/2026-09-05-round-1a-ledger.md` first, especially "Carried into round 1b".

## Global Constraints

- **Two repos.** drawcast is worked in the worktree `~/Documents/GitHub/drawcast/.claude/worktrees/round-1b` (branch `round-1b`, node_modules symlinked); drawcast-anvil at `~/Documents/GitHub/drawcast-anvil` on `master`. Never `git add -A` — add named paths only.
- **Implementers never push.** The controller pushes drawcast-anvil once, after Tasks 1–8, and asks Hans to pull with **"source code"**. Nothing on the client depends on the pull except the smoke.
- **Anvil test:** `set -o pipefail; python3 -m pytest -q` from the repo root, and check the exit status yourself — `pytest | tail && git commit` commits a red suite.
- **drawcast test:** `npx vitest run` AND `npx tsc --noEmit`. Vitest uses esbuild and does not type-check; `tsc` is a separate gate.
- **Pure Python modules may not import `anvil.server` or `anvil.tables`** — pytest leaves those unimportable on purpose. `api.py`, `dashboard_server.py` and the forms are glue, pinned by source-text tests (`tests/test_api_source.py`, `test_dashboard_source.py`, `test_signin_source.py`).
- **Bodies are `text/plain`** (CORS-simple); answers are JSON with `Cache-Control: no-store`; every handler is budgeted through `_allowed(...)` before it touches a table.
- **search-first everywhere:** `next(iter(table.search(...)), None)`, never `.get()` on a duplicate-prone table; a get-then-create sits inside `@anvil.tables.in_transaction` with the lookup inside.
- **Absence means keep** for every optional field a write carries (`title`, `page`, `lectures`, and from this round `access`).
- **No backwards compatibility.** No real learners; columns and rows are dropped, not migrated.
- **When you retire or rename a user-facing concept, sweep `client_code/*/form_template.html` and `README.md`** — three Important findings in round 0 came from that gap, and the README is the checklist Hans follows at the pull.
- **Copy rules:** the app says *Sign in* / *Signed in*; "author key" is named nowhere that runs (pinned). Errors are `{"error": "<word>"}`.
- **A credential rides a query string only on a `fetch` no person sees** (`GET /cast`, `GET /cast/audio`, `POST /cast/audio`). Never in an address a person could copy; a mailed token rides the **fragment**.

## File Structure

**drawcast-anvil**
- `anvil.yaml` — `courses.access` (+), `runs.join` (+), `casts.access` (−); `use_email: false` (Task 8).
- `server_code/access.py` — `cast_read` grows `enrolled/teacher/admin`; `JOIN`, `ENROLLMENT_STATES`, `enrol_outcome`.
- `server_code/parsers.py` — `parse_cast_put.access` optional; `parse_enroll` admits `anvil/` (the handler guards).
- `server_code/api.py` — the gate reads the course; `/enroll` approval + server courses; `/event` active only; `request_link`, `redeem_here`, the once-token sweep, `_mail_teachers`.
- `server_code/mail.py` — `join_request`, `join_decision`.
- `server_code/tokens.py` — `mail_landing`.
- `server_code/dashboard_server.py` — `decide_enrollment`, `set_course_access`, `my_enrollments`, `leave_course`, `forget_me`, `_course_link`; `join` in `run_view`/`update_run`/`new_run`; `access` in `list_courses`.
- `server_code/dash.py` — the grid names a pending row; `my_course_html`.
- `client_code/RunForm` — `drop_join`, `panel_pending`. `client_code/Form1` — the account home; `#t=` landing; per-course access. `client_code/SignIn` — the chooser.
- `README.md` — endpoints, the pull ritual, first-time setup.

**drawcast**
- `src/learn.ts` — `JoinOutcome` + `pending`/`rejected`; `SendOutcome`.
- `src/viewer.ts` — `CastDenied`; the two doors on a refused cast; `courseDoor(..., onJoined)`; the reporter stops after a refusal.
- `src/publish/server.ts`, `src/ui/share.ts`, `src/main.ts` — `access` optional; *as before*; the account link in Settings.
- Tests: `tests/learn.test.ts`, `course-door.test.ts`, `viewer-anvil.test.ts`, `learn-viewer.test.ts`, `publish-server.test.ts`.

**Order.** Anvil Tasks 1→8 in sequence (each edits `api.py` or the forms). Client Tasks 9→10 then 11, in parallel with the Anvil sequence — different repositories cannot conflict. Task 12 after Hans's pull.

---

### Task 1: Schema — `access` on the course, `join` on the run, nothing on the cast

**Files:** Modify `drawcast-anvil/anvil.yaml`, `tests/test_schema.py`, `README.md`

**Interfaces:** Produces `courses.access` (string), `runs.join` (string), and removes `casts.access`. Every later task reads these columns; Anvil RAISES on a column that does not exist, so nothing in server code may read `casts.access` after this lands.

- [ ] **Step 1: Write the failing schema test**

Append to `tests/test_schema.py`:

```python
def test_access_lives_on_the_course_and_join_on_the_run():
    # Round 1b (spec §5): `access` is about the work, so it is the course's
    # — round 0 had put it on each cast, the wrong grain for a course of
    # twenty lectures. `join` is about a cohort, so it sits on the run
    # beside `open`. The cast row carries neither.
    assert columns("courses")["access"]["type"] == "string"
    assert columns("runs")["join"]["type"] == "string"
    assert "access" not in columns("casts")
    order = [c["name"] for c in load()["db_schema"]["runs"]["columns"]]
    assert order.index("join") == order.index("open") + 1
```

- [ ] **Step 2: Run it and watch it fail**

Run: `python3 -m pytest tests/test_schema.py -q` — Expected: FAIL (`KeyError: 'access'` on courses).

- [ ] **Step 3: Edit `anvil.yaml`**

In `db_schema.casts.columns`, delete the four-line entry whose `name: access`. In `db_schema.courses.columns`, after the `owner` entry insert:

```yaml
    - admin_ui: {}
      client_hidden: null
      name: access
      type: string
```

In `db_schema.runs.columns`, after the `open` entry insert:

```yaml
    - admin_ui: {}
      client_hidden: null
      name: join
      type: string
```

Do not touch the users service line in this task (Task 8 flips `use_email`).

- [ ] **Step 4: README — the pull ritual**

In `README.md`, under "## The pull ritual", replace the paragraph beginning "This pull (the identity round)" with:

```
This pull (round 1b) moves `access` off `casts` and onto `courses` — a
course's lectures are one door — and adds `join` to `runs` beside `open`.
Existing `casts.access` values are dropped, not migrated: every course row
reads as `enrolled` (closed) until its owner sets it in the dashboard or
publishes with a choice. `use_email` is now OFF in the users service: the
sign-in page offers Google, Microsoft, Facebook and a mailed link, and an
unknown address that asks for a link gets a passwordless account (see
"First-time setup"). If the identity round's pull was never taken, its
changes ride along: `enrollments` becomes `run, user → users, state,
created, last_seen, drip_index, drip_at`, `runs` loses `require_email`, and
`tokens` and `casts` appear while `users.author_key` goes.
```

- [ ] **Step 5: Run and commit**

Run: `set -o pipefail; python3 -m pytest -q` — Expected: PASS (350 + 1).

```bash
cd ~/Documents/GitHub/drawcast-anvil
git add anvil.yaml tests/test_schema.py README.md
git commit -m "feat(schema): access is the course's, join is the run's, the cast carries neither"
```

Do not push.

---

### Task 2: The pure rules — `cast_read` learns the reader's standing; `enrol_outcome`

**Files:** Modify `drawcast-anvil/server_code/access.py`, `tests/test_access.py`

**Interfaces:** Produces `access.cast_read(access, owner_id, user_id, enrolled=False, teacher=False, admin=False) -> bool`, `access.JOIN = ("anyone", "approval")`, `access.ENROLLMENT_STATES = ("pending", "active", "rejected")`, `access.enrol_outcome(existing_state, join) -> str`. Task 3 feeds `cast_read`; Task 4 feeds `enrol_outcome`; Task 5 validates against `JOIN`.

- [ ] **Step 1: Replace the round-0 gate test and add the enrol rule's**

In `tests/test_access.py`, delete `test_cast_read_round_0` and its parametrize block (the one with the comment "round 0: nobody else, enrolment comes in round 1"). In its place:

```python
@pytest.mark.parametrize("level, owner, user, standing, expected", [
    ("open", "u1", None, {}, True),                                   # public
    ("open", None, None, {}, True),
    ("enrolled", "u1", None, {}, False),                              # nobody signed in
    ("enrolled", "u1", "u1", {}, True),                               # the owner
    ("enrolled", "u1", "u9", {}, False),                              # a stranger, signed in
    ("enrolled", "u1", "u9", {"enrolled": True}, True),               # an ACTIVE enrolment
    ("enrolled", "u1", "u9", {"teacher": True}, True),                # a teacher of one of its runs
    ("enrolled", "u1", "u9", {"admin": True}, True),
    ("enrolled", None, "u9", {"enrolled": True}, True),               # unowned, but enrolled
    ("enrolled", None, None, {"enrolled": True, "admin": True}, False),  # no account, no standing
    ("signed-in", "u1", "u9", {}, True),                              # any account
    ("signed-in", "u1", None, {}, False),
    (None, "u1", "u9", {}, False),                                    # unset reads as enrolled
    (None, "u1", "u9", {"enrolled": True}, True),
    ("sort-of", "u1", "u9", {}, False),                               # unknown reads as enrolled too
])
def test_cast_read(level, owner, user, standing, expected):
    assert access.cast_read(level, owner, user, **standing) is expected


def test_the_join_and_state_vocabularies():
    assert access.JOIN == ("anyone", "approval")
    assert access.ENROLLMENT_STATES == ("pending", "active", "rejected")


@pytest.mark.parametrize("existing, join, expected", [
    (None, "anyone", "active"),
    (None, "approval", "pending"),
    (None, None, "active"),            # a run written before the column existed
    ("pending", "approval", "pending"),  # a second click never re-mails the teachers
    ("rejected", "anyone", "rejected"),  # spec §3: no silent re-apply
    ("active", "approval", "active"),    # turning approval on later does not demote anyone
])
def test_enrol_outcome(existing, join, expected):
    assert access.enrol_outcome(existing, join) == expected
```

`pytest` is already imported at the top of the file.

- [ ] **Step 2: Run and watch it fail**

Run: `python3 -m pytest tests/test_access.py -q` — Expected: FAIL (`TypeError: cast_read() got an unexpected keyword argument`; `JOIN` missing).

- [ ] **Step 3: Grow `access.py`**

Replace the `cast_read` function and its comment block with:

```python
def cast_read(access, owner_id, user_id, enrolled=False, teacher=False, admin=False):
    """Who may read a stored cast (spec §5, question 2), given the COURSE's
    `access` — round 1b moved it off the cast: a course's lectures are one
    door — and what the reader is to that course.

    `open` is public. Anything else needs an account. The owner, a teacher
    of one of the course's runs and an admin always pass: they are the
    people the door exists for. `signed-in` then admits any account.
    `enrolled` admits an ACTIVE enrolment and nobody else — and so does any
    value that is not one of the three, since a course row written before
    the column existed reads as None and the closed reading is the safe one.
    api._read_denied feeds this ids and the reader's standing (_standing)."""
    if access == "open":
        return True
    if user_id is None:
        return False
    if admin or teacher or (owner_id is not None and owner_id == user_id):
        return True
    if access == "signed-in":
        return True
    return bool(enrolled)
```

After `ACCESS = (...)` add:

```python
# How someone gets into a run (spec §5, question 3) and where an enrolment
# can stand (spec §3). `pending` and `rejected` arrive with round 1b.
JOIN = ("anyone", "approval")
ENROLLMENT_STATES = ("pending", "active", "rejected")
```

And after `slug_owner_conflict` add:

```python
def enrol_outcome(existing_state, join):
    """What POST /enroll does with a (run, user) pair: the state to WRITE for
    a new row, or the state to REPORT for one that exists. A row that exists
    is never rewritten by a second click — pending stays pending (the
    teachers are not nagged), rejected stays rejected (spec §3: the same
    person does not silently re-apply), active stays active. A new row is
    active unless the run wants approval; a run written before `join`
    existed reads as None and means anyone."""
    if existing_state is not None:
        return existing_state
    return "pending" if join == "approval" else "active"
```

- [ ] **Step 4: Run and commit**

Run: `set -o pipefail; python3 -m pytest -q` — Expected: PASS.

```bash
git add server_code/access.py tests/test_access.py
git commit -m "feat(access): the gate knows enrolment, teaching and admin; the enrol rule is pure"
```

---

### Task 3: The gate reads the course — `access` written through the claim, read by `_read_denied`

**Files:** Modify `drawcast-anvil/server_code/api.py`, `server_code/parsers.py`, `tests/test_parsers.py`, `tests/test_api_source.py`, `README.md`

**Interfaces:** Consumes `access.cast_read(...)` (Task 2). Produces `POST /cast {key, cast, title?, spec, access?}` where a missing `access` keeps the course's value; `GET /cast` and `GET /cast/audio` answering `401 key` (closed, nobody signed in) and `403 access` (signed in, no standing); `_claim_course_in_tx(key, author, title, page, lectures, access=None)`; `_course_of_cast(key)`; `_standing(course, user)`.

- [ ] **Step 1: The parser — `access` is optional now**

In `tests/test_parsers.py`, in `test_parse_cast_put_accepts_an_anvil_key`, change the expected dict's `"access": "enrolled"` to `"access": None` and the following line to `assert out["access"] is None  # absent means keep the course's value (spec §5)`. `test_access_must_be_one_of_three` stays as it is. Run `python3 -m pytest tests/test_parsers.py -q` — FAIL. Then in `parsers.parse_cast_put` replace

```python
    access = body.get("access", "enrolled")
    if access not in ACCESS:
        raise BadRequest("access")
```

with

```python
    # Absent means KEEP (spec §5): the course's stored value stands, and a
    # course this publish creates gets the default in api._claim_course_in_tx.
    # Present, it is the author's explicit choice and must be one of three.
    access = body.get("access")
    if access is not None and access not in ACCESS:
        raise BadRequest("access")
```

and in the docstring replace "`access` defaults to the closed value." with "`access` is None when absent — the course keeps its value."

- [ ] **Step 2: Pin the gate's new shape, and watch the pins fail**

Append to `tests/test_api_source.py`:

```python
def test_the_gate_reads_the_course_and_the_readers_standing(source):
    # Round 1b (spec §5): access is the course's. The read resolves the
    # cast's course by slug, decides `open` before touching the key, and
    # feeds cast_read the reader's standing — an ACTIVE enrolment, a run's
    # teacher, an admin — so `enrolled` is a real door and `signed-in`
    # admits any account. casts.access is gone: nothing may read it.
    gate = body_of("_read_denied")
    assert "_course_of_cast(row[\"key\"])" in gate
    assert 'course["access"]' in gate
    assert gate.index('== "open"') < gate.index("_author(")
    assert 'row["access"]' not in source
    standing = body_of("_standing")
    assert 'e["state"] == "active"' in standing
    assert 'r["teachers"]' in standing
    assert 'user["admin"]' in standing
    assert "**_standing(course, user)" in body_of("_may_read")
    assert "next(iter(app_tables.courses.search(key=rq.slug_of(key))), None)" in body_of("_course_of_cast")


def test_access_is_written_through_the_claim_and_absence_keeps_it(source):
    # The publish body's access goes to the COURSE row, by the same
    # absence-means-keep rule as title, page and lectures; a course the
    # publish creates gets the closed default. The cast row carries none.
    claim = body_of("_claim_course_in_tx")
    assert 'access=access or "enrolled"' in claim
    assert 'if access is not None:' in claim and 'updates["access"] = access' in claim
    write = body_of("_cast_write")
    assert "_claim_course_in_tx(rq.slug_of(key), author, None, None, None, access)" in write
    assert "access=" not in write.split("_claim_course_in_tx")[1].split("return")[0].replace("access=access", "")
    put = body_of("_cast_put")
    assert 'req["access"]' in put
    assert "access=req" not in put  # not in the cast's fields
```

Run: `python3 -m pytest tests/test_api_source.py -q` — Expected: FAIL on both.

- [ ] **Step 3: The claim carries `access`**

In `api.py`, change `_claim_course_in_tx`'s signature to `def _claim_course_in_tx(key, author, title, page, lectures, access=None):` and:

- the create branch's `add_row(...)` gains `access=access or "enrolled"` (spec §5: the default is the closed one);
- after `if lectures is not None: updates["lectures"] = lectures` add
  ```python
      if access is not None:
          updates["access"] = access
  ```
- extend the docstring's third sentence: "lectures is written when given, like title and page — and so is `access` (round 1b): absent keeps the stored door, present is the owner's explicit choice, and a course this creates gets the closed default."

`_claim_course` (the transactional wrapper) keeps its five arguments; it passes no access.

- [ ] **Step 4: The cast write hands `access` to the course, not the cast**

Change `_cast_write`'s signature to `def _cast_write(key, author, fields, access):`, replace the line `if _claim_course_in_tx(rq.slug_of(key), author, None, None, None) == "owner":` with `if _claim_course_in_tx(rq.slug_of(key), author, None, None, None, access) == "owner":`, and in the docstring replace the sentence beginning "The course is the other half of the namespace" with:

"The course is the other half of the namespace, and it is claimed HERE too, on every write — and it is where `access` goes (round 1b, spec §5): the body's value writes through to the course row when present and leaves it alone when absent, the cast row carries no door of its own."

In `_cast_put`, replace

```python
    fields = dict(title=req["title"], spec=req["spec"], access=req["access"], updated=utcnow())
    outcome = _cast_write(req["cast"], author, fields)
```

with

```python
    fields = dict(title=req["title"], spec=req["spec"], updated=utcnow())
    outcome = _cast_write(req["cast"], author, fields, req["access"])
```

- [ ] **Step 5: The read**

Replace `_may_read` and `_read_denied` (keep `_cast_row` above them) with:

```python
def _course_of_cast(key):
    """The course a stored cast belongs to: the row keyed by its slug, which
    _cast_write claims on every publish. search-first, like every lookup
    here. None only for a row that predates the claim, which reads as
    closed (cast_read treats a missing level as `enrolled`)."""
    return next(iter(app_tables.courses.search(key=rq.slug_of(key))), None)


def _standing(course, user):
    """What `user` is to `course`, for the gate: an ACTIVE enrolment in one
    of its runs (a pending or rejected one opens nothing), a teacher of one
    of its runs, or an admin. The owner is decided by id inside cast_read.
    A handful of rows each way — a course's runs, an account's enrolments."""
    if course is None:
        return {"enrolled": False, "teacher": False, "admin": bool(user["admin"])}
    runs = list(app_tables.runs.search(course=course))
    teacher = any(user.get_id() in [t.get_id() for t in (r["teachers"] or [])] for r in runs)
    enrolled = any(e["state"] == "active" and e["run"] is not None and e["run"]["course"] == course
                   for e in app_tables.enrollments.search(user=user))
    return {"enrolled": enrolled, "teacher": teacher, "admin": bool(user["admin"])}


def _may_read(row, course, user):
    """The gate, rows in: the course's level, the cast's owner, the reader
    and the reader's standing. The rule itself is access.cast_read."""
    owner = row["owner"]
    return access.cast_read(None if course is None else course["access"],
                            None if owner is None else owner.get_id(),
                            user.get_id(), **_standing(course, user))


def _read_denied(row, key):
    """The gate as a response: None when the caller may read `row`, else the
    answer. The level is the COURSE's (spec §5, round 1b). An open course
    never resolves the key at all — no lookup, no last_used stamp. On a
    closed one, nobody signed in (no key, or a key that is no session) is
    401, the client's cue to sign in; someone signed in without standing is
    403, the client's cue to offer the door."""
    course = _course_of_cast(row["key"])
    if course is not None and course["access"] == "open":
        return None
    user = _author(key)
    if user is None:
        return json_response({"error": "key"}, 401)
    if not _may_read(row, course, user):
        return json_response({"error": "access"}, 403)
    return None
```

`grep -n 'row\["access"\]' server_code/` must come back empty.

- [ ] **Step 6: README**

In the endpoint table, the `POST /cast` row: replace `{key, cast, title?, spec, access?}` and its answer cell's tail with: body `{key, cast, title?, spec, access?}`, answer `… claims the course `anvil/<slug>` for the author and writes `access` to THAT row when the body carries it (absent means keep; a course this creates is `enrolled`); clears the stored audio`. The `GET /cast` row: `the spec as text/plain — 401 key (a closed course, nobody signed in), 403 access (signed in, but not enrolled, teaching, owning or admin), 404 unknown`. In the prose paragraph on `POST /cast`, replace the last sentence ("`access` is `open` (public) … without moving the check.") with:

```
`access` — `open`, `signed-in` or `enrolled` — is the COURSE's from round
1b (spec §5): the body's value writes through to `courses.access` when
present and leaves it alone when absent (the app's "as before"), and a
course the publish creates starts `enrolled`. The read consults the course:
`open` is public; anything else needs a session key; then the cast's owner,
any teacher of one of the course's runs and an admin always read,
`signed-in` admits any account, and `enrolled` admits an ACTIVE enrolment
in one of the course's runs — a pending or declined request opens nothing.
```

- [ ] **Step 7: Run and commit**

Run: `set -o pipefail; python3 -m pytest -q` — Expected: PASS.

```bash
git add server_code/api.py server_code/parsers.py tests/test_parsers.py tests/test_api_source.py README.md
git commit -m "feat(casts): the door is the course's, and enrolment, teaching and admin open it"
```

---

### Task 4: `/enroll` — approval, and the server's own courses; `/event` counts active only

**Files:** Modify `drawcast-anvil/server_code/api.py`, `server_code/parsers.py`, `server_code/mail.py`, `tests/test_parsers.py`, `tests/test_mail.py`, `tests/test_api_source.py`, `README.md`

**Interfaces:** Consumes `access.enrol_outcome` (Task 2). Produces `POST /enroll → {ok: true, state: "active"|"pending"|"rejected"}`, `mail.join_request(course_title, run_title, applicant_email, dashboard_url) -> (subject, text)`, `mail.join_decision(course_title, approved, link) -> (subject, text)`, `api._mail_teachers(run, applicant)`. Task 5's `decide_enrollment` consumes `mail.join_decision`.

- [ ] **Step 1: The mail texts, failing first**

Append to `tests/test_mail.py`:

```python
def test_the_join_request_names_who_what_and_where_to_decide():
    subject, text = mail.join_request("Spanish 1", "spring", "kari@example.org", "https://drawcast.anvil.app/")
    assert "kari@example.org" in subject and "Spanish 1" in subject
    assert "spring" in text and "https://drawcast.anvil.app/" in text


def test_the_decision_mail_says_yes_with_a_link_and_no_without_one():
    subject, text = mail.join_decision("Spanish 1", True, "https://drawcast.app/#spanish-one")
    assert "Spanish 1" in subject and "https://drawcast.app/#spanish-one" in text
    subject, text = mail.join_decision("Spanish 1", False, "https://drawcast.app/#spanish-one")
    assert "declined" in text and "https://drawcast.app/#spanish-one" not in text
```

Run: `python3 -m pytest tests/test_mail.py -q` — FAIL. Append to `mail.py`:

```python
def join_request(course_title, run_title, applicant_email, dashboard_url):
    """To the course's owner and the run's teachers (spec §3): who asked,
    for what, and where the decision is taken. The address is the
    applicant's own — it is what the dashboard shows and what they gave."""
    subject = "%s asked to join %s" % (applicant_email, course_title)
    text = (
        "%s asked to join %s (%s).\n"
        "\n"
        "Approve or decline in the drawcast dashboard:\n"
        "\n"
        "%s\n"
    ) % (applicant_email, course_title, run_title, dashboard_url)
    return subject, text


def join_decision(course_title, approved, link):
    """To the applicant, either way (spec §3). A yes carries the course's
    link; a no carries no link at all — there is nothing for them to open."""
    if approved:
        return ("You're in: %s" % course_title,
                "The teachers of %s approved your request to join.\n\nStart here:\n\n%s\n" % (course_title, link))
    return ("Your request to join %s" % course_title,
            "The teachers of %s declined your request to join. If you think that is a mistake, ask them directly.\n" % course_title)
```

- [ ] **Step 2: The parser admits the server's namespace**

In `tests/test_parsers.py`, replace `test_parse_enroll_refuses_the_server_namespace` (the whole function, comment and both asserts) with:

```python
def test_parse_enroll_admits_the_server_namespace_now_the_handler_guards_it():
    # Round 1b: an anvil/ course has a door in the app (the viewer's 403
    # door), so /enroll must take the key. The reason the identity round
    # refused it — the handler CREATED the course row with the caller's
    # title and page — is closed in http_enroll instead: for anvil/ keys it
    # only ever reads a row a publish already claimed.
    out = rq.parse_enroll({"key": "k" * 40, "course": "anvil/spanish1", "title": "Spanish",
                           "page": "https://drawcast.app/#spanish-one"})
    assert out["course"] == "anvil/spanish1"
```

Run: `python3 -m pytest tests/test_parsers.py -q` — FAIL. In `parsers.parse_enroll`, delete the line `_refuse_server_course(course)` and change the docstring's last sentence to: "An `anvil/` course key is admitted from round 1b — the handler reads the claimed row and never creates one (see `_refuse_server_course` for the two doors that stay shut)." In `_refuse_server_course`'s docstring, replace the paragraph beginning "POST /enroll is the third door" with:

"POST /enroll admitted `anvil/` keys in round 1b, once a server course had a door to enrol from (the viewer's 403 door). It is safe because http_enroll never creates or fills in a course row for that namespace: the row must already exist and be owned, else `404 run` — so the squatter's title and page this door was closed against can never be written."

- [ ] **Step 3: Pin the handler, and watch the pins fail**

In `tests/test_api_source.py`, in `test_enroll_authorises_from_the_token_and_mints_nothing`, replace `assert 'state="active"' in body` with `assert "access.enrol_outcome(" in body and "state=state" in body`. Then append:

```python
def test_enroll_never_creates_a_server_course(source):
    # An anvil/ course row is made by a publish and nowhere else: /enroll
    # reads it, requires an owner, and answers "run" (nothing written) when
    # it is missing or unowned. GitHub courses keep the fill-only create.
    body = body_of("http_enroll")
    at = body.index("startswith(rq.CAST_PREFIX)")
    server = body[at:body.index("else:", at)]
    assert "app_tables.courses.search(key=req[\"course\"])" in server
    assert 'course["owner"] is None' in server
    assert '{"error": "run"}, 404' in server
    assert "add_row" not in server and "_course_row(" not in server
    assert "_course_row(" in body[body.index("else:", at):]


def test_enroll_writes_pending_when_the_run_wants_approval_and_mails_once(source):
    body = body_of("http_enroll")
    assert 'run["join"]' in body
    assert 'if state == "pending":' in body
    assert "_mail_teachers(run, user)" in body
    # Mailed on CREATE only: a second click on a pending request reports the
    # state and touches nothing — the teachers are not nagged.
    assert body.index("add_row(") < body.index("_mail_teachers(")
    assert body.count("_mail_teachers(") == 1
    # An existing row's state is reported as stored, never rewritten.
    assert 'elif row["state"] == "active":' in body
    mailer = body_of("_mail_teachers")
    assert "mail.join_request(" in mailer
    assert "except Exception" in mailer  # never fatal to the enrolment
    assert 'run["teachers"]' in mailer and 'course["owner"]' in mailer


def test_event_counts_active_enrolments_only(source):
    body = body_of("http_event")
    assert 'e["state"] == "active"' in body
    assert body.index('e["state"] == "active"') < body.index('"enrol"')


def test_a_new_run_starts_open_to_anyone(source):
    assert 'join="anyone"' in body_of("_run_row")
```

Run: `python3 -m pytest tests/test_api_source.py -q` — FAIL.

- [ ] **Step 4: The handler**

In `_run_row`, the `add_row(...)` gains `join="anyone",` after `open=True,`. Replace `http_enroll` whole with:

```python
@anvil.server.http_endpoint("/enroll", methods=["POST"], **ENDPOINT)
def http_enroll(**params):
    """One click for someone signed in — or a request, when the run wants
    approval (spec §3). The account IS the identity, so there is nothing to
    mint: joining twice reports the enrolment that already exists, in
    whatever state it is in (access.enrol_outcome: pending stays pending,
    rejected stays rejected). The key is resolved BEFORE any row is touched,
    so nobody unsigned-in creates rows.

    Two kinds of course key. A GitHub course (owner/repo/dir) is created
    fill-only if missing, as before. A server course (anvil/<slug>) is
    NEVER created here: its row is made by the publish that claims it, and
    a missing or unowned one is "run" with nothing written — the squatter's
    title and page the identity round closed this door against."""
    if not _allowed("enroll"):
        return json_response({"error": "rate"}, 429)
    try:
        req = rq.parse_enroll(load_body())
    except rq.BadRequest as exc:
        return _bad(exc)
    user = _author(req["key"])
    if user is None:
        return json_response({"error": "key"}, 401)
    if req["course"].startswith(rq.CAST_PREFIX):
        course = next(iter(app_tables.courses.search(key=req["course"])), None)
        if course is None or course["owner"] is None:
            return json_response({"error": "run"}, 404)
    else:
        course = _course_row(req["course"], req["title"], req["page"])
    run = _run_row(course, req["run"])
    if run is None:
        return json_response({"error": "run"}, 404)
    if not run["open"]:
        return json_response({"error": "closed"}, 403)
    now = utcnow()
    # search-first, like every lookup here: nothing enforces uniqueness on
    # (run, user), and .get() raises on a duplicate.
    row = next(iter(app_tables.enrollments.search(run=run, user=user)), None)
    state = access.enrol_outcome(None if row is None else row["state"], run["join"])
    if row is None:
        row = app_tables.enrollments.add_row(run=run, user=user, state=state,
                                             created=now, last_seen=now, drip_index=0, drip_at=None)
        if state == "pending":
            _mail_teachers(run, user)
    elif row["state"] == "active":
        row.update(last_seen=now)
    # The row's own state, not the literal: a hand-edited row must not be
    # reported as something it is not.
    return json_response({"ok": True, "state": row["state"]})


def _mail_teachers(run, applicant):
    """The join request (spec §3): one mail to the course's owner and the
    run's teachers, naming the applicant's address and the course, sent
    inline — one click, one mail — and never fatal: the enrolment is
    written whether the mail goes or not, and a failure is the server
    log's. Nothing to send to when the course is unowned and the run has
    no teachers, which a claimed course cannot be."""
    course = run["course"]
    people = [course["owner"]] + list(run["teachers"] or [])
    addresses = sorted({p["email"] for p in people if p is not None and p["email"]})
    if not addresses:
        return
    subject, text = mail.join_request(course["title"] or course["key"], run["title"] or run["slug"] or "default",
                                      applicant["email"], anvil.server.get_app_origin() + "/")
    try:
        anvil.email.send(to=addresses, from_name=mail.FROM_NAME, subject=subject, text=text)
    except Exception as exc:
        print("join request mail failed: %r" % (exc,))
```

In `http_event`, change the list comprehension to require an active row:

```python
    rows = [e for e in app_tables.enrollments.search(user=user)
            if e["state"] == "active" and e["run"] is not None and e["run"]["course"] is not None
            and e["run"]["course"]["key"] == course_key]
```

and add to its docstring: "Only an ACTIVE enrolment counts (round 1b): a pending or declined request is `403 enrol` like no enrolment at all."

- [ ] **Step 5: README**

Endpoint table, `/enroll` row: body unchanged; answer: `{ok, state}` — `state` is `active`, `pending` (the run wants approval — the teachers are mailed once, on the first click) or `rejected` (a declined request is kept, and a second click reports it); idempotent; `401 key`, `403 closed`, `404 run` (also an `anvil/` course nobody has published). In the "`POST /enroll` is one click" paragraph: delete "(`state` is `active` throughout this round; `pending`/`rejected` are round 1b's)"; replace the sentence "An `anvil/` key is `400 {"error":"reserved"}` on all three doors — `/course`, a course-kind `/name`, and `/enroll`:" and what follows about `/enroll` with:

```
An `anvil/` key is `400 {"error":"reserved"}` on both claim doors —
`/course` and a course-kind `/name` — because a course in the server's own
namespace is claimed by publishing into it (`POST /cast` claims
`anvil/<slug>`), never by asking. `/enroll` takes an `anvil/` key from round
1b (the viewer's 403 door enrols into one) but NEVER creates or fills in
that row: it must already exist and be owned, else `404 run`. When the run's
`join` is `approval`, a new enrolment is written `pending`, the owner and the
run's teachers get one mail, and the answer's `state` says so; a teacher
decides in the dashboard and the applicant is mailed either way. `/event`
counts only an `active` enrolment.
```

Also delete the README sentence "A client-side stop belongs to the round that adds the account page, where "enrolled or not" becomes something the app knows rather than something it learns one 403 at a time." and replace it with "The client stops reporting for a cast after the first refusal (drawcast `viewer.ts`, round 1b)."

- [ ] **Step 6: Run and commit**

Run: `set -o pipefail; python3 -m pytest -q` — Expected: PASS.

```bash
git add server_code/api.py server_code/parsers.py server_code/mail.py tests/test_parsers.py tests/test_mail.py tests/test_api_source.py README.md
git commit -m "feat(enroll): a request when the run wants approval, a door into the server's own courses"
```

---

### Task 5: The dashboard — pending requests, `join` beside `open`, `access` per course

**Files:** Modify `drawcast-anvil/server_code/dashboard_server.py`, `server_code/dash.py`, `client_code/RunForm/__init__.py`, `client_code/RunForm/form_template.html`, `client_code/Form1/__init__.py`, `tests/test_dash.py`, `tests/test_dashboard_source.py`

**Interfaces:** Consumes `mail.join_decision` (Task 4), `access.JOIN`, `access.ACCESS`. Produces callables `decide_enrollment(run_id, enrollment_id, state) -> True`, `set_course_access(course_key, access) -> True`; `run_view` gains `settings.join` and `pending: [{id, email}]`; `list_courses` gains `access` and `can_manage`; `list_runs` gains `join` and `pending` (a count); `update_run` accepts `join`; `_learners` rows gain `state`; `_course_link(course) -> str` (Task 6 reuses it); `_owner_or_admin(user, course) -> bool`.

- [ ] **Step 1: The grid names a pending row — failing test first**

Append to `tests/test_dash.py` (the file already defines a learner dict; add a second with `"state": "pending"` and no progress):

```python
def test_the_grid_marks_a_request_that_is_not_yet_in():
    pending = {"who": "ola@example.org", "email": "ola@example.org", "last_seen": "2026-09-06",
               "state": "pending", "progress": []}
    active = {"who": "kari@example.org", "email": "kari@example.org", "last_seen": "2026-09-05",
              "state": "active", "progress": []}
    html = dash.run_grid_html([{"cast": "anvil/spanish1/01.yaml", "title": "01.yaml"}], [pending, active])
    assert "ola@example.org" in html and "awaiting approval" in html
    # An active learner carries no tag: the common case reads clean.
    assert html.count("awaiting approval") == 1
    assert "<small>active</small>" not in html
```

Run: `python3 -m pytest tests/test_dash.py -q` — FAIL. In `dash.run_grid_html`, replace the `rows.append(...)` statement with:

```python
        # A request not yet decided sits in the grid with its tag, so a teacher
        # sees who is waiting without leaving the run; an active learner
        # carries no tag. `state` is the enrolment's own word, escaped like
        # everything else in the row.
        tag = "" if learner.get("state", "active") == "active" else " · <em>%s</em>" % _e(
            "awaiting approval" if learner["state"] == "pending" else learner["state"])
        rows.append("<tr><td><b>%s</b><br><small>%s%s</small></td>%s</tr>" % (
            _e(learner["who"]), _e(learner["last_seen"]), tag, cells))
```

- [ ] **Step 2: Pin the callables, and watch the pins fail**

In `tests/test_dashboard_source.py`, in `test_the_forms_callables_are_all_there`, replace the expected set with:

```python
    assert set(CALLABLES) == {"list_courses", "list_runs", "run_view", "learner_answers", "update_run", "new_run",
                              "run_csv", "my_tokens", "revoke_all", "add_teacher", "remove_teacher",
                              "decide_enrollment", "set_course_access",
                              "my_enrollments", "leave_course", "forget_me"}
```

(Task 6 adds the last three; until then this test is RED — Task 6 turns it green. Say so in the commit message.) Then append:

```python
def test_a_decision_is_gated_scoped_and_mailed():
    # Any teacher of the run decides (spec §3) — the gate is _run_for's; the
    # row must be THIS run's and still pending, else a plain error and no
    # write; the applicant is mailed either way through mail.join_decision.
    body = CALLABLES["decide_enrollment"][1]
    assert "_run_for(" in body
    assert 'en["run"] != run' in body and 'en["state"] != "pending"' in body
    assert body.index('raise ValueError("no such pending request")') < body.index("en.update(")
    assert "_mail_decision(" in body
    assert 'state not in ("active", "rejected")' in body
    mailer = SRC[SRC.index("def _mail_decision("):SRC.index("@anvil.server.callable", SRC.index("def _mail_decision("))]
    assert "mail.join_decision(" in mailer and "_course_link(" in mailer and "except Exception" in mailer


def test_course_access_is_the_owners_to_set_and_validated():
    body = CALLABLES["set_course_access"][1]
    assert "_course_for(" in body
    assert "_owner_or_admin(" in body
    assert "access.ACCESS" in body
    # Teachers of a run keep editing the run (join, open, drip); the course's
    # door is the owner's, like the teacher list.
    assert "_owner_or_admin(" in SRC[SRC.index("def _can_manage("):SRC.index("def _manage_run(")]


def test_join_travels_with_the_run_settings():
    assert '"join": run["join"] or "anyone"' in CALLABLES["run_view"][1]
    assert '"pending":' in CALLABLES["run_view"][1]
    assert '"join"' in CALLABLES["update_run"][1] and "access.JOIN" in CALLABLES["update_run"][1]
    assert 'join="anyone"' in CALLABLES["new_run"][1]
    assert '"join": r["join"] or "anyone"' in CALLABLES["list_runs"][1]
    assert '"access": c["access"] or "enrolled"' in CALLABLES["list_courses"][1]
    assert '"can_manage":' in CALLABLES["list_courses"][1]


def test_the_learner_rows_carry_their_state():
    learners = SRC[SRC.index("def _learners("):SRC.index("def _lectures(")]
    assert '"state": en["state"] or "active"' in learners


def test_the_course_link_prefers_a_registered_name():
    body = SRC[SRC.index("def _course_link("):SRC.index("\n\n\n", SRC.index("def _course_link("))]
    assert 'kind="course"' in body
    assert body.index("app_tables.names.search(") < body.index('course["page_url"]')
    assert "https://drawcast.app/#" in body


def test_runform_offers_join_and_lists_pending_requests():
    assert 'name="drop_join"' in RUNFORM_TEMPLATE and 'name="panel_pending"' in RUNFORM_TEMPLATE
    assert '("Anyone can join", "anyone")' in RUNFORM and '("Teachers approve each request", "approval")' in RUNFORM
    assert '"join": self.drop_join.selected_value' in RUNFORM
    assert 'anvil.server.call("decide_enrollment", self.run_id, ' in RUNFORM
    assert RUNFORM.count('"decide_enrollment"') == 2  # approve and decline


def test_form1_lets_the_owner_set_the_courses_door():
    assert 'anvil.server.call("set_course_access", ' in FORM1
    assert '("Anyone with the link", "open")' in FORM1
    assert '("Anyone signed in", "signed-in")' in FORM1
    assert '("Enrolled learners", "enrolled")' in FORM1
    assert 'c["can_manage"]' in FORM1
```

Run: `python3 -m pytest tests/test_dashboard_source.py -q` — FAIL.

- [ ] **Step 3: `dashboard_server.py`**

Add after `_can_manage`'s definition — and make `_can_manage` call it:

```python
def _owner_or_admin(user, course):
    """The course's own powers — its door (access), its teachers, and one
    day its deletion — belong to whoever claimed it, or an admin. A teacher
    added to a run edits the run."""
    owner = course["owner"]
    return _is_admin(user) or (owner is not None and owner.get_id() == user.get_id())


def _can_manage(user, run):
    """Teachers are added and removed by the course's OWNER or an admin — a
    teacher may not invite further teachers."""
    return _owner_or_admin(user, run["course"])
```

Add after `_lectures`:

```python
def _course_link(course):
    """Where a learner opens the course (spec §8): drawcast.app/#<name> when
    a course-kind name points at it — the registry is the address people
    are given — else the course's stored page, else the app itself. search-
    first: two names may point at one course."""
    named = next(iter(app_tables.names.search(target=course["key"], kind="course")), None)
    if named is not None:
        return "https://drawcast.app/#%s" % named["name"]
    return course["page_url"] or "https://drawcast.app/"
```

In `_learners`, the appended dict gains `"state": en["state"] or "active",` after `"email": email,`.

`list_courses` becomes:

```python
@anvil.server.callable
def list_courses():
    user = _user()
    return [{"key": c["key"], "title": c["title"], "page": c["page_url"],
             # The course's door (spec §5) — None reads as the closed default —
             # and whether this account may change it.
             "access": c["access"] or "enrolled", "can_manage": _owner_or_admin(user, c)}
            for c in app_tables.courses.search() if _course_access(user, c)]
```

`list_runs`'s dict gains `"join": r["join"] or "anyone",` after `"drip": r["drip"],` and `"pending": sum(1 for e in app_tables.enrollments.search(run=r) if e["state"] == "pending"),` after `"learners": ...`.

In `run_view`, `"settings"` becomes `{"open": run["open"], "default": run["default"], "drip": run["drip"], "join": run["join"] or "anyone"}` and the returned dict gains:

```python
        # Requests awaiting a decision (spec §3): the enrolment id is what
        # decide_enrollment takes, scoped to this run there.
        "pending": [{"id": en.get_id(), "email": en["user"]["email"]}
                    for en in app_tables.enrollments.search(run=run)
                    if en["state"] == "pending" and en["user"] is not None],
```

In `update_run`, the allowed tuple gains `"join"` and after the drip check add:

```python
    if "join" in allowed and allowed["join"] not in access.JOIN:
        raise ValueError("join must be anyone or approval")
```

In `new_run`, the `add_row(...)` gains `join="anyone",` after `open=True,`.

Add these callables after `remove_teacher`:

```python
@anvil.server.callable
def decide_enrollment(run_id, enrollment_id, state):
    """Approve or decline a pending request (spec §3). Any teacher of the
    run decides — the gate is _run_for's. The row must be THIS run's and
    still pending: an id from another run, or a decision already taken, is
    a plain error and no write. The applicant is mailed either way."""
    run = _run_for(_user(), run_id)
    if state not in ("active", "rejected"):
        raise ValueError("state must be active or rejected")
    en = app_tables.enrollments.get_by_id(enrollment_id)
    if en is None or en["run"] != run or en["state"] != "pending":
        raise ValueError("no such pending request")
    en.update(state=state, last_seen=utcnow())
    _mail_decision(run, en, state == "active")
    return True


def _mail_decision(run, en, approved):
    """Never fatal: the decision is written whether the mail goes or not."""
    user = en["user"]
    if user is None or not user["email"]:
        return
    course = run["course"]
    subject, text = mail.join_decision(course["title"] or course["key"], approved, _course_link(course))
    try:
        anvil.email.send(to=user["email"], from_name=mail.FROM_NAME, subject=subject, text=text)
    except Exception as exc:
        print("decision mail failed: %r" % (exc,))


@anvil.server.callable
def set_course_access(course_key, access_level):
    """The course's door (spec §5, question 2), edited live: takes effect for
    every reader at once, without a republish. The owner's or an admin's."""
    user = _user()
    course = _course_for(user, course_key)
    if not _owner_or_admin(user, course):
        raise anvil.server.PermissionDenied("Only the course owner can change who may watch it")
    if access_level not in access.ACCESS:
        raise ValueError("access must be open, signed-in or enrolled")
    course.update(access=access_level)
    return True
```

Add `import anvil.email` beside the other anvil imports and `import mail` beside `import dash`.

- [ ] **Step 4: `RunForm`**

Template — in `panel_settings`, after `check_default` add `<anvil-component type="DropDown" name="drop_join"></anvil-component>`; after `panel_teachers` add:

```html
        <anvil-component type="ColumnPanel" name="panel_pending" prop:role="card">
            <anvil-component type="Label" name="label_pending" prop:role="lede" prop:text="Requests to join"></anvil-component>
            <anvil-component type="ColumnPanel" name="panel_pending_list"></anvil-component>
        </anvil-component>
```

Python — in `__init__`, after the drip items: `self.drop_join.items = [("Anyone can join", "anyone"), ("Teachers approve each request", "approval")]`. In `refresh`, after the drip line: `self.drop_join.selected_value = s["join"] or "anyone"`, and at the end `self.show_pending(view["pending"])`. In `save`, the dict gains `"join": self.drop_join.selected_value`. Add:

```python
    def show_pending(self, pending):
        """Rebuilt from the server's answer every time, like the teacher list."""
        self.panel_pending_list.clear()
        self.panel_pending.visible = bool(pending) or self.drop_join.selected_value == "approval"
        if not pending:
            self.panel_pending_list.add_component(Label(text="Nobody is waiting."))
            return
        for p in pending:
            row = FlowPanel()
            row.add_component(Label(text=p["email"]))
            approve = Button(text="Approve")
            approve.set_event_handler("click", lambda en_id=p["id"], **e: self.decide(en_id, "active"))
            decline = Button(text="Decline", role="secondary-button")
            decline.set_event_handler("click", lambda en_id=p["id"], **e: self.decide(en_id, "rejected"))
            row.add_component(approve)
            row.add_component(decline)
            self.panel_pending_list.add_component(row)

    def decide(self, enrollment_id, state):
        try:
            anvil.server.call("decide_enrollment", self.run_id, enrollment_id, state)
        except Exception as exc:
            alert(str(exc))
            return
        Notification("Approved — they have been emailed." if state == "active" else "Declined — they have been emailed.").show()
        self.refresh()
```

- [ ] **Step 5: `Form1` — the course's door**

In `load_courses`, after the `Link` line and before the runs loop, add:

```python
            if c["can_manage"]:
                door = DropDown(items=[("Anyone with the link", "open"), ("Anyone signed in", "signed-in"),
                                       ("Enrolled learners", "enrolled")], selected_value=c["access"])
                door.set_event_handler("change", lambda key=c["key"], dd=door, **e: self.set_access(key, dd.selected_value))
                self.panel_courses.add_component(Label(text="Who can watch"))
                self.panel_courses.add_component(door)
```

and change the run button's text to `"%s — %d learners, %d waiting (%s)" % (r["title"] or "(untitled)", r["learners"], r["pending"], flags)`. Add the method:

```python
    def set_access(self, course_key, access_level):
        try:
            anvil.server.call("set_course_access", course_key, access_level)
        except Exception as exc:
            alert(str(exc))
            return
        Notification("Saved — it applies to every viewer at once.").show()
```

- [ ] **Step 6: Run and commit**

Run: `set -o pipefail; python3 -m pytest -q` — Expected: everything green EXCEPT `test_the_forms_callables_are_all_there` (three callables Task 6 adds). Commit anyway, saying so:

```bash
git add server_code/dashboard_server.py server_code/dash.py client_code/RunForm client_code/Form1/__init__.py tests/test_dash.py tests/test_dashboard_source.py
git commit -m "feat(dashboard): requests are decided, join sits beside open, the door is the owner's (callables pin red until the account home)"
```

---

### Task 6: The account home — what you follow, and the way out

**Files:** Modify `drawcast-anvil/server_code/dashboard_server.py`, `server_code/dash.py`, `client_code/Form1/__init__.py`, `client_code/Form1/form_template.html`, `tests/test_dash.py`, `tests/test_dashboard_source.py`, `README.md`

**Interfaces:** Consumes `_course_link`, `_lectures`, `progress.aggregate`, `rows.event_dicts`. Produces callables `my_enrollments() -> [{id, title, state, html}]`, `leave_course(enrollment_id) -> True`, `forget_me() -> int`; `dash.my_course_html(item) -> str` where `item = {title, link, run, state, joined, lectures: [{title, opened, completed, right, total}]}`.

- [ ] **Step 1: The renderer, failing first**

Append to `tests/test_dash.py`:

```python
ITEM = {"title": "Spanish 1", "link": "https://drawcast.app/#spanish-one", "run": "spring", "state": "active",
        "joined": "2026-09-01",
        "lectures": [{"title": "01.yaml", "opened": True, "completed": True, "right": 2, "total": 3},
                     {"title": "02.yaml", "opened": True, "completed": False, "right": 0, "total": 0},
                     {"title": "03.yaml", "opened": False, "completed": False, "right": 0, "total": 0}]}


def test_my_course_names_the_course_the_link_and_the_progress():
    html = dash.my_course_html(ITEM)
    assert 'href="https://drawcast.app/#spanish-one"' in html and "Spanish 1" in html
    assert "1 of 3 finished" in html and "2 of 3 opened" in html and "2/3 answers right" in html
    assert "✓ 01.yaml" in html and "○ 02.yaml" in html and "· 03.yaml" in html


def test_my_course_says_when_a_request_is_waiting_or_was_declined():
    assert "Awaiting the teachers" in dash.my_course_html(dict(ITEM, state="pending", lectures=[]))
    assert "declined" in dash.my_course_html(dict(ITEM, state="rejected", lectures=[]))
    assert "Nothing opened yet" in dash.my_course_html(dict(ITEM, lectures=[]))


def test_my_course_escapes_what_the_course_row_carries():
    html = dash.my_course_html(dict(ITEM, title="<b>x</b>", link='https://x/#"y'))
    assert "<b>x</b>" not in html and "&lt;b&gt;x&lt;/b&gt;" in html
    assert 'href="https://x/#&quot;y"' in html
```

Run: `python3 -m pytest tests/test_dash.py -q` — FAIL. Append to `dash.py`:

```python
def my_course_html(item):
    """One followed course on the account home (spec §8): the course as a
    link, the run, the state when it is not simply "in", and the learner's
    own progress — the same marks the teacher's grid uses, so the two views
    agree. Every field is the course row's or the enrolment's, escaped here."""
    state = {"pending": "Awaiting the teachers' approval — you will get an email.",
             "rejected": "The teachers declined this request."}.get(item["state"], "")
    parts = ["<h3><a href='%s'>%s</a> <small>%s · joined %s</small></h3>" % (
        _e(item["link"]), _e(item["title"]), _e(item["run"]), _e(item["joined"]))]
    if state:
        parts.append("<p class='muted'>%s</p>" % _e(state))
    lectures = item["lectures"]
    opened = sum(1 for l in lectures if l["opened"])
    done = sum(1 for l in lectures if l["completed"])
    right = sum(l["right"] for l in lectures)
    total = sum(l["total"] for l in lectures)
    if not lectures or not opened:
        parts.append("<p class='muted'>Nothing opened yet.</p>")
        return "".join(parts)
    parts.append("<p>%d of %d finished · %d of %d opened · %d/%d answers right</p>" % (
        done, len(lectures), opened, len(lectures), right, total))
    parts.append("<ul>")
    for l in lectures:
        mark = "✓" if l["completed"] else ("○" if l["opened"] else "·")
        score_txt = " — %d/%d" % (l["right"], l["total"]) if l["total"] else ""
        parts.append("<li>%s %s%s</li>" % (mark, _e(l["title"]), _e(score_txt)))
    parts.append("</ul>")
    return "".join(parts)
```

- [ ] **Step 2: Pin the callables**

Append to `tests/test_dashboard_source.py`:

```python
def test_the_account_home_reads_only_the_callers_own_rows():
    # No course gate — these are the account's own enrolments — but the
    # login gate always, and every row is found FROM the caller: an
    # enrolment id from someone else's account is "not yours", not a read.
    body = CALLABLES["my_enrollments"][1]
    assert "_user()" in body and "app_tables.enrollments.search(user=user)" in body
    assert "dash.my_course_html(" in body and "_course_link(" in body
    leave = CALLABLES["leave_course"][1]
    assert "app_tables.enrollments.get_by_id(" in leave
    assert 'en["user"] != user' in leave
    assert leave.index("PermissionDenied") < leave.index("delete")
    # Events first, then the enrolment: an enrolment deleted first would
    # orphan its events, which the CSV export still lists.
    assert leave.index("app_tables.events.search(enrollment=en).delete_all_rows()") < leave.index("en.delete()")
    forget = CALLABLES["forget_me"][1]
    assert "app_tables.enrollments.search(user=user)" in forget
    assert forget.index("delete_all_rows()") < forget.index("en.delete()")


def test_form1_is_the_account_home():
    assert 'name="panel_learning"' in FORM1_TEMPLATE and 'name="button_forget"' in FORM1_TEMPLATE
    assert 'anvil.server.call("my_enrollments")' in FORM1
    assert 'anvil.server.call("leave_course", ' in FORM1 and 'anvil.server.call("forget_me")' in FORM1
    # Both destructive buttons confirm first: the record goes, not the browser.
    assert FORM1.count("confirm(") == 2
```

and at the top of that section add `FORM1_TEMPLATE = (CLIENT / "Form1" / "form_template.html").read_text(encoding="utf-8")` beside `FORM1`.

Run: `python3 -m pytest tests/test_dashboard_source.py -q` — FAIL.

- [ ] **Step 3: The callables**

Append to `dashboard_server.py`:

```python
@anvil.server.callable
def my_enrollments():
    """The account home (spec §8): what this account follows, with its own
    progress, rendered by dash.my_course_html. No course gate — these are
    the caller's own rows — and nothing is returned that the caller did not
    produce or is not entitled to open."""
    user = _user()
    out = []
    for en in app_tables.enrollments.search(user=user):
        run = en["run"]
        course = run["course"] if run is not None else None
        if course is None:
            continue  # the run or course was deleted under the learner; nothing to show
        prog = progress.aggregate(event_dicts(en))
        by_cast = {p["cast"]: p for p in prog}
        lectures = []
        for lec in _lectures(run, [{"progress": prog}]):
            p = by_cast.get(lec["cast"])
            right, total = progress.score(p) if p is not None else (0, 0)
            lectures.append({"title": lec["title"], "opened": bool(p and p["opened"]),
                             "completed": bool(p and p["completed"]), "right": right, "total": total})
        item = {"title": course["title"] or course["key"], "link": _course_link(course),
                "run": run["title"] or run["slug"] or "default", "state": en["state"] or "active",
                "joined": en["created"].strftime("%Y-%m-%d") if en["created"] else "",
                "lectures": lectures}
        out.append({"id": en.get_id(), "title": item["title"], "state": item["state"],
                    "html": dash.my_course_html(item)})
    return out


@anvil.server.callable
def leave_course(enrollment_id):
    """Leave one course (spec §3): the enrolment and every event under it.
    The row must be the caller's own — an id is not a capability. Events
    first, then the row: the reverse order would orphan events the CSV
    export still lists."""
    user = _user()
    en = app_tables.enrollments.get_by_id(enrollment_id)
    if en is None or en["user"] != user:
        raise anvil.server.PermissionDenied("Not your enrolment")
    app_tables.events.search(enrollment=en).delete_all_rows()
    en.delete()
    return True


@anvil.server.callable
def forget_me():
    """Forget me (spec §3): every enrolment and every event the account has,
    in every course. The account itself stays — it owns tokens, and may own
    courses — and signing out is a different thing again. The same two
    lines as leave_course, per row, in the same order."""
    user = _user()
    n = 0
    for en in list(app_tables.enrollments.search(user=user)):
        app_tables.events.search(enrollment=en).delete_all_rows()
        en.delete()
        n += 1
    return n
```

The two delete lines are written out in both callables on purpose: the source pins slice each callable's own body, and the order — events, then the row — is the thing they pin.

- [ ] **Step 4: `Form1` becomes the account home**

Template — replace the file with:

```html
<anvil-form layout="drawcast.Layouts.BaseLayout">
    <anvil-block slot="title">
        <anvil-component type="Label" name="label_title" prop:role="h1" prop:text="Your drawcast account"></anvil-component>
    </anvil-block>
    <anvil-block slot="actions">
        <anvil-component type="Button" name="button_key" prop:text="Signed-in browsers" prop:role="secondary-button"></anvil-component>
        <anvil-component type="Button" name="button_logout" prop:text="Log out" prop:role="secondary-button"></anvil-component>
    </anvil-block>
    <anvil-block slot="content">
        <anvil-component type="ColumnPanel" name="panel_key" prop:role="card">
            <anvil-component type="Label" name="label_key" prop:text=""></anvil-component>
            <anvil-component type="Button" name="button_new_key" prop:text="Sign out everywhere"></anvil-component>
        </anvil-component>
        <anvil-component type="ColumnPanel" name="panel_learning" prop:role="card">
            <anvil-component type="Label" name="label_learning" prop:role="lede" prop:text="Courses you follow"></anvil-component>
            <anvil-component type="ColumnPanel" name="panel_learning_list"></anvil-component>
            <anvil-component type="Button" name="button_forget" prop:text="Forget me — leave every course" prop:role="secondary-button"></anvil-component>
        </anvil-component>
        <anvil-component type="ColumnPanel" name="panel_courses" prop:role="card">
            <anvil-component type="Label" name="label_teaching" prop:role="lede" prop:text="Courses you teach"></anvil-component>
            <anvil-component type="ColumnPanel" name="panel_teaching_list"></anvil-component>
        </anvil-component>
    </anvil-block>
</anvil-form>
```

Python — `load_courses` now fills `self.panel_teaching_list` instead of `self.panel_courses` (every `self.panel_courses.add_component` / `.clear()` becomes `self.panel_teaching_list....`). In `__init__`, after `self.button_logout...` add `self.button_forget.set_event_handler("click", self.forget)` and `self.load_learning()` before `self.load_courses()`. Add:

```python
    def load_learning(self):
        self.panel_learning_list.clear()
        items = anvil.server.call("my_enrollments")
        self.button_forget.visible = bool(items)
        if not items:
            self.panel_learning_list.add_component(Label(text="You are not following any course. Open a course's link in drawcast and press Join."))
            return
        for it in items:
            self.panel_learning_list.add_component(HtmlTemplate(html=it["html"]))
            leave = Button(text="Leave this course", role="secondary-button")
            leave.set_event_handler("click", lambda en_id=it["id"], title=it["title"], **e: self.leave(en_id, title))
            self.panel_learning_list.add_component(leave)

    def leave(self, enrollment_id, title):
        if not confirm("Leave %s? Your progress and answers in it are deleted for you and its teachers. This cannot be undone." % title):
            return
        anvil.server.call("leave_course", enrollment_id)
        self.load_learning()

    def forget(self, **event_args):
        if not confirm("Leave every course and delete all your progress and answers? Your account and sign-in stay. This cannot be undone."):
            return
        anvil.server.call("forget_me")
        self.load_learning()
```

Keep `open_form("SignIn")`'s `#signin` route and the `while ... login_with_form()` loop exactly as they are — Task 8 replaces the loop.

- [ ] **Step 5: README**

Replace the paragraph beginning "There is no `GET /progress` and no `POST /forget` any more" with:

```
There is no `GET /progress` and no `POST /forget`: a learner's own progress
and the way out of a course are the account home's — Form1 on
drawcast.anvil.app, on `anvil.server.call` (`my_enrollments`, `leave_course`,
`forget_me`), not this HTTP API. *Leave this course* deletes one enrolment
and its events; *Forget me* deletes them all. The account stays.
```

Under "## Layout", change `client_code/Form1` (login + courses)` to `client_code/Form1` (the account home: courses followed, with progress and the way out; courses taught)`.

- [ ] **Step 6: Run and commit**

Run: `set -o pipefail; python3 -m pytest -q` — Expected: PASS, including the callables pin Task 5 left red.

```bash
git add server_code/dashboard_server.py server_code/dash.py client_code/Form1 tests/test_dash.py tests/test_dashboard_source.py README.md
git commit -m "feat(account): the home shows what you follow, and lets you leave"
```

---

### Task 7: The link signs up, and lands on the server too

**Files:** Modify `drawcast-anvil/server_code/api.py`, `server_code/tokens.py`, `tests/test_tokens.py`, `tests/test_api_source.py`, `README.md`

**Interfaces:** Consumes `_once_token`, `_spend_once`, `send_sign_in_link`, `_allowed`, `rq.parse_login`, `limits.address_key`. Produces `tokens.mail_landing(url, allowlist) -> str | None`; callables `request_link(email, return_url) -> bool` and `redeem_here(token) -> bool` (Task 8's SignIn and Form1 call them); `send_sign_in_link` creates a passwordless `users` row for an unknown address; `_once_token` sweeps the user's expired `once` rows.

- [ ] **Step 1: `mail_landing`, failing first**

Append to `tests/test_tokens.py`:

```python
ALLOW = ("https://drawcast.app",)


def test_mail_landing_keeps_a_landing_the_mailed_rule_admits():
    assert tokens.mail_landing("https://drawcast.app/#spanish-one", ALLOW) == "https://drawcast.app/#spanish-one"
    assert tokens.mail_landing("https://drawcast.app/", ALLOW) == "https://drawcast.app/"


def test_mail_landing_falls_back_to_the_root_for_an_editor_address():
    # The sign-in page is opened from wherever the person was — a lecture,
    # a document, a query string. None of those may be mailed (they are the
    # caller's text on our letterhead), and none is a place a sign-in has
    # business landing; the root of the same origin, signed in, is the
    # honest fallback.
    assert tokens.mail_landing("https://drawcast.app/#gh=h/dcast/x/01.yaml", ALLOW) == "https://drawcast.app/"
    assert tokens.mail_landing("https://drawcast.app/?x=1#spanish-one", ALLOW) == "https://drawcast.app/"


def test_mail_landing_refuses_another_origin_outright():
    assert tokens.mail_landing("https://evil.test/", ALLOW) is None
    assert tokens.mail_landing("https://drawcast.app.evil.test/#spanish-one", ALLOW) is None
    assert tokens.mail_landing("", ALLOW) is None
```

Run: `python3 -m pytest tests/test_tokens.py -q` — FAIL. Append to `tokens.py`:

```python
def mail_landing(url, allowlist):
    """Where a link asked for FROM THE SIGN-IN PAGE lands (round 1b):
    sign_in_landing's answer when the return URL is one the mailed rule
    admits, else the ROOT of the return's origin when that origin is ours —
    the page was opened from wherever the person was, and an editor address
    (a #gh= lecture, a query string) is neither mailable nor a place a
    sign-in has business landing. None when the origin is not ours."""
    landing = sign_in_landing(url, allowlist)
    if landing is not None:
        return landing
    if allowed_return(url, allowlist) is None:
        return None
    parts = urlparse(url)
    return "%s://%s/" % (parts.scheme, parts.netloc)
```

- [ ] **Step 2: Pin the callables and the signup, and watch the pins fail**

Append to `tests/test_api_source.py`:

```python
def test_the_link_creates_an_account_for_an_unknown_address(source):
    # Round 1b (spec §1): the link is the whole email path, signup included.
    # An unknown address gets a passwordless row — enabled, unconfirmed,
    # nothing to plant — and the mail is the proof. The refusal rule still
    # runs after it, so a row that DOES carry a password and is unconfirmed
    # (a leftover from the password era) stays refused.
    body = body_of("send_sign_in_link")
    at_create = body.index("app_tables.users.add_row(")
    assert "password_hash" not in body[at_create:body.index(")", at_create)]
    assert "enabled=True" in body and "confirmed_email=False" in body
    assert at_create < body.index("access.mail_sign_in_refusal(")
    assert "signed_up=" in body


def test_request_link_is_the_sign_in_pages_way_to_the_same_mail(source):
    # The same parser, both budgets (the IP from the callable's context, the
    # address always), the same background task — and the same answer for
    # every address. return_url None means "sign in to THIS app": the link
    # lands on our own root, where Form1 redeems it.
    body = body_of("request_link")
    assert "@anvil.server.callable" in source[source.index("def request_link(") - 40:source.index("def request_link(")]
    assert "rq.parse_login(" in body
    assert "anvil.server.get_app_origin()" in body
    assert "tokens.mail_landing(" in body
    assert '_allowed("login", key=ip)' in body
    assert '_allowed("login_address", key=limits.address_key(' in body
    assert 'launch_background_task("send_sign_in_link"' in body
    assert "anvil.email.send" not in body and "_once_token" not in body


def test_redeem_here_spends_the_token_and_opens_a_users_session(source):
    body = body_of("redeem_here")
    assert "_spend_once(" in body
    assert "anvil.users.force_login(" in body
    assert body.index("_spend_once(") < body.index("force_login(")
    assert '_allowed("redeem"' in body
    assert "app_tables.tokens" not in body  # the spend is _spend_once's transaction


def test_expired_once_tokens_are_swept_when_a_new_one_is_minted(source):
    # Carried from round 0's review: an abandoned sign-in left a live secret
    # in the table forever. Bounded — this user's rows, on their next mint.
    body = body_of("_once_token")
    assert 'app_tables.tokens.search(user=user, kind="once")' in body
    assert "tokens.is_live(" in body
    assert body.index("r.delete()") < body.index("add_row(")
```

Run: `python3 -m pytest tests/test_api_source.py -q` — FAIL.

- [ ] **Step 3: `api.py`**

Replace `_once_token` with:

```python
def _once_token(user):
    """The one-time token row (spec §1): five minutes, single use, spent by
    _spend_once. The ONE place a `once` row is written — the redirect
    (mint_once), the mailed link (send_sign_in_link) — and both build the
    link with mail.sign_in_link, so neither carries a copy of a security
    rule the other could drift from.

    Sweeps this user's EXPIRED once rows first (round 1b, carried from round
    0's review): an abandoned sign-in used to leave a live secret in the
    table forever. Bounded — one account's rows, on that account's next
    mint — so no full-table scan and nothing another account can trigger."""
    now = time.time()
    for r in app_tables.tokens.search(user=user, kind="once"):
        if not tokens.is_live({"kind": "once", "created": r["created"]}, now):
            r.delete()
    return app_tables.tokens.add_row(secret=tokens.make_secret(), user=user, kind="once",
                                     created=now, last_used=None, label=None)
```

In `send_sign_in_link`, replace

```python
    user = _user_by_email(email)
    if user is None:
        print("send_sign_in_link: refused — no account under that address")
        return
```

with

```python
    user = _user_by_email(email)
    if user is None:
        # An unknown address gets an account (spec §1, round 1b): the link is
        # the signup, and the mail is the proof. Passwordless — there is no
        # password to plant — enabled, unconfirmed like every social row the
        # guard below admits without one. parse_login lower-cased the address,
        # so the row is stored the way _user_by_email will find it.
        user = app_tables.users.add_row(email=email, enabled=True, confirmed_email=False, signed_up=utcnow())
        print("send_sign_in_link: created a passwordless account")
```

and update the docstring: "Sends to an account whose address is PROVEN — or creates one, passwordless, when the address is unknown (round 1b) — …".

Add after `http_login`:

```python
@anvil.server.callable
def request_link(email, return_url):
    """The sign-in page's "Email me a link" (spec §1, round 1b): the mail
    POST /login sends, asked for from inside this app. return_url is the
    drawcast address the page was opened for — mail_landing pins it to a
    root or a bare #name — or None when the person is signing in to THIS
    app (the dashboard): then the link lands on our own root with the
    token in the fragment, and Form1 redeems it into a users session
    (redeem_here). Budgeted like /login — the IP from the callable's
    context, the address always — and the same True for every address,
    known or not: the existence oracle is the same either way. False only
    for a malformed address, an origin that is not ours, or a spent
    budget, none of which depends on the address existing."""
    origin = anvil.server.get_app_origin()
    try:
        req = rq.parse_login({"email": email, "return": return_url if return_url is not None else origin + "/"})
    except rq.BadRequest:
        return False
    if return_url is None:
        target = origin + "/"
    else:
        target = tokens.mail_landing(req["return"], tokens.RETURN_ALLOWLIST)
        if target is None:
            return False
    ip = getattr(getattr(anvil.server.context, "client", None), "ip", "") or ""
    if not _allowed("login", key=ip):
        return False
    if not _allowed("login_address", key=limits.address_key(req["email"])):
        return False
    try:
        anvil.server.launch_background_task("send_sign_in_link", req["email"], target)
    except Exception as exc:
        print("launch_background_task(send_sign_in_link) failed: %r" % (exc,))
    return True


@anvil.server.callable
def redeem_here(token):
    """A mailed link that landed on THIS app (#t=…, Form1): spend the once
    token exactly as /redeem does — _spend_once's transaction, single use —
    and open a users session for its account, so the dashboard signs in by
    mail the way the app does. True when signed in."""
    ip = getattr(getattr(anvil.server.context, "client", None), "ip", "") or ""
    if not _allowed("redeem", key=ip):
        return False
    if not isinstance(token, str) or not token:
        return False
    user = _spend_once(token, time.time())
    if user is None or not user["enabled"]:
        return False
    anvil.users.force_login(user, remember=True)
    return True
```

`_budget` already treats an empty key as "no remote address, allow" — passing `key=ip` with `ip == ""` is that case, and never `None` (which would read `anvil.server.request`, absent in a callable).

- [ ] **Step 4: README**

In the `POST /login` paragraph, replace "The mail goes only to an account whose address is PROVEN: `confirmed_email`, or a row with no password (which only Google/Microsoft, or you by hand, can have created)." with: "An unknown address gets an account first — passwordless, enabled, unconfirmed (round 1b: the link is the signup) — and the mail then goes only to a row whose address is PROVEN: `confirmed_email`, or a row with no password, which every row this API creates and every social row is." Delete the sentence "No account is created. Signing up …" wherever it survives in `api.py`'s docstrings too. Add, after that paragraph:

```
The same mail is asked for from the sign-in page through the callable
`request_link(email, return_url)` (`return_url` None means "sign in to this
app": the link lands on this app's root with `#t=`, and Form1 hands it to
`redeem_here`, which spends it and opens a users session). A link asked for
from an editor address the mailed rule refuses lands on the app root instead.
```

- [ ] **Step 5: Run and commit**

Run: `set -o pipefail; python3 -m pytest -q` — Expected: PASS.

```bash
git add server_code/api.py server_code/tokens.py tests/test_tokens.py tests/test_api_source.py README.md
git commit -m "feat(login): the link signs up, lands on the server too, and sweeps what it left behind"
```

---

### Task 8: The sign-in page is a chooser; Form1 lands the link; the password goes

**Files:** Modify `drawcast-anvil/client_code/SignIn/__init__.py`, `client_code/SignIn/form_template.html`, `client_code/Form1/__init__.py`, `anvil.yaml`, `tests/test_signin_source.py`, `tests/test_schema.py`, `README.md`

**Interfaces:** Consumes `request_link`, `redeem_here`, `mint_once` (Task 7). Produces the SignIn form that every sign-in goes through — the app's handshake (`#signin?return=`) and the dashboard's own (no fragment) — and `use_email: false`.

- [ ] **Step 1: Pins first**

In `tests/test_signin_source.py`, replace `test_form1_routes_signin_before_its_own_login_loop` with:

```python
def test_form1_routes_signin_and_the_landing_before_anything_loads():
    # #signin → SignIn (the app's handshake); #t= → redeem_here (a mailed
    # link landing on THIS app); no session → SignIn (the dashboard's own
    # sign-in). All three before a table is read.
    assert FORM1.index('open_form("SignIn")') < FORM1.index("self.load_learning()")
    assert 'startswith("#t=")' in FORM1
    assert 'anvil.server.call("redeem_here", ' in FORM1
    # The spent token leaves the address before anything else happens.
    assert FORM1.index("history.replaceState(") < FORM1.index("self.load_learning()")
    assert "login_with_form" not in FORM1


def test_signin_is_a_chooser_with_no_password_anywhere():
    # Round 1b (spec §1): three providers and the link; the users service's
    # own form — the one that offered a password — is called nowhere.
    for name in ("button_google", "button_microsoft", "button_facebook", "box_email", "button_link", "panel_choices"):
        assert 'name="%s"' % name in TEMPLATE, name
    for call in ("anvil.users.login_with_google", "anvil.users.login_with_microsoft", "anvil.users.login_with_facebook"):
        assert call in SIGNIN, call
    assert 'anvil.server.call("request_link", ' in SIGNIN
    assert "login_with_form" not in SIGNIN
    assert "password" not in SIGNIN.lower() and "password" not in TEMPLATE.lower()


def test_signin_serves_both_the_app_and_the_dashboard():
    # With a return URL the form bounces back with a token (mint_once);
    # without one it is the dashboard's sign-in and opens Form1. A #signin
    # link whose return is missing or bad still says so rather than
    # quietly becoming a dashboard sign-in.
    assert 'anvil.server.call("mint_once", self.target)' in SIGNIN
    assert 'open_form("Form1")' in SIGNIN
    assert 'startswith("#signin") and self.target is None' in SIGNIN
```

In `tests/test_schema.py`, in `test_the_providers_hans_turned_on_are_the_ones_that_ship`, replace the `use_email` comment and assertion with:

```python
    # Email + password is OFF (round 1b, spec §1): the mailed link is the
    # whole email path, signup included, so nobody is excluded and nothing
    # can be planted under someone else's address. Flip this back only with
    # the README's "First-time setup" rewritten to match.
    assert cfg["use_email"] is False
```

Run: `python3 -m pytest tests/test_signin_source.py tests/test_schema.py -q` — FAIL.

- [ ] **Step 2: `anvil.yaml`**

In the users service `client_config`, change `use_email: true` to `use_email: false`. Nothing else on that line.

- [ ] **Step 3: The SignIn template**

Replace the file with:

```html
<anvil-form layout="drawcast.Layouts.BaseLayout">
    <anvil-block slot="title">
        <anvil-component type="Label" name="label_title" prop:role="h1" prop:text="Sign in"></anvil-component>
    </anvil-block>
    <anvil-block slot="content">
        <anvil-component type="Label" name="label_status" prop:text="Signing in…"></anvil-component>
        <anvil-component type="ColumnPanel" name="panel_choices" prop:role="card">
            <anvil-component type="Button" name="button_google" prop:text="Continue with Google"></anvil-component>
            <anvil-component type="Button" name="button_microsoft" prop:text="Continue with Microsoft"></anvil-component>
            <anvil-component type="Button" name="button_facebook" prop:text="Continue with Facebook"></anvil-component>
            <anvil-component type="Label" name="label_link" prop:text="Or get a sign-in link by email — it works once, for five minutes, and no account is needed beforehand:"></anvil-component>
            <anvil-component type="TextBox" name="box_email" prop:placeholder="you@example.org"></anvil-component>
            <anvil-component type="Button" name="button_link" prop:text="Email me a link" prop:role="secondary-button"></anvil-component>
        </anvil-component>
    </anvil-block>
</anvil-form>
```

- [ ] **Step 4: The SignIn form**

Replace `client_code/SignIn/__init__.py` with:

```python
from ._anvil_designer import SignInTemplate
from anvil import *
import anvil.js
from anvil.js.window import decodeURIComponent
import anvil.server
import anvil.users


class SignIn(SignInTemplate):
    """Every sign-in goes through here (spec §1). Opened at #signin?return=…
    by drawcast's handshake, it makes sure there is a user and bounces
    straight back with a one-time token — when the session is already alive
    nothing is shown but this form's title for an instant. Opened by Form1
    with no fragment, it is the dashboard's own sign-in and ends in Form1.

    A chooser, not the users service's form (round 1b): Google, Microsoft,
    Facebook, or a mailed link. There is no password — the link is the whole
    email path, and an unknown address gets an account when it asks."""

    def __init__(self, **properties):
        super().__init__(**properties)
        self.panel_choices.visible = False
        self.target = self._return_url()
        raw = anvil.js.window.location.hash or ""
        if raw.startswith("#signin") and self.target is None:
            self.label_status.text = "This sign-in link did not come from drawcast."
            return
        self.button_google.set_event_handler("click", lambda **e: self._provider(anvil.users.login_with_google))
        self.button_microsoft.set_event_handler("click", lambda **e: self._provider(anvil.users.login_with_microsoft))
        self.button_facebook.set_event_handler("click", lambda **e: self._provider(anvil.users.login_with_facebook))
        self.button_link.set_event_handler("click", self._link)
        self.box_email.set_event_handler("pressed_enter", self._link)
        if anvil.users.get_user() is not None:
            self._finish()
            return
        self.label_status.text = "Sign in to drawcast" if self.target else "Sign in to the drawcast dashboard"
        self.panel_choices.visible = True

    def _provider(self, login):
        # A cancelled popup returns None or raises, depending on the provider;
        # either way the chooser stays and says so.
        try:
            login()
        except Exception as exc:
            self.label_status.text = "Sign-in did not complete: %s" % exc
            return
        if anvil.users.get_user() is not None:
            self._finish()

    def _link(self, **event_args):
        email = (self.box_email.text or "").strip()
        if not email:
            return
        ok = anvil.server.call("request_link", email, self.target)
        # The same words whether or not the address had an account: the
        # server answers the same, and this label must not become the oracle.
        self.label_status.text = (
            "Check your inbox: the link signs you in and works once, for five minutes. You can close this page."
            if ok else
            "Could not send a link to that address just now — check it, or try again in an hour.")

    def _finish(self):
        if self.target is None:
            open_form("Form1")
            return
        url = anvil.server.call("mint_once", self.target)
        if url is None:
            self.label_status.text = "This sign-in link did not come from drawcast."
            return
        anvil.js.window.location.replace(url)

    def _return_url(self):
        # The raw fragment, not anvil.get_url_hash(): the return URL arrives
        # percent-encoded (a bare "#" or "&" inside it would otherwise cut it
        # short), and this is the one place that decodes it. Empty and
        # undecodable (#signin?return=%zz) both count as missing: the status
        # label says so, instead of a raise out of __init__.
        raw = anvil.js.window.location.hash or ""
        if "return=" not in raw:
            return None
        encoded = raw.split("return=", 1)[1].split("&", 1)[0]
        if not encoded:
            return None
        try:
            return decodeURIComponent(encoded) or None
        except Exception:
            return None
```

`test_return_url_treats_empty_and_undecodable_as_missing` and `test_both_forms_read_the_raw_fragment_and_never_get_url_hash` keep passing as written.

- [ ] **Step 5: Form1's startup**

Replace the top of `Form1.__init__` — everything from the `if (anvil.js.window.location.hash or "").startswith("#signin"):` line through the `while` loop — with:

```python
        # Three things before a table is read. drawcast's handshake lands at
        # #signin?return=… and must reach SignIn. A mailed link landing HERE
        # (#t=…, a teacher signing in to the dashboard by mail) is spent
        # through redeem_here, which opens the users session, and the token
        # leaves the address before anything else — the same rule the app
        # follows. No session after that: SignIn, the dashboard's own way in.
        # The RAW fragment throughout: anvil.get_url_hash() parses some
        # shapes into a dict, and a route guarded on its type dies silently.
        raw = anvil.js.window.location.hash or ""
        if raw.startswith("#signin"):
            open_form("SignIn")
            return
        if raw.startswith("#t="):
            ok = anvil.server.call("redeem_here", raw[3:].split("&", 1)[0])
            anvil.js.window.history.replaceState(None, "", anvil.js.window.location.pathname)
            if not ok:
                alert("That sign-in link has expired or was already used — ask for a new one.")
        if anvil.users.get_user() is None:
            open_form("SignIn")
            return
        self.panel_key.visible = False
```

(`self.panel_key.visible = False` is the line that used to follow the loop; keep it once.)

- [ ] **Step 6: README — first-time setup**

Replace steps 2 and 3 under "## First-time setup (Hans)" with:

```
2. Sign in once. Open the app: the sign-in page offers Google, Microsoft,
   Facebook and "Email me a link" — there is no password (`use_email` is
   off; round 1b). A link typed for an address with no account CREATES one,
   passwordless; the row appears in Users with `enabled` ticked and no
   `password_hash`. Then tick `admin` on your own Users row: that is what
   makes you see every course, not just your own. Google, Microsoft and
   Facebook are ON as login methods in `anvil.yaml`, and
   `allow_signup: true` + `enable_automatically: true` make each self-
   service. Do NOT remove the Google, Facebook, Microsoft or Stripe SERVICES
   from the app: `client_code/Layouts/BaseLayout/__init__.py` imports them,
   and the app stops loading the moment one is gone. Never tick
   `confirmed_email` on a row you did not verify yourself: a leftover
   password-era row can be a stranger's signup under someone else's
   address, and the mailed link refuses exactly those (unconfirmed AND
   carrying a password).
3. Press **Sign in** inside drawcast: it opens this app at
   `#signin?return=…`, which — signed in already — bounces straight back
   with a one-time token that drawcast redeems (`POST /redeem`) for the
   session key it keeps. Publishing while signed in makes you the owner
   here.
```

Delete the two paragraphs above the list that begin "**A risk this round narrows but cannot close**" and "**Turning Email + password off is NOT the recommendation**" and "**The real fix removes the password, not the email.**", and put in their place:

```
**The planted-row class is closed (round 1b).** With `use_email` off nobody
can sign up with a password, so nobody can plant a row under someone else's
address; the mailed link proves the address at every sign-in and creates the
account when it is unknown. The refusal in `access.mail_sign_in_refusal`
stays for rows the password era left behind.
```

- [ ] **Step 7: Run and commit**

Run: `set -o pipefail; python3 -m pytest -q` — Expected: PASS.

```bash
git add client_code/SignIn client_code/Form1/__init__.py anvil.yaml tests/test_signin_source.py tests/test_schema.py README.md
git commit -m "feat(signin): a chooser — three providers and the link — and no password anywhere"
```

**MANUAL STEP — Hans:** the controller pushes Tasks 1–8 together and asks you to pull with **"source code"**. Every `casts.access` value is dropped (every course reads closed until set); password login is off from this pull on — sign in with Google or ask for a link.

---

### Task 9: `learn.ts` — a join can be pending; a report can be refused; the door says so

**Files:** Modify `drawcast/src/learn.ts`, `src/viewer.ts` (`courseDoor` only), `tests/learn.test.ts`, `tests/course-door.test.ts`

**Interfaces:** Produces `type SendOutcome = "ok" | "refused" | "failed"`, `sendEvent(api, ev, key, fetchImpl?) -> Promise<SendOutcome>`; `JoinOutcome` gains `"pending" | "rejected"`; `joinCourse` reads the answer's `state`; `courseDoor(name, resolved, deps?, opts?: { onJoined?: () => void; lead?: string })`. Task 10 consumes all four.

- [ ] **Step 1: The failing tests**

In `tests/learn.test.ts`, replace the test `"a refusal is false, never a throw into playback — 403 enrol, 401 key, a 500, the network"` with:

```typescript
  test("the answer names the kind of failure, and never throws into playback: a refusal (401 key, 403 enrol) is the server's no; a 500 or the network is 'failed'", async () => {
    expect(await sendEvent(API, { kind: "opened", cast: CAST }, KEY, fetchReturning(200, { ok: true }))).toBe("ok");
    expect(await sendEvent(API, { kind: "opened", cast: CAST }, KEY, fetchReturning(403, { error: "enrol" }))).toBe("refused");
    expect(await sendEvent(API, { kind: "opened", cast: CAST }, KEY, fetchReturning(401, { error: "key" }))).toBe("refused");
    expect(await sendEvent(API, { kind: "opened", cast: CAST }, KEY, fetchReturning(500, {}))).toBe("failed");
    expect(await sendEvent(API, { kind: "opened", cast: CAST }, KEY, fetchReturning(429, { error: "rate" }))).toBe("failed");
    const dead = vi.fn(async () => {
      throw new Error("offline");
    }) as unknown as typeof fetch;
    expect(await sendEvent(API, { kind: "opened", cast: CAST }, KEY, dead)).toBe("failed");
  });
```

and change every other `toBe(false)` on a `sendEvent` result in that file to `toBe("failed")` (the no-token and not-a-key cases). Append inside `describe("joinCourse", …)`:

```typescript
  test("a 200 whose state is pending or rejected is that, not 'ok' — the run wants approval, or already said no", async () => {
    expect(await joinCourse(API, KEY, REQ, fetchReturning(200, { ok: true, state: "pending" }))).toBe("pending");
    expect(await joinCourse(API, KEY, REQ, fetchReturning(200, { ok: true, state: "rejected" }))).toBe("rejected");
    // Anything else in a 200 — active, a missing field, a body that is not
    // JSON — is in.
    expect(await joinCourse(API, KEY, REQ, fetchReturning(200, { ok: true }))).toBe("ok");
    const notJson = vi.fn(async () => new Response("ok", { status: 200 })) as unknown as typeof fetch;
    expect(await joinCourse(API, KEY, REQ, notJson)).toBe("ok");
  });
  test("the notes for pending and rejected tell the learner what happens next, and never say 'You're in'", () => {
    expect(joinNote("pending")).toMatch(/teachers/i);
    expect(joinNote("pending")).toMatch(/email/i);
    expect(joinNote("rejected")).toMatch(/declined/i);
    for (const o of ["pending", "rejected"] as const) expect(joinNote(o)).not.toMatch(/you're in/i);
  });
```

In `tests/course-door.test.ts`, change the `door(...)` helper's signature to also take `opts?: { onJoined?: () => void; lead?: string }` and pass it as `courseDoor("learn-russian", {...}, deps, opts)`; then append inside `describe("the door, signed in", …)`:

```typescript
  test("pending: the button goes, the note is not an error, no lecture link appears — the teachers decide", async () => {
    const d = door({ token: "tok", outcome: "pending", page: null });
    d.button.click();
    await tick();
    expect(d.note.textContent).toBe(joinNote("pending"));
    expect(d.note.classList.contains("error")).toBe(false);
    expect(d.button.hidden).toBe(true);
    expect(d.links()).toHaveLength(0);
    expect(d.deps.forget).not.toHaveBeenCalled();
  });
  test("rejected: the button goes and the note is an error", async () => {
    const d = door({ token: "tok", outcome: "rejected", page: null });
    d.button.click();
    await tick();
    expect(d.note.textContent).toBe(joinNote("rejected"));
    expect(d.note.classList.contains("error")).toBe(true);
    expect(d.button.hidden).toBe(true);
    expect(d.links()).toHaveLength(0);
  });
  test("with onJoined, a successful join calls it instead of adding the first-lecture link — the caller knows what comes next", async () => {
    const onJoined = vi.fn();
    const d = door({ token: "tok", outcome: "ok", page: null }, { onJoined });
    d.button.click();
    await tick();
    expect(onJoined).toHaveBeenCalledTimes(1);
    expect(d.links()).toHaveLength(0);
    expect(d.button.hidden).toBe(true);
  });
  test("a lead replaces the default sentence above the button", () => {
    const d = door({ token: "tok" }, { lead: "This drawcast is part of a course you have not joined." });
    expect(d.note.textContent).toBe("This drawcast is part of a course you have not joined.");
  });
```

The `door()` helper builds `deps` and calls `courseDoor(name, resolved, deps)`; the `opts` argument is the new fourth parameter. `test.each` over the error outcomes stays; a pending/rejected outcome must not be added to it.

- [ ] **Step 2: Run and watch them fail**

Run: `npx vitest run tests/learn.test.ts tests/course-door.test.ts` — Expected: FAIL (`false` vs `"failed"`; `courseDoor` takes three arguments).

- [ ] **Step 3: `learn.ts`**

Replace `sendEvent`'s signature, doc and body with:

```typescript
/** What became of a report. `refused` is the server's no — `401 key` (the
 *  token is dead) or `403 enrol` (the account is not in this cast's course)
 *  — and the caller stops asking for this cast; `failed` is everything else
 *  (no token, not a cast key, the network, a 5xx, a 429), after which the
 *  next event may still get through. None of it is the player's business
 *  to shout about; it goes on drawing. */
export type SendOutcome = "ok" | "refused" | "failed";

/**
 * Report one event under the account `key` names. Never throws.
 */
export async function sendEvent(api: string, ev: LearnEvent, key: string, fetchImpl: typeof fetch = fetch): Promise<SendOutcome> {
  if (!CAST_KEY_RE.test(ev.cast) || !key) return "failed";
  const payload: LearnEvent =
    ev.kind === "answer"
      ? { ...ev, given: ev.given.slice(-MAX_ATTEMPTS).map((g) => g.slice(0, MAX_TEXT)), expected: ev.expected.slice(0, MAX_TEXT) }
      : ev;
  try {
    const res = await fetchImpl(`${apiBase(api)}/_/api/event`, {
      method: "POST",
      // text/plain keeps this a simple request: no preflight, and keepalive
      // lets a `completed` fired on the last frame outlive the tab.
      headers: { "content-type": "text/plain" },
      body: JSON.stringify({ key, ...payload }),
      keepalive: true,
    });
    if (res.ok) return "ok";
    return res.status === 401 || res.status === 403 ? "refused" : "failed";
  } catch {
    return "failed";
  }
}
```

Change `JoinOutcome` to `export type JoinOutcome = "ok" | "pending" | "rejected" | "key" | "closed" | "run" | "invalid" | "rate" | "error";`. In `joinCourse`, replace `if (res.ok) return "ok";` with:

```typescript
    if (res.ok) {
      // The answer's `state` (spec §3): pending when the run wants approval,
      // rejected when the teachers already said no. A 200 with anything
      // else — active, no field, a body that is not JSON — is in.
      const body = (await res.json().catch(() => ({}))) as { state?: unknown };
      return body.state === "pending" ? "pending" : body.state === "rejected" ? "rejected" : "ok";
    }
```

and add to `joinNote`'s switch:

```typescript
    case "pending":
      return "Your request is with the course's teachers — you'll get an email when they decide.";
    case "rejected":
      return "The course's teachers declined your request to join. If that seems wrong, ask them directly.";
```

Update `joinCourse`'s doc comment: "`200 {state}` maps to `ok`, `pending` or `rejected`".

- [ ] **Step 4: `courseDoor` — an outcome that ends the door, and a caller who knows what is next**

In `viewer.ts`, change the signature to

```typescript
export function courseDoor(
  name: string,
  resolved: Resolved,
  deps: DoorDeps = liveDoorDeps,
  opts: { onJoined?: () => void; lead?: string } = {},
): HTMLElement {
```

replace the `note` line with `const note = h("p", { class: "viewer-status" }, opts.lead ?? "Joining lets you and the course's teachers follow your progress and answers.");`, and replace the body of the `.then((outcome) => { … })` with:

```typescript
      note.textContent = joinNote(outcome);
      // Pending is not an error: the teachers decide, and the door has said
      // what happens next. Rejected is, and so is every refusal.
      note.classList.toggle("error", outcome !== "ok" && outcome !== "pending");
      // Three answers end the door — in, waiting, declined — and the rest
      // leave the button for another try.
      const settled = outcome === "ok" || outcome === "pending" || outcome === "rejected";
      button.hidden = settled;
      button.disabled = false;
      if (outcome === "ok") {
        // The caller may know what comes next (the refused-cast door reloads
        // the lecture); otherwise, with no page in the registry to send them
        // to, the first lecture is the other thing a name reaches
        // (`#<name>/1`, names.ts), so there is always something to click.
        if (opts.onJoined) opts.onJoined();
        else if (!resolved.page) wrap.append(h("p", {}, h("a", { href: `#${name}/1` }, "Start with the first lecture")));
      }
      // A token the server no longer knows is dead in this browser too: drop
      // it, so the next click is the sign-in the note just asked for.
      if (outcome === "key") {
        deps.forget();
        button.textContent = "Sign in to join";
      }
```

Extend the doc comment above `courseDoor` with one sentence: "`opts.onJoined` replaces the first-lecture link after a successful join; `opts.lead` replaces the sentence above the button — both for the refused-cast door (deniedDoor)."

- [ ] **Step 5: Run both gates and commit**

Run: `npx tsc --noEmit && npx vitest run` — Expected: `tsc` names every caller of `sendEvent` that still expects a boolean (viewer.ts's three `void` calls compile as they are — `void` discards the promise). PASS.

```bash
cd ~/Documents/GitHub/drawcast/.claude/worktrees/round-1b
git add src/learn.ts src/viewer.ts tests/learn.test.ts tests/course-door.test.ts
git commit -m "feat(learn): a join can be pending, a report can be refused, and the door says which"
```

---

### Task 10: The viewer — a refused cast is a door, and reporting stops after a refusal

**Files:** Modify `drawcast/src/viewer.ts`, `tests/viewer-anvil.test.ts`, `tests/learn-viewer.test.ts`, `tests/course-door.test.ts`

**Interfaces:** Consumes `SendOutcome`, `courseDoor(..., opts)` (Task 9). Produces `class CastDenied extends Error { status: 401 | 403 }` thrown by `fetchAnvilText`; `deniedDoor(cast, status, deps?, onJoined?) -> HTMLElement`; `runViewer` renders it in place of the error line.

- [ ] **Step 1: The failing tests**

In `tests/viewer-anvil.test.ts`, import `CastDenied` beside `fetchAnvilText` and replace the two tests `"a refusal names the door, not the network"` and `"401 — the server's answer to no token at all — is the same door"` with:

```typescript
  test("403 — signed in without standing — is a typed refusal the viewer turns into the course's door", async () => {
    const { impl } = fetchWith(() => new Response("{}", { status: 403 }));
    const err = await fetchAnvilText(REF, impl).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(CastDenied);
    expect((err as CastDenied).status).toBe(403);
    expect((err as Error).message).toMatch(/join/i);
  });
  test("401 — nobody signed in — is the same class, and says to sign in", async () => {
    const { f, impl } = fetchWith(() => new Response("{}", { status: 401 }));
    const err = await fetchAnvilText(REF, impl).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(CastDenied);
    expect((err as CastDenied).status).toBe(401);
    expect((err as Error).message).toMatch(/sign in/i);
    // BOTH requests went out, and that is the accepted cost of fetching them
    // in parallel: the audio leaves before the spec's status is known.
    // Pinned — if this ever reads 1 again, the fetches have gone back to
    // sequential and every first play pays an extra round trip.
    expect(f).toHaveBeenCalledTimes(2);
  });
  test("the viewer renders a refused server cast as a door, before the generic error line", () => {
    const run = viewer.slice(viewer.indexOf("export async function runViewer("));
    const at = run.indexOf("} catch (err) {");
    const handler = run.slice(at, run.indexOf("status.classList.add(\"error\")", at));
    expect(handler).toContain("err instanceof CastDenied && req.anvil");
    expect(handler).toContain("deniedDoor(req.anvil.cast, err.status)");
    expect(handler.indexOf("deniedDoor(")).toBeLessThan(handler.indexOf("(err as Error).message"));
  });
```

In `tests/course-door.test.ts`, import `deniedDoor` beside `courseDoor` and append a describe:

```typescript
describe("the door on a refused server cast", () => {
  function denied(status: 401 | 403, token: string, outcome: JoinOutcome = "ok") {
    const onJoined = vi.fn();
    const deps: DoorDeps = { token: () => token, forget: vi.fn(), signIn: vi.fn(), join: vi.fn(async () => outcome) };
    const root = deniedDoor("anvil/spanish1/01-intro.yaml", status, deps, onJoined) as unknown as El;
    return { root, deps, onJoined, button: root.all().find((e) => e.tagName === "button")!, note: root.all().find((e) => e.className === "viewer-status")! };
  }
  test("401: one button, the sign-in, and no join", () => {
    const d = denied(401, "");
    expect(d.button.textContent).toBe("Sign in to watch");
    d.button.click();
    expect(d.deps.signIn).toHaveBeenCalledTimes(1);
    expect(d.deps.join).not.toHaveBeenCalled();
  });
  test("403: the course's door, built from the cast key alone — the course is anvil/<slug>, the heading the slug — and a join reloads", async () => {
    const d = denied(403, "tok");
    expect(d.root.all().find((e) => e.tagName === "h1")!.textContent).toBe("Spanish1");
    expect(d.note.textContent).toMatch(/part of a course/i);
    expect(d.button.textContent).toBe("Join this course");
    d.button.click();
    await tick();
    expect(d.deps.join).toHaveBeenCalledWith("tok", { course: "anvil/spanish1", title: "Spanish1", page: "https://drawcast.app/#spanish1" });
    expect(d.onJoined).toHaveBeenCalledTimes(1);
  });
  test("403, pending: the note says the teachers decide and nothing reloads", async () => {
    const d = denied(403, "tok", "pending");
    d.button.click();
    await tick();
    expect(d.note.textContent).toBe(joinNote("pending"));
    expect(d.onJoined).not.toHaveBeenCalled();
    expect(d.button.hidden).toBe(true);
  });
});
```

In `tests/learn-viewer.test.ts`, inside `describe("the viewer reports as the account", …)` replace the tests `"a report carries the token, under the cast key, to the reporter's api"`, `"opened is reported once per session, like a view"`, `"an answer is keyed by (item, step)…"` and `"opened, answer and completed are wired and never awaited…"` with:

```typescript
  test("one report function, fed the reporter, carries the token under the cast key to the reporter's api", () => {
    expect(block).toMatch(/const report = \(ev: LearnEvent\): void => \{/);
    expect(block).toMatch(/void sendEvent\(reporter\.api, ev, reporter\.key\)\.then\(\(outcome\) => \{\s*if \(outcome === "refused"\) reporter\.stopped = true;\s*\}\);/);
    expect(src.match(/sendEvent\(/g)).toHaveLength(1); // the import aside — one call site
  });
  test("a refusal stops this cast's reporting for the session; a network failure does not", () => {
    expect(block).toMatch(/if \(!reporter \|\| reporter\.stopped\) return;/);
    expect(block).not.toMatch(/outcome === "failed"\) reporter\.stopped/);
  });
  test("opened is reported once per session, like a view", () => {
    expect(block).toMatch(/if \(firstOpenInSession\(reporter\.cast, session\)\) report\(\{ kind: "opened", cast: reporter\.cast \}\)/);
  });
  test("an answer is keyed by (item, step): the playlist item index plus the step inside it", () => {
    expect(src).toMatch(/onAnswer: reporter\s*\?\s*\(a, _item, index\) =>/);
    expect(src).toMatch(/report\(\{ kind: "answer", cast: reporter\.cast, item: index, step: a\.index/);
  });
  test("opened, answer and completed go through report and are never awaited — a refusal or an outage can never reach playback", () => {
    expect(src.match(/report\(\{ kind: "(opened|answer|completed)"/g)).toHaveLength(3);
    expect(src).not.toMatch(/await\s+(sendEvent|report)\(/);
  });
```

(`src.match(/sendEvent\(/g)` counts the one call; the import line reads `sendEvent }` without a parenthesis.)

- [ ] **Step 2: Run and watch them fail**

Run: `npx vitest run tests/viewer-anvil.test.ts tests/course-door.test.ts tests/learn-viewer.test.ts` — Expected: FAIL (`CastDenied` not exported; `deniedDoor` missing; pins on `void sendEvent(reporter.api, { kind: "opened"`).

- [ ] **Step 3: `viewer.ts` — the typed refusal**

Above `fetchAnvilText` add:

```typescript
/**
 * The server said no to a stored cast, and which no it was: 401 is nobody
 * signed in (the client's cue to sign in), 403 is signed in without standing
 * — not enrolled, not teaching, not the owner (the cue to offer the door).
 * A class, not a message, so runViewer can render a door instead of an
 * error line; the message is what a non-anvil caller (main.ts's narration
 * reuse) shows if it ever surfaces one.
 */
export class CastDenied extends Error {
  status: 401 | 403;
  constructor(status: 401 | 403) {
    super(status === 401 ? "This drawcast is private — sign in to watch it." : "This drawcast is part of a course you have not joined — join to watch it.");
    this.status = status;
  }
}
```

In `fetchAnvilText`, replace the `if (!res.ok) { throw new Error(…) }` block with:

```typescript
  if (res.status === 401 || res.status === 403) throw new CastDenied(res.status);
  if (!res.ok) {
    throw new Error(
      res.status === 404
        ? "That drawcast is not on the drawcast server (it may have been removed)."
        : `Could not fetch the drawcast (HTTP ${res.status}).`,
    );
  }
```

and in its doc comment replace "the server's 401 becomes the message that says what to do about it" with "the server's 401 and 403 become a CastDenied, which runViewer turns into a door".

- [ ] **Step 4: The doors**

After `courseDoor` add:

```typescript
/**
 * A refused server cast is a door, not an error (spec §7). 401: nobody is
 * signed in — the handshake, which returns to this very address and plays
 * on the way back. 403: signed in without standing — the course's own door,
 * built from the cast key alone (`anvil/<slug>/<file>` belongs to the
 * course `anvil/<slug>`, which /enroll accepts for a published server
 * course); joined, the page reloads and the fetch finds the enrolment. A
 * pending request says so and stays. `onJoined` is injectable for the node
 * suite; live, it reloads.
 */
export function deniedDoor(cast: string, status: 401 | 403, deps: DoorDeps = liveDoorDeps, onJoined: () => void = () => location.reload()): HTMLElement {
  if (status === 401) {
    const button = h("button", { class: "primary" }, "Sign in to watch");
    button.addEventListener("click", () => deps.signIn());
    return h(
      "div",
      { class: "viewer-wrap" },
      h("h1", { class: "viewer-title" }, "This drawcast is private"),
      h("p", { class: "viewer-status" }, "Sign in to watch it. If you are enrolled in its course — or it is open to anyone signed in — it plays straight after."),
      h("p", {}, button),
    );
  }
  const slug = cast.split("/")[1] ?? cast;
  return courseDoor(slug, { kind: "course", target: `anvil/${slug}`, page: null }, deps, {
    onJoined,
    lead: "This drawcast is part of a course you have not joined — join to watch it. Joining lets you and the course's teachers follow your progress and answers.",
  });
}
```

In `runViewer`'s `catch (err)` block, before the two existing lines:

```typescript
    if (err instanceof CastDenied && req.anvil) {
      status.replaceWith(deniedDoor(req.anvil.cast, err.status));
      return;
    }
```

- [ ] **Step 5: The reporter stops after a refusal**

Replace the block from `const reporter = …` through the `if (reporter) { … }` that reports `opened` with:

```typescript
    const reporter = castKey !== null && enroll === DEFAULT_ENROLL_API && key !== "" ? { api: enroll, key, cast: castKey, stopped: false } : null;
    // One refusal — 401 (the token is dead) or 403 (not enrolled) — stops
    // this cast's reporting for the session: the server would answer the
    // same to every later event, and the README counted the waste. A
    // network failure does not stop it; the next event may get through.
    // Never awaited: a report can never reach playback.
    const report = (ev: LearnEvent): void => {
      if (!reporter || reporter.stopped) return;
      void sendEvent(reporter.api, ev, reporter.key).then((outcome) => {
        if (outcome === "refused") reporter.stopped = true;
      });
    };
    if (reporter) {
      const session = (() => {
        try {
          return sessionStorage;
        } catch {
          return null;
        }
      })();
      if (firstOpenInSession(reporter.cast, session)) report({ kind: "opened", cast: reporter.cast });
    }
```

The `onAnswer` callback body becomes `report({ kind: "answer", cast: reporter.cast, item: index, step: a.index, question: a.question, given: a.given, expected: a.expected, correct: a.correct });` and `onDone`'s becomes `report({ kind: "completed", cast: reporter.cast });`. Add `LearnEvent` to the existing `import type { JoinOutcome, JoinRequest } from "./learn";` line — the value-import line above it must stay byte-identical (a pin reads it).

- [ ] **Step 6: Run both gates and commit**

Run: `npx tsc --noEmit && npx vitest run` — Expected: PASS.

```bash
git add src/viewer.ts tests/viewer-anvil.test.ts tests/learn-viewer.test.ts tests/course-door.test.ts
git commit -m "feat(viewer): a refused cast is a door, and one refusal ends the session's reporting"
```

---

### Task 11: The publish dialog — *Who can watch* sends nothing unless asked; Settings links the account

**Files:** Modify `drawcast/src/publish/server.ts`, `src/ui/share.ts`, `src/main.ts`, `tests/publish-server.test.ts`

**Interfaces:** Produces `ServerPublishArgs.access?: ServerAccess` (omitted from the body when undefined); `publishServer(choices: { bake; embedImages; name?; access?: ServerAccess })`.

- [ ] **Step 1: The failing tests**

In `tests/publish-server.test.ts`:

- In `test("the spec write is a text/plain JSON body: key, cast, title, the spec ALONE, and the access")`, keep the assertion (ARGS carries `access: "enrolled"`) and add, directly after it, a new test using the file's own `fetchWith`/`okJson` helpers:
  ```typescript
  test("no access chosen, no access in the body — absent means keep (spec §5)", async () => {
    const { impl, calls } = fetchWith(() => okJson());
    await publishToServer({ ...ARGS, access: undefined }, impl);
    const body = JSON.parse(calls()[0][1].body as string) as Record<string, unknown>;
    expect("access" in body).toBe(false);
    expect(body).toMatchObject({ key: "t", cast: "anvil/spanish1/01-intro.yaml", title: "Intro" });
  });
  ```
- Replace `test("hands publishServer the shared choices plus the name and the access")`'s regex with `/publishServer:\s*\(choices:\s*\{\s*bake:\s*boolean;\s*embedImages:\s*boolean;\s*name\?:\s*string;\s*access\?:\s*ServerAccess\s*\}\)\s*=>\s*Promise<void>/`.
- Replace `test("who can watch: two values, closed by default, reset on every open")` with:
  ```typescript
  test("who can watch: as before by default — which sends nothing — then the three doors, reset to as-before on every open", () => {
    const panel = share.slice(share.indexOf("// ---- drawcast server panel"), share.indexOf("// ---- Drive panel"));
    expect(panel).toContain('["", "As before"]');
    expect(panel).toContain('["open", "Anyone with the link"]');
    expect(panel).toContain('["signed-in", "Anyone signed in"]');
    expect(panel).toContain('["enrolled", "Enrolled learners (and you)"]');
    expect(panel).toMatch(/const access: ServerAccess \| undefined =/);
    expect(panel).not.toContain('"Only you, for now"');
    expect(share).toContain('serverAccess.value = "";');
    expect(share).not.toContain('serverAccess.value = "enrolled";');
  });
  ```
- Replace `test("says before the click that access is set anew on every publish")` with:
  ```typescript
  test("says before the click that as-before keeps the server's door, and that a choice is the course's, live", () => {
    const panel = share.slice(share.indexOf("// ---- drawcast server panel"), share.indexOf("// ---- Drive panel"));
    expect(panel).toContain("As before keeps what the server has");
    expect(panel).toContain("same door the dashboard edits");
    expect(panel).not.toContain("Every publish sets this anew");
  });
  ```
- Replace `test("every successful publish says which door it set — …")` with:
  ```typescript
  test("every successful publish says which door it set — or that it left the door alone", () => {
    expect(serverCast).toMatch(/const door =\s*access === undefined\s*\?/);
    expect(serverCast).toContain("as before");
    expect(serverCast).toContain("open: anyone with the link can watch");
    expect(serverCast).toContain("anyone signed in can watch");
    expect(serverCast).toContain("enrolled learners (and you) can watch");
    expect(serverCast).toMatch(/setStatus\(`Published to \$\{address\}\$\{silent\}\$\{door\}/);
    expect(serverCast).toMatch(/`Published to \$\{address\}\$\{door\}, but WITHOUT its narration/);
    expect(serverCast).not.toMatch(/api\/cast\?cast=.*access/);
  });
  test("Settings links the account home on the server", () => {
    expect(main).toContain('"Your account"');
    expect(main).toMatch(/href: `\$\{DEFAULT_ENROLL_API\}\/`/);
  });
  ```

Run: `npx vitest run tests/publish-server.test.ts` — Expected: FAIL.

- [ ] **Step 2: `publish/server.ts`**

Change `access: ServerAccess;` in `ServerPublishArgs` to:

```typescript
  /** Who can watch (spec §5, question 2). Undefined sends nothing, and the
   *  server keeps the course's door as it is — "as before"; a value is the
   *  author's explicit choice and writes through to the COURSE. */
  access?: ServerAccess;
```

and the body line to `body: JSON.stringify({ key: args.token, cast, title: args.title, spec, ...(args.access === undefined ? {} : { access: args.access }) }),`. Update the type's comment: "The server enforces all three from round 1b: open is public, signed-in any account, enrolled an active enrolment — and the owner, the run's teachers and an admin always."

- [ ] **Step 3: `share.ts`**

Change `publishServer`'s type to `access?: ServerAccess`. Replace the `serverAccess` option loop and hint with:

```typescript
  // "Who can watch" (spec §5, question 2): the COURSE's door, edited live
  // in the dashboard — so the default here is "as before", which sends
  // nothing and leaves the server's value alone. A choice is the author's
  // explicit edit and writes through. Absence-means-keep is what stops a
  // republished lecture from re-opening a door a teacher closed.
  const serverAccess = h("select", { "aria-label": "Who can watch" }) as HTMLSelectElement;
  for (const [v, label] of [
    ["", "As before"],
    ["open", "Anyone with the link"],
    ["signed-in", "Anyone signed in"],
    ["enrolled", "Enrolled learners (and you)"],
  ]) {
    serverAccess.appendChild(h("option", { value: v }, label));
  }
  const serverAccessRow = h(
    "div",
    {},
    h("label", { class: "quiet-label" }, "Who can watch ", serverAccess),
    h(
      "div",
      { class: "hint" },
      "As before keeps what the server has — enrolled learners and you, on a first publish. A choice here is the course's door, the same door the dashboard edits: it applies at once to every lecture published under this name.",
    ),
  );
```

In the click handler replace `const access: ServerAccess = serverAccess.value === "open" ? "open" : "enrolled";` with:

```typescript
    const access: ServerAccess | undefined =
      serverAccess.value === "open" || serverAccess.value === "signed-in" || serverAccess.value === "enrolled" ? serverAccess.value : undefined;
```

and in `prepPanels`, `serverAccess.value = "enrolled";` becomes `serverAccess.value = "";`.

- [ ] **Step 4: `main.ts`**

`publishServerCast`'s parameter type becomes `access?: ServerAccess`. Replace the `const door = …` expression with:

```typescript
    const door =
      access === undefined
        ? " — who can watch: as before (enrolled learners and you, on a first publish)"
        : access === "open"
          ? " — open: anyone with the link can watch"
          : access === "signed-in"
            ? " — anyone signed in can watch"
            : " — enrolled learners (and you) can watch; a link shared while it was open now asks to sign in";
```

and its comment with: "Which door this publish set, or that it left the door alone: the server keeps the course's value unless the body carries one (spec §5), so *as before* is a true statement about what happened, not a guess." In the `"account"` settings field, change the `settings-row` to `h("div", { class: "settings-row" }, signInBtn, signOutBtn, signInState, h("a", { href: `${DEFAULT_ENROLL_API}/`, target: "_blank", rel: "noopener" }, "Your account"))` and append to the note: " Your account page on the server shows the courses you follow, your progress, and the way out of a course."

- [ ] **Step 5: Run both gates and commit**

Run: `npx tsc --noEmit && npx vitest run` — Expected: PASS.

```bash
git add src/publish/server.ts src/ui/share.ts src/main.ts tests/publish-server.test.ts
git commit -m "feat(publish): who can watch is the course's, and the dialog sends nothing unless asked"
```

---

### Task 12: Smoke the round end to end, and close the ledger

**Files:** Create `drawcast/docs/superpowers/plans/2026-09-06-round-1b-smoke.md`; modify `docs/superpowers/plans/2026-09-06-round-1b-ledger.md`

After Hans's pull. The controller runs the curl half; the browser half is Hans's, or the controller's with a token Hans supplies.

- [ ] **Step 1: The anonymous surface (curl, no token)**

```bash
B=https://drawcast.anvil.app/_/api
curl -s -o /dev/null -w "%{http_code}\n" "$B/cast?cast=anvil/<a private slug>/<file>.yaml"   # → 401
curl -s -X POST $B/enroll -H 'content-type: text/plain' -d '{"key":"nope","course":"anvil/x","title":"x","page":"https://drawcast.app/"}'   # → 401 key (the parser admits anvil/ now)
curl -s -X POST $B/login -H 'content-type: text/plain' -d '{"email":"<an address with NO account>","return":"https://drawcast.app/"}'   # → {"ok":true}, the mail arrives, and Users gains a row with no password_hash
```

- [ ] **Step 2: The gate (browser)**

Publish a cast to the server with *Who can watch* left at *As before* → the status says "as before". In the dashboard the course reads "Enrolled learners". Open the link in a second browser signed out → the *Sign in to watch* door. Sign in there with a Google account that is not enrolled → the course door, "part of a course you have not joined". Join → the lecture plays. Set the run to *Teachers approve* in RunForm; a third account joins → "Your request is with the course's teachers", the owner gets the mail, the grid shows *awaiting approval*; approve → the applicant's mail, and the lecture plays for them. Republish the cast with *As before* → the dashboard's door has not moved; republish with *Anyone signed in* → it has.

- [ ] **Step 3: The account home**

Open drawcast.anvil.app as the learner: the course is listed with its progress; *Leave this course* → the teacher's grid loses the row. As Hans: the dashboard sign-in offers no password; *Email me a link* with no return lands at `#t=` on the Anvil app and signs in.

- [ ] **Step 4: Write down what happened and commit**

Record every step's answer and every surprise in the smoke file, the way `2026-09-05-round-0-measurements.md` does. Then the ledger's "Verified live" table. A round is delivered when it has been used.

---

## Self-Review

**Spec coverage (§12 round 1b):** approval — Tasks 2, 4, 5, 9; `access` on the course and the real gate — Tasks 1, 2, 3; `/enroll` open to server courses — Task 4; the account home with leave and forget — Task 6; the dashboard's `join` and `access` — Task 5; the sign-in chooser, link signup, landing on the server, `use_email` off — Tasks 7, 8; the viewer's two doors and the reporting stop — Tasks 9, 10; *as before* — Task 11. §3's "the applicant is told" — Task 5's `_mail_decision`. §1's "the link may also land on the server's own page" — Task 7's `redeem_here`, Task 8's Form1. Carried from 1a: `/login`'s client caller — the chooser (Task 8); no way to leave — Task 6; passwordless — Tasks 7, 8; the once-row sweep — Task 7; reporting after a 403 — Task 10.

**Deliberately not here:** the owner delete and unlisting (round 2, spec §9/§12), `listed`, `#free`, drip mail, a `me` route in the app (the home is on the server, §8), sweeping passwordless rows that never confirmed (named in §14 as sweepable; no learners yet).

**Type consistency:** `access.cast_read(access, owner_id, user_id, enrolled=, teacher=, admin=)` — defined Task 2, fed by `_may_read` Task 3 with `**_standing(course, user)` returning exactly those three keys. `access.enrol_outcome(existing_state, join)` — Task 2, called Task 4. `mail.join_request(course_title, run_title, applicant_email, dashboard_url)` and `mail.join_decision(course_title, approved, link)` — Task 4, called by `_mail_teachers` (Task 4) and `_mail_decision` (Task 5). `_course_link(course)` — Task 5, used by `_mail_decision` and `my_enrollments` (Task 6). `request_link(email, return_url)` and `redeem_here(token)` — Task 7, called by SignIn and Form1 in Task 8. `SendOutcome` and `courseDoor(name, resolved, deps, opts)` — Task 9, consumed by Task 10's `report` and `deniedDoor`. `ServerPublishArgs.access?` — Task 11, matching `parse_cast_put`'s optional access (Task 3).

**Two things an implementer must check rather than trust:** (1) Task 8 assumes `anvil.users.login_with_google()` / `login_with_microsoft()` / `login_with_facebook()` exist client-side and `anvil.users.force_login(user, remember=True)` server-side — both are documented Anvil API, but pytest cannot reach them; a NameError there surfaces only after the pull, on the sign-in page. (2) Task 7 reads the caller's IP from `anvil.server.context.client.ip`; if the runtime hands back None the budget falls open, which is the limiter's designed failure mode, not a hole.

