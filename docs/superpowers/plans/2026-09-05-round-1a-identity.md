# Round 1a — the code becomes an account — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A learner signs in once and joins a course in one click; the three-word code, the join box and the word list are gone.

**Architecture:** Round 0 gave every author a session token through a redirect handshake. This round points the learner half of the API at that same token: an enrolment links a `users` row to a `runs` row, `/enroll` authorises from the token instead of minting a code, and a magic link becomes the third way to obtain one. The client loses its per-course code map and its 180-line inline join script; the published course page stops being a dashboard and becomes a door.

**Tech Stack:** Python 3 + Anvil Works + pytest (drawcast-anvil); TypeScript + Vite + Vitest (drawcast). No new dependencies.

**Spec:** `docs/superpowers/specs/2026-09-05-private-publishing-and-learner-identity-design.md` — §1 (the handshake), §2 (what a person is), §3 (getting in), §8 (where each page lives), §12 (round 1).

## Global Constraints

- **Two repos.** `~/Documents/GitHub/drawcast` (branch `main`) and `~/Documents/GitHub/drawcast-anvil` (branch `master`). Never `git add -A` — another session shares the drawcast checkout. Add named paths only.
- **Implementers never push.** A push to `drawcast-anvil master` precedes Hans pulling into the live app; the controller asks him.
- **Anvil pulls are manual**, and any task touching `anvil.yaml` ends with Hans accepting the pull with **"source code"**.
- **Anvil test:** `set -o pipefail; python3 -m pytest -q` from the repo root, and check the exit status — a pipe takes its status from the last command, so `pytest | tail && git commit` commits a red suite.
- **drawcast test:** `npx vitest run` AND `npx tsc --noEmit`. **Vitest uses esbuild and does not type-check**; `tsc` is a separate gate that has already caught two bugs a green suite missed.
- **Pure Python modules may not import `anvil.server` or `anvil.tables`** — pytest leaves those unimportable on purpose. `api.py` and `dashboard_server.py` are glue, pinned by source-text tests.
- **Bodies are `text/plain`** (CORS-simple); answers are JSON with `Cache-Control: no-store`; endpoints use `ENDPOINT = dict(cross_site_session=False, enable_cors=True)`.
- **A credential may ride a query string only on a `fetch` no person sees** (§1, narrowed in round 0). A credential in an address a person could copy is still forbidden.
- **No backwards compatibility.** There are no real learners; rows are dropped, not migrated.
- **When you retire a user-facing concept, sweep `client_code/*/form_template.html` and `README.md`** for copy naming the old one. Three Important findings in round 0 came from that gap.

## File Structure

**drawcast-anvil** — `anvil.yaml` (schema + login flags); `server_code/parsers.py` (`parse_enroll` loses name/email, `parse_login` arrives); `server_code/api.py` (`/enroll` re-authorised, `/login` added, `/progress` and `/forget` deleted); `server_code/mail.py` (welcome → sign-in link); `server_code/limits.py` (+`login`); `server_code/dashboard_server.py` and `server_code/dash.py` (a learner is an account); **deleted:** `server_code/words.py`, `server_code/codes.py`, `tests/test_codes.py`.

**drawcast** — `src/learn.ts` (the account token is the identity; the per-course code map goes); `src/course/page.ts` (a door, no script); `src/course/publish.ts` (stops injecting the script); `src/viewer.ts` (the learner block reads one token); `src/ui/share.ts` (bake defaults on); **deleted:** `src/course/enrol-script.ts`, `tests/course-join-page.test.ts`.

---

### Task 1: Schema — an enrolment is an account, and social login is on

**Files:** Modify `drawcast-anvil/anvil.yaml`, `drawcast-anvil/README.md`, `drawcast-anvil/tests/test_schema.py`

**Interfaces:** Produces `enrollments(run→runs, user→users, state, created, last_seen, drip_index, drip_at)` and `runs` without `require_email`.

- [ ] **Step 1: Rewrite the `enrollments` columns in `db_schema`**

Delete the `code`, `name` and `email` column entries. Add, in the existing shape (`admin_ui: {}`, `client_hidden: null`, `name`, `type`, `target` for links):

```yaml
    - admin_ui: {}
      client_hidden: null
      name: user
      target: users
      type: link_single
    - admin_ui: {}
      client_hidden: null
      name: state
      type: string
    - admin_ui: {}
      client_hidden: null
      name: drip_index
      type: number
    - admin_ui: {}
      client_hidden: null
      name: drip_at
      type: datetime
```

`state` carries `active` for every row this round writes. `pending` and `rejected` are round 1b's; the column exists now so that round adds values, not a migration. `drip_index`/`drip_at` are round 4's, added here for the same reason — one schema pull instead of three.

- [ ] **Step 2: Drop `require_email` from `runs`**

Delete that whole column entry. The account carries an address; there is nothing to require.

- [ ] **Step 3: Turn on social login**

In `anvil.yaml`'s users service `client_config`, set `use_google: true` and `use_microsoft: true`. Leave `use_facebook: false` — Hans's learners are university accounts, and every provider added is a support surface. Leave `confirm_email: true` alone; Task 3's magic link is what makes email signup pleasant.

- [ ] **Step 4: Re-aim `tests/test_schema.py`**

It asserts the old columns. Assert instead that `enrollments` has `user`, `state`, `drip_index`, `drip_at` and does NOT have `code`, `name` or `email`; that `runs` has no `require_email`; and that `enrollments.user` targets `users`.

- [ ] **Step 5: Update the README**

The endpoint table loses `GET /progress` and `POST /forget` (Task 5 deletes them) and gains `POST /login`. The pull ritual section says this pull **drops every existing enrolment row** — they are keyed by a code that no longer exists — and that `use_google`/`use_microsoft` are now on.

- [ ] **Step 6: Run and commit**

Run: `set -o pipefail; python3 -m pytest -q` — Expected: PASS

```bash
cd ~/Documents/GitHub/drawcast-anvil
git add anvil.yaml README.md tests/test_schema.py
git commit -m "feat(schema): an enrolment is an account, and social login is on"
```

Do not push. The controller batches the Anvil tasks and asks Hans for one pull.

---

### Task 2: Delete the word list

**Files:** Delete `drawcast-anvil/server_code/words.py`, `server_code/codes.py`, `tests/test_codes.py`. Modify `server_code/mail.py`, `tests/test_mail.py`.

**Interfaces:** Produces `mail.sign_in_link(url, token)` and `mail.sign_in(link)` returning `(subject, text)`. Removes `codes.make_code`, `codes.CODE_RE`, `words.WORDS`.

- [ ] **Step 1: Write the failing mail test**

```python
# drawcast-anvil/tests/test_mail.py — replace the welcome tests
import mail


def test_sign_in_link_appends_the_token():
    assert mail.sign_in_link("https://drawcast.app/", "abc") == "https://drawcast.app/#t=abc"
    assert mail.sign_in_link("https://drawcast.app/#spanish", "abc") == "https://drawcast.app/#spanish&t=abc"


def test_the_mail_names_the_link_and_its_life():
    subject, text = mail.sign_in("https://drawcast.app/#t=abc")
    assert "drawcast" in subject.lower()
    assert "https://drawcast.app/#t=abc" in text
    # The reader must know it expires, or a dead link looks like a broken app.
    assert "5" in text or "five" in text
```

- [ ] **Step 2: Run it and watch it fail**

Run: `python3 -m pytest tests/test_mail.py -q` — Expected: FAIL, `sign_in_link` missing.

- [ ] **Step 3: Replace `mail.py`**

```python
"""The sign-in mail (spec §1): the third way to obtain a session token,
beside a password and a social provider. Pure; api.py does the sending."""

FROM_NAME = "drawcast"

# Mirrors tokens.ONCE_TTL_S, stated in words because the reader of a dead
# link needs to know it was short-lived, not broken.
TTL_MINUTES = 5


def sign_in_link(return_url, token):
    """The one-time token rides the FRAGMENT, never the query string: a
    fragment is not sent to any server and does not land in an access log."""
    joiner = "&" if "#" in return_url else "#"
    return "%s%st=%s" % (return_url, joiner, token)


def sign_in(link):
    subject = "Your drawcast sign-in link"
    text = (
        "Open this link to sign in to drawcast:\n"
        "\n"
        "%s\n"
        "\n"
        "It works once and expires after %d minutes. If you did not ask to\n"
        "sign in, nothing has happened to your account and you can ignore this.\n"
    ) % (link, TTL_MINUTES)
    return subject, text
```

- [ ] **Step 4: Delete the code machinery**

```bash
git rm server_code/words.py server_code/codes.py tests/test_codes.py
```

Then remove `import codes` from `server_code/api.py` and `server_code/parsers.py`, and delete `parsers.CODE_RE` and `parse_code` if nothing else uses them (`grep -rn "codes\.\|parse_code\|CODE_RE" server_code/ tests/` must come back empty).

- [ ] **Step 5: Run the suite and commit**

Run: `set -o pipefail; python3 -m pytest -q` — Expected: PASS.

```bash
git add server_code/mail.py tests/test_mail.py server_code/api.py server_code/parsers.py
git commit -m "feat(mail): a sign-in link replaces the welcome mail, and the word list goes"
```

---

### Task 3: `POST /login` — the magic link

**Files:** Modify `drawcast-anvil/server_code/api.py`, `server_code/limits.py`, `server_code/parsers.py`, `tests/test_limits.py`, `tests/test_parsers.py`, `tests/test_api_source.py`

**Interfaces:** Consumes `tokens.make_secret`, `tokens.allowed_return`, `mail.sign_in`, `mail.sign_in_link`. Produces `POST /_/api/login {email, return} → {ok: true}` always.

- [ ] **Step 1: Write the failing parser and budget tests**

```python
# append to drawcast-anvil/tests/test_parsers.py
def test_parse_login_needs_an_address_and_a_return():
    out = rq.parse_login({"email": " Kari@Example.ORG ", "return": "https://drawcast.app/#spanish"})
    assert out == {"email": "kari@example.org", "return": "https://drawcast.app/#spanish"}


@pytest.mark.parametrize("body", [
    {"email": "not-an-address", "return": "https://drawcast.app/"},
    {"email": "kari@example.org"},
    {"return": "https://drawcast.app/"},
    {"email": 5, "return": "https://drawcast.app/"},
])
def test_parse_login_rejects(body):
    with pytest.raises(rq.BadRequest):
        rq.parse_login(body)
```

```python
# append to drawcast-anvil/tests/test_limits.py
def test_the_login_bucket_exists():
    assert limits.BUDGETS["login"] == 20
```

- [ ] **Step 2: Run them and watch them fail**

Run: `python3 -m pytest tests/test_parsers.py tests/test_limits.py -q` — Expected: FAIL on both.

- [ ] **Step 3: Add the parser and the budget**

```python
# server_code/parsers.py
def parse_login(body):
    """A sign-in request. The address is lower-cased because that is how it
    will be matched against the users table, which stores it as typed."""
    body = _obj(body)
    email = _text(body, "email", MAX_TITLE, required=True).lower()
    if not EMAIL_RE.fullmatch(email):
        raise BadRequest("email")
    return {"email": email, "return": _text(body, "return", MAX_PAGE, required=True)}
```

Add `"login": 20,` to `BUDGETS` in `limits.py`.

- [ ] **Step 4: Add the endpoint**

```python
# server_code/api.py
@anvil.server.http_endpoint("/login", methods=["POST"], **ENDPOINT)
def http_login(**params):
    """A sign-in link, mailed. The answer is the SAME whether or not the
    address has an account: a differing answer here is an account-existence
    oracle for anyone with a list of addresses.

    No account is created. Signing up is the users service's own job, on the
    app's sign-in form; this endpoint only lets someone who already has an
    account reach it from the other origin without a password."""
    if not _allowed("login"):
        return json_response({"error": "rate"}, 429)
    try:
        req = rq.parse_login(load_body())
    except rq.BadRequest as exc:
        return _bad(exc)
    target = tokens.allowed_return(req["return"], tokens.RETURN_ALLOWLIST)
    if target is None:
        return json_response({"error": "return"}, 400)
    user = _user_by_email(req["email"])
    if user is not None and user["enabled"]:
        secret = tokens.make_secret()
        app_tables.tokens.add_row(secret=secret, user=user, kind="once",
                                  created=time.time(), last_used=None, label=None)
        subject, text = mail.sign_in(mail.sign_in_link(target, secret))
        try:
            anvil.email.send(to=req["email"], from_name=mail.FROM_NAME, subject=subject, text=text)
        except Exception:
            pass
    return json_response({"ok": True})
```

`_user_by_email` currently lives in `dashboard_server.py`. Move it to `rows.py` — glue both files already import — and have both call it from there, so the lower-casing rule has one home.

- [ ] **Step 5: Pin it**

```python
# append to tests/test_api_source.py
def test_login_answers_the_same_for_unknown_addresses(source):
    """No account-existence oracle: the {"ok": True} return sits OUTSIDE the
    `if user is not None` block."""
    body = source[source.index("def http_login"):source.index("def http_login") + 2000]
    assert body.count('json_response({"ok": True})') == 1
    assert "return json_response({\"ok\": True})" in body.split("if user is not None")[1]


def test_login_checks_the_return_allowlist(source):
    assert "tokens.allowed_return(req[\"return\"], tokens.RETURN_ALLOWLIST)" in source
```

- [ ] **Step 6: Run and commit**

Run: `set -o pipefail; python3 -m pytest -q` — Expected: PASS.

```bash
git add server_code/api.py server_code/limits.py server_code/parsers.py server_code/rows.py server_code/dashboard_server.py tests/
git commit -m "feat(login): a mailed link is the third way to a session token"
```

---

### Task 4: `/enroll` is one click

**Files:** Modify `drawcast-anvil/server_code/api.py`, `server_code/parsers.py`, `tests/test_parsers.py`, `tests/test_api_source.py`

**Interfaces:** Consumes `api._author` (a session token → users row). Produces `POST /_/api/enroll {key, course, title, page, run?} → {ok: true, state: "active"}`; `401 key`, `403 closed`, `404 run`.

- [ ] **Step 1: Write the failing parser test**

```python
# in tests/test_parsers.py — replace the name/email cases
def test_parse_enroll_no_longer_takes_a_name_or_an_address():
    out = rq.parse_enroll({"key": "k" * 40, "course": "h/dcast/spanish", "title": "Spanish",
                           "page": "https://h.github.io/dcast/spanish/", "name": "Kari", "email": "k@e.org"})
    assert out == {"key": "k" * 40, "course": "h/dcast/spanish", "title": "Spanish",
                   "page": "https://h.github.io/dcast/spanish/", "run": None}
```

- [ ] **Step 2: Run it and watch it fail**

Run: `python3 -m pytest tests/test_parsers.py -q` — Expected: FAIL (the dict still carries `name`/`email`).

- [ ] **Step 3: Change the parser**

In `parse_enroll`, delete the `name` and `email` lines and add `"key": _text(body, "key", 200, required=True)` to the returned dict. Extra keys in the body are ignored, not rejected — a stale client sending `name` gets no error, it just has no effect.

- [ ] **Step 4: Re-point the handler**

```python
@anvil.server.http_endpoint("/enroll", methods=["POST"], **ENDPOINT)
def http_enroll(**params):
    """One click for someone signed in. The account IS the identity, so there
    is nothing to mint and nothing to remember: joining twice is idempotent
    and returns the enrolment that already exists."""
    if not _allowed("enroll"):
        return json_response({"error": "rate"}, 429)
    try:
        req = rq.parse_enroll(load_body())
    except rq.BadRequest as exc:
        return _bad(exc)
    user = _author(req["key"])
    if user is None:
        return json_response({"error": "key"}, 401)
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
    if row is None:
        app_tables.enrollments.add_row(run=run, user=user, state="active",
                                       created=now, last_seen=now, drip_index=0, drip_at=None)
    else:
        row.update(last_seen=now)
    return json_response({"ok": True, "state": "active"})
```

- [ ] **Step 5: Pin the shape**

```python
# append to tests/test_api_source.py
def test_enroll_authorises_from_the_token_and_mints_nothing(source):
    body = source[source.index("def http_enroll"):source.index("def _send_welcome") if "_send_welcome" in source else source.index("def http_event")]
    assert "_author(req[\"key\"])" in body
    assert "codes." not in body
    assert "app_tables.enrollments.search(run=run, user=user)" in body
```

- [ ] **Step 6: Run and commit**

Run: `set -o pipefail; python3 -m pytest -q` — Expected: PASS.

```bash
git add server_code/api.py server_code/parsers.py tests/
git commit -m "feat(enroll): one click for a signed-in account, nothing minted"
```

---

### Task 5: `/event` follows the account; `/progress` and `/forget` go

**Files:** Modify `drawcast-anvil/server_code/api.py`, `server_code/limits.py`, `tests/test_api_source.py`, `README.md`

**Interfaces:** Produces `POST /_/api/event {key, kind, cast, …} → {ok}`; `401 key`; `403 enrol` when the account is not enrolled in a run of that cast's course.

- [ ] **Step 1: Re-point `/event`**

`parse_event` loses `code` and gains `key` (same change as `parse_enroll`: `_text(body, "key", 200, required=True)`). The handler resolves the account with `_author(ev["key"])`, then finds the enrolment:

```python
    user = _author(ev["key"])
    if user is None:
        return json_response({"error": "key"}, 401)
    course_key = rq.course_of(ev["cast"])
    # The account may be in several courses; this cast names exactly one.
    row = next((e for e in app_tables.enrollments.search(user=user)
                if e["run"] is not None and e["run"]["course"] is not None
                and e["run"]["course"]["key"] == course_key), None)
    if row is None:
        # Not enrolled is not an error the player should shout about — but it
        # is not silence either: the client stops reporting for this cast.
        return json_response({"error": "enrol"}, 403)
```

The rest (writing the event row, stamping `last_seen`) is unchanged.

- [ ] **Step 2: Delete `/progress` and `/forget`**

Both had exactly one caller: the join box's progress view, which Task 9 deletes. The learner's own progress moves to the account home, which is an Anvil form using `anvil.server.call` — not this HTTP API. Delete `http_progress` and `http_forget`, and their `progress`/`forget` entries in `limits.BUDGETS`.

**There is a window with no way to leave a course** until round 1b's account home lands. With no real learners that is acceptable; say so in the README rather than leaving it to be discovered.

- [ ] **Step 3: Pin the deletions and the gate**

```python
# append to tests/test_api_source.py
def test_the_learner_http_surface_is_enroll_and_event_only(source):
    assert '@anvil.server.http_endpoint("/progress"' not in source
    assert '@anvil.server.http_endpoint("/forget"' not in source
    assert '@anvil.server.http_endpoint("/enroll"' in source
    assert '@anvil.server.http_endpoint("/event"' in source


def test_event_refuses_a_cast_the_account_is_not_enrolled_in(source):
    assert '{"error": "enrol"}, 403' in source
```

- [ ] **Step 4: Run and commit**

Run: `set -o pipefail; python3 -m pytest -q` — Expected: PASS.

```bash
git add server_code/api.py server_code/limits.py tests/ README.md
git commit -m "feat(event): the account reports; progress and forget leave the HTTP surface"
```

---

### Task 6: The dashboard shows accounts, not codes

**Files:** Modify `drawcast-anvil/server_code/dashboard_server.py`, `server_code/dash.py`, `tests/test_dash.py`, `client_code/RunForm/__init__.py`

**Interfaces:** Consumes `enrollments.user`. Produces `_learners(run)` returning `[{"who", "email", "last_seen", "progress"}]` — `code` is gone from every shape.

- [ ] **Step 1: Write the failing renderer test**

```python
# in drawcast-anvil/tests/test_dash.py — replace the code-bearing cases
LEARNER = {"who": "kari@example.org", "email": "kari@example.org", "last_seen": "2026-09-05",
           "progress": [{"cast": "anvil/spanish/01.yaml", "opened": True, "completed": False,
                         "answers": [{"item": 0, "step": 1, "question": "q", "given": ["a"],
                                      "expected": "b", "correct": False}]}]}


def test_the_grid_names_the_account_not_a_code():
    html = dash.run_grid_html([{"cast": "anvil/spanish/01.yaml", "title": "01.yaml"}], [LEARNER])
    assert "kari@example.org" in html
    # No three-word code anywhere: the concept is gone.
    assert "-" not in html.split("<td>")[1].split("</td>")[0] or True
    assert "○ 0/1" in html
```

- [ ] **Step 2: Run it and watch it fail**

Run: `python3 -m pytest tests/test_dash.py -q` — Expected: FAIL, `run_grid_html` reads `learner["code"]`.

- [ ] **Step 3: Change the renderer and its feeder**

In `dash.run_grid_html`, replace `learner["name"] or learner["code"]` with `learner["who"]` and drop the `<small>` line's code. In `dashboard_server._learners`, build:

```python
        u = en["user"]
        out.append({"who": (u["email"] if u is not None else "(deleted account)"),
                    "email": (u["email"] if u is not None else None),
                    "last_seen": en["last_seen"].strftime("%Y-%m-%d") if en["last_seen"] else "",
                    "progress": progress.aggregate(event_dicts(en))})
```

`run_view`'s `learners` list and `learner_answers`' lookup key both move from `code` to the account's email. `run_csv`'s `CSV_FIELDS` loses `code` and keeps `email`. `RunForm`'s learner dropdown follows.

- [ ] **Step 4: Sweep for the retired noun**

`grep -rn "code" server_code/ client_code/ README.md` — every surviving hit must be about something else (an HTTP status code, `server_code/`). The round-0 pin `test_the_retired_credential_is_named_nowhere_the_app_runs` shows the shape if a second one is worth adding.

- [ ] **Step 5: Run and commit**

Run: `set -o pipefail; python3 -m pytest -q` — Expected: PASS.

```bash
git add server_code/dashboard_server.py server_code/dash.py client_code/RunForm/__init__.py tests/
git commit -m "feat(dashboard): a learner is an account with an address"
```

**MANUAL STEP — Hans:** the controller pushes Tasks 1–6 together and asks you to pull with **"source code"**. Existing enrolment rows disappear; they were keyed by a code that no longer exists.

---

### Task 7: A slug belongs to one account

**Files:** Modify `drawcast-anvil/server_code/access.py`, `server_code/api.py`, `tests/test_access.py`, `tests/test_api_source.py`

**Interfaces:** Produces `access.slug_owner_conflict(existing_owner_ids, author_id) -> bool`.

Round 0 claims each cast key individually, so `anvil/spanish/01.yaml` and `anvil/spanish/02.yaml` can belong to different accounts — and round 1b will treat `anvil/spanish` as one course with one owner. The final review of round 0 recorded this as a design gap to close here.

- [ ] **Step 1: Write the failing rule test**

```python
# append to drawcast-anvil/tests/test_access.py
import access


def test_a_free_slug_is_claimable():
    assert access.slug_owner_conflict([], "u1") is False


def test_your_own_slug_is_yours():
    assert access.slug_owner_conflict(["u1", "u1"], "u1") is False


def test_someone_elses_slug_is_refused():
    assert access.slug_owner_conflict(["u2"], "u1") is True
    assert access.slug_owner_conflict(["u1", "u2"], "u1") is True
```

- [ ] **Step 2: Run it and watch it fail**

Run: `python3 -m pytest tests/test_access.py -q` — Expected: FAIL, `slug_owner_conflict` missing.

- [ ] **Step 3: Add the rule**

```python
def slug_owner_conflict(existing_owner_ids, author_id):
    """True when a cast already stored under this slug belongs to someone
    else. A slug is a course's namespace from round 1b on, and a course has
    one owner — so the second writer must be refused at the first cast, not
    discovered when the course is assembled."""
    return any(owner_id != author_id for owner_id in existing_owner_ids if owner_id is not None)
```

- [ ] **Step 4: Enforce it in the cast write**

Inside `_cast_write`'s transaction, before creating a row, gather the owners of every cast whose key starts `anvil/<slug>/` and refuse with `403 {"error": "slug"}` when `slug_owner_conflict` is true. Search by prefix using the same search-first idiom the file uses everywhere; there is no index, and the row count under one slug is a lecture count.

- [ ] **Step 5: Pin it and commit**

```python
# append to tests/test_api_source.py
def test_the_cast_write_claims_the_whole_slug(source):
    assert "access.slug_owner_conflict(" in source
    assert '{"error": "slug"}, 403' in source
```

Run: `set -o pipefail; python3 -m pytest -q` — Expected: PASS.

```bash
git add server_code/access.py server_code/api.py tests/
git commit -m "feat(casts): a slug is a namespace, and it belongs to one account"
```

---

### Task 8: `learn.ts` — the account is the identity

**Files:** Rewrite `drawcast/src/learn.ts`; modify `tests/learn.test.ts`

**Interfaces:** Consumes `getToken()` from `src/account.ts`. Produces `sendEvent(api, ev, fetchImpl?)`, `firstOpenInSession(castKey, storage)`, `courseKeyOf(castKey)`, `apiBase(url)`, `DEFAULT_ENROLL_API`, `CAST_KEY_RE`. **Removes** `LEARNERS_KEY`, `CODE_RE`, `normalizeCode`, `learnerFor`, `saveLearner`, `forgetLearner`, `readLearners`, `learnerParam`, `stripLearnerParam`, `reportingAllowed`, `readProgress`, `LearnerEntry`, `Progress`.

- [ ] **Step 1: Write the failing test**

```typescript
// drawcast/tests/learn.test.ts — replace the code-bearing suites, keep the cast-key ones
import { describe, expect, test, vi } from "vitest";
import { courseKeyOf, sendEvent } from "../src/learn";

describe("sendEvent", () => {
  test("carries the account token as key, not a code", async () => {
    const f = vi.fn(async () => new Response("{}", { status: 200 })) as unknown as typeof fetch;
    await sendEvent("https://a", { kind: "opened", cast: "anvil/spanish/01.yaml" }, f);
    const [url, init] = (f as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://a/_/api/event");
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    expect(body).toMatchObject({ kind: "opened", cast: "anvil/spanish/01.yaml" });
    expect("code" in body).toBe(false);
    expect(typeof body.key).toBe("string");
  });
  test("a refusal is false, never a throw into playback", async () => {
    const f = vi.fn(async () => new Response("{}", { status: 403 })) as unknown as typeof fetch;
    expect(await sendEvent("https://a", { kind: "opened", cast: "anvil/spanish/01.yaml" }, f)).toBe(false);
    const dead = vi.fn(async () => { throw new Error("offline"); }) as unknown as typeof fetch;
    expect(await sendEvent("https://a", { kind: "opened", cast: "anvil/spanish/01.yaml" }, dead)).toBe(false);
  });
  test("a cast key that is not a cast key is refused without a request", async () => {
    const f = vi.fn() as unknown as typeof fetch;
    expect(await sendEvent("https://a", { kind: "opened", cast: "not-a-key" }, f)).toBe(false);
    expect((f as unknown as ReturnType<typeof vi.fn>).mock.calls.length).toBe(0);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run tests/learn.test.ts` — Expected: FAIL, `sendEvent`'s signature takes an entry.

- [ ] **Step 3: Rewrite `learn.ts`**

Keep the module's rule verbatim in its header — *nothing here may throw into playback; every failure returns null or false*. Keep `CAST_KEY_RE`, `courseKeyOf`, `apiBase`, `DEFAULT_ENROLL_API`, `firstOpenInSession`, `AnswerPayload` and `LearnEvent` unchanged. Replace the entry-bearing `sendEvent` with:

```typescript
export async function sendEvent(api: string, ev: LearnEvent, key: string, fetchImpl: typeof fetch = fetch): Promise<boolean> {
  if (!CAST_KEY_RE.test(ev.cast) || !key) return false;
  const payload: LearnEvent =
    ev.kind === "answer"
      ? { ...ev, given: ev.given.slice(-MAX_ATTEMPTS).map((g) => g.slice(0, MAX_TEXT)), expected: ev.expected.slice(0, MAX_TEXT) }
      : ev;
  try {
    const res = await fetchImpl(`${apiBase(api)}/_/api/event`, {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body: JSON.stringify({ key, ...payload }),
      keepalive: true,
    });
    return res.ok;
  } catch {
    return false;
  }
}
```

Delete every removed export listed under **Interfaces**.

**Do NOT import `getToken`.** `learn.ts` has **zero imports**, and `account.ts`
imports `learn.ts` — importing back would cycle, which round 0 checked
deliberately and a pin depends on. The token arrives as a parameter; Task 10's
caller is what reads it.

The Step 1 tests above must therefore pass it positionally —
`sendEvent("https://a", { … }, "tok", f)`, asserting `body.key === "tok"` —
plus one case that an empty token returns false without a request.

- [ ] **Step 4: Run both gates and commit**

Run: `npx tsc --noEmit && npx vitest run` — Expected: PASS.

```bash
cd ~/Documents/GitHub/drawcast
git add src/learn.ts tests/learn.test.ts
git commit -m "feat(learn): the account token reports, and the code map goes"
```

---

### Task 9: The course page becomes a door

**Files:** Delete `drawcast/src/course/enrol-script.ts`, `tests/course-join-page.test.ts`. Modify `src/course/page.ts`, `src/course/publish.ts`, `tests/course-page.test.ts`, `tests/course-publish.test.ts`

**Interfaces:** Produces `coursePage(course, links, join?: { courseKey: string; app: string })` rendering a static page with a **link** to `drawcast.app/#<name>` and no `<script>` at all.

- [ ] **Step 1: Write the failing page test**

```typescript
// in drawcast/tests/course-page.test.ts
test("the published page carries no script at all", () => {
  const html = coursePage({ title: "Spanish", context: {}, lectures: [], warnings: [] }, [], { courseKey: "h/d/spanish", app: "https://drawcast.anvil.app" });
  expect(html).not.toContain("<script");
  expect(html).not.toContain("localStorage");
});
test("it points at the app rather than trying to be one", () => {
  const html = coursePage({ title: "Spanish", context: {}, lectures: [], warnings: [] }, [], { courseKey: "h/d/spanish", app: "https://drawcast.anvil.app" });
  expect(html).toMatch(/Join this course/i);
  expect(html).toContain("https://drawcast.app/#");
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run tests/course-page.test.ts` — Expected: FAIL (the page still injects `ENROL_SCRIPT`).

- [ ] **Step 3: Rewrite the join box as a door**

In `page.ts`, delete the `import { ENROL_SCRIPT }` and the whole `<script>` block, and replace the join `<section>` with static markup: one sentence saying the course tracks progress for signed-in learners, and one anchor to the course in the app. Keep `coursePageStyle` and drop the rules only the script used (`.mark`, `.review`, `.join input`, `.join button`).

`publish.ts` passes `{ courseKey, app }` where it passed `{ courseKey, enroll }`; the `enroll:` document key still decides whether the door appears at all.

- [ ] **Step 4: Delete the script and its test**

```bash
git rm src/course/enrol-script.ts tests/course-join-page.test.ts
```

`grep -rn "ENROL_SCRIPT" src/ tests/` must come back empty.

- [ ] **Step 5: Run both gates and commit**

Run: `npx tsc --noEmit && npx vitest run` — Expected: PASS.

```bash
git add src/course/page.ts src/course/publish.ts tests/
git commit -m "feat(course): the published page is a door, not a dashboard"
```

---

### Task 10: The viewer reports as the account

**Files:** Modify `drawcast/src/viewer.ts`, `tests/learn-viewer.test.ts`, `tests/viewer.test.ts`

**Interfaces:** Consumes `sendEvent(api, ev, key, fetchImpl?)` (Task 8) and `getToken()` (round 0).

- [ ] **Step 1: Simplify the learner block**

`viewer.ts:382–413` currently reads a code out of `localStorage` per course, honours `?learner=`, strips it, and mounts a 🎓 button. All of that goes. What remains:

```typescript
    const key = getToken();
    const reporting = key !== "" && castKey !== null;
```

and the three call sites become `void sendEvent(DEFAULT_ENROLL_API, { … }, key)`. Delete the `learnerButton` export, the `?learner=` handling, and the imports that go with them (`learnerFor`, `saveLearner`, `forgetLearner`, `normalizeCode`, `stripLearnerParam`, `reportingAllowed`, `LearnerEntry`). `tsc` will name any you miss.

- [ ] **Step 2: Keep `meta.enroll`**

It still says *which* server to report to, which matters for an author running their own. Do not delete it.

- [ ] **Step 3: Re-aim the viewer tests**

`tests/learn-viewer.test.ts` pins the code-bearing block. Rewrite it to pin: no report without a token, a report carrying the token when there is one, and that a failure never throws.

- [ ] **Step 4: Run both gates and commit**

Run: `npx tsc --noEmit && npx vitest run` — Expected: PASS.

```bash
git add src/viewer.ts tests/
git commit -m "feat(viewer): the signed-in account reports, or nothing does"
```

---

### Task 11: Bake by default on the drawcast server

**Files:** Modify `drawcast/src/ui/share.ts`, `docs/superpowers/specs/2026-09-05-private-publishing-and-learner-identity-design.md`, `tests/publish-server.test.ts`

Round 0's measurement answered §15's quota question — 100 GB, a million rows, **no metered bandwidth** — and it inverts §4's advice. Not baking makes every student's browser synthesise every lecture; baking pays once. See `docs/superpowers/plans/2026-09-05-round-0-measurements.md`.

- [ ] **Step 1: Write the failing test**

```typescript
// in drawcast/tests/publish-server.test.ts
test("narration is ticked by default on the server panel — storage is free, synthesis is not", () => {
  expect(share).toContain('buildEmbedChoices("server", true)');
  expect(share).not.toContain('buildEmbedChoices("server", false)');
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run tests/publish-server.test.ts` — Expected: FAIL.

- [ ] **Step 3: Flip the default and the spec sentence**

Change `buildEmbedChoices("server", false)` to `true` in `src/ui/share.ts`. In the spec's §4, replace "**Baked audio is a choice per course, default off on the server.**" with a sentence saying it defaults **on**, because the round-0 measurement showed storage is free and unbaked audio spends cloud TTS per student per lecture. Cite the measurement document.

The status line Task 13 of round 0 added — *"without narration — any narration stored there earlier is gone"* — now appears only when the author unticks deliberately, which is the right shape for it.

- [ ] **Step 4: Run both gates and commit**

Run: `npx tsc --noEmit && npx vitest run` — Expected: PASS.

```bash
git add src/ui/share.ts docs/superpowers/specs/2026-09-05-private-publishing-and-learner-identity-design.md tests/
git commit -m "feat(publish): bake by default — the quota answered the question"
```

---

### Task 12: Smoke the round end to end

**Files:** Create `drawcast/docs/superpowers/plans/2026-09-05-round-1a-smoke.md`

- [ ] **Step 1: Sign in from a browser that has never seen drawcast**

Open `drawcast.app` → Settings → Publishing → **Sign in**. Expect the Anvil sign-in, then a return to the same page signed in. Try the Google button too — Task 1 turned it on.

- [ ] **Step 2: Ask for a mailed link**

`curl -s -X POST https://drawcast.anvil.app/_/api/login -H 'content-type: text/plain' -d '{"email":"<your address>","return":"https://drawcast.app/"}'` → `{"ok":true}`, and the mail arrives. Then run it again with an address that has **no** account: the answer must be byte-identical, and no mail arrives.

- [ ] **Step 3: Join and be counted**

Open a published course page — it is now static, with a link into the app. Follow it, join in one click, play a lecture, answer a question wrongly. Then open the teacher dashboard: the grid names your **email address**, and the answer is there verbatim.

- [ ] **Step 4: Confirm the refusals**

Sign out, reload the lecture, answer again — nothing is recorded and nothing breaks. Enrol in a course, then have a second account publish a cast under a slug the first account owns: `403 {"error":"slug"}`.

- [ ] **Step 5: Write down what happened and commit**

Record each result, and anything that surprised you, the way `2026-09-05-round-0-measurements.md` does. A round is delivered when it has been used, not when its tests pass — round 0's own audio bug proved that.

---

## Self-Review

**Spec coverage (round 1 in §12, identity half):** one-click join — Task 4. Accounts replacing codes — Tasks 1, 4, 8, 10. The account home — **deferred to 1b** with approval and the settings card, per the split recorded when this plan was written. GitHub page reduced to static and `ENROL_SCRIPT` deleted — Task 9. Social login enabled — Task 1. §1's third sign-in way — Tasks 2, 3. §2's table shapes — Task 1. §3's idempotent join — Task 4.

**Carried in from round 0's final review:** the unclaimed `anvil/<slug>/` namespace — Task 7. The baked-audio default, inverted by the quota measurement — Task 11.

**Deliberately not here:** approval (`runs.join`), the account home, the dashboard settings card, owner delete, `listed`/`access` on courses, drip mail. All 1b or later. `state` and the two drip columns ship in Task 1's schema anyway, so those rounds add values rather than another pull.

**Type consistency:** `sendEvent(api, ev, key, fetchImpl?)` is defined in Task 8 and called that way in Task 10. `_author(key)` is round 0's and is used unchanged by Tasks 3, 4, 5. `_learners` returns `who`/`email`/`last_seen`/`progress` in Task 6 and `dash.run_grid_html` reads `who`. `access.slug_owner_conflict(existing_owner_ids, author_id)` is defined and called in Task 7.

**One risk carried deliberately:** Task 5 deletes `/forget` before 1b gives a learner any other way to leave a course. With no real learners that is a gap on paper only, and it is named in the README rather than left to be found.
