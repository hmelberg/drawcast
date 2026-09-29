# Skill: publish to your GitHub, and buy a pretty name — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The drawcast skill publishes a new drawcast or course from Claude Code to a GitHub repo the user chooses, and can buy and register a `drawcast.app/#<name>` pretty link for it through the Anvil server, with the payment made on Stripe's page.

**Architecture:** Three parts, each shippable alone. **A** (drawcast): a `publish-target` command gives a local workdir an `origin.json` that points at the chosen repo. The existing `push` then writes the files exactly as it does for a revision. **B** (drawcast-anvil): a device sign-in, so a terminal can get a session token. The terminal shows a code, the user types it on drawcast.anvil.app while signed in, and the terminal collects the token. **C** (drawcast): `login` / `logout` / `name` / `name-wait` commands. They call the endpoints that already exist (`/name/check`, `/name`, `/name/pay`, `GET /name`) through `src/names.ts`, open Stripe Checkout in the browser, and poll the registry until the name resolves.

**Tech Stack:** Node ESM scripts run through Vite's SSR loader (`scripts/cast.mjs`), vitest, `gh` CLI; Anvil server Python (pure modules + `api.py`), pytest.

**Spec:** this conversation, 2026-09-29. Facts it rests on, checked in the code:
- `cast.mjs push` already regenerates what the app's publish writes (course page, READMEs, `courses.json` / `casts.json`, end pages). It pushes with `gh auth git-credential`, and `--direct` commits to the default branch.
- Every name is paid (`names.py`: 3-character floor; 20 USD for ≤5 characters, 10 USD for ≤7, 5 USD otherwise). `POST /name` answers 402 for a free name. `POST /name/pay` opens Stripe Checkout, and settlement happens on `/name/paid` and on the webhook.
- `/name/pay` requires `return` to be on `tokens.RETURN_ALLOWLIST` (`https://drawcast.app`, `https://drawcast.netlify.app`). The skill passes `https://drawcast.app/`, and the browser lands on `#paid=<name>`, which the app already reports. **No change to payments is needed.**
- A **cast** name claims nothing: any target is accepted. A **course** name runs `_claim_course(target, …)` first and gets 403 when another author owns the course key. **No new ownership check is needed.**
- The one missing piece is a session token for a terminal. Today it only arrives by redirect to an allowlisted origin, and localhost is deliberately not on the list.

## Global Constraints

- Every command that pays or publishes is run by the skill only after the user says yes in the conversation. `push` without `--dry-run` and `name --buy` are never run speculatively.
- `name --buy` requires `--price <cents>` equal to `priceFor(name)`. The skill must have said the price in the conversation first.
- No card data, Stripe key or GitHub token passes through the skill. GitHub goes through `gh`; payment goes through Stripe's hosted page in the user's browser.
- The session token lives in `~/.config/drawcast/session.json` with mode `0600`, and is never printed or logged.
- The API base is `https://drawcast.anvil.app` (`DEFAULT_ENROLL_API` in `src/learn.ts`), overridable with `DRAWCAST_API`.
- Repos are public. The viewer reads `raw.githubusercontent.com`, and Pages on a private repo needs a paid plan.
- Name rules, prices and registration shapes come from `src/names.ts`, `src/course/publish.ts` and `src/publish/cast.ts`, loaded through `withVite`. They are never copied into the scripts.
- The Anvil repo is `../drawcast-anvil`. Its tests run with `python3 -m pytest -q`. Deploy follows its README: rebase on Anvil's "Edited settings" commit, push once per round to `master`, then pull in the Anvil editor.

## Review Focus

1. **Device-flow phishing.** Someone starts a device sign-in and sends a victim the link. The approve page must never pre-fill the code from the URL. The user types the code shown in their own terminal, and the page says what approving grants. *(Task B3 pins the no-prefill rule in the source test.)*
2. **Payment cancelled or tab closed.** `name-wait` must end with a clear "not paid (yet)" after its timeout, not hang or claim success. A later run must still pick up a payment the webhook settled. *(Task C3 tests the timeout and the late-settle outcome.)*
3. **Name bought, then taken in between** (`#taken=`). This is rare, but `name-wait` must not report success when the name resolves to someone else's target. *(Task C3 tests "resolves, but to another target".)*
4. **First publish into a repo that already has a course or cast with the same slug.** `publish-target` must choose a free slug (`slugFor`) and never overwrite another entry. *(Task A1 tests it.)*
5. **Expired, missing or revoked session token** ("Sign out everywhere" in the dashboard). `name` must say "run `cast.mjs login`", not show a stack trace. *(Task C2 tests the 401 → message path.)*

---

## Part A — publish a new drawcast or course to the user's GitHub (drawcast repo)

### Task 1 (A1): `publishOrigin` — the origin.json of a first publish (pure)

**Files:**
- Modify: `scripts/cast-github.mjs` (add `publishOrigin`, `pagesUrlFor`)
- Modify: `scripts/cast-github.d.mts` (types)
- Test: `tests/cast-github.test.ts`

**Interfaces:**
- Produces: `publishOrigin({ kind, owner, repo, branch, base, clone, viewerBase, dir, slug, takenSlugs, slugFor }) → { origin, slug }`, where `origin` has the same shape `pull` writes (course: `{kind:"course", owner, repo, branch, base, clone, viewerBase, pulled, path, coursesDir, lecture:null}`; cast: `{kind:"cast", …, path, castsDir, file}`) plus `published: "new"`.
- Produces: `pagesUrlFor(owner, repo, path) → "https://<owner>.github.io/<repo>/<path>/"`.

- [ ] **Step 1: Write the failing tests**

```ts
import { pagesUrlFor, publishOrigin } from "../scripts/cast-github.mjs";
import { slugFor } from "../src/publish/github";

describe("publishOrigin (cast.mjs publish-target)", () => {
  const common = { owner: "ann", repo: "casts", branch: "main", base: "abc123", clone: "dev-casts/repos/ann__casts", viewerBase: "https://drawcast.app/", slugFor };

  it("a course goes in <dir>/<slug> with the pull shape", () => {
    const { origin, slug } = publishOrigin({ ...common, kind: "course", dir: "courses", slug: "qaly-basics", takenSlugs: [] });
    expect(slug).toBe("qaly-basics");
    expect(origin).toMatchObject({ kind: "course", owner: "ann", repo: "casts", branch: "main", base: "abc123", path: "courses/qaly-basics", coursesDir: "courses", lecture: null, published: "new" });
  });

  it("a course at the repo root has no leading slash", () => {
    expect(publishOrigin({ ...common, kind: "course", dir: "", slug: "q", takenSlugs: [] }).origin.path).toBe("q");
  });

  it("a slug already in the repo gets a fresh one — never overwrites", () => {
    const { slug, origin } = publishOrigin({ ...common, kind: "course", dir: "", slug: "qaly-basics", takenSlugs: ["qaly-basics"] });
    expect(slug).not.toBe("qaly-basics");
    expect(origin.path).toBe(slug);
  });

  it("a cast goes in <dir>/casts/<slug>.yaml", () => {
    const { origin } = publishOrigin({ ...common, kind: "cast", dir: "", slug: "twenty-players", takenSlugs: [] });
    expect(origin).toMatchObject({ kind: "cast", path: "casts/twenty-players.yaml", castsDir: "casts", file: "twenty-players.yaml" });
  });

  it("pagesUrlFor", () => {
    expect(pagesUrlFor("ann", "casts", "courses/q")).toBe("https://ann.github.io/casts/courses/q/");
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run tests/cast-github.test.ts`
Expected: FAIL, `publishOrigin is not a function`.

- [ ] **Step 3: Implement**

```js
const join = (...p) => p.filter(Boolean).join("/");

/** The origin.json of a FIRST publish (cast.mjs publish-target): the shape
 *  pull writes, so push treats it like any revision. A slug already in the
 *  repo is never reused — slugFor picks a free one. */
export function publishOrigin({ kind, owner, repo, branch, base, clone, viewerBase, dir, slug, takenSlugs, slugFor }) {
  const free = takenSlugs.includes(slug) ? slugFor(slug, new Set(takenSlugs)) : slug;
  const common = { owner, repo, branch, base, clone, viewerBase, pulled: new Date().toISOString(), published: "new" };
  if (kind === "course") return { slug: free, origin: { kind, ...common, path: join(dir, free), coursesDir: dir, lecture: null } };
  const castsDir = join(dir, "casts");
  const file = `${free}.yaml`;
  return { slug: free, origin: { kind, ...common, path: join(castsDir, file), castsDir, file } };
}

export function pagesUrlFor(owner, repo, path) {
  return `https://${owner}.github.io/${repo}/${path ? `${path}/` : ""}`;
}
```

Add the matching declarations to `scripts/cast-github.d.mts`.

- [ ] **Step 4: Run to verify they pass**

Run: `npx vitest run tests/cast-github.test.ts` → PASS.

- [ ] **Step 5: Commit** — `git commit -m "cast.mjs: publishOrigin — the origin.json of a first publish"`

### Task 2 (A2): `cast.mjs publish-target <workdir> <owner/repo> [--dir d] [--create]`

**Files:**
- Modify: `scripts/cast.mjs`: extract `ensureClone(owner, repo, branch, folders)` from `pull` (lines ~409–427) and use it in both commands. Add a `"publish-target"` command. Update the usage comment at the top.

**Interfaces:**
- Consumes: `publishOrigin`, `pagesUrlFor` (A1); `slugify`, `slugFor`, `parseManifest` (`/src/publish/github.ts`); `parseCastIndex` (`/src/publish/cast.ts`); `parseCourse`, `setCourseOption` (`/src/course/document.ts`).
- Produces: `<workdir>/origin.json` that `push` accepts unchanged; a course workdir's `course.md` gets `slug: <slug>`.

- [ ] **Step 1: Extract `ensureClone`**

```js
/** A sparse, blob-less clone of owner/repo@branch under dev-casts/repos/, fresh from origin,
 *  with `folders` checked out; returns { clone, base }. */
function ensureClone(owner, repo, branch, folders) {
  const clone = resolve(ROOT, "dev-casts/repos", `${owner}__${repo}`);
  if (!existsSync(clone)) {
    mkdirSync(resolve(ROOT, "dev-casts/repos"), { recursive: true });
    sh("git", ["clone", "--quiet", "--filter=blob:none", "--sparse", "--depth", "1", "--branch", branch, `https://github.com/${owner}/${repo}.git`, clone]);
  } else {
    sh("git", ["-C", clone, "fetch", "--quiet", "--depth", "1", "origin", branch]);
    sh("git", ["-C", clone, "checkout", "--quiet", "--force", "-B", branch, "FETCH_HEAD"]);
  }
  const dirs = new Set(sh("git", ["-C", clone, "sparse-checkout", "list"]).split("\n").filter(Boolean));
  for (const f of folders) if (f) dirs.add(f);
  if (dirs.size) sh("git", ["-C", clone, "sparse-checkout", "set", ...dirs]);
  return { clone, base: sh("git", ["-C", clone, "rev-parse", "HEAD"]) };
}
```

Replace the matching block in `pull` with `const { clone, base } = ensureClone(t.owner, t.repo, branch, [folder]);`. Run `npx vitest run tests/cast-github.test.ts`. Then run `node scripts/cast.mjs pull https://github.com/hmelberg/dcast/tree/main/understanding-the-qaly dev-casts/_pull-check --force` and confirm it still prints the lecture list. Delete `dev-casts/_pull-check`.

- [ ] **Step 2: The command**

```js
  async "publish-target"(args) {
    const flag = (n) => (args.includes(n) ? args[args.indexOf(n) + 1] : undefined);
    const [work, target] = args.filter((a, i) => !a.startsWith("-") && args[i - 1] !== "--dir");
    if (!work || !target) throw new Error("usage: cast.mjs publish-target <workdir> <owner/repo> [--dir <folder>] [--create]");
    const wd = resolve(ROOT, work);
    if (existsSync(resolve(wd, "origin.json"))) throw new Error(`${work} already has an origin.json — it is published; use push`);
    const [owner, repo] = target.split("/");
    const me = sh("gh", ["api", "user", "--jq", ".login"]);
    let info = spawnSync("gh", ["api", `repos/${owner}/${repo}`], { encoding: "utf8" });
    if (info.status !== 0) {
      if (!args.includes("--create")) throw new Error(`${owner}/${repo} does not exist (signed in to gh as ${me}) — pass --create to make it, public`);
      sh("gh", ["repo", "create", `${owner}/${repo}`, "--public", "--add-readme", "-d", "Drawcasts"]);
      info = spawnSync("gh", ["api", `repos/${owner}/${repo}`], { encoding: "utf8" });
    }
    const meta = JSON.parse(info.stdout);
    if (meta.private) throw new Error(`${owner}/${repo} is private — the player cannot read it; choose a public repo`);
    if (!meta.permissions?.push) throw new Error(`${me} cannot push to ${owner}/${repo}`);
    const branch = meta.default_branch;
    // Pages from the default branch's root; 409 = already on.
    const pages = spawnSync("gh", ["api", "-X", "POST", `repos/${owner}/${repo}/pages`, "-f", `source[branch]=${branch}`, "-f", "source[path]=/"], { encoding: "utf8" });
    if (pages.status !== 0 && !/409|already/i.test(pages.stderr + pages.stdout)) console.log(`(GitHub Pages not switched on: ${pages.stderr.trim()} — the #gh= player link works without it)`);

    const dir = flag("--dir") ?? "";
    const isCourse = existsSync(resolve(wd, "course.md"));
    const { clone, base } = ensureClone(owner, repo, branch, [dir, isCourse ? "" : joinRepo(dir, "casts")]);
    await withVite(async (load) => {
      const { slugify, slugFor, parseManifest } = await load("/src/publish/github.ts");
      const { parseCastIndex } = await load("/src/publish/cast.ts");
      const { parseCourse, setCourseOption } = await load("/src/course/document.ts");
      const viewerBase = findViewerBase(clone, dir);
      if (isCourse) {
        let text = readFileSync(resolve(wd, "course.md"), "utf8");
        const course = parseCourse(text);
        const manifest = readAtCommit(clone, base, joinRepo(dir, "courses.json"));
        const taken = manifest ? parseManifest(manifest).courses.map((c) => c.slug) : [];
        const { origin, slug } = publishOrigin({ kind: "course", owner, repo, branch, base, clone: relative(ROOT, clone), viewerBase, dir, slug: course.context.slug ?? slugify(course.title || basename(wd)), takenSlugs: taken, slugFor });
        if (course.context.slug !== slug) writeFileSync(resolve(wd, "course.md"), setCourseOption(text, "slug", slug));
        writeFileSync(resolve(wd, "origin.json"), JSON.stringify(origin, null, 1) + "\n");
        console.log(`${work} → ${owner}/${repo}/${origin.path} (as ${me}). Page after push: ${pagesUrlFor(owner, repo, origin.path)}\nNext: cast.mjs push ${work} --dry-run`);
        return;
      }
      const yamls = readdirSync(wd).filter((f) => /\.ya?ml$/i.test(f));
      if (yamls.length !== 1) throw new Error(`${work} must hold exactly one .yaml (it holds ${yamls.length})`);
      const index = readAtCommit(clone, base, joinRepo(dir, "casts", "casts.json"));
      const taken = index ? parseCastIndex(index).casts.map((c) => c.slug) : [];
      const { origin } = publishOrigin({ kind: "cast", owner, repo, branch, base, clone: relative(ROOT, clone), viewerBase, dir, slug: slugify(yamls[0].replace(/\.ya?ml$/i, "")), takenSlugs: taken, slugFor });
      if (origin.file !== yamls[0]) writeFileSync(resolve(wd, origin.file), readFileSync(resolve(wd, yamls[0])));
      writeFileSync(resolve(wd, "origin.json"), JSON.stringify(origin, null, 1) + "\n");
      console.log(`${work} → ${owner}/${repo}/${origin.path} (as ${me}). Player after push: ${viewerBase}#gh=${owner}/${repo}/${origin.path}\nNext: cast.mjs push ${work} --dry-run`);
    });
  },
```

Check that `parseManifest(...).courses[i].slug` and `parseCastIndex(...).casts[i].slug` are the field names (`src/publish/github.ts:224`, `src/publish/cast.ts:41`), and adjust if they differ.

- [ ] **Step 3: Verify end to end on a scratch repo (ask Hans first: this creates a public repo)**

```bash
node scripts/cast.mjs publish-target dev-casts/courses/<an existing built course> hmelberg/drawcast-skill-test --create
node scripts/cast.mjs push dev-casts/courses/<same> --dry-run     # lists new files only
node scripts/cast.mjs push dev-casts/courses/<same> --direct -m "drawcast: publish course"
```

Expected: the course page, README, `courses.json` and lecture YAMLs are on `main`. `https://drawcast.app/#gh=hmelberg/drawcast-skill-test/<slug>/<first lecture>.yaml` plays, and after a minute or two the Pages URL shows the course page. Repeat with one cast workdir, then delete the scratch repo (`gh repo delete`, after asking).

- [ ] **Step 4: Commit** — `git commit -m "cast.mjs publish-target: a new cast or course gets an origin in the user's repo; push publishes it"`

### Task 3 (A3): SKILL.md — "Publishing something new"

**Files:** Modify `.claude/skills/drawcast/SKILL.md`: add a section after "Revising what is published".

- [ ] **Step 1: Write the section**

```markdown
## Publishing something new (to a GitHub repo of the user's)

1. **Which account and repo.** `gh api user --jq .login` names the account gh is signed in
   as; say it and ask which repo (an existing public one, or a new one) and folder. If gh is
   not signed in, ask the user to run `! gh auth login`.
2. `node scripts/cast.mjs publish-target <workdir> <owner/repo> [--dir <folder>] [--create]`
   — `--create` only when the user said to make the repo. It turns Pages on and picks a slug
   no other cast or course in the repo has.
3. `push <workdir> --dry-run`, show the file list, and on a yes `push <workdir> --direct`
   (it is the user's own repo; a PR to yourself is noise). Later revisions: the normal
   revise flow on the same workdir.
4. Report the player link (`drawcast.app/#gh=…`) and the course page (Pages can take a
   minute the first time). Narration is the browser's voice until the course is published
   with narration from the app.
```

- [ ] **Step 2: Commit** — `git commit -m "drawcast skill: publishing something new"`

---

## Part B — device sign-in on the Anvil server (drawcast-anvil repo)

### Task 4 (B1): `device.py` — the rules (pure)

**Files:**
- Create: `server_code/device.py`
- Test: `tests/test_device.py`

**Interfaces:**
- Produces: `DEVICE_TTL_S = 600`, `POLL_INTERVAL_S = 5`, `ALPHABET`, `make_user_code(choice=secrets.choice) -> "XXXX-XXXX"`, `normalize_user_code(raw) -> "XXXX-XXXX" | None`, `is_live(created, now) -> bool`, `poll_verdict(row, now) -> "unknown"|"expired"|"pending"|"approved"|"denied"` (`row` is `{"created", "state"}` or `None`).

- [ ] **Step 1: Failing tests**

```python
import device


def test_user_code_shape_and_alphabet():
    code = device.make_user_code()
    assert len(code) == 9 and code[4] == "-"
    assert all(c in device.ALPHABET for c in code.replace("-", ""))


def test_alphabet_has_no_vowels_or_lookalikes():
    for c in "AEIOUY01":
        assert c not in device.ALPHABET


def test_normalize_accepts_what_people_type():
    assert device.normalize_user_code(" bcdf-ghjk ") == "BCDF-GHJK"
    assert device.normalize_user_code("bcdfghjk") == "BCDF-GHJK"


def test_normalize_refuses_the_rest():
    for raw in (None, 12, "", "BCDF-GHJ", "BCDF-GHJKL", "ABCD-EFGH", "BCDF_GH!K"):
        assert device.normalize_user_code(raw) is None


def test_poll_verdicts():
    now = 10_000
    assert device.poll_verdict(None, now) == "unknown"
    assert device.poll_verdict({"created": now - device.DEVICE_TTL_S, "state": "approved"}, now) == "expired"
    for state in ("pending", "approved", "denied"):
        assert device.poll_verdict({"created": now - 1, "state": state}, now) == state
```

- [ ] **Step 2: Run** `python3 -m pytest -q tests/test_device.py` → FAIL (no module).

- [ ] **Step 3: Implement**

```python
"""Device sign-in (skill round, 2026-09-29). A terminal — the drawcast skill
in Claude Code — gets a session token without a redirect to it: it shows a
short code, the person types it on drawcast.anvil.app while signed in, and
the terminal's poll collects the token. RFC 8628's shape, minus the
pre-filled link: the code is typed, never carried in the URL, so a link
someone else sent cannot approve their terminal with one click. Pure."""
import secrets

DEVICE_TTL_S = 600
POLL_INTERVAL_S = 5
ALPHABET = "BCDFGHJKLMNPQRSTVWXZ"  # no vowels (no words), no 0/O/1/I
CODE_LEN = 8


def make_user_code(choice=secrets.choice):
    raw = "".join(choice(ALPHABET) for _ in range(CODE_LEN))
    return raw[:4] + "-" + raw[4:]


def normalize_user_code(raw):
    if not isinstance(raw, str):
        return None
    s = raw.strip().upper().replace("-", "")
    if len(s) != CODE_LEN or any(c not in ALPHABET for c in s):
        return None
    return s[:4] + "-" + s[4:]


def is_live(created, now):
    return now - created < DEVICE_TTL_S


def poll_verdict(row, now):
    if row is None:
        return "unknown"
    if not is_live(row["created"], now):
        return "expired"
    return row["state"]
```

- [ ] **Step 4: Run** → PASS. **Step 5: Commit** — `git commit -m "device.py: device sign-in rules"`

### Task 5 (B2): table, endpoints and callables

**Files:**
- Modify: `anvil.yaml` (new table `device_codes`)
- Modify: `server_code/limits.py` (`"device": 20`, `"device_poll": 400`)
- Modify: `server_code/api.py` (`import device`; `/device/start`, `/device/poll`; callables `device_request`, `approve_device`)
- Test: `tests/test_schema.py`, `tests/test_limits.py`, `tests/test_api_source.py`

**Interfaces:**
- Produces HTTP: `POST /_/api/device/start {label}` → `200 {device, code, verify, interval, expires_in}`. `POST /_/api/device/poll {device}` → `202 {state:"pending"}` | `200 {key, email}` | `400 {error:"expired"|"denied"|"unknown"}` | `429`.
- Produces callables: `device_request(code) -> {"label", "age_s"} | None`, `approve_device(code, allow) -> "approved"|"denied"|"unknown"|"signed-out"`.

- [ ] **Step 1: Failing tests**

In `tests/test_schema.py`:

```python
def test_device_codes_table():
    cols = columns("device_codes")
    for name in ("device", "code", "label", "state", "user", "created"):
        assert name in cols, name
    assert cols["user"]["target"] == "users"
    assert load()["db_schema"]["device_codes"]["client"] == "none"
```

In `tests/test_limits.py`:

```python
def test_device_buckets():
    assert limits.BUDGETS["device"] == 20
    assert limits.BUDGETS["device_poll"] >= device.DEVICE_TTL_S // device.POLL_INTERVAL_S * 2
```

(add `import device` at the top). In `tests/test_api_source.py`, follow that file's existing way of reading `api.py` source:

```python
def test_device_poll_spends_in_a_transaction_and_mints_a_session():
    src = API  # the file's existing api.py source string
    assert "@anvil.tables.in_transaction\ndef _spend_device(" in src
    assert '"/device/start"' in src and '"/device/poll"' in src
    body = src.split("def http_device_poll(", 1)[1].split("\n@", 1)[0]
    assert 'kind="session"' in body
```

- [ ] **Step 2: Run** `python3 -m pytest -q` → the new tests FAIL.

- [ ] **Step 3: Implement**

`anvil.yaml`: add under `db_schema` (same style as `tokens`):

```yaml
  device_codes:
    client: none
    columns:
    - {admin_ui: {}, client_hidden: null, name: device, type: string}
    - {admin_ui: {}, client_hidden: null, name: code, type: string}
    - {admin_ui: {}, client_hidden: null, name: label, type: string}
    - {admin_ui: {}, client_hidden: null, name: state, type: string}
    - {admin_ui: {}, client_hidden: null, name: user, target: users, type: link_single}
    - {admin_ui: {}, client_hidden: null, name: created, type: number}
    indexes: []
    server: full
    title: device_codes
```

(Write it in the block style the file already uses.) `limits.py` `BUDGETS`: add

```python
    # Device sign-in (skill round, 2026-09-29): starting one, and the
    # terminal's poll every POLL_INTERVAL_S for up to DEVICE_TTL_S.
    "device": 20,
    "device_poll": 400,
```

`api.py`, after `http_signout`:

```python
# --- device sign-in (skill round, 2026-09-29) ---------------------------------

@anvil.server.http_endpoint("/device/start", methods=["POST"], **ENDPOINT)
def http_device_start(**params):
    """A terminal asks to sign in. `device` is its secret to poll with and
    is never shown to a person; `code` is what the person types on the
    approve page. The verify URL deliberately carries no code."""
    if not _allowed("device"):
        return json_response({"error": "rate"}, 429)
    body = load_body()
    label = body.get("label") if isinstance(body, dict) else None
    label = label.strip()[:60] if isinstance(label, str) and label.strip() else "A terminal"
    secret = tokens.make_secret()
    code = device.make_user_code()
    app_tables.device_codes.add_row(device=secret, code=code, label=label, state="pending", user=None, created=time.time())
    return json_response({"device": secret, "code": code, "verify": "%s/#device" % anvil.server.get_app_origin(),
                          "interval": device.POLL_INTERVAL_S, "expires_in": device.DEVICE_TTL_S})


@anvil.tables.in_transaction
def _spend_device(secret, now):
    """Look up, judge and (when final) delete in ONE transaction, like
    _spend_once: an approved row yields its user exactly once."""
    row = next(iter(app_tables.device_codes.search(device=secret)), None)
    verdict = device.poll_verdict(None if row is None else {"created": row["created"], "state": row["state"]}, now)
    if verdict in ("expired", "denied"):
        row.delete()
        return verdict, None, None
    if verdict != "approved":
        return verdict, None, None
    user, label = row["user"], row["label"]
    row.delete()
    return verdict, user, label


@anvil.server.http_endpoint("/device/poll", methods=["POST"], **ENDPOINT)
def http_device_poll(**params):
    if not _allowed("device_poll"):
        return json_response({"error": "rate"}, 429)
    body = load_body()
    secret = body.get("device") if isinstance(body, dict) else None
    if not isinstance(secret, str) or not secret:
        return json_response({"error": "unknown"}, 400)
    verdict, user, label = _spend_device(secret, time.time())
    if verdict == "pending":
        return json_response({"state": "pending"}, 202)
    if verdict != "approved" or user is None or not user["enabled"]:
        return json_response({"error": verdict if verdict != "approved" else "denied"}, 400)
    key = tokens.make_secret()
    app_tables.tokens.add_row(secret=key, user=user, kind="session", created=time.time(), last_used=utcnow(), label=label)
    return json_response({"key": key, "email": user["email"]})


def _live_device_row(code):
    code = device.normalize_user_code(code)
    if code is None:
        return None
    now = time.time()
    return next((r for r in app_tables.device_codes.search(code=code, state="pending") if device.is_live(r["created"], now)), None)


@anvil.server.callable
def device_request(code):
    """What the approve page shows before the click: the terminal's label
    and how long ago it asked. None for a code that is not waiting."""
    if anvil.users.get_user() is None:
        return None
    row = _live_device_row(code)
    return None if row is None else {"label": row["label"], "age_s": int(time.time() - row["created"])}


@anvil.server.callable
def approve_device(code, allow):
    user = anvil.users.get_user()
    if user is None or not user["enabled"]:
        return "signed-out"
    row = _live_device_row(code)
    if row is None:
        return "unknown"
    row.update(state="approved" if allow else "denied", user=user if allow else None)
    return "approved" if allow else "denied"
```

The new session token appears under "Signed-in browsers" with its label, and "Sign out everywhere" revokes it. That is the existing dashboard, so nothing more is needed there.

- [ ] **Step 4: Run** `python3 -m pytest -q` → all PASS.
- [ ] **Step 5: Commit** — `git commit -m "Device sign-in: /device/start, /device/poll, approve_device — a terminal gets a session token"`

### Task 6 (B3): the approve page

**Files:**
- Create: `client_code/DeviceApprove/__init__.py`, `client_code/DeviceApprove/form_template.html`
- Modify: `client_code/Form1/__init__.py` (route `#device` after the signed-out check)
- Test: `tests/test_signin_source.py`

- [ ] **Step 1: Failing tests** (append to `tests/test_signin_source.py`)

```python
DEVICE = (CLIENT / "DeviceApprove" / "__init__.py").read_text(encoding="utf-8")
DEVICE_T = (CLIENT / "DeviceApprove" / "form_template.html").read_text(encoding="utf-8")


def test_device_page_components_exist():
    named = set(re.findall(r'name="(\w+)"', DEVICE_T))
    for ref in set(re.findall(r"self\.(\w+)\.", DEVICE)):
        assert ref in named, ref


def test_device_code_is_typed_never_read_from_the_url():
    # The phishing guard: a link someone sent must not arrive pre-filled.
    assert "location.hash" not in DEVICE and "get_url_hash" not in DEVICE


def test_device_route_comes_after_the_signed_out_check():
    signed_out = FORM1.index("if anvil.users.get_user() is None:")
    route = FORM1.index('raw.startswith("#device")')
    assert route > signed_out
```

- [ ] **Step 2: Run** → FAIL.

- [ ] **Step 3: Implement**

`form_template.html`:

```html
<anvil-form layout="drawcast.Layouts.BaseLayout">
    <anvil-block slot="title">
        <anvil-component type="Label" name="label_title" prop:role="h1" prop:text="Sign in a terminal"></anvil-component>
    </anvil-block>
    <anvil-block slot="content">
        <anvil-component type="ColumnPanel" name="panel_code" prop:role="card">
            <anvil-component type="Label" name="label_intro" prop:text="Type the code your terminal shows. Only do this if you started it yourself, just now: approving lets that terminal publish and buy names as you."></anvil-component>
            <anvil-component type="TextBox" name="box_code" prop:placeholder="XXXX-XXXX"></anvil-component>
            <anvil-component type="Button" name="button_look" prop:text="Continue"></anvil-component>
        </anvil-component>
        <anvil-component type="ColumnPanel" name="panel_confirm" prop:role="card">
            <anvil-component type="Label" name="label_what" prop:text=""></anvil-component>
            <anvil-component type="Button" name="button_allow" prop:text="Allow"></anvil-component>
            <anvil-component type="Button" name="button_deny" prop:text="Deny" prop:role="secondary-button"></anvil-component>
        </anvil-component>
        <anvil-component type="Label" name="label_status" prop:text=""></anvil-component>
    </anvil-block>
</anvil-form>
```

`__init__.py`:

```python
from ._anvil_designer import DeviceApproveTemplate
from anvil import *
import anvil.server
import anvil.users


class DeviceApprove(DeviceApproveTemplate):
    """#device: a terminal (the drawcast skill) asks to sign in as the
    person on this page. The code is TYPED — never read from the address —
    so a link someone else sent cannot approve their terminal in one click."""

    def __init__(self, **properties):
        super().__init__(**properties)
        self.panel_confirm.visible = False
        self.button_look.set_event_handler("click", self._look)
        self.box_code.set_event_handler("pressed_enter", self._look)
        self.button_allow.set_event_handler("click", lambda **e: self._answer(True))
        self.button_deny.set_event_handler("click", lambda **e: self._answer(False))

    def _look(self, **event_args):
        req = anvil.server.call("device_request", self.box_code.text or "")
        if req is None:
            self.label_status.text = "No terminal is waiting with that code (they last ten minutes)."
            return
        email = anvil.users.get_user()["email"] or ""
        self.label_what.text = "“%s” asked %d seconds ago to sign in as %s." % (req["label"], req["age_s"], email)
        self.panel_code.visible = False
        self.panel_confirm.visible = True
        self.label_status.text = ""

    def _answer(self, allow):
        verdict = anvil.server.call("approve_device", self.box_code.text or "", allow)
        self.panel_confirm.visible = False
        self.label_status.text = {
            "approved": "Done — go back to the terminal. You can sign it out under Signed-in browsers.",
            "denied": "Denied. The terminal was not signed in.",
        }.get(verdict, "That code is no longer waiting — start again in the terminal.")
```

`Form1/__init__.py`, right after the `if anvil.users.get_user() is None: open_form("SignIn"); return` block:

```python
        if raw.startswith("#device"):
            open_form("DeviceApprove")
            return
```

(A signed-out visitor goes through SignIn, whose dashboard branch ends in `open_form("Form1")` with the hash intact, so this line is reached after sign-in.)

- [ ] **Step 4: Run** `python3 -m pytest -q` → PASS.
- [ ] **Step 5: Commit** — `git commit -m "DeviceApprove: #device, the code typed, Allow/Deny"`

### Task 7 (B4): deploy and live smoke

- [ ] **Step 1:** Follow the README's deploy: `git fetch && git rebase origin/master`, then `git push origin HEAD:master`. Open the app in the Anvil editor, pull from git, and apply the `device_codes` schema when Anvil asks. **Ask Hans before the push.** It changes the live server.
- [ ] **Step 2: Smoke**

```bash
API=https://drawcast.anvil.app/_/api
curl -s -X POST -H 'content-type: text/plain' -d '{"label":"smoke"}' $API/device/start       # → {device, code, verify, …}
curl -s -o /dev/null -w '%{http_code}\n' -X POST -H 'content-type: text/plain' -d '{"device":"<device>"}' $API/device/poll   # → 202
# open https://drawcast.anvil.app/#device, type the code, Allow
curl -s -X POST -H 'content-type: text/plain' -d '{"device":"<device>"}' $API/device/poll   # → {key, email}
curl -s -X POST -H 'content-type: text/plain' -d '{"device":"<device>"}' $API/device/poll   # → 400 unknown (spent)
curl -s -X POST -H 'content-type: text/plain' -d '{"key":"<key>"}' $API/signout             # clean up
```

Expected as commented. Also check that Deny gives `400 denied` on the next poll.

---

## Part C — sign-in and names from the skill (drawcast repo; needs B deployed)

### Task 8 (C1): `scripts/cast-account.mjs` — session file and device login

**Files:**
- Create: `scripts/cast-account.mjs`, `scripts/cast-account.d.mts`
- Modify: `scripts/cast.mjs` (commands `login`, `logout`)
- Test: `tests/cast-account.test.ts`

**Interfaces:**
- Produces: `apiUrl() -> string` (`DRAWCAST_API` or `https://drawcast.anvil.app`), `sessionPath(home) -> string`, `readSession(home) -> {api, key, email} | null`, `writeSession(home, s)` (mode 0600), `clearSession(home)`, `deviceLogin({api, label, fetchImpl, sleep, say}) -> {key, email}` (throws `Error("expired"|"denied"|…)`).

- [ ] **Step 1: Failing tests**

```ts
import { mkdtempSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { clearSession, deviceLogin, readSession, writeSession } from "../scripts/cast-account.mjs";

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });

describe("session file", () => {
  it("round-trips, private, and clears", () => {
    const home = mkdtempSync(join(tmpdir(), "dc-"));
    expect(readSession(home)).toBeNull();
    writeSession(home, { api: "https://x", key: "k", email: "a@b" });
    expect(readSession(home)).toEqual({ api: "https://x", key: "k", email: "a@b" });
    expect(statSync(join(home, ".config/drawcast/session.json")).mode & 0o077).toBe(0);
    clearSession(home);
    expect(readSession(home)).toBeNull();
  });
});

describe("deviceLogin", () => {
  it("shows the code, polls through pending, returns the key", async () => {
    const said: string[] = [];
    const answers = [json(200, { device: "d", code: "BCDF-GHJK", verify: "https://x/#device", interval: 5, expires_in: 600 }), json(202, { state: "pending" }), json(200, { key: "K", email: "a@b" })];
    const out = await deviceLogin({ api: "https://x", label: "t", fetchImpl: async () => answers.shift()!, sleep: async () => {}, say: (s: string) => said.push(s) });
    expect(out).toEqual({ key: "K", email: "a@b" });
    expect(said.join("\n")).toMatch(/BCDF-GHJK/);
    expect(said.join("\n")).toMatch(/https:\/\/x\/#device/);
  });

  it("a denial is an error, not a hang", async () => {
    const answers = [json(200, { device: "d", code: "BCDF-GHJK", verify: "v", interval: 5, expires_in: 600 }), json(400, { error: "denied" })];
    await expect(deviceLogin({ api: "https://x", label: "t", fetchImpl: async () => answers.shift()!, sleep: async () => {}, say: () => {} })).rejects.toThrow(/denied/);
  });
});
```

- [ ] **Step 2: Run** `npx vitest run tests/cast-account.test.ts` → FAIL.

- [ ] **Step 3: Implement**

```js
// The skill's drawcast account: a session token from the device sign-in
// (drawcast-anvil's /device/start + /device/poll), kept in
// ~/.config/drawcast/session.json, readable by the user only.
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const apiUrl = () => (process.env.DRAWCAST_API || "https://drawcast.anvil.app").replace(/\/+$/, "");
export const sessionPath = (home) => join(home, ".config/drawcast/session.json");

export function readSession(home) {
  const f = sessionPath(home);
  if (!existsSync(f)) return null;
  try {
    const s = JSON.parse(readFileSync(f, "utf8"));
    return typeof s.key === "string" ? { api: s.api, key: s.key, email: s.email ?? null } : null;
  } catch {
    return null;
  }
}

export function writeSession(home, s) {
  const f = sessionPath(home);
  mkdirSync(join(home, ".config/drawcast"), { recursive: true, mode: 0o700 });
  writeFileSync(f, JSON.stringify(s) + "\n", { mode: 0o600 });
  chmodSync(f, 0o600);
}

export function clearSession(home) {
  rmSync(sessionPath(home), { force: true });
}

const post = (fetchImpl, url, body) => fetchImpl(url, { method: "POST", headers: { "content-type": "text/plain" }, body: JSON.stringify(body) });

export async function deviceLogin({ api, label, fetchImpl = fetch, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), say = console.log }) {
  const start = await post(fetchImpl, `${api}/_/api/device/start`, { label });
  if (!start.ok) throw new Error(start.status === 429 ? "rate" : "unreachable");
  const { device, code, verify, interval, expires_in } = await start.json();
  say(`Open ${verify} (sign in if asked) and type this code: ${code}\nWaiting up to ${Math.round(expires_in / 60)} minutes…`);
  for (let waited = 0; waited <= expires_in; waited += interval) {
    await sleep(interval * 1000);
    const r = await post(fetchImpl, `${api}/_/api/device/poll`, { device });
    if (r.status === 202) continue;
    const body = await r.json().catch(() => ({}));
    if (r.ok && typeof body.key === "string") return { key: body.key, email: body.email ?? null };
    throw new Error(body.error || `poll ${r.status}`);
  }
  throw new Error("expired");
}
```

In `cast.mjs` (import `homedir` from `node:os`, `hostname` from `node:os`):

```js
  async login() {
    const api = apiUrl();
    const { key, email } = await deviceLogin({ api, label: `Claude Code on ${hostname()}` });
    writeSession(homedir(), { api, key, email });
    console.log(`Signed in to ${api} as ${email}. Sign this terminal out with cast.mjs logout, or under Signed-in browsers on your account page.`);
  },

  async logout() {
    const s = readSession(homedir());
    if (s) await fetch(`${s.api}/_/api/signout`, { method: "POST", headers: { "content-type": "text/plain" }, body: JSON.stringify({ key: s.key }) }).catch(() => {});
    clearSession(homedir());
    console.log("Signed out.");
  },
```

- [ ] **Step 4: Run** → PASS. Then run `node scripts/cast.mjs login` live, approve on `#device`, and check `ls -l ~/.config/drawcast/session.json` shows `-rw-------`.
- [ ] **Step 5: Commit** — `git commit -m "cast.mjs login/logout: the device sign-in, a private session file"`

### Task 9 (C2): `cast.mjs name <workdir> <name> [--buy --price <cents>]`

**Files:**
- Modify: `scripts/cast-account.mjs` (add `registrationFor`, `nameAdvice`)
- Modify: `scripts/cast.mjs` (command `name`)
- Test: `tests/cast-account.test.ts`

**Interfaces:**
- Consumes: `readSession` (C1); from `/src/names.ts`: `normalizeName`, `isPayable`, `priceFor`, `formatPrice`, `checkPaidName`, `registerName`, `startNamePayment`; from `/src/course/publish.ts`: `courseRegistration`; `/src/publish/cast.ts`: `castRegistration`; `/src/course/document.ts`: `parseCourse`, `setCourseOption`.
- Produces: `registrationFor(origin, name, lib, courseText?) -> Omit<Registration,"key">`; `nameAdvice(state, name, price) -> string`; `origin.json` gains `pendingName: {name, target, started}` after `--buy`.

- [ ] **Step 1: Failing tests**

```ts
import { nameAdvice, registrationFor } from "../scripts/cast-account.mjs";
import * as coursePub from "../src/course/publish";
import * as castPub from "../src/publish/cast";
import { parseCourse } from "../src/course/document";

const lib = { courseRegistration: coursePub.courseRegistration, castRegistration: castPub.castRegistration, parseCourse };

describe("registrationFor", () => {
  it("a cast: its GitHub file, under the chosen name", () => {
    const origin = { kind: "cast", owner: "ann", repo: "casts", path: "casts/qaly.yaml", castsDir: "casts", file: "qaly.yaml" };
    expect(registrationFor(origin, "qaly", lib)).toMatchObject({ name: "qaly", kind: "cast", target: "ann/casts/casts/qaly.yaml" });
  });

  it("a course: the course key, page and lectures, under the chosen name", () => {
    const text = "# QALYs\nslug: qalys\n\n---\n## One\nWhy?\nstatus: done · file: 01-one.yaml\n";
    const origin = { kind: "course", owner: "ann", repo: "casts", path: "qalys", coursesDir: "" };
    const reg = registrationFor(origin, "qaly", lib, text);
    expect(reg).toMatchObject({ name: "qaly", kind: "course", target: "ann/casts/qalys", page: "https://ann.github.io/casts/qalys/" });
    expect(reg.lectures).toEqual(["ann/casts/qalys/01-one.yaml"]);
  });
});

describe("nameAdvice", () => {
  it("says the price for a free name and how to buy", () => {
    expect(nameAdvice("free", "qaly", 2000)).toMatch(/20 USD.*--buy --price 2000/);
  });
  it("says what to do when not signed in", () => {
    expect(nameAdvice("key", "qaly", 2000)).toMatch(/cast\.mjs login/);
  });
});
```

(Check the `status:` line format against `src/course/document.ts` before relying on this fixture. If it differs, copy a real line from a built `course.md` in `dev-casts/courses/`.)

- [ ] **Step 2: Run** → FAIL.

- [ ] **Step 3: Implement** (in `cast-account.mjs`)

```js
import { pagesUrlFor } from "./cast-github.mjs";

/** What POST /name and /name/pay are sent for this workdir's published copy, under `name`. */
export function registrationFor(origin, name, lib, courseText) {
  const repo = { owner: origin.owner, repo: origin.repo };
  if (origin.kind === "course") {
    const course = lib.parseCourse(courseText);
    const reg = lib.courseRegistration({ ...course, name }, repo, origin.coursesDir, pagesUrlFor(origin.owner, origin.repo, origin.path));
    if (!reg) throw new Error("the course has no slug — run publish-target and push first");
    return reg;
  }
  const slug = origin.file.replace(/\.ya?ml$/i, "");
  return { ...lib.castRegistration(slug, repo, origin.castsDir, pagesUrlFor(origin.owner, origin.repo, origin.castsDir)), name };
}

const dollars = (c) => `${Number.isInteger(c / 100) ? c / 100 : (c / 100).toFixed(2)} USD`;

export function nameAdvice(state, name, price) {
  switch (state) {
    case "free": return `drawcast.app/#${name} is free: ${dollars(price)}, one-time. To buy: cast.mjs name <workdir> ${name} --buy --price ${price}`;
    case "yours": return `drawcast.app/#${name} is already yours — cast.mjs name <workdir> ${name} --buy points it here at no cost`;
    case "taken": return `drawcast.app/#${name} belongs to someone else — pick another`;
    case "short": return `"${name}" is too short — at least 3 characters`;
    case "invalid": return `"${name}" is not a valid name (a-z, 0-9, dashes; not gh-, anvil-, …)`;
    case "key": return "not signed in to drawcast — run: node scripts/cast.mjs login";
    default: return "the drawcast server did not answer — try again in a minute";
  }
}
```

The command in `cast.mjs`:

```js
  async name(args) {
    const flag = (n) => (args.includes(n) ? args[args.indexOf(n) + 1] : undefined);
    const [work, raw] = args.filter((a, i) => !a.startsWith("-") && args[i - 1] !== "--price");
    if (!work || !raw) throw new Error("usage: cast.mjs name <workdir> <name> [--buy --price <cents>]");
    const wd = resolve(ROOT, work);
    const origin = JSON.parse(readFileSync(resolve(wd, "origin.json"), "utf8"));
    const s = readSession(homedir());
    await withVite(async (load) => {
      const N = await load("/src/names.ts");
      const lib = { ...(await load("/src/course/publish.ts")), ...(await load("/src/publish/cast.ts")), ...(await load("/src/course/document.ts")) };
      const name = N.normalizeName(raw);
      if (!name || !N.isPayable(name)) return console.log(nameAdvice(name ? "short" : "invalid", raw, 0));
      if (!s) return console.log(nameAdvice("key", name, 0));
      const price = N.priceFor(name);
      const courseText = origin.kind === "course" ? readFileSync(resolve(wd, "course.md"), "utf8") : undefined;
      const reg = { key: s.key, ...registrationFor(origin, name, lib, courseText) };
      if (!args.includes("--buy")) {
        const { state } = await N.checkPaidName(s.api, name, s.key, origin.kind);
        return console.log(nameAdvice(state, name, price));
      }
      // Already yours: POST /name repoints it, free.
      const first = await N.registerName(s.api, reg);
      if (first === "ok") return console.log(`https://drawcast.app/#${name} now points here.`);
      if (first !== "pay") return console.log(N.nameNote(first, name).replace(/^ · /, ""));
      if (Number(flag("--price")) !== price) throw new Error(`--price must be ${price} (${N.formatPrice(price)}) — say the price to the user first`);
      const pay = await N.startNamePayment(s.api, { ...reg, return: "https://drawcast.app/" });
      if (typeof pay !== "object") return console.log(nameAdvice(pay, name, price));
      origin.pendingName = { name, target: reg.target, started: new Date().toISOString() };
      writeFileSync(resolve(wd, "origin.json"), JSON.stringify(origin, null, 1) + "\n");
      spawnSync("open", [pay.url]);
      console.log(`Opened Stripe Checkout for drawcast.app/#${name} (${N.formatPrice(price)}):\n  ${pay.url}\nPay there, then: cast.mjs name-wait ${work}`);
    });
  },
```

- [ ] **Step 4: Run** `npx vitest run tests/cast-account.test.ts` → PASS.
- [ ] **Step 5: Commit** — `git commit -m "cast.mjs name: check a name, or buy it — Stripe Checkout in the browser, the price confirmed"`

### Task 10 (C3): `cast.mjs name-wait <workdir> [--timeout 540]`, and the course door on the next push

**Files:**
- Modify: `scripts/cast-account.mjs` (add `waitForName`)
- Modify: `scripts/cast.mjs` (command `name-wait`; in `push`, the door comes from `origin.registered`)
- Test: `tests/cast-account.test.ts`

**Interfaces:**
- Produces: `waitForName({api, name, target, timeoutS, fetchImpl, sleep}) -> "ok" | "elsewhere" | "timeout"`; `origin.registered = name` on success (and `pendingName` removed); a course's `course.md` gets `name: <name>`.
- Consumes: `resolveName` from `/src/names.ts` (`GET /_/api/name?n=`).

- [ ] **Step 1: Failing tests**

```ts
import { waitForName } from "../scripts/cast-account.mjs";

describe("waitForName", () => {
  const args = { api: "https://x", name: "qaly", target: "ann/casts/qalys", timeoutS: 30, sleep: async () => {} };
  it("ok once the name resolves to our target", async () => {
    const answers = [new Response("{}", { status: 404 }), new Response(JSON.stringify({ kind: "course", target: "ann/casts/qalys" }))];
    expect(await waitForName({ ...args, fetchImpl: async () => answers.shift()! })).toBe("ok");
  });
  it("elsewhere when it resolves to someone else's target (taken between checkout and payment)", async () => {
    expect(await waitForName({ ...args, fetchImpl: async () => new Response(JSON.stringify({ kind: "cast", target: "bob/x/y.yaml" })) })).toBe("elsewhere");
  });
  it("timeout when nothing settles (a cancelled or unfinished payment)", async () => {
    expect(await waitForName({ ...args, fetchImpl: async () => new Response("{}", { status: 404 }) })).toBe("timeout");
  });
});
```

- [ ] **Step 2: Run** → FAIL.

- [ ] **Step 3: Implement**

```js
/** Poll the public resolver until `name` points at `target`. The redirect
 *  and the webhook both settle a paid name, so this sees either; it never
 *  claims success for a name that resolves somewhere else. */
export async function waitForName({ api, name, target, timeoutS = 540, fetchImpl = fetch, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) }) {
  for (let t = 0; t <= timeoutS; t += 5) {
    const r = await fetchImpl(`${api}/_/api/name?n=${encodeURIComponent(name)}`).catch(() => null);
    if (r?.ok) {
      const body = await r.json().catch(() => ({}));
      return body.target === target ? "ok" : "elsewhere";
    }
    await sleep(5000);
  }
  return "timeout";
}
```

The command:

```js
  async "name-wait"(args) {
    const [work] = args.filter((a) => !a.startsWith("-"));
    const timeoutS = Number(args.includes("--timeout") ? args[args.indexOf("--timeout") + 1] : 540);
    const wd = resolve(ROOT, work);
    const origin = JSON.parse(readFileSync(resolve(wd, "origin.json"), "utf8"));
    const p = origin.pendingName;
    if (!p) throw new Error(`${work} has no name being bought — run cast.mjs name … --buy first`);
    const outcome = await waitForName({ api: readSession(homedir())?.api ?? apiUrl(), name: p.name, target: p.target, timeoutS });
    if (outcome === "timeout") return console.log(`Not paid (yet). If the payment went through, run name-wait again; if it was cancelled, nothing was charged.`);
    if (outcome === "elsewhere") return console.log(`drawcast.app/#${p.name} went to someone else between checkout and payment — Stripe refunds it by hand; write to Hans. Pick another name.`);
    origin.registered = p.name;
    delete origin.pendingName;
    writeFileSync(resolve(wd, "origin.json"), JSON.stringify(origin, null, 1) + "\n");
    if (origin.kind === "course") {
      const { setCourseOption } = await withVite((load) => load("/src/course/document.ts"));
      const f = resolve(wd, "course.md");
      writeFileSync(f, setCourseOption(readFileSync(f, "utf8"), "name", p.name));
      console.log(`https://drawcast.app/#${p.name} is yours and plays the course. Push once more (cast.mjs push ${work} --direct) so the course page's Join door carries the name.`);
    } else console.log(`https://drawcast.app/#${p.name} is yours and plays the drawcast.`);
  },
```

In `push`, replace the `door:` argument of `buildPublishPlan`:

```js
        door: origin.registered
          ? { name: origin.registered, app: "https://drawcast.app/" }
          : pageDoor(readAtCommit(clone, upstream, joinRepo(origin.path, "index.html")), doorlessNote),
```

(`buildPublishPlan` still shows no door unless `course.md` has `enroll:`, so a course without a Join door stays without one.)

- [ ] **Step 4: Run** `npm test` → PASS (the whole suite, since `push` changed).
- [ ] **Step 5: Commit** — `git commit -m "cast.mjs name-wait: the name settles (or not), recorded; a course's next push carries it on its door"`

### Task 11 (C4): SKILL.md — "A pretty link", and the end-to-end check

**Files:** Modify `.claude/skills/drawcast/SKILL.md` (after "Publishing something new").

- [ ] **Step 1: Write the section**

```markdown
## A pretty link (drawcast.app/#<name>)

Only for something already published (it needs origin.json). Every name is bought, one-time:
20 USD up to 5 characters, 10 USD up to 7, 5 USD longer; 3 at least. The #gh= link stays free.

1. Not signed in (`name` says so): `node scripts/cast.mjs login` — it prints a code and
   drawcast.anvil.app/#device; the user types the code there. Once per machine.
2. `name <workdir> <name>` — the answer (free and its price / yours / taken). Say it.
3. On the user's yes to THAT price: `name <workdir> <name> --buy --price <cents>`. It opens
   Stripe Checkout in their browser; they pay there (never ask for card details).
4. `name-wait <workdir>` (run it in the background; up to 9 minutes). Report the link.
   A course: push once more so the page's door carries the name.
```

- [ ] **Step 2: End-to-end, in Stripe test mode (ask Hans: this switches the live server to test keys for the duration)**

Set the Anvil secret `stripe_mode` = `test`. Then, on the scratch repo from A2:
`login` → `name … qaly-test-<n>` → `--buy --price 500` → pay with card `4242 4242 4242 4242` → `name-wait`. Expected: "is yours". `https://drawcast.app/#qaly-test-<n>` plays, and a repeat `name … --buy` says "now points here" at no cost. Set `stripe_mode` back to live and delete the test name row in the Anvil `names` table.

- [ ] **Step 3: Commit** — `git commit -m "drawcast skill: a pretty link — login, name, name-wait"`, then update the memory file `drawcast-skill-revise-from-github.md` (or a new one) with the new commands.
