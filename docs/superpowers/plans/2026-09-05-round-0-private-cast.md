# Round 0 — One Private Cast, and the Handshake — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An author signs in once, publishes a drawcast to the drawcast server, and opens it at `drawcast.app/#<name>` — where nobody else can.

**Architecture:** A redirect handshake carries a credential across the two origins a session cookie cannot: the app sends the browser to the Anvil app, which mints a one-time token and redirects back, and the app exchanges it for a long-lived session token. `users.author_key` becomes a `tokens` table, so every endpoint that already takes a bearer `key` keeps its shape. A cast is stored as two objects — a ~10 KB spec in a text column and the baked audio in a Media blob — and the viewer gains a fourth source that fetches both and concatenates them into the text the parser already expects.

**Tech Stack:** TypeScript + Vite + Vitest (drawcast); Python 3 + Anvil Works + pytest (drawcast-anvil). No new dependencies in either repo.

**Spec:** `docs/superpowers/specs/2026-09-05-private-publishing-and-learner-identity-design.md` (rounds and rationale in §12; this plan is round 0)

## Global Constraints

- **Two repos.** `~/Documents/GitHub/drawcast` (branch `main`) and `~/Documents/GitHub/drawcast-anvil` (branch `master`). Never `git add -A` in either — another session shares the drawcast working tree. Add named paths only.
- **Anvil pulls are manual.** Any task touching `anvil.yaml` ends with: *Hans opens the app in the Anvil editor and accepts the pull, choosing **"source code"**, not "default database schema".* Nothing after that task works until he has.
- **Anvil test command:** `python3 -m pytest -q` from the repo root. `pytest.ini` puts `server_code` on the path. `tests/conftest.py` stubs only `anvil.microsoft.auth`; `anvil.server` and `anvil.tables` must keep failing to import, so **pure modules may not import them** and glue modules are tested by reading their source text (`tests/test_api_source.py` is the existing pattern).
- **drawcast test command:** `npx vitest run <path>` for one file, `npm test` for all.
- **Request bodies are `text/plain`** so they stay CORS-simple (no preflight); handlers parse the raw bytes with `load_body()`. Answers are JSON with `Cache-Control: no-store` via `json_response()`.
- **Endpoint options are `ENDPOINT = dict(cross_site_session=False, enable_cors=True)`** — unchanged. A session cookie can never authorise a cross-origin fetch; the bearer token is the mechanism.
- **A credential never travels in a query string.** One-time tokens may (they are single-use and expire in 5 minutes); session tokens may not.
- **Name rule:** `NAME_RE` and `RESERVED_PREFIXES` in `src/names.ts` and `server_code/names.py` must stay byte-identical, pinned by `tests/names.test.ts` and `tests/test_names.py`. This round adds `MIN_NAME_LENGTH = 8` (base segment only, at registration only) and `me` to the reserved list.
- **Cast key shape:** `anvil/<course-slug>/<file>.yaml`. It must keep matching `CAST_KEY_RE` in `src/learn.ts:11` and `CAST_RE` in `server_code/parsers.py`, so events, progress and the dashboard need no change.
- **Serving:** the spec is gated on every request and `no-store`; the audio blob is cacheable and fetched at most once per device.

---

### Task 1: `tokens.py` — the pure rules

**Files:**
- Create: `drawcast-anvil/server_code/tokens.py`
- Test: `drawcast-anvil/tests/test_tokens.py`

**Interfaces:**
- Consumes: nothing.
- Produces: `make_secret() -> str`, `ONCE_TTL_S = 300`, `is_live(row: dict, now: float) -> bool`, `allowed_return(url: str, allowlist: tuple[str, ...]) -> str | None`, `RETURN_ALLOWLIST: tuple[str, ...]`.

- [ ] **Step 1: Write the failing test**

```python
# drawcast-anvil/tests/test_tokens.py
import pytest

import tokens


def test_secrets_are_long_and_unique():
    a, b = tokens.make_secret(), tokens.make_secret()
    assert a != b
    assert len(a) >= 32


@pytest.mark.parametrize("age,live", [(0, True), (299, True), (300, False), (10_000, False)])
def test_a_one_time_token_dies_after_five_minutes(age, live):
    assert tokens.is_live({"kind": "once", "created": 1000.0}, 1000.0 + age) is live


def test_a_session_token_does_not_expire():
    assert tokens.is_live({"kind": "session", "created": 0.0}, 10**9) is True


@pytest.mark.parametrize("url", [
    "https://drawcast.app/",
    "https://drawcast.app/#spanish",
    "http://localhost:5173/#spanish",
])
def test_allowed_returns_are_kept_whole(url):
    assert tokens.allowed_return(url, tokens.RETURN_ALLOWLIST) == url


@pytest.mark.parametrize("url", [
    "https://drawcast.app.evil.test/#x",   # suffix attack
    "https://evil.test/#x",
    "//drawcast.app/#x",                   # protocol-relative
    "javascript:alert(1)",
    "",
    None,
    "https://drawcast.app@evil.test/",     # userinfo attack
])
def test_everything_else_is_refused(url):
    assert tokens.allowed_return(url, tokens.RETURN_ALLOWLIST) is None
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd ~/Documents/GitHub/drawcast-anvil && python3 -m pytest tests/test_tokens.py -q`
Expected: FAIL — `ModuleNotFoundError: No module named 'tokens'`

- [ ] **Step 3: Write the module**

```python
# drawcast-anvil/server_code/tokens.py
"""Token rules (spec §1). Pure: no anvil imports, so pytest can reach it.

Two kinds live in one table. A `once` token is what a sign-in redirect
carries in the URL — single use, five minutes. A `session` token is what the
app stores and sends as `key` on every write; it does not expire and is
revoked by deleting its row.
"""
import secrets
from urllib.parse import urlparse

ONCE_TTL_S = 300

# Exact origins. A prefix test would accept https://drawcast.app.evil.test.
RETURN_ALLOWLIST = (
    "https://drawcast.app",
    "https://drawcast.netlify.app",
    "http://localhost:5173",
)


def make_secret():
    return secrets.token_urlsafe(32)


def is_live(row, now):
    if row.get("kind") != "once":
        return True
    return now - row["created"] < ONCE_TTL_S


def allowed_return(url, allowlist):
    """The return URL, unchanged, when its ORIGIN is on the list — or None.

    urlparse is what decides the origin, so `https://drawcast.app@evil.test/`
    (userinfo, not host) and `//drawcast.app/x` (no scheme) both fall out.
    """
    if not isinstance(url, str) or not url:
        return None
    try:
        parts = urlparse(url)
    except ValueError:
        return None
    if parts.scheme not in ("http", "https") or not parts.hostname:
        return None
    origin = "%s://%s" % (parts.scheme, parts.netloc)
    return url if origin in allowlist else None
```

- [ ] **Step 4: Run it and watch it pass**

Run: `python3 -m pytest tests/test_tokens.py -q`
Expected: PASS, 15 tests.

- [ ] **Step 5: Commit**

```bash
cd ~/Documents/GitHub/drawcast-anvil
git add server_code/tokens.py tests/test_tokens.py
git commit -m "feat(tokens): the pure rules — five-minute one-time, exact-origin returns"
```

---

### Task 2: The name floor and `me`, in both repos

**Files:**
- Modify: `drawcast-anvil/server_code/names.py`
- Modify: `drawcast-anvil/tests/test_names.py`
- Modify: `drawcast/src/names.ts`
- Modify: `drawcast/tests/names.test.ts`

**Interfaces:**
- Produces: `names.MIN_NAME_LENGTH = 8` and `names.normalize_name` unchanged; new `names.registrable(name) -> bool` (Python) / `isRegistrable(name: string): boolean` (TypeScript). `RESERVED_PREFIXES` gains `"me"` in both.

**Why two functions rather than a stricter `normalize_name`:** the floor applies at **registration only**. A name already registered must keep resolving, so `GET /name` and the viewer keep using `normalize_name` / `normalizeName` exactly as they do now.

- [ ] **Step 1: Write the failing Python test**

```python
# append to drawcast-anvil/tests/test_names.py
def test_me_is_reserved():
    assert names.normalize_name("me") is None
    assert names.normalize_name("me-too") is None
    assert names.RESERVED_PREFIXES == ("gh", "gdoc", "gdrive", "url", "anvil", "api", "name", "course", "learner", "me")


@pytest.mark.parametrize("name,ok", [
    ("spanish1", True),          # exactly 8
    ("learn-russian", True),
    ("spanish", False),          # 7
    ("a", False),
    ("learn-russian/3", True),   # the floor is the BASE segment's
])
def test_the_floor_applies_to_the_base_segment(name, ok):
    assert names.registrable(name) is ok


def test_a_name_below_the_floor_still_resolves():
    # registrable() gates writes; normalize_name() stays the read rule.
    assert names.normalize_name("spanish") == "spanish"
```

- [ ] **Step 2: Run it and watch it fail**

Run: `python3 -m pytest tests/test_names.py -q`
Expected: FAIL — `AttributeError: module 'names' has no attribute 'registrable'`, plus the reserved-prefix assertion.

- [ ] **Step 3: Change `names.py`**

```python
# server_code/names.py — replace RESERVED_PREFIXES and add below normalize_name
RESERVED_PREFIXES = ("gh", "gdoc", "gdrive", "url", "anvil", "api", "name", "course", "learner", "me")

MIN_NAME_LENGTH = 8


def registrable(raw):
    """May this name be REGISTERED? The floor is deliberate and temporary
    (spec §14): short names are the valuable ones in a first-come namespace
    and must not be spent before the namespace has a policy. Reading is
    unaffected — normalize_name stays the resolver's rule, so a name already
    registered below the floor keeps working."""
    name = normalize_name(raw)
    if name is None:
        return False
    base, _ = split_name(name)
    return len(base) >= MIN_NAME_LENGTH
```

- [ ] **Step 4: Run the Python tests**

Run: `python3 -m pytest tests/test_names.py -q`
Expected: PASS.

- [ ] **Step 5: Write the failing TypeScript test**

```typescript
// append to drawcast/tests/names.test.ts
describe("the registration floor", () => {
  test("reserved prefixes still match the server, now including me", () => {
    expect([...RESERVED_PREFIXES]).toEqual(["gh", "gdoc", "gdrive", "url", "anvil", "api", "name", "course", "learner", "me"]);
    expect(normalizeName("me")).toBeNull();
    expect(normalizeName("me-too")).toBeNull();
  });
  test("eight characters in the base segment, and reading is unaffected", () => {
    expect(isRegistrable("spanish1")).toBe(true);
    expect(isRegistrable("learn-russian/3")).toBe(true);
    expect(isRegistrable("spanish")).toBe(false);
    expect(normalizeName("spanish")).toBe("spanish");
  });
});
```

Add `isRegistrable` and `MIN_NAME_LENGTH` to the import at the top of the file.

- [ ] **Step 6: Run it and watch it fail**

Run: `cd ~/Documents/GitHub/drawcast && npx vitest run tests/names.test.ts`
Expected: FAIL — `isRegistrable is not a function`.

- [ ] **Step 7: Change `names.ts`**

```typescript
// src/names.ts — replace RESERVED_PREFIXES, then add after normalizeName
export const RESERVED_PREFIXES = ["gh", "gdoc", "gdrive", "url", "anvil", "api", "name", "course", "learner", "me"] as const;

export const MIN_NAME_LENGTH = 8;

/** May this name be REGISTERED? Mirrors names.py's registrable(). Reading
 *  stays normalizeName's job, so a name already registered below the floor
 *  keeps resolving (spec §9). */
export function isRegistrable(raw: string | null | undefined): boolean {
  const name = normalizeName(raw);
  if (name === null) return false;
  return name.split("/", 1)[0].length >= MIN_NAME_LENGTH;
}
```

- [ ] **Step 8: Run both suites**

Run: `npx vitest run tests/names.test.ts` — Expected: PASS
Run: `cd ~/Documents/GitHub/drawcast-anvil && python3 -m pytest -q` — Expected: PASS

- [ ] **Step 9: Commit both repos**

```bash
cd ~/Documents/GitHub/drawcast-anvil
git add server_code/names.py tests/test_names.py
git commit -m "feat(names): an 8-character registration floor, and me is reserved"
cd ~/Documents/GitHub/drawcast
git add src/names.ts tests/names.test.ts
git commit -m "feat(names): mirror the registration floor and the me reservation"
```

---

### Task 3: Schema — `tokens` and `casts`, and `author_key` retires

**Files:**
- Modify: `drawcast-anvil/anvil.yaml` (`db_schema`)
- Modify: `drawcast-anvil/README.md`

**Interfaces:**
- Produces: tables `tokens(secret, user→users, kind, created, last_used, label)` and `casts(key, owner→users, title, spec, audio, access, created, updated)`. `users.author_key` is removed.

- [ ] **Step 1: Add the two tables to `db_schema`**

Follow the existing column shape exactly — every column is a mapping with `admin_ui: {}`, `client_hidden: null`, `name`, `type`, and `target` for links. Insert alphabetically among the tables:

```yaml
  casts:
    client: none
    columns:
    - admin_ui: {}
      client_hidden: null
      name: key
      type: string
    - admin_ui: {}
      client_hidden: null
      name: owner
      target: users
      type: link_single
    - admin_ui: {}
      client_hidden: null
      name: title
      type: string
    - admin_ui: {}
      client_hidden: null
      name: spec
      type: string
    - admin_ui: {}
      client_hidden: null
      name: audio
      type: media
    - admin_ui: {}
      client_hidden: null
      name: access
      type: string
    - admin_ui: {}
      client_hidden: null
      name: created
      type: datetime
    - admin_ui: {}
      client_hidden: null
      name: updated
      type: datetime
    indexes: []
    server: full
    title: casts
  tokens:
    client: none
    columns:
    - admin_ui: {}
      client_hidden: null
      name: secret
      type: string
    - admin_ui: {}
      client_hidden: null
      name: user
      target: users
      type: link_single
    - admin_ui: {}
      client_hidden: null
      name: kind
      type: string
    - admin_ui: {}
      client_hidden: null
      name: created
      type: number
    - admin_ui: {}
      client_hidden: null
      name: last_used
      type: datetime
    - admin_ui: {}
      client_hidden: null
      name: label
      type: string
    indexes: []
    server: full
    title: tokens
```

`created` is a **number** (epoch seconds), not a datetime: `tokens.is_live` compares it against `time.time()`, and keeping one clock out of the pure module is what makes it testable.

- [ ] **Step 2: Remove `author_key` from the `users` table's columns**

Delete the whole four-line column entry named `author_key` from `db_schema.users.columns`. Leave `admin` and `enabled` alone.

- [ ] **Step 3: Update the README**

In "The pull ritual", replace the paragraph about `courses.owner` with:

```markdown
This pull adds `tokens` and `casts` and REMOVES `users.author_key`. Anyone
who had pasted a key into drawcast must press **Sign in** there once; the
key column is gone and the app now holds a session token instead.
```

In "Endpoints", add the four new rows:

```markdown
| POST | `/redeem` | `{token}` | `{key}` — `400 token` when unknown or expired |
| POST | `/signout` | `{key}` | `{ok}` |
| POST | `/cast` | `{key, cast, title, spec, access?}` | `{ok}` — `401 key`, `403 owner` |
| GET | `/cast` | `?cast=&key=` | the spec as `text/plain`, or `401`/`403`/`404` |
| POST | `/name/check` | `{name, key?}` | `{state: "free"\|"yours"\|"taken"\|"short"}` |
```

- [ ] **Step 4: Commit, then hand over for the pull**

```bash
cd ~/Documents/GitHub/drawcast-anvil
git add anvil.yaml README.md
git commit -m "feat(schema): tokens and casts arrive, users.author_key retires"
git push origin master
```

**MANUAL STEP — Hans:** open the app in the Anvil editor, accept the pull, choose **"source code"**. Confirm Data Tables now shows `tokens` and `casts`, and that `users` no longer has `author_key`. Nothing in Tasks 4–8 works until this is done.

---

### Task 4: `_bearer` — every existing endpoint reads the token table

**Files:**
- Modify: `drawcast-anvil/server_code/api.py` (`_author`, ~line 240)
- Modify: `drawcast-anvil/server_code/dashboard_server.py` (`my_author_key`, `new_author_key`)
- Modify: `drawcast-anvil/client_code/Form1/__init__.py`
- Test: `drawcast-anvil/tests/test_api_source.py`

**Interfaces:**
- Consumes: `tokens.make_secret`, `tokens.is_live` (Task 1).
- Produces: `api._author(secret) -> users row | None`, unchanged in name and signature, so `http_course` and `_name_set` are untouched. `dashboard_server.my_tokens() -> list[dict]`, `dashboard_server.revoke_all() -> True`.

- [ ] **Step 1: Write the failing source test**

`api.py` imports `anvil.server`, so it cannot be imported under pytest — the repo's existing pattern is to assert on its source text.

```python
# append to drawcast-anvil/tests/test_api_source.py
def test_author_resolves_a_session_token_and_not_a_user_column(source):
    assert "app_tables.users.get(author_key=" not in source
    assert "app_tables.tokens.search(secret=" in source
    assert 'row["kind"] != "session"' in source


def test_author_stamps_last_used(source):
    assert "last_used=utcnow()" in source
```

If `tests/test_api_source.py` has no `source` fixture, add one at the top of the file:

```python
import pathlib
import pytest


@pytest.fixture
def source():
    return (pathlib.Path(__file__).resolve().parents[1] / "server_code" / "api.py").read_text(encoding="utf-8")
```

- [ ] **Step 2: Run it and watch it fail**

Run: `python3 -m pytest tests/test_api_source.py -q`
Expected: FAIL on the `app_tables.tokens.search` assertion.

- [ ] **Step 3: Replace `_author` in `api.py`**

```python
def _author(key):
    """The users row behind a session token, or None when the token is
    unknown, is a one-time token that was never redeemed, or the account is
    disabled. Named `_author` still, so http_course and _name_set do not
    change: what moved is where the secret lives, not what it means.

    search-first, like every other lookup here: nothing enforces uniqueness
    on tokens.secret, and .get() RAISES on a duplicate — which would 500
    every authorised endpoint at once."""
    row = next(iter(app_tables.tokens.search(secret=key)), None) if key else None
    if row is None or row["kind"] != "session":
        return None
    user = row["user"]
    if user is None or not user["enabled"]:
        return None
    row.update(last_used=utcnow())
    return user
```

Add `import tokens` to the import block at the top of `api.py`.

- [ ] **Step 4: Replace the key callables in `dashboard_server.py`**

```python
@anvil.server.callable
def my_tokens():
    """The browsers signed in as this account. The secret itself is never
    returned — it left once, through the redirect that minted it."""
    user = _user()
    return [{"label": t["label"] or "a browser",
             "last_used": t["last_used"].strftime("%Y-%m-%d") if t["last_used"] else ""}
            for t in app_tables.tokens.search(user=user, kind="session")]


@anvil.server.callable
def revoke_all():
    """Sign out everywhere: every session token for this account goes."""
    user = _user()
    app_tables.tokens.search(user=user).delete_all_rows()
    return True
```

Delete `my_author_key` and `new_author_key`, and the now-unused `import secrets`.

- [ ] **Step 5: Update `Form1`**

Replace the key panel's handlers so the panel lists browsers instead of showing a secret:

```python
    def toggle_key(self, **event_args):
        self.panel_key.visible = not self.panel_key.visible
        if self.panel_key.visible:
            rows = anvil.server.call("my_tokens")
            self.label_key.text = ("Signed in from: " + ", ".join(
                "%s (%s)" % (r["label"], r["last_used"]) for r in rows)) if rows else \
                "No browser is signed in. Press Sign in inside drawcast."

    def new_key(self, **event_args):
        anvil.server.call("revoke_all")
        self.label_key.text = "Signed out everywhere."
```

- [ ] **Step 6: Run the suite**

Run: `python3 -m pytest -q`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add server_code/api.py server_code/dashboard_server.py client_code/Form1/__init__.py tests/test_api_source.py
git commit -m "refactor(auth): the author key becomes a session token row"
```

---

### Task 5: `/signin`, `/redeem`, `/signout`

**Files:**
- Modify: `drawcast-anvil/server_code/api.py`
- Modify: `drawcast-anvil/server_code/limits.py`
- Create: `drawcast-anvil/client_code/SignIn/__init__.py`
- Modify: `drawcast-anvil/anvil.yaml` (register the new form)
- Test: `drawcast-anvil/tests/test_limits.py`, `drawcast-anvil/tests/test_api_source.py`

**Interfaces:**
- Consumes: `tokens.make_secret`, `tokens.is_live`, `tokens.allowed_return`, `tokens.RETURN_ALLOWLIST`.
- Produces: `POST /_/api/redeem {token} → {key}`; `POST /_/api/signout {key} → {ok}`; a server callable `mint_once(return_url) -> str` used by the `SignIn` form.

- [ ] **Step 1: Add the budgets, test first**

```python
# append to drawcast-anvil/tests/test_limits.py
def test_the_new_buckets_exist():
    assert limits.BUDGETS["redeem"] == 60
    assert limits.BUDGETS["cast"] == 300
    assert limits.BUDGETS["cast_set"] == 60
```

Run: `python3 -m pytest tests/test_limits.py -q` → FAIL (KeyError). Then add to `BUDGETS` in `limits.py`:

```python
    "redeem": 60,
    "cast": 300,
    "cast_set": 60,
```

Run again → PASS.

- [ ] **Step 2: Add the endpoints to `api.py`**

```python
# --- sign in -----------------------------------------------------------------

@anvil.server.callable
def mint_once(return_url):
    """Called by the SignIn form, which runs INSIDE the app where the session
    lives. Returns the URL to send the browser back to, with a one-time
    token attached — or None when the return URL is not one of ours.

    The allowlist is the whole defence here: without it this callable is an
    open redirect that hands a token to whoever asked."""
    user = anvil.users.get_user()
    if user is None or not user["enabled"]:
        return None
    target = tokens.allowed_return(return_url, tokens.RETURN_ALLOWLIST)
    if target is None:
        return None
    secret = tokens.make_secret()
    app_tables.tokens.add_row(secret=secret, user=user, kind="once",
                              created=time.time(), last_used=None, label=None)
    joiner = "&" if "#" in target else "#"
    return "%s%st=%s" % (target, joiner, secret)


@anvil.server.http_endpoint("/redeem", methods=["POST"], **ENDPOINT)
def http_redeem(**params):
    if not _allowed("redeem"):
        return json_response({"error": "rate"}, 429)
    body = load_body()
    if not isinstance(body, dict) or not isinstance(body.get("token"), str):
        return json_response({"error": "token"}, 400)
    row = next(iter(app_tables.tokens.search(secret=body["token"], kind="once")), None)
    if row is None or not tokens.is_live({"kind": "once", "created": row["created"]}, time.time()):
        if row is not None:
            row.delete()  # expired: no second chance, and no row left to guess at
        return json_response({"error": "token"}, 400)
    user = row["user"]
    row.delete()  # single use, spent here
    if user is None or not user["enabled"]:
        return json_response({"error": "token"}, 400)
    secret = tokens.make_secret()
    app_tables.tokens.add_row(secret=secret, user=user, kind="session",
                              created=time.time(), last_used=utcnow(),
                              label=(body.get("label") or "")[:60] or None)
    return json_response({"key": secret})


@anvil.server.http_endpoint("/signout", methods=["POST"], **ENDPOINT)
def http_signout(**params):
    body = load_body()
    key = body.get("key") if isinstance(body, dict) else None
    row = next(iter(app_tables.tokens.search(secret=key)), None) if key else None
    if row is not None:
        row.delete()
    # Always ok: whether the token existed is not the caller's business, and
    # signing out of a token already revoked is not an error.
    return json_response({"ok": True})
```

Add `import anvil.users` to the imports at the top of `api.py`.

- [ ] **Step 3: Write the `SignIn` form**

```python
# drawcast-anvil/client_code/SignIn/__init__.py
from ._anvil_designer import SignInTemplate
from anvil import *
import anvil.server
import anvil.users


class SignIn(SignInTemplate):
    """The one page a drawcast author sees on this app. It reads the return
    URL from the fragment (#signin?return=...), makes sure there is a user,
    and bounces straight back with a one-time token. When the session is
    already alive nothing is shown but this form's own title for an instant."""

    def __init__(self, **properties):
        super().__init__(**properties)
        target = self._return_url()
        if anvil.users.get_user() is None:
            anvil.users.login_with_form(allow_cancel=False)
        url = anvil.server.call("mint_once", target) if target else None
        if url is None:
            self.label_status.text = "This sign-in link did not come from drawcast."
            return
        anvil.js.window.location.replace(url)

    def _return_url(self):
        raw = anvil.get_url_hash()
        if not isinstance(raw, str) or "return=" not in raw:
            return None
        from anvil.js.window import decodeURIComponent
        return decodeURIComponent(raw.split("return=", 1)[1].split("&", 1)[0])
```

Register the form in `anvil.yaml` the way `RunForm` is registered, and add a startup route so `#signin` opens it: in `Form1.__init__`, before the login loop, add

```python
        if (anvil.get_url_hash() or "").startswith("signin"):
            open_form("SignIn")
            return
```

- [ ] **Step 4: Pin the endpoints in the source test**

```python
# append to tests/test_api_source.py
def test_redeem_spends_the_one_time_token(source):
    assert 'app_tables.tokens.search(secret=body["token"], kind="once")' in source
    assert source.count("row.delete()") >= 2


def test_mint_once_checks_the_return_allowlist(source):
    assert "tokens.allowed_return(return_url, tokens.RETURN_ALLOWLIST)" in source
```

- [ ] **Step 5: Run the suite and commit**

Run: `python3 -m pytest -q` → PASS

```bash
git add server_code/api.py server_code/limits.py client_code/SignIn/__init__.py anvil.yaml tests/
git commit -m "feat(signin): a one-time token crosses the origin a cookie cannot"
git push origin master
```

**MANUAL STEP — Hans:** pull in the Anvil editor (**source code**), then smoke it:

```bash
curl -s -X POST https://drawcast.anvil.app/_/api/redeem -H 'content-type: text/plain' -d '{"token":"nope"}'
# → {"error":"token"}
```

---

### Task 6: `POST /cast` and the gated `GET /cast`

**Files:**
- Modify: `drawcast-anvil/server_code/parsers.py`
- Modify: `drawcast-anvil/server_code/api.py`
- Test: `drawcast-anvil/tests/test_parsers.py`, `tests/test_api_source.py`

**Interfaces:**
- Consumes: `api._author` (Task 4), `_allowed` (existing).
- Produces: `parsers.parse_cast_put(body) -> {"key","cast","title","spec","access"}`; `POST /_/api/cast`; `GET /_/api/cast?cast=&key=`; `GET /_/api/cast/audio?cast=&key=`.

- [ ] **Step 1: Write the failing parser test**

```python
# append to drawcast-anvil/tests/test_parsers.py
GOOD = {"key": "k" * 40, "cast": "anvil/spanish1/01-intro.yaml",
        "title": "Intro", "spec": "meta:\n  title: Intro\n"}


def test_parse_cast_put_accepts_an_anvil_key():
    out = rq.parse_cast_put(dict(GOOD))
    assert out["cast"] == "anvil/spanish1/01-intro.yaml"
    assert out["access"] == "enrolled"        # the default is the closed one


@pytest.mark.parametrize("field,value", [
    ("cast", "not-a-cast-key"),
    ("cast", "anvil/../etc/passwd.yaml"),
    ("spec", ""),
    ("spec", 5),
    ("key", None),
])
def test_parse_cast_put_rejects(field, value):
    body = dict(GOOD)
    body[field] = value
    with pytest.raises(rq.BadRequest):
        rq.parse_cast_put(body)


def test_access_must_be_one_of_three():
    assert rq.parse_cast_put(dict(GOOD, access="open"))["access"] == "open"
    with pytest.raises(rq.BadRequest):
        rq.parse_cast_put(dict(GOOD, access="sort-of"))
```

- [ ] **Step 2: Run it and watch it fail**

Run: `python3 -m pytest tests/test_parsers.py -q` → FAIL, `parse_cast_put` missing.

- [ ] **Step 3: Add the parser**

```python
# server_code/parsers.py
MAX_SPEC = 400_000          # a spec is ~10 KB; this is a sanity bound, not a target
ACCESS = ("open", "signed-in", "enrolled")


def parse_cast_put(body):
    """A cast being stored on the server. `spec` is the YAML without its
    audio document — the audio travels as its own request (spec §4), because
    a 7 MB base64 body in a JSON field is exactly what made GitHub answer
    422 on 2026-09-02."""
    body = _obj(body)
    access = body.get("access", "enrolled")
    if access not in ACCESS:
        raise BadRequest("access")
    spec = body.get("spec")
    if not isinstance(spec, str) or not spec.strip():
        raise BadRequest("spec")
    return {
        "key": _text(body, "key", 200, required=True),
        "cast": _required_match(body, "cast", CAST_RE, 300),
        "title": _text(body, "title", MAX_TITLE),
        "spec": spec[:MAX_SPEC],
        "access": access,
    }
```

- [ ] **Step 4: Run the parser tests**

Run: `python3 -m pytest tests/test_parsers.py -q` → PASS

- [ ] **Step 5: Add the endpoints**

```python
# --- casts -------------------------------------------------------------------

def _cast_row(key):
    # search-first: nothing enforces uniqueness on casts.key.
    return next(iter(app_tables.casts.search(key=key)), None)


def _may_read(row, user):
    """Round 0's gate: an open cast is public, anything else is the owner's
    alone. Round 1 adds `signed-in` and enrolment; the shape is here so that
    round does not have to move the check."""
    if row["access"] == "open":
        return True
    owner = row["owner"]
    return user is not None and owner is not None and owner.get_id() == user.get_id()


@anvil.server.http_endpoint("/cast", methods=["POST"], **ENDPOINT)
def http_cast_put(**params):
    if not _allowed("cast_set"):
        return json_response({"error": "rate"}, 429)
    try:
        req = rq.parse_cast_put(load_body())
    except rq.BadRequest as exc:
        return _bad(exc)
    author = _author(req["key"])
    if author is None:
        return json_response({"error": "key"}, 401)
    row = _cast_row(req["cast"])
    if row is not None and row["owner"] is not None and row["owner"].get_id() != author.get_id():
        return json_response({"error": "owner"}, 403)
    fields = dict(title=req["title"], spec=req["spec"], access=req["access"], updated=utcnow())
    if row is None:
        app_tables.casts.add_row(key=req["cast"], owner=author, audio=None,
                                 created=utcnow(), **fields)
    else:
        row.update(owner=author, **fields)
    return json_response({"ok": True})


@anvil.server.http_endpoint("/cast", methods=["GET"], **ENDPOINT)
def http_cast_get(**params):
    if not _allowed("cast"):
        return json_response({"error": "rate"}, 429)
    q = anvil.server.request.query_params
    row = _cast_row(q.get("cast") or "")
    if row is None:
        return json_response({"error": "unknown"}, 404)
    if not _may_read(row, _author(q.get("key"))):
        return json_response({"error": "access"}, 403)
    # text/plain, not JSON: the client hands this straight to
    # parsePlaylistText, and wrapping YAML in JSON would only cost a decode.
    return anvil.server.HttpResponse(
        status=200, body=row["spec"],
        headers={"Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store"})
```

**Note on the two decorators:** Anvil registers endpoints by path, and `/name` already proves a second decorated function on one path silently overwrites the first. These two differ by **method**, which the router does distinguish — but if the smoke below shows one shadowing the other, merge them into a single handler that dispatches on `anvil.server.request.method`, exactly as `http_name` does.

- [ ] **Step 6: Add the audio endpoint**

```python
@anvil.server.http_endpoint("/cast/audio", methods=["GET", "POST"], **ENDPOINT)
def http_cast_audio(**params):
    if anvil.server.request.method == "POST":
        if not _allowed("cast_set"):
            return json_response({"error": "rate"}, 429)
        q = anvil.server.request.query_params
        author = _author(q.get("key"))
        if author is None:
            return json_response({"error": "key"}, 401)
        row = _cast_row(q.get("cast") or "")
        if row is None:
            return json_response({"error": "unknown"}, 404)
        if row["owner"] is None or row["owner"].get_id() != author.get_id():
            return json_response({"error": "owner"}, 403)
        body = anvil.server.request.body
        row.update(audio=anvil.BlobMedia("text/plain", body.get_bytes(), name="audio.yaml"),
                   updated=utcnow())
        return json_response({"ok": True})

    if not _allowed("cast"):
        return json_response({"error": "rate"}, 429)
    q = anvil.server.request.query_params
    row = _cast_row(q.get("cast") or "")
    if row is None or row["audio"] is None:
        return json_response({"error": "unknown"}, 404)
    if not _may_read(row, _author(q.get("key"))):
        return json_response({"error": "access"}, 403)
    # The blob is the same bytes for every reader, so it is served cacheable
    # and, where Anvil gives the media its own URL, not through this server
    # at all. Task 15 measures which of the two paths this becomes.
    url = getattr(row["audio"], "url", None)
    if url:
        return anvil.server.HttpResponse(status=302, headers={"Location": url})
    return anvil.server.HttpResponse(
        status=200, body=row["audio"].get_bytes(),
        headers={"Content-Type": "text/plain; charset=utf-8",
                 "Cache-Control": "public, max-age=31536000, immutable"})
```

Add `import anvil` to `api.py` if it is not already bound (it needs the bare name for `anvil.BlobMedia`, the same reason `dashboard_server.py` imports it).

- [ ] **Step 7: Run the suite, commit, push, pull**

Run: `python3 -m pytest -q` → PASS

```bash
git add server_code/api.py server_code/parsers.py tests/
git commit -m "feat(casts): store a spec and its audio as two objects, read them behind a gate"
git push origin master
```

**MANUAL STEP — Hans:** pull (**source code**), then smoke with a real session token from Task 8:

```bash
B=https://drawcast.anvil.app/_/api
curl -s -X POST $B/cast -H 'content-type: text/plain' \
  -d '{"key":"<token>","cast":"anvil/spanish1/01-intro.yaml","title":"Intro","spec":"meta:\n  title: Intro\n"}'
curl -s "$B/cast?cast=anvil/spanish1/01-intro.yaml&key=<token>"
curl -s -o /dev/null -w "%{http_code}\n" "$B/cast?cast=anvil/spanish1/01-intro.yaml"   # → 403
```

---

### Task 7: `POST /name/check`

**Files:**
- Modify: `drawcast-anvil/server_code/api.py`
- Test: `drawcast-anvil/tests/test_api_source.py`

**Interfaces:**
- Produces: `POST /_/api/name/check {name, key?} → {"state": "free"|"yours"|"taken"|"short"|"invalid"}`.

- [ ] **Step 1: Add the endpoint**

```python
@anvil.server.http_endpoint("/name/check", methods=["POST"], **ENDPOINT)
def http_name_check(**params):
    """Advice, not a reservation (spec §9): nothing is held between this
    answer and the publish, and POST /name still decides. It is a POST with a
    text/plain body rather than a GET because telling "yours" from
    "someone else's" needs the token, and a credential must never ride in a
    query string."""
    if not _allowed("name"):
        return json_response({"error": "rate"}, 429)
    body = load_body()
    if not isinstance(body, dict):
        return json_response({"error": "body"}, 400)
    name = names.normalize_name(body.get("name"))
    if name is None:
        return json_response({"state": "invalid"})
    if not names.registrable(name):
        return json_response({"state": "short"})
    base, _ = names.split_name(name)
    row = next(iter(app_tables.names.search(name=base)), None)
    if row is None:
        return json_response({"state": "free"})
    author = _author(body.get("key"))
    return json_response({"state": "yours" if author is not None and row["owner"] == author else "taken"})
```

- [ ] **Step 2: Make `_name_set` enforce the floor**

In `_name_set`, right after `base, sub = names.split_name(req["name"])` and the `sub is not None` guard, add:

```python
    if not names.registrable(base):
        return json_response({"error": "short"}, 400)
```

- [ ] **Step 3: Pin both in the source test**

```python
# append to tests/test_api_source.py
def test_the_check_is_a_post_and_the_floor_is_enforced_on_write(source):
    assert '@anvil.server.http_endpoint("/name/check", methods=["POST"]' in source
    assert "if not names.registrable(base):" in source
```

- [ ] **Step 4: Run, commit, push, pull**

Run: `python3 -m pytest -q` → PASS

```bash
git add server_code/api.py tests/test_api_source.py
git commit -m "feat(names): a check endpoint, and the floor enforced on registration"
git push origin master
```

**MANUAL STEP — Hans:** pull (**source code**).

---

### Task 8: `src/account.ts` — the client half of the handshake

**Files:**
- Create: `drawcast/src/account.ts`
- Test: `drawcast/tests/account.test.ts`
- Modify: `drawcast/src/store.ts` (`getAuthorKey`/`setAuthorKey` → re-export from account)

**Interfaces:**
- Consumes: `DEFAULT_ENROLL_API` from `src/learn.ts`.
- Produces: `getToken(): string`, `setToken(t: string): void`, `signInUrl(returnTo: string, api?: string): string`, `tokenInHash(hash: string): string | null`, `stripToken(url: string): string`, `redeemToken(api, token, fetchImpl?): Promise<string | null>`, `signOut(api, token, fetchImpl?): Promise<void>`.

- [ ] **Step 1: Write the failing test**

```typescript
// drawcast/tests/account.test.ts
import { describe, expect, test, vi } from "vitest";
import { redeemToken, signInUrl, stripToken, tokenInHash } from "../src/account";

describe("the token in the address", () => {
  test("is found after a name or a cast, and only as its own parameter", () => {
    expect(tokenInHash("#spanish1&t=abc123")).toBe("abc123");
    expect(tokenInHash("#gh=o/r/p.yaml&t=abc123")).toBe("abc123");
    expect(tokenInHash("#spanish1")).toBeNull();
    expect(tokenInHash("#tomorrow=1")).toBeNull();
  });
  test("is stripped without disturbing the rest", () => {
    expect(stripToken("https://drawcast.app/#spanish1&t=abc&mode=silent")).toBe("https://drawcast.app/#spanish1&mode=silent");
    expect(stripToken("https://drawcast.app/#spanish1&t=abc")).toBe("https://drawcast.app/#spanish1");
    expect(stripToken("https://drawcast.app/#spanish1")).toBe("https://drawcast.app/#spanish1");
  });
});

describe("signInUrl", () => {
  test("sends the return address, encoded", () => {
    expect(signInUrl("https://drawcast.app/#spanish1", "https://drawcast.anvil.app")).toBe(
      "https://drawcast.anvil.app/#signin?return=https%3A%2F%2Fdrawcast.app%2F%23spanish1",
    );
  });
});

describe("redeemToken", () => {
  test("returns the session token", async () => {
    const f = vi.fn(async () => new Response(JSON.stringify({ key: "sess" }), { status: 200 })) as unknown as typeof fetch;
    expect(await redeemToken("https://a", "once", f)).toBe("sess");
  });
  test("a refusal and an outage are both null, never a throw", async () => {
    const bad = vi.fn(async () => new Response("{}", { status: 400 })) as unknown as typeof fetch;
    expect(await redeemToken("https://a", "once", bad)).toBeNull();
    const dead = vi.fn(async () => {
      throw new Error("offline");
    }) as unknown as typeof fetch;
    expect(await redeemToken("https://a", "once", dead)).toBeNull();
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run tests/account.test.ts`
Expected: FAIL — cannot resolve `../src/account`.

- [ ] **Step 3: Write the module**

```typescript
// drawcast/src/account.ts
// The client half of the sign-in handshake (spec §1). The app and the server
// are two origins, so a session cookie cannot authorise a fetch from here;
// what crosses is a one-time token in a redirect, exchanged once for a
// session token that lives in this browser like the GitHub token does.
//
// Nothing here may throw into a page load: every failure returns null.

import { apiBase, DEFAULT_ENROLL_API } from "./learn";

const TOKEN_KEY = "drawcast.token";
/** `t` as its own parameter — never the `t` inside another word. */
const TOKEN_RE = /[#&]t=([^&]+)/;

function storage(): Storage | null {
  try {
    return localStorage;
  } catch {
    return null; // private mode can throw on access, not only on use
  }
}

export function getToken(): string {
  try {
    return storage()?.getItem(TOKEN_KEY) ?? "";
  } catch {
    return "";
  }
}

export function setToken(token: string): void {
  const s = storage();
  if (!s) return;
  try {
    if (token) s.setItem(TOKEN_KEY, token);
    else s.removeItem(TOKEN_KEY);
  } catch {
    /* no storage — this browser signs in again next time */
  }
}

export function signInUrl(returnTo: string, api: string = DEFAULT_ENROLL_API): string {
  return `${apiBase(api)}/#signin?return=${encodeURIComponent(returnTo)}`;
}

export function tokenInHash(hash: string): string | null {
  const m = TOKEN_RE.exec(hash);
  if (!m) return null;
  try {
    return decodeURIComponent(m[1]) || null;
  } catch {
    return null; // a malformed escape is not a token, not a crash
  }
}

/** The same URL without `t=`, so a copied address never carries a token. */
export function stripToken(url: string): string {
  return url.replace(/([#&])t=[^&]*&/, "$1").replace(/[#&]t=[^&]*$/, "");
}

export async function redeemToken(api: string, token: string, fetchImpl: typeof fetch = fetch): Promise<string | null> {
  try {
    const res = await fetchImpl(`${apiBase(api)}/_/api/redeem`, {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body: JSON.stringify({ token, label: navigator.userAgent.slice(0, 60) }),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { key?: unknown };
    return typeof body.key === "string" ? body.key : null;
  } catch {
    return null;
  }
}

export async function signOut(api: string, token: string, fetchImpl: typeof fetch = fetch): Promise<void> {
  try {
    await fetchImpl(`${apiBase(api)}/_/api/signout`, {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body: JSON.stringify({ key: token }),
    });
  } catch {
    /* signing out locally is what matters; the row can be revoked from the dashboard */
  }
}
```

- [ ] **Step 4: Point `store.ts` at it**

Replace the bodies of `getAuthorKey`/`setAuthorKey` in `src/store.ts` so every existing caller keeps working while the storage key moves:

```typescript
/** @deprecated The author key became a session token (spec §1). Kept as the
 *  name every publish path already calls; the value now comes from account.ts. */
export function getAuthorKey(): string {
  return getToken();
}

export function setAuthorKey(key: string): void {
  setToken(key);
}
```

Add `import { getToken, setToken } from "./account";` at the top of `store.ts`, and delete `KEYS.authorKey`.

- [ ] **Step 5: Run and commit**

Run: `npx vitest run tests/account.test.ts` → PASS
Run: `npm test` → PASS

```bash
cd ~/Documents/GitHub/drawcast
git add src/account.ts src/store.ts tests/account.test.ts
git commit -m "feat(account): the client half of the sign-in handshake"
```

---

### Task 9: Redeem on arrival, in `entry.ts`

**Files:**
- Modify: `drawcast/src/entry.ts`
- Test: `drawcast/tests/account.test.ts` (extend)

**Interfaces:**
- Consumes: `tokenInHash`, `stripToken`, `redeemToken`, `setToken` (Task 8).
- Produces: `redeemFromAddress(hash, href, api, fetchImpl?): Promise<boolean>` exported from `src/account.ts` — entry calls it before routing.

- [ ] **Step 1: Write the failing test**

```typescript
// append to drawcast/tests/account.test.ts
import { redeemFromAddress } from "../src/account";

describe("redeemFromAddress", () => {
  test("exchanges a token, stores it and reports true", async () => {
    const f = vi.fn(async () => new Response(JSON.stringify({ key: "sess" }), { status: 200 })) as unknown as typeof fetch;
    expect(await redeemFromAddress("#spanish1&t=once", "https://drawcast.app/#spanish1&t=once", "https://a", f)).toBe(true);
  });
  test("does nothing at all when the address carries no token", async () => {
    const f = vi.fn() as unknown as typeof fetch;
    expect(await redeemFromAddress("#spanish1", "https://drawcast.app/#spanish1", "https://a", f)).toBe(false);
    expect((f as unknown as ReturnType<typeof vi.fn>).mock.calls.length).toBe(0);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run tests/account.test.ts` → FAIL, `redeemFromAddress` is not exported.

- [ ] **Step 3: Add it to `account.ts`**

```typescript
/**
 * A token in the address is spent and erased before anything routes on the
 * hash: `t=` must never survive into a copied link, and the router must not
 * see it. Returns whether a token was found, not whether it worked — a
 * failed exchange leaves the person signed out, which the next action will
 * offer to fix.
 */
export async function redeemFromAddress(
  hash: string,
  href: string,
  api: string = DEFAULT_ENROLL_API,
  fetchImpl: typeof fetch = fetch,
): Promise<boolean> {
  const once = tokenInHash(hash);
  if (!once) return false;
  const session = await redeemToken(api, once, fetchImpl);
  if (session) setToken(session);
  try {
    history.replaceState(null, "", stripToken(href));
  } catch {
    /* the address keeps the spent token; it is single-use and already dead */
  }
  return true;
}
```

- [ ] **Step 4: Call it from `entry.ts`**

```typescript
// src/entry.ts — replace the top-level routing with an async boot
import { redeemFromAddress } from "./account";
import { isNameHash } from "./names";

async function boot(): Promise<void> {
  // Before routing: a `t=` in the address is a sign-in coming back, and the
  // hash it rode in on is the page the person actually asked for.
  await redeemFromAddress(location.hash, location.href);
  const hash = location.hash;
  if (/[#&](gdoc|gh|gdrive|anvil)[=-]/.test(hash)) {
    const { parseViewerHash, runViewer } = await import("./viewer");
    const req = parseViewerHash(hash);
    if (req) await runViewer(req);
  } else if (isNameHash(hash)) {
    const { runNamed } = await import("./viewer");
    await runNamed(hash);
  } else {
    await import("./main");
  }
}

void boot();
```

Note the added `anvil` in the source pattern — Task 11 makes it resolve.

- [ ] **Step 5: Run and commit**

Run: `npm test` → PASS

```bash
git add src/account.ts src/entry.ts tests/account.test.ts
git commit -m "feat(account): spend an arriving token before anything routes on the hash"
```

---

### Task 10: Settings → Sign in

**Files:**
- Modify: `drawcast/src/main.ts` (the `authorKey` field, ~1618 and ~1774)

**Interfaces:**
- Consumes: `getToken`, `setToken`, `signInUrl`, `signOut` (Task 8).

- [ ] **Step 1: Replace the input with a button pair**

```typescript
// src/main.ts — replace authorKeyInput and its listener
const signInBtn = h("button", { class: "small" }, "Sign in") as HTMLButtonElement;
const signOutBtn = h("button", { class: "small" }, "Sign out") as HTMLButtonElement;
const signInState = h("span", { class: "settings-inline" });
function refreshSignIn(): void {
  const on = getToken() !== "";
  signInState.textContent = on ? "Signed in to the drawcast server." : "Not signed in.";
  signInBtn.hidden = on;
  signOutBtn.hidden = !on;
}
signInBtn.addEventListener("click", () => {
  // Back to exactly where we are, so a sign-in never costs the page.
  location.href = signInUrl(location.href);
});
signOutBtn.addEventListener("click", () => {
  void signOut(DEFAULT_ENROLL_API, getToken());
  setToken("");
  refreshSignIn();
});
refreshSignIn();
```

- [ ] **Step 2: Replace the settings row**

```typescript
  [
    "authorKey",
    h(
      "div",
      { class: "settings-field" },
      h("label", {}, "drawcast account"),
      h("div", { class: "settings-row" }, signInBtn, signOutBtn, signInState),
      h(
        "div",
        { class: "settings-note" },
        "Signing in lets you publish to the drawcast server, register drawcast.app/#<name> links, and own your courses in the teacher dashboard. It opens drawcast.anvil.app and comes straight back. Nothing is stored but a token for this browser — sign out here, or from the dashboard for every browser at once.",
      ),
    ),
  ],
```

- [ ] **Step 3: Verify by hand**

Run: `npm run dev`, open Settings → Publishing. Expected: a **Sign in** button and "Not signed in." Pressing it leaves for the Anvil app; after signing in you come back to the same page with "Signed in to the drawcast server."

- [ ] **Step 4: Commit**

```bash
git add src/main.ts
git commit -m "feat(settings): Sign in replaces pasting a key"
```

---

### Task 11: `#anvil=` — the fourth source

**Files:**
- Modify: `drawcast/src/viewer.ts`
- Test: `drawcast/tests/viewer-anvil.test.ts` (create)

**Interfaces:**
- Consumes: `getToken` (Task 8), `GET /cast` and `GET /cast/audio` (Task 6).
- Produces: `ViewerRequest.anvil?: { cast: string; api: string }`; `fetchAnvilText(ref, fetchImpl?): Promise<string>`; `castKeyFor` accepting the Anvil case.

- [ ] **Step 1: Write the failing test**

```typescript
// drawcast/tests/viewer-anvil.test.ts
import { describe, expect, test, vi } from "vitest";
import { fetchAnvilText, parseViewerHash } from "../src/viewer";

describe("parseViewerHash", () => {
  test("reads #anvil=<course>/<file> and keeps the common parameters", () => {
    const req = parseViewerHash("#anvil=spanish1/01-intro.yaml&mode=silent");
    expect(req?.anvil?.cast).toBe("anvil/spanish1/01-intro.yaml");
    expect(req?.mode).toBe("silent");
  });
  test("refuses a path that climbs out", () => {
    expect(parseViewerHash("#anvil=spanish1/../../etc/passwd.yaml")).toBeNull();
  });
});

describe("fetchAnvilText", () => {
  test("concatenates the spec and its audio into one document", async () => {
    const f = vi.fn(async (url: string) =>
      url.includes("/cast/audio")
        ? new Response("audio:\n  lang: en\n", { status: 200 })
        : new Response("meta:\n  title: Intro\n", { status: 200 }),
    ) as unknown as typeof fetch;
    const text = await fetchAnvilText({ cast: "anvil/spanish1/01.yaml", api: "https://a" }, f);
    expect(text).toBe("meta:\n  title: Intro\n---\naudio:\n  lang: en\n");
  });
  test("a cast without audio is just its spec", async () => {
    const f = vi.fn(async (url: string) =>
      url.includes("/cast/audio") ? new Response("{}", { status: 404 }) : new Response("meta: {}\n", { status: 200 }),
    ) as unknown as typeof fetch;
    expect(await fetchAnvilText({ cast: "anvil/spanish1/01.yaml", api: "https://a" }, f)).toBe("meta: {}\n");
  });
  test("a refusal names the door, not the network", async () => {
    const f = vi.fn(async () => new Response("{}", { status: 403 })) as unknown as typeof fetch;
    await expect(fetchAnvilText({ cast: "anvil/spanish1/01.yaml", api: "https://a" }, f)).rejects.toThrow(/sign in|not yours/i);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run tests/viewer-anvil.test.ts` → FAIL, `fetchAnvilText` is not exported.

- [ ] **Step 3: Extend `parseViewerHash`**

```typescript
// src/viewer.ts — beside GH_RE
const ANVIL_RE = /[#&]anvil[=-]([\w.-]+)\/([^&\s]+)/;
```

In `parseViewerHash`, add `const anv = ANVIL_RE.exec(hash);` beside the others, include it in the `if (!gh && !doc && !drive && !anv) return null;` guard, add `.replace(/anvil-/, "anvil=")` to the `URLSearchParams` normalisation, and return before the `gh` branch:

```typescript
  if (anv) {
    const path = decodeURIComponent(anv[2]);
    if (!DOC_PATH_RE.test(path)) return null;
    return { anvil: { cast: `anvil/${anv[1]}/${path}`, api: DEFAULT_ENROLL_API }, ...common };
  }
```

Add `anvil?: { cast: string; api: string };` to `ViewerRequest`.

- [ ] **Step 4: Add `fetchAnvilText`**

```typescript
/**
 * A cast stored on the drawcast server arrives as two objects (spec §4) and
 * is handed to the parser as one document — so `parsePlaylistText`,
 * `speech.prefetch` and mount order never learn about the split. The audio
 * request is skipped for a cast that has none: 404 there is normal, not an
 * error.
 */
export async function fetchAnvilText(ref: { cast: string; api: string }, fetchImpl: typeof fetch = fetch): Promise<string> {
  const q = `cast=${encodeURIComponent(ref.cast)}&key=${encodeURIComponent(getToken())}`;
  const res = await fetchImpl(`${apiBase(ref.api)}/_/api/cast?${q}`);
  if (!res.ok) {
    throw new Error(
      res.status === 403 || res.status === 401
        ? "This drawcast is private. Sign in with the account it belongs to — Settings → Publishing → Sign in."
        : res.status === 404
          ? "That drawcast is not on the drawcast server (it may have been removed)."
          : `Could not fetch the drawcast (HTTP ${res.status}).`,
    );
  }
  const spec = await res.text();
  const audio = await fetchImpl(`${apiBase(ref.api)}/_/api/cast/audio?${q}`).catch(() => null);
  if (!audio || !audio.ok) return spec;
  const track = await audio.text();
  return `${spec.replace(/\n*$/, "\n")}---\n${track}`;
}
```

- [ ] **Step 5: Wire it into the load and the cast key**

At `viewer.ts:340`, extend the ternary:

```typescript
    const text = req.anvil
      ? await fetchAnvilText(req.anvil)
      : req.gh
        ? await fetchGhText(req.gh)
        : req.driveId
          ? await fetchGdriveText(req.driveId)
          : await fetchGdocText(req.docId!);
```

Then, wherever the file reads `req.gh` to build a cast key (`viewer.ts:366` for counting and `:386` for reporting), take the Anvil key too:

```typescript
    const castKey = req.anvil ? req.anvil.cast : req.gh ? castKeyFor(req.gh) : null;
```

and use `castKey` in place of both `castKeyFor(req.gh)` calls, replacing `&& req.gh` with `&& castKey` in the counting guard and `if (req.gh)` with `if (castKey)` in the reporting block.

- [ ] **Step 6: Run and commit**

Run: `npx vitest run tests/viewer-anvil.test.ts && npm test` → PASS

```bash
git add src/viewer.ts tests/viewer-anvil.test.ts
git commit -m "feat(viewer): #anvil= as a fourth source, two objects served as one document"
```

---

### Task 12: A name that points at the server

**Files:**
- Modify: `drawcast/src/viewer.ts` (`runNamed`, ~line 257)
- Test: `drawcast/tests/viewer-anvil.test.ts` (extend)

**Interfaces:**
- Consumes: `resolveName` (existing), `parseViewerHash` (Task 11).
- Produces: `anvilHashFor(hash, target): string` in `src/names.ts`.

- [ ] **Step 1: Write the failing test**

```typescript
// append to drawcast/tests/viewer-anvil.test.ts
import { anvilHashFor } from "../src/names";

describe("a name pointing at the server", () => {
  test("becomes an #anvil= hash, keeping the parameters", () => {
    expect(anvilHashFor("#spanish1&mode=silent", "anvil/spanish1/01-intro.yaml")).toBe("#anvil=spanish1/01-intro.yaml&mode=silent");
  });
  test("a github target still becomes a gh hash", () => {
    expect(anvilHashFor("#spanish1", "hmelberg/dcast/casts/one.yaml")).toBe("#gh=hmelberg/dcast/casts/one.yaml");
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run tests/viewer-anvil.test.ts` → FAIL, `anvilHashFor` missing.

- [ ] **Step 3: Add it to `names.ts`**

```typescript
/** The hash a resolved target should be played through: the server for an
 *  `anvil/` key, GitHub for anything else. One place, so runNamed does not
 *  have to know how a cast key is shaped. */
export function anvilHashFor(hash: string, target: string): string {
  const rest = hash.slice(1).split("&").slice(1);
  const tail = rest.length ? "&" + rest.join("&") : "";
  return target.startsWith("anvil/")
    ? `#anvil=${target.slice("anvil/".length)}${tail}`
    : `#gh=${target}${tail}`;
}
```

- [ ] **Step 4: Use it in `runNamed`**

In `src/viewer.ts:279`, replace `ghHashFor(hash, resolved.target)` with `anvilHashFor(hash, resolved.target)` and update the import.

- [ ] **Step 5: Run and commit**

Run: `npm test` → PASS

```bash
git add src/names.ts src/viewer.ts tests/viewer-anvil.test.ts
git commit -m "feat(names): a name resolves to the server as readily as to GitHub"
```

---

### Task 13: Publish one cast to the drawcast server

**Files:**
- Modify: `drawcast/src/publish/cast.ts`
- Create: `drawcast/src/publish/server.ts`
- Test: `drawcast/tests/publish-server.test.ts`
- Modify: `drawcast/src/ui/share.ts` (the destination rail), `drawcast/src/ui/destinations.ts`

**Interfaces:**
- Consumes: `getToken` (Task 8), `POST /cast`, `POST /cast/audio` (Task 6).
- Produces: `serverCastKey(slug: string, file: string): string`; `publishToServer(args): Promise<{ cast: string; url: string }>`.

- [ ] **Step 1: Write the failing test**

```typescript
// drawcast/tests/publish-server.test.ts
import { describe, expect, test, vi } from "vitest";
import { publishToServer, serverCastKey, splitBakedYaml } from "../src/publish/server";

describe("serverCastKey", () => {
  test("is a/b/c-shaped so events and progress never notice", () => {
    expect(serverCastKey("spanish1", "01-intro.yaml")).toBe("anvil/spanish1/01-intro.yaml");
  });
});

describe("splitBakedYaml", () => {
  test("separates the audio document from the spec", () => {
    const { spec, audio } = splitBakedYaml("meta: {}\n---\naudio:\n  lang: en\n");
    expect(spec).toBe("meta: {}\n");
    expect(audio).toBe("audio:\n  lang: en\n");
  });
  test("an unbaked document has no audio", () => {
    expect(splitBakedYaml("meta: {}\n").audio).toBeNull();
  });
});

describe("publishToServer", () => {
  test("writes the spec, then the audio, and reports the address", async () => {
    const f = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 })) as unknown as typeof fetch;
    const out = await publishToServer(
      { slug: "spanish1", file: "01-intro.yaml", title: "Intro", yaml: "meta: {}\n---\naudio:\n  lang: en\n", access: "enrolled", token: "t", api: "https://a" },
      f,
    );
    const calls = (f as unknown as ReturnType<typeof vi.fn>).mock.calls as [string, RequestInit][];
    expect(calls[0][0]).toBe("https://a/_/api/cast");
    expect(calls[1][0]).toContain("/_/api/cast/audio?");
    expect(out.cast).toBe("anvil/spanish1/01-intro.yaml");
    expect(out.url).toBe("https://drawcast.app/#anvil=spanish1/01-intro.yaml");
  });
  test("a rejected token is an error the caller can show", async () => {
    const f = vi.fn(async () => new Response(JSON.stringify({ error: "key" }), { status: 401 })) as unknown as typeof fetch;
    await expect(publishToServer({ slug: "s", file: "a.yaml", title: "t", yaml: "meta: {}\n", access: "open", token: "t", api: "https://a" }, f)).rejects.toThrow(/sign in/i);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run tests/publish-server.test.ts` → FAIL, module missing.

- [ ] **Step 3: Write `src/publish/server.ts`**

```typescript
// Publishing to the drawcast server (spec §4). Two requests, because the
// spec is ~10 KB and the audio is megabytes: one JSON body carrying both is
// exactly what made GitHub answer 422 on a baked course (2026-09-02).

import { apiBase } from "../learn";

export function serverCastKey(slug: string, file: string): string {
  return `anvil/${slug}/${file}`;
}

/** The published YAML is one file with the audio appended as a second
 *  document; storage wants them apart. `formatPublished` is the only writer
 *  of that separator, so this is its exact inverse. */
export function splitBakedYaml(yaml: string): { spec: string; audio: string | null } {
  const at = yaml.indexOf("\n---\naudio:");
  if (at < 0) return { spec: yaml, audio: null };
  return { spec: yaml.slice(0, at + 1), audio: yaml.slice(at + "\n---\n".length) };
}

export interface ServerPublishArgs {
  slug: string;
  file: string;
  title: string;
  yaml: string;
  access: "open" | "signed-in" | "enrolled";
  token: string;
  api: string;
}

export async function publishToServer(args: ServerPublishArgs, fetchImpl: typeof fetch = fetch): Promise<{ cast: string; url: string }> {
  const cast = serverCastKey(args.slug, args.file);
  const { spec, audio } = splitBakedYaml(args.yaml);
  const res = await fetchImpl(`${apiBase(args.api)}/_/api/cast`, {
    method: "POST",
    headers: { "content-type": "text/plain" },
    body: JSON.stringify({ key: args.token, cast, title: args.title, spec, access: args.access }),
  });
  if (!res.ok) {
    throw new Error(
      res.status === 401
        ? "The drawcast server did not accept this browser — Settings → Publishing → Sign in."
        : res.status === 403
          ? "That name already belongs to another account on the drawcast server."
          : `The drawcast server refused the publish (HTTP ${res.status}).`,
    );
  }
  if (audio) {
    const q = `cast=${encodeURIComponent(cast)}&key=${encodeURIComponent(args.token)}`;
    const up = await fetchImpl(`${apiBase(args.api)}/_/api/cast/audio?${q}`, {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body: audio,
    });
    // The spec is already stored and playable; a failed audio upload is worth
    // saying out loud rather than losing the whole publish over.
    if (!up.ok) throw new Error(`The drawing was published, but its narration was not (HTTP ${up.status}). Publish again to retry the audio.`);
  }
  return { cast, url: `https://drawcast.app/#anvil=${args.slug}/${args.file}` };
}
```

- [ ] **Step 4: Offer it in the Share rail**

In `src/ui/destinations.ts`, add a `server` row beside the GitHub and Drive rows, with `casts: true, courses: false` (round 3 adds courses). In `src/ui/share.ts`, mount a panel whose Publish button calls `publishToServer` with `getToken()`, the slug from the name field, the file name from the cast's slug, and the access value from the "Who can watch" control — for round 0 a two-value select, `open` and `enrolled`, defaulting to `enrolled`. Disable the button with "Sign in to publish here" when `getToken()` is empty.

- [ ] **Step 5: Run and commit**

Run: `npx vitest run tests/publish-server.test.ts && npm test` → PASS

```bash
git add src/publish/server.ts src/ui/share.ts src/ui/destinations.ts tests/publish-server.test.ts
git commit -m "feat(publish): a third target — the drawcast server, spec and audio apart"
```

---

### Task 14: The Check button

**Files:**
- Modify: `drawcast/src/names.ts`
- Modify: `drawcast/src/ui/share.ts`
- Test: `drawcast/tests/names.test.ts` (extend)

**Interfaces:**
- Consumes: `POST /name/check` (Task 7), `getToken` (Task 8).
- Produces: `checkName(api, name, token, fetchImpl?): Promise<"free" | "yours" | "taken" | "short" | "invalid" | "error">`, `checkNote(state, name): string`.

- [ ] **Step 1: Write the failing test**

```typescript
// append to drawcast/tests/names.test.ts
describe("checkName", () => {
  test("passes the state through and never throws", async () => {
    const ok = fetchReturning(200, { state: "taken" });
    expect(await checkName("https://a", "spanish1", "t", ok)).toBe("taken");
    const dead = vi.fn(async () => {
      throw new Error("offline");
    }) as unknown as typeof fetch;
    expect(await checkName("https://a", "spanish1", "t", dead)).toBe("error");
  });
  test("a short name is refused without asking the server", async () => {
    const f = vi.fn() as unknown as typeof fetch;
    expect(await checkName("https://a", "spanish", "t", f)).toBe("short");
    expect((f as unknown as ReturnType<typeof vi.fn>).mock.calls.length).toBe(0);
  });
  test("the note says what to do, not what happened", () => {
    expect(checkNote("free", "spanish1")).toMatch(/free/i);
    expect(checkNote("short", "spanish")).toMatch(/8/);
  });
});
```

Add `checkName, checkNote` to the file's import.

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run tests/names.test.ts` → FAIL.

- [ ] **Step 3: Add them to `names.ts`**

```typescript
export type CheckState = "free" | "yours" | "taken" | "short" | "invalid" | "error";

/** Advice, not a reservation (spec §9): nothing is held, and POST /name
 *  still decides. The floor is checked here first so an obviously short name
 *  costs no request out of the 600/h budget. */
export async function checkName(api: string, name: string, token: string, fetchImpl: typeof fetch = fetch): Promise<CheckState> {
  const normalized = normalizeName(name);
  if (normalized === null) return "invalid";
  if (!isRegistrable(normalized)) return "short";
  try {
    const res = await fetchImpl(`${apiBase(api)}/_/api/name/check`, {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body: JSON.stringify({ name: normalized, key: token }),
    });
    if (!res.ok) return "error";
    const body = (await res.json()) as { state?: unknown };
    const state = body.state;
    return state === "free" || state === "yours" || state === "taken" || state === "short" || state === "invalid" ? state : "error";
  } catch {
    return "error";
  }
}

export function checkNote(state: CheckState, name: string): string {
  switch (state) {
    case "free":
      return `"${name}" is free.`;
    case "yours":
      return `"${name}" is already yours — publishing moves it to this drawcast.`;
    case "taken":
      return `"${name}" belongs to someone else. Pick another.`;
    case "short":
      return "Names need at least 8 characters for now.";
    case "invalid":
      return "That is not a valid name: lower-case letters, digits and dashes.";
    case "error":
      return "Could not check the name just now — publishing will tell you for certain.";
  }
}
```

- [ ] **Step 4: Put the button beside the field**

In `src/ui/share.ts`, next to the existing publish-name input, add a `Check` button and a note element. On click: disable the button, `checkNote(await checkName(DEFAULT_ENROLL_API, input.value, getToken()), input.value)` into the note, re-enable. **No listener on `input`** — the budget is 600/h and a check-as-you-type would spend it (spec §9).

- [ ] **Step 5: Run and commit**

Run: `npm test` → PASS

```bash
git add src/names.ts src/ui/share.ts tests/names.test.ts
git commit -m "feat(names): a Check button beside the field, on the button only"
```

---

### Task 15: Measure the three unknowns

**Files:**
- Create: `drawcast/docs/superpowers/plans/2026-09-05-round-0-measurements.md`

This task is the point of the round: the spec's §4 and §15 defer three decisions to numbers that do not exist yet.

- [ ] **Step 1: Publish one real baked lecture**

From the app, publish `where-did-this-whole-enterprise-come` (1.44 MB, 99 % audio) to the server as `anvil/measure01/lecture.yaml`, access `enrolled`.

- [ ] **Step 2: Measure the spec and the audio separately**

```bash
B=https://drawcast.anvil.app/_/api
K=<session token>
C=anvil/measure01/lecture.yaml
for i in 1 2 3; do
  curl -s -o /dev/null -w "spec  ttfb=%{time_starttransfer}s total=%{time_total}s size=%{size_download}\n" "$B/cast?cast=$C&key=$K"
done
for i in 1 2 3; do
  curl -sL -o /dev/null -w "audio ttfb=%{time_starttransfer}s total=%{time_total}s size=%{size_download}\n" "$B/cast/audio?cast=$C&key=$K"
done
curl -s -o /dev/null -w "github total=%{time_total}s size=%{size_download}\n" \
  "https://raw.githubusercontent.com/hmelberg/dcast/HEAD/health-technology-assessment-deciding/where-did-this-whole-enterprise-come.yaml"
```

- [ ] **Step 3: Answer the three questions in the file**

Write `2026-09-05-round-0-measurements.md` with:
1. **Did the 1.4 MB audio POST succeed?** If Anvil refused the body, the fallback is chunked upload — record the limit that was hit.
2. **Is the Media URL directly servable?** `curl -sI "$B/cast/audio?…"` — a `302` with a `Location` means yes and the blob never touches server code; a `200` means the streaming fallback is live and `Cache-Control` is doing the work instead.
3. **What does a baked lecture cost to serve?** The numbers above against GitHub's, and therefore whether "baked audio, default off on the server" (spec §4) should stay the default.

- [ ] **Step 4: Commit**

```bash
cd ~/Documents/GitHub/drawcast
git add docs/superpowers/plans/2026-09-05-round-0-measurements.md
git commit -m "docs(round-0): what the server actually costs to serve"
```

---

## Self-Review

**Spec coverage (round 0 in §12):** `tokens` replacing `users.author_key` — Tasks 3, 4. `#signin`/`redeem`/`signout` — Tasks 5, 8, 9. Sign in in Settings — Task 10. Storage as two objects (§4) — Tasks 3, 6, 13. `POST /cast` and the gated read — Task 6. `#anvil=` source — Tasks 11, 12. Name registration with Check and the floor — Tasks 2, 7, 14. The three measurements — Task 15. The `me` reservation (§9) — Task 2.

**Deliberately not in this plan** (later rounds in spec §12): enrolment and approval, the account home, the catalogue, `listed`/`join`/`drip`, deletion, the static GitHub page and the deletion of `ENROL_SCRIPT`. `access` ships as a column with three legal values but only `open` and owner-only are enforced (Task 6, `_may_read`), which is what lets round 1 add enrolment without moving the check.

**Type consistency:** `getToken`/`setToken` (Task 8) are used under those names in Tasks 10, 11, 13, 14. `_author(key)` keeps its name and signature (Task 4) so `http_course` and `_name_set` are untouched. `names.registrable` / `isRegistrable` are the write-gate in both repos (Task 2), used by Tasks 7 and 14. `fetchAnvilText` takes `{cast, api}` in Task 11 and is called with `req.anvil`, which is declared as that shape. `serverCastKey(slug, file)` and `parseViewerHash`'s `anvil.cast` produce the same `anvil/<slug>/<file>` string, which is what `_cast_row` looks up.

**One risk carried deliberately:** Task 6 registers two functions on `/cast` differing only by method. `http_name`'s comment records that Anvil registers by path, and the task says to merge them into one method-dispatching handler if the smoke test shows one shadowing the other.
