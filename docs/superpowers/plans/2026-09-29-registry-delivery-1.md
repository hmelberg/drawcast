# Registry, free names and name visits (delivery 1) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every publish from the app or the skill is registered with Anvil and gets a free, non-editable `drawcast.app/#<name>` made from its title; GitHub ownership is proven by a claim file; name lookups go through a caching Netlify function that counts visits per name per day; a course name opens its GitHub course page (Join goes to `#<name>&join`); the dashboard lists an owner's items, names and visits.

**Architecture:** Anvil's `courses` table becomes the registry (course and cast rows); a pure `registry.py` holds the rules (item keys, the free-name generator); `/claim`, `/claim/verify` and `/register` are new endpoints. A Netlify function `name.mts` fronts `GET /name` with a warm-instance cache and a daily visit record in Netlify Blobs. The app and the skill call `/claim` before and `/register` after a successful commit, never failing a publish on a registry error.

**Tech Stack:** Anvil server Python (pure modules + `api.py`, pytest; `api.py` tested by reading its source), TypeScript/Vite app (vitest), Netlify Functions + `@netlify/blobs` 11, Node scripts (`scripts/cast.mjs`).

**Spec:** `docs/superpowers/specs/2026-09-29-registry-private-names-design.md` (§1 registry and ownership, §2 names and visits, §4 viewing; §7 delivery 1).

## Scope ruling for delivery 1

The spec lists "unlisted with its fee and pay-the-difference" under delivery 1. **Moved:** the listed/unlisted switch and its fee ship with the catalogue (delivery 4), when unlisted means something; the generalised payment plumbing (`/register/quote`, `/register/pay`) ships with private (delivery 2), its first real use. Delivery 1 stores `listed` (default true), `private` (default false) and `paid_lectures` (0) so later deliveries need no migration.

## Global Constraints

- Repos: app `~/Documents/GitHub/drawcast` (work in a worktree; `npm ci` in it — a symlinked `node_modules` breaks `astronomy-engine`), server `~/Documents/GitHub/drawcast-anvil` (branch `registry-1`). Tests: `npm test`, `npx tsc --noEmit -p .`; `python3 -m pytest -q`.
- A registry or name-service failure never fails a publish or playback: publish shows a status suffix; lookups fall back to Anvil directly.
- Free names: at most 40 characters, `names.normalize_name`-valid, never starting with a reserved word (`gh gdoc gdrive url anvil api name course learner me www`), at least 20 characters, not editable, never repointed by `POST /name` (409 `free`).
- Visit records store no IP address, no cookies, no visitor id.
- Every Anvil table column keeps the editor's shape (`admin_ui`, `client_hidden`, `name`, `type`, `target` for links) — `tests/test_schema.py::test_every_column_has_the_editors_shape`.
- `share.ts` keeps exactly one `addEventListener("input"` and two `buildNameCheck(` (tests/publish-server.test.ts:332–350).
- Pushing to Anvil `master`, deploying Netlify, and editing Anvil/Netlify secrets are Hans's steps (the permission classifier blocks production deploys).
- Commits end with the session's Co-Authored-By / Claude-Session lines.

## Review Focus

1. **Registering someone else's repo.** A signed-in account that cannot write to `owner/repo` registers its course first. It must stay an *unproven* owner, and the real author's first verified claim must take the item (and its free name's owner) over. *(Task 3 tests.)*
2. **A title that yields nothing** (Cyrillic, emoji, "!!!") or a title that is a reserved word ("Course", "Name"). The free name must still be valid and ≥20 characters. *(Task 1 tests.)*
3. **Two items with the same title** registered one after the other → `…`, `…-2`; a republish of the same item keeps its name. *(Task 1 and Task 3 tests.)*
4. **Anvil down or slow during publish** — the commit already landed; the publish must report success with a "not registered (server unreachable)" note, and a later republish registers it. *(Task 7 test.)*
5. **The name function when Anvil is down or Blobs throws** — resolution must still answer (Anvil direct fallback in the client); a counting failure must never turn a lookup into an error. *(Tasks 5 and 6 tests.)*

---

## Part A — Anvil (drawcast-anvil, branch `registry-1`)

### Task 1: `registry.py` — item keys and the free name (pure)

**Files:** Create `server_code/registry.py`, `tests/test_registry.py`.

**Interfaces — Produces:**
- `item_key(kind, target) -> str | None` — a course's target as is; a cast's target without its `.yaml/.yml/.json/.txt` extension; `None` for `gdrive/…` or `anvil/…` targets (not registered in delivery 1).
- `repo_of(item) -> "owner/repo"`.
- `slugify(text) -> str` — the same folding as `src/publish/github.ts` `slugify` (æ→ae, ø→o, å→a, ä→a, ö→o, ü→u, ß→ss, then NFD accent strip, non-alnum runs → `-`), without the 40 cut and returning `""` when empty.
- `free_name(title, owner, taken) -> str` — `taken(name) -> bool`.
- Constants `FREE_MIN = 20`, `NAME_MAX = 40`.

- [ ] **Step 1: Failing tests**

```python
import registry
import names


def never(_):
    return False


def test_item_key():
    assert registry.item_key("course", "ann/casts/qaly") == "ann/casts/qaly"
    assert registry.item_key("cast", "ann/casts/casts/intro.yaml") == "ann/casts/casts/intro"
    assert registry.item_key("cast", "gdrive/abcdefghijk") is None
    assert registry.item_key("cast", "anvil/spanish/01.yaml") is None
    assert registry.repo_of("ann/casts/casts/intro") == "ann/casts"


def test_slugify_matches_the_app():
    assert registry.slugify("Hvorfor blåbær og øl?") == "hvorfor-blabaer-og-ol"
    assert registry.slugify("Café Straße") == "cafe-strasse"
    assert registry.slugify("Привет") == ""


def test_long_title_is_its_own_name():
    assert registry.free_name("Understanding the QALY: definition and debates", "ann", never) == "understanding-the-qaly-definition-and"


def test_short_title_gets_by_owner():
    assert registry.free_name("QALYs", "hmelberg", never) == "qalys-by-hmelberg"


def test_reserved_first_word_gets_by_owner():
    n = registry.free_name("Course on health economics", "ann", never)
    assert n.startswith("course-on-health") is False
    assert names.normalize_name(n) == n


def test_empty_title_gets_owner_and_code():
    n = registry.free_name("Привет", "ann", never)
    assert n.startswith("ann-") and len(n) >= registry.FREE_MIN
    assert names.normalize_name(n) == n


def test_taken_gets_a_number():
    taken = {"qalys-by-hmelberg"}
    assert registry.free_name("QALYs", "hmelberg", taken.__contains__) == "qalys-by-hmelberg-2"


def test_every_free_name_is_valid_long_enough_and_not_reserved():
    for title in ["", "!", "Name", "me", "www things", "A" * 80, "Hvorfor blåbær?", "ai"]:
        n = registry.free_name(title, "an-owner", never)
        assert names.normalize_name(n) == n, (title, n)
        assert registry.FREE_MIN <= len(n) <= registry.NAME_MAX, (title, n)
```

- [ ] **Step 2: Run** `python3 -m pytest -q tests/test_registry.py` → FAIL (no module).

- [ ] **Step 3: Implement**

```python
"""The registry's rules (registry round, 2026-09-29; spec
docs/superpowers/specs/2026-09-29-registry-private-names-design.md in the
drawcast repo). Pure: no anvil imports.

An ITEM is a published course (owner/repo/<folder>) or a single drawcast
(its path without the extension). Every item gets one FREE name, made from
its title, at its first registration: not editable, never repointed."""
import re
import secrets
import unicodedata

import names

FREE_MIN = 20
NAME_MAX = 40
_EXT = re.compile(r"\.(?:ya?ml|json|txt)$")
_FOLD = {"æ": "ae", "ø": "o", "å": "a", "ä": "a", "ö": "o", "ü": "u", "ß": "ss"}
_CODE = "bcdfghjklmnpqrstvwxz"


def item_key(kind, target):
    if not isinstance(target, str) or target.startswith(("gdrive/", "anvil/")):
        return None
    return target if kind == "course" else _EXT.sub("", target)


def repo_of(item):
    return "/".join(item.split("/")[:2])


def slugify(text):
    """src/publish/github.ts slugify's folding, without its length cut."""
    s = "".join(_FOLD.get(c, c) for c in (text or "").lower())
    s = "".join(c for c in unicodedata.normalize("NFD", s) if not unicodedata.combining(c))
    return re.sub(r"[^a-z0-9]+", "-", s).strip("-")


def _cut(s, limit=NAME_MAX):
    if len(s) <= limit:
        return s
    head = s[: limit + 1]
    b = head.rfind("-")
    return (head[:b] if b > limit // 2 else s[:limit]).rstrip("-")


def _reserved(s):
    first = s.split("-", 1)[0]
    return first in names.RESERVED_PREFIXES


def _base(title, owner):
    owner = slugify(owner) or "author"
    slug = slugify(title)
    if not slug:
        code = "".join(secrets.choice(_CODE) for _ in range(6))
        return _cut("%s-%s-drawcast" % (owner, code))
    if len(slug) >= FREE_MIN and not _reserved(slug):
        return _cut(slug)
    tail = "-by-" + owner
    s = _cut(slug, NAME_MAX - len(tail)) + tail
    if _reserved(s) or len(s) < FREE_MIN:
        s = _cut("%s-%s-drawcast" % (owner, slug))
    return s


def free_name(title, owner, taken):
    """The item's free name; `taken(name)` says whether a name is in use."""
    base = _base(title, owner)
    if len(base) < FREE_MIN:
        base = _cut(base + "-drawcast")
    if not taken(base):
        return base
    n = 2
    while True:
        suffix = "-%d" % n
        cand = _cut(base, NAME_MAX - len(suffix)) + suffix
        if not taken(cand):
            return cand
        n += 1
```

- [ ] **Step 4: Run** → PASS. If a padded name is still under 20 (e.g. a 1-character owner), `_base` adds `-drawcast`; adjust `_base`, not the tests.
- [ ] **Step 5: Commit** — `registry.py: item keys and the free name from a title`

### Task 2: schema

**Files:** Modify `anvil.yaml`, `tests/test_schema.py`.

- `courses` + `kind` (string), `listed` (bool), `private` (bool), `paid_lectures` (number), `updated` (datetime).
- `names` + `free` (bool), `item` (string).
- New table `repo_claims`: `repo` (string), `owner` (link_single → users), `nonce` (string), `verified` (datetime), `created` (datetime).

- [ ] **Step 1: Failing test** (append to `tests/test_schema.py`):

```python
def test_registry_columns():
    c = columns("courses")
    assert {k: c[k]["type"] for k in ("kind", "listed", "private", "paid_lectures", "updated")} == {
        "kind": "string", "listed": "bool", "private": "bool", "paid_lectures": "number", "updated": "datetime"}
    n = columns("names")
    assert n["free"]["type"] == "bool" and n["item"]["type"] == "string"
    r = columns("repo_claims")
    assert r["owner"]["target"] == "users"
    assert {k: r[k]["type"] for k in ("repo", "nonce", "verified", "created")} == {
        "repo": "string", "nonce": "string", "verified": "datetime", "created": "datetime"}
    assert load()["db_schema"]["repo_claims"]["client"] == "none"
```

- [ ] **Step 2: Run** → FAIL. **Step 3:** add the columns in the file's block style (`admin_ui: {}`, `client_hidden: null`). **Step 4:** `python3 -m pytest -q` → PASS (the editor-shape test covers the new columns). **Step 5: Commit** — `Schema: registry columns on courses, free/item on names, repo_claims`

### Task 3: `/claim`, `/claim/verify`, `/register`; free names refuse repointing

**Files:** Modify `server_code/api.py`, `server_code/limits.py` (`"claim": 60`, `"register": 120`), `server_code/parsers.py` (`parse_register`), `tests/test_parsers.py`, `tests/test_api_source.py`, `tests/test_limits.py`.

**Interfaces — Produces (HTTP, text/plain JSON bodies):**
- `POST /claim {key, repo}` → `{nonce, path: ".drawcast/claim"}` (401 key, 400 repo). Upserts the caller's `repo_claims` row (one per (repo, owner)), new nonce each call unless one is pending for < 1 h.
- `POST /claim/verify {key, repo}` → `{verified: bool}`. Fetches `https://raw.githubusercontent.com/<repo>/HEAD/.drawcast/claim`; verified when its first line equals the caller's pending nonce. On success stamps `verified` and **takes over** every registry row under `repo/` whose owner is unproven (owner empty, or owner without a verified claim on that repo), and those rows' free names.
- `POST /register {key?, kind, target, title, page?, lectures?}` → `{item, name, owner: "you"|"other"|"none", proven: bool}`. Upserts the registry row keyed `registry.item_key(kind, target)`; creates the free name on first registration; updates title/page/lectures (and the free name row's page/lectures) on later ones. Owner rules: empty → the caller (if signed in); the caller → stays; someone else → unchanged, answer `owner: "other"` (no write except when the caller is proven and the other is not: take over).
- `POST /name` for a name whose row has `free` true → 409 `{"error": "free"}`.

- [ ] **Step 1: Failing tests**

`tests/test_parsers.py`:

```python
def test_parse_register():
    r = rq.parse_register({"kind": "cast", "target": "ann/casts/casts/intro.yaml", "title": "Intro"})
    assert r == {"key": None, "kind": "cast", "target": "ann/casts/casts/intro.yaml", "title": "Intro", "page": None, "lectures": None}
    for bad in ({"kind": "x", "target": "a/b/c.yaml"}, {"kind": "cast", "target": "gdrive/abcdefghijkl"},
                {"kind": "cast", "target": "anvil/s/01.yaml"}, {"kind": "course", "target": "a/b/c.yaml"}):
        with pytest.raises(rq.BadRequest):
            rq.parse_register(bad)
```

`tests/test_api_source.py`:

```python
def test_registry_endpoints_registered_once():
    for path in ("/claim", "/claim/verify", "/register"):
        assert SRC.count('http_endpoint("%s"' % path) == 1, path


def test_register_writes_inside_one_transaction():
    assert "@anvil.tables.in_transaction\ndef _register_in_tx(" in SRC
    body = body_of("_register_in_tx")
    assert "registry.free_name(" in body and "registry.item_key(" in body


def test_claim_verify_reads_raw_github_and_takes_over_unproven_rows():
    body = body_of("http_claim_verify")
    assert "raw.githubusercontent.com" in body
    assert "_take_over_unproven(" in body


def test_a_free_name_is_never_repointed():
    assert 'json_response({"error": "free"}, 409)' in body_of("_name_set")
```

`tests/test_limits.py`: extend `test_budgets_match_the_spec` with `"claim": 60, "register": 120`.

- [ ] **Step 2: Run** → FAIL.

- [ ] **Step 3: Implement.** `parsers.parse_register`: `key` optional string; `kind` in `NAME_KINDS`; cast target matches `CAST_RE` and not `anvil/`; course target matches `COURSE_RE`, not `CAST_RE`/`GDRIVE_RE`, not `anvil/`; `title` optional text ≤ `MAX_TITLE`; `page` optional `https://…` ≤ `MAX_PAGE`; `lectures` via `_lectures`. In `api.py`:

```python
# --- registry (registry round, 2026-09-29) ------------------------------------

def _proven(user, repo):
    if user is None:
        return False
    return any(r["verified"] is not None for r in app_tables.repo_claims.search(repo=repo, owner=user))


@anvil.tables.in_transaction
def _register_in_tx(req, user):
    item = registry.item_key(req["kind"], req["target"])
    repo = registry.repo_of(item)
    row = next(iter(app_tables.courses.search(key=item)), None)
    now = utcnow()
    if row is None:
        row = app_tables.courses.add_row(key=item, kind=req["kind"], title=req["title"] or item.rsplit("/", 1)[-1],
                                         page_url=req["page"], lectures=req["lectures"] or [], owner=user,
                                         access="open", listed=True, private=False, paid_lectures=0,
                                         created=now, updated=now)
    else:
        owner = row["owner"]
        if owner is None and user is not None:
            row.update(owner=user)
        elif owner is not None and user is not None and owner != user and _proven(user, repo) and not _proven(owner, repo):
            row.update(owner=user)
        updates = {"updated": now}
        if row["owner"] == user or row["owner"] is None:
            if req["title"]:
                updates["title"] = req["title"]
            if req["page"]:
                updates["page_url"] = req["page"]
            if req["lectures"] is not None:
                updates["lectures"] = req["lectures"]
        row.update(**updates)
    free = next(iter(app_tables.names.search(item=item, free=True)), None)
    if free is None:
        taken = lambda n: next(iter(app_tables.names.search(name=n)), None) is not None
        name = registry.free_name(row["title"], item.split("/", 1)[0], taken)
        free = app_tables.names.add_row(name=name, kind=req["kind"], target=req["target"], page=row["page_url"],
                                        lectures=row["lectures"] if req["kind"] == "course" else None,
                                        owner=row["owner"], created=now, free=True, item=item)
    else:
        free.update(owner=row["owner"], target=req["target"], page=row["page_url"],
                    lectures=row["lectures"] if req["kind"] == "course" else None)
    who = "none" if row["owner"] is None else ("you" if row["owner"] == user else "other")
    return {"item": item, "name": free["name"], "owner": who, "proven": _proven(row["owner"], repo)}


@anvil.server.http_endpoint("/register", methods=["POST"], **ENDPOINT)
def http_register(**params):
    if not _allowed("register"):
        return json_response({"error": "rate"}, 429)
    try:
        req = rq.parse_register(load_body())
    except rq.BadRequest as exc:
        return _bad(exc)
    user = _author(req["key"]) if req["key"] else None
    if req["key"] and user is None:
        return json_response({"error": "key"}, 401)
    return json_response(_register_in_tx(req, user))
```

`/claim` and `/claim/verify` (budget `claim`; `repo` must match `^[\w.-]+/[\w.-]+$`):

```python
def _take_over_unproven(repo, user):
    for row in app_tables.courses.search(key=tq.like(repo + "/%")):
        if not (row["key"] or "").startswith(repo + "/"):
            continue
        if row["owner"] is None or (row["owner"] != user and not _proven(row["owner"], repo)):
            row.update(owner=user, updated=utcnow())
            for n in app_tables.names.search(item=row["key"], free=True):
                n.update(owner=user)
```

`http_claim_verify` fetches with `anvil.http.request(url, timeout=10)`; any error → `{verified: false}`. `_name_set`: right after the `taken` lookup, `if taken is not None and taken["free"]: return json_response({"error": "free"}, 409)`.

The existing `_claim_course_in_tx` (POST /course, casts) keeps working: its rows get `kind` empty; `/register` fills `kind` on the next publish.

- [ ] **Step 4: Run** `python3 -m pytest -q` → PASS.
- [ ] **Step 5: Commit** — `Registry: /claim, /claim/verify (claim file, proven owners take over), /register (free title name); a free name is never repointed`

### Task 4: dashboard — my items, names, visits

**Files:** Modify `server_code/dashboard_server.py` (`list_items`, `name_visits`), `client_code/Form1/__init__.py` + `form_template.html` (panel "Your published drawcasts and courses"), `tests/test_dashboard_source.py`.

- `list_items()` → for the signed-in user: `[{key, kind, title, link: "https://drawcast.app/#<free name>", names: [{name, free}], proven}]`, owner rows only, newest `updated` first, at most 200.
- `name_visits(name)` → owner of the name only; `anvil.http.request("https://drawcast.app/.netlify/functions/name?stats=" + name, headers={"x-drawcast-stats": <secret "name_stats_secret">}, json=True)` → last 30 days `[{day, count, country: {...}, source: {...}, ref: {...}}]`; any error → `None`.
- Form1: one row per item — title, link, "proven"/"unproven (republish while signed in to prove it)", and a "Visits" button showing a 30-day total and the top 5 countries and referrers in a Label.

- [ ] **Step 1: Failing source tests** — `list_items` filters on `owner=user`; `name_visits` checks the name row's owner before any request; the secret name is `name_stats_secret`; Form1 names every component its template defines (the existing component-contract test pattern).
- [ ] **Step 2–4:** implement, `python3 -m pytest -q` → PASS.
- [ ] **Step 5: Commit** — `Dashboard: your published items, their names and name visits`

---

## Part B — Netlify (drawcast, worktree)

### Task 5: `netlify/lib/name-visits.mts` — the daily record (pure)

**Files:** Create `netlify/lib/name-visits.mts`, `tests/name-visits.test.ts`.

**Interfaces — Produces:** `type Visit = { country: string; source: "name" | "lecture"; ref: string }`; `type DayRecord = { count: number; country: Record<string, number>; source: Record<string, number>; ref: Record<string, number> }`; `visitKey(name, day) -> "v/<name>/<day>"`; `addVisit(rec | null, v) -> DayRecord` (maps capped at 50 keys, overflow into `"other"`); `refDomain(ref) -> string` (host of a URL, `""` for none/invalid, `drawcast.app` referrers → `""`).

- [ ] **Step 1: Failing tests**

```ts
import { describe, expect, it } from "vitest";
import { addVisit, refDomain, visitKey } from "../netlify/lib/name-visits.mts";

describe("name visits", () => {
  it("adds a visit to an empty day", () => {
    expect(addVisit(null, { country: "NO", source: "name", ref: "t.co" })).toEqual({ count: 1, country: { NO: 1 }, source: { name: 1 }, ref: { "t.co": 1 } });
  });
  it("accumulates and leaves an empty referrer out", () => {
    const r = addVisit(addVisit(null, { country: "NO", source: "name", ref: "" }), { country: "SE", source: "lecture", ref: "" });
    expect(r).toEqual({ count: 2, country: { NO: 1, SE: 1 }, source: { name: 1, lecture: 1 }, ref: {} });
  });
  it("caps each map at 50 keys, the rest under 'other'", () => {
    let r = null;
    for (let i = 0; i < 60; i++) r = addVisit(r, { country: `C${i}`, source: "name", ref: "" });
    expect(Object.keys(r!.country).length).toBe(51);
    expect(r!.country.other).toBe(10);
  });
  it("refDomain", () => {
    expect(refDomain("https://www.facebook.com/x?y")).toBe("www.facebook.com");
    expect(refDomain("https://drawcast.app/#x")).toBe("");
    expect(refDomain("nonsense")).toBe("");
    expect(visitKey("qaly", "2026-09-29")).toBe("v/qaly/2026-09-29");
  });
});
```

- [ ] **Step 2–4:** implement; `npx vitest run tests/name-visits.test.ts` → PASS.
- [ ] **Step 5: Commit** — `name-visits: the daily visit record per name (no IP, capped maps)`

### Task 6: `netlify/functions/name.mts` and the client switch

**Files:** Create `netlify/functions/name.mts`, `tests/name-endpoint.test.ts`; modify `src/names.ts` (`resolveName` tries `NAME_ENDPOINTS` then Anvil), `src/viewer.ts` (`runNamed` passes `src` and `ref`), `tests/names.test.ts`.

**Interfaces — Produces:**
- `handleNameRequest(req, deps)` with `NameDeps = { resolve(name) -> Promise<{status, body}>; readDay(key) -> Promise<DayRecord|null>; writeDay(key, rec) -> Promise<void>; country(req) -> string; now() -> number; statsSecret: string; readRange(name, days) -> Promise<Array<{day} & DayRecord>> }`.
- `GET ?n=<name>&src=name|lecture&ref=<url>` → Anvil's answer (status and JSON body passed through), `Access-Control-Allow-Origin: *`, `Cache-Control: no-store`. A 200 records a visit (after the answer is built; a Blobs error is swallowed). Resolution cache: a module-level `Map` (60 s TTL, 500 entries) of 200 answers.
- `GET ?stats=<name>` with header `x-drawcast-stats: <NAME_STATS_SECRET>` → the last 30 days; wrong or missing secret → 403.
- Client: `NAME_ENDPOINTS = ["/.netlify/functions/name", "https://drawcast.app/.netlify/functions/name"]`; `resolveName(api, name, fetchImpl, opts?: {src, ref})` tries them, then `${api}/_/api/name?n=` directly (the fallback when both are down or 404).

- [ ] **Step 1: Failing tests** (fake deps, real `Request`s, as `tests/views-endpoint.test.ts` does): a 200 answer is passed through and recorded once with country/source/ref; a 404 is passed through and not recorded; a `writeDay` throw still answers 200; the second lookup inside 60 s does not call `resolve`; stats with the wrong secret → 403, right secret → the range. In `tests/names.test.ts`: `resolveName` uses the first endpoint that answers; both endpoints failing → the Anvil URL; the query carries `src` and `ref`.
- [ ] **Step 2–4:** implement (default export wires `getStore({ name: "name-visits", consistency: "strong" })`, `context.geo?.country?.code ?? "??"`, `process.env.NAME_STATS_SECRET`); `npm test` → PASS.
- [ ] **Step 5: Commit** — `Name lookups through a Netlify function: 60 s cache, daily visits per name (country, source, referrer); Anvil stays the fallback`

---

## Part C — the app (drawcast, worktree)

### Task 7: `src/registry.ts` and registration after every GitHub publish

**Files:** Create `src/registry.ts`, `tests/registry-client.test.ts`; modify `src/publish/cast.ts` (`CastPublishArgs.extraFiles?: PublishFile[]`, appended to `plan.files`), `src/course/publish.ts` (`PublishArgs.extraFiles?`), `src/main.ts` (`publishDrawcast`), `src/ui/course.ts` (`publish`), `src/store.ts` (`SavedDoc.freeName?: string`).

**Interfaces — Produces:**
- `claimFile(api, token, repo, fetchImpl) -> Promise<PublishFile | null>` — `POST /claim`; `{path: ".drawcast/claim", content: nonce + "\n"}` or null (signed out, error).
- `verifyClaim(api, token, repo, fetchImpl) -> Promise<boolean>`.
- `registerItem(api, reg: {key?, kind, target, title, page?, lectures?}, fetchImpl) -> Promise<{item, name, owner, proven} | "key" | "rate" | "error">`.
- `registryNote(out) -> string` — `" · drawcast.app/#<name>"`, or `" · not registered (server unreachable)"`, or for `owner: "other"` `" · registered to another account — republish while signed in to prove the repo is yours"`.

- [ ] **Step 1: Failing tests** — `claimFile` returns null with no token and never throws on a network error; `registerItem` maps 200/401/429/else; `registryNote` for each outcome; source tests: `publishDrawcast` calls `claimFile(` before `publishCast(` and `registerItem(` after it; `ui/course.ts publish` calls `claimFile(` before `commitPublish(` and `registerItem(` after it, and the status line carries `registryNote(`. Update `tests/names-register.test.ts:43` ("no registerName in cast publish") to also allow `registerItem`.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** — in both flows: `const claim = await claimFile(DEFAULT_ENROLL_API, getToken(), repo, bounded)` (10 s `AbortSignal.timeout` fetch, as the course flow's `bounded`); pass `extraFiles: claim ? [claim] : []`; after the commit: `if (claim) await verifyClaim(...)`; `const reg = await registerItem(DEFAULT_ENROLL_API, { key: getToken() || undefined, kind, target, title, page, lectures }, bounded)`; `doc.freeName = reg.name` when present; append `registryNote(reg)` to the status. Cast target: `${owner}/${repo}/${castsDir}/${slug}.yaml`; course: `courseRegistration(...)`'s `target/page/title/lectures`.
- [ ] **Step 4: Run** `npm test` + `npx tsc --noEmit -p .` → PASS.
- [ ] **Step 5: Commit** — `Every GitHub publish registers with Anvil (claim file first, free name after)`

### Task 8: a course name opens its course page; Join goes to `#<name>&join`

**Files:** Modify `src/viewer.ts` (`runNamed`), `src/course/page.ts` (`courseHref`), `tests/course-door.test.ts`, `tests/course-page.test.ts`, `tests/view-origin.test.ts` if affected.

- `runNamed`: after `namedRoute`, `if (resolved.kind === "course" && resolved.page && !/[#&]join(?:=|&|$)/.test(hash)) { location.replace(resolved.page); return; }`; otherwise the course door as today.
- `courseHref(base, name)` → `` `${base}/#${name}&join` ``.

- [ ] **Step 1: Failing tests** — a course with a page and no `&join` redirects to the page; `#name&join` shows the door; a course without a page shows the door; `coursePage`'s door link ends `#<name>&join`. **Steps 2–4**, `npm test` → PASS. **Step 5: Commit** — `A course name opens its course page; the page's Join goes to #<name>&join`

### Task 9: the free link in the Share panel

**Files:** Modify `src/ui/share.ts` (`ShareDoc.freeName?`; the Pretty link panel shows "Your free link: drawcast.app/#<freeName>" above the buy form when set), `src/main.ts` (pass `freeName`), `tests/course-claim.test.ts` or a new `tests/share-free-name.test.ts`.

- [ ] **Steps 1–5** as usual (a failing test that the hint appears with a `freeName` and not without; no new `input` listener). **Commit** — `Share: show the item's free link`

---

## Part D — the skill (drawcast, worktree)

### Task 10: `push` claims and registers; `cast.mjs register`

**Files:** Modify `scripts/cast-account.mjs` (`registerFor(origin, lib, courseText) -> {kind, target, title, page, lectures}`), `scripts/cast.mjs` (`push`: before committing, when signed in and the repo has no `.drawcast/claim` of ours, add the claim file; after a `--direct` push, `verifyClaim` + `registerItem` and print the free link; a PR push prints "register after the merge: cast.mjs register <workdir>"; new command `register <workdir>`), `tests/cast-account.test.ts`, `.claude/skills/drawcast/SKILL.md` (one line in "Publishing something new": the free link comes back after the push).

- [ ] **Steps 1–5** — `registerFor` tests for a cast and a course (targets and the page URL); `npm test` → PASS; a dry run against `hmelberg/drawcast-skill-test` shows `.drawcast/claim` among the new files. **Commit** — `cast.mjs: push adds the claim file and registers; register <workdir>`

---

## Part E — deploy and live check (Hans's steps marked)

### Task 11: deploy and verify

- [ ] **Hans:** push `registry-1` to drawcast-anvil `master`; in the Anvil editor pull, apply the schema (new columns, `repo_claims`), add the secret `name_stats_secret` (a long random string I generate and show once).
- [ ] **Hans:** in Netlify, add env `NAME_STATS_SECRET` with the same value; merge and push the app branch (deploys the function).
- [ ] Live: publish the test course again from the skill (`push --direct`) → the free link prints; `curl https://drawcast.app/.netlify/functions/name?n=<free name>` answers; open `drawcast.app/#<free name>` twice → the dashboard's Visits shows 2 with a country; `drawcast.app/#skill-publish-test` (a course name) lands on the GitHub course page, and its Join goes to `#skill-publish-test&join`.
