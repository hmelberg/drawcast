# Private courses and drawcasts (delivery 2, mode 2a) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An author can make a course or a single drawcast **private**: its lecture files are published encrypted in the author's public GitHub repo, the course page and titles stay public, and only enrolled learners (joined by approval), the course's teachers and the owner can watch — the player fetches the key from Anvil after sign-in. Private costs 3 USD per drawcast, 1 USD per lecture for a course (3 USD minimum), and later publishes pay 1 USD per new lecture.

**Architecture:** Anvil holds one random 256-bit key per private item (stored encrypted with `anvil.secrets.encrypt_with_key`) and hands it to owner / teachers / active enrolments at `POST /key`. A pure TypeScript module `src/crypto/lecture-lock.ts` turns a lecture YAML into an envelope (plain header + AES-GCM ciphertext) and back; the app's publish and the skill's push lock lecture files just before commit; the viewer unlocks at its single fetch→parse choke point. Payment reuses the Stripe Checkout plumbing of names through a new `pending_payments` table with a purpose.

**Tech Stack:** Anvil server Python (pure modules + `api.py` source-tested, pytest), TypeScript/Vite (vitest; WebCrypto `crypto.subtle` works in both browsers and the node test environment — `tests/publish-commit.test.ts` already uses it), Node scripts (`scripts/cast.mjs`).

**Spec:** `docs/superpowers/specs/2026-09-29-registry-private-names-design.md` (§1 registry, §3 publishing and the encrypted format, §4 viewing, §6 Anvil; §7 delivery 2). Delivery 1 plan and ledger: `docs/superpowers/plans/2026-09-29-registry-delivery-1.md`.

## Rulings this plan makes (against the spec)

1. **Deterministic IV instead of a fresh one per publish.** The spec says "a fresh IV for every file and every publish". This plan derives the IV from the content: `iv = first 12 bytes of HMAC-SHA-256(k_iv, plaintext)`, with `k_iv` derived from the item key by HKDF. Identical plaintext ⇒ identical ciphertext, so an unchanged lecture produces no diff, no re-upload of multi-MB narrated files, and no noise in PRs. It leaks only whether two versions of a whole lecture file are identical, which the public commit history already shows. Nonce reuse with different plaintexts is impossible (different plaintext ⇒ different HMAC, except with negligible probability). The item key string is bound as AES-GCM additional data, so an envelope can't be moved to another item.
2. **Pay before the first private publish.** A course made private must never have been committed in plaintext. So private is bought for a target computed before the first commit (the app's `preparePublish` / the skill's `publish-target` already know the slug and path), and the first commit is already encrypted. Making an already-public item private is allowed with a warning that earlier plaintext stays readable in the git history.
3. **The key goes to the payer before proof; a proven take-over rotates it.** Encryption needs the key before the commit that carries the claim file, so the key is issued to the registry row's owner even while unproven. A squatter with no write access gains nothing from a key (they can't commit encrypted files into the repo). When a proven owner takes over (delivery 1's `_take_over_unproven` / `_register_in_tx`), the item's key is **rotated** and its paid state kept, so a squatter's key is worthless; the real owner's next publish re-encrypts with the new key.
4. **Private joining is always by approval.** Runs of a private item are created with `join="approval"`, and making an item private switches its existing runs to approval.
5. **The listed switch still waits for the catalogue (delivery 4).** `listed` stays true; the price function already takes it.

## Global Constraints

- Repos: app `~/Documents/GitHub/drawcast` (work in a worktree; `npm ci` in it), server `~/Documents/GitHub/drawcast-anvil` (branch `private-2`). Tests: `npm test`, `npx tsc --noEmit -p .`; `python3 -m pytest -q`.
- Prices (US cents): cast `300`; course `100` per lecture, covering at least `3` lectures; a later publish pays `100` per lecture beyond the covered count. Public + listed is free.
- Envelope format (the file keeps its path and `.yaml` name):
  ```
  drawcast-encrypted: 1
  item: <registry item key>
  enroll: https://drawcast.anvil.app
  alg: AES-GCM-256
  iv: <base64url, 12 bytes>
  data: <base64url ciphertext of the UTF-8 file>
  ```
- The key never appears in a URL, a log line, a commit, a status line or an error message. On the client it lives only in `localStorage["drawcast.itemkey:<item>"]` on the main origin.
- The player asks Anvil for the key every time it is online; a kept key is used only when Anvil can't be reached; a 401/403 deletes the kept key.
- No thumbnails/posters are committed for private lectures (they would show a frame of the lecture).
- A registry, key or payment failure never corrupts a publish: nothing private is committed unless the lock step succeeded for every lecture (all-or-nothing).
- Pushing to Anvil `master`, deploying, and editing Anvil secrets are Hans's steps. Stripe is currently in **test mode** on the live server (checkout ids `cs_test_…`).
- Commits end with the session's Co-Authored-By / Claude-Session lines.

## Review Focus

1. **A plaintext leak on the first private publish** — any path (course or cast, app or skill, first publish or adding a lecture) that commits an unencrypted lecture file, a poster, or narration audio outside the envelope. *(Tasks 10 and 11 tests assert every committed lecture path of a private item starts with `drawcast-encrypted: 1`, and no `.png` is committed.)*
2. **Access after removal** — a learner rejected or removed must stop getting the key; the player must drop its kept key on 403. *(Tasks 4 and 7 tests.)*
3. **The view origin** — a private lecture opened on the view origin must hop to the main origin (the account lives there) instead of showing "sign in" forever. *(Task 7 test.)*
4. **A take-over by a proven owner** rotates the key and keeps the paid state; the old key no longer decrypts newly published files. *(Task 4 test.)*
5. **A course grows** — adding a lecture to a private course must require the difference before publishing, and the new lecture must be locked like the rest. *(Tasks 3 and 10 tests.)*

---

## Part A — Anvil (drawcast-anvil, branch `private-2`)

### Task 1: pricing and key helpers (pure)

**Files:** Modify `server_code/registry.py`; test `tests/test_registry.py`.

**Interfaces — Produces:** `CAST_PRICE = 300`, `LECTURE_PRICE = 100`, `COURSE_MIN_LECTURES = 3`; `covered(kind, lectures) -> int`; `price_due(kind, lectures, private, listed, paid_lectures) -> int` (cents); `new_item_key() -> str` (base64url, 32 random bytes, no padding).

- [ ] **Step 1: Failing tests**

```python
def test_public_listed_is_free():
    assert registry.price_due("course", 10, private=False, listed=True, paid_lectures=0) == 0


def test_cast_costs_once():
    assert registry.price_due("cast", 1, private=True, listed=True, paid_lectures=0) == 300
    assert registry.price_due("cast", 1, private=True, listed=True, paid_lectures=1) == 0


def test_course_minimum_and_per_lecture():
    assert registry.price_due("course", 1, True, True, 0) == 300
    assert registry.price_due("course", 5, True, True, 0) == 500


def test_course_pays_the_difference_beyond_what_is_covered():
    assert registry.covered("course", 1) == 3
    assert registry.price_due("course", 3, True, True, 3) == 0
    assert registry.price_due("course", 4, True, True, 3) == 100
    assert registry.price_due("course", 2, True, True, 3) == 0


def test_unlisted_alone_is_priced_like_private():
    assert registry.price_due("cast", 1, private=False, listed=False, paid_lectures=0) == 300


def test_new_item_key_is_32_bytes_base64url():
    import base64
    k = registry.new_item_key()
    assert "=" not in k and "+" not in k and "/" not in k
    assert len(base64.urlsafe_b64decode(k + "=")) == 32
    assert registry.new_item_key() != k
```

- [ ] **Step 2: Run** `python3 -m pytest -q tests/test_registry.py` → FAIL.
- [ ] **Step 3: Implement**

```python
CAST_PRICE = 300
LECTURE_PRICE = 100
COURSE_MIN_LECTURES = 3


def covered(kind, lectures):
    """How many lectures a payment covers: a cast is one; a course at least
    COURSE_MIN_LECTURES (the 3 USD minimum buys three)."""
    return 1 if kind == "cast" else max(int(lectures or 0), COURSE_MIN_LECTURES)


def price_due(kind, lectures, private, listed, paid_lectures):
    """Cents owed for publishing `lectures` with these switches, given what is
    already paid for. Public + listed is free; anything else is the item's
    price once, and a course that grows pays per lecture beyond `paid_lectures`."""
    if not private and listed:
        return 0
    if kind == "cast":
        return 0 if paid_lectures >= 1 else CAST_PRICE
    need = covered(kind, lectures)
    return max(0, need - int(paid_lectures or 0)) * LECTURE_PRICE


def new_item_key():
    return base64.urlsafe_b64encode(secrets.token_bytes(32)).decode("ascii").rstrip("=")
```

(add `import base64` at the top.)
- [ ] **Step 4: Run** → PASS. **Step 5: Commit** — `registry.py: private pricing (cast 3 USD, course 1 USD/lecture min 3, pay the difference) and item keys`

### Task 2: schema

**Files:** `anvil.yaml`, `tests/test_schema.py`.

- `courses` + `item_key` (string — the item key encrypted with `anvil.secrets.encrypt_with_key("registry_keys", …)`).
- New table `pending_payments`: `secret` (string), `owner` (link_single → users), `purpose` (string: `"private"`), `item` (string), `kind` (string), `lectures` (number), `amount` (number), `currency` (string), `return_url` (string), `session` (string), `state` (string), `created` (datetime), `paid_at` (datetime).
- `payments` + `purpose` (string), `item` (string) — **update** the existing exact-set test for `payments` in `tests/test_schema.py` (l.160–168) to include them.

- [ ] **Steps 1–5** (failing schema test for the new columns/table, add them in the editor's block shape, run, commit) — `Schema: item_key on courses, pending_payments, purpose/item on payments`

### Task 3: quote, pay, settle

**Files:** `server_code/payments.py` (generalise `checkout_fields`), `server_code/api.py`, `server_code/parsers.py` (`parse_register_pay`), `server_code/limits.py` (`"quote": 300`), tests `tests/test_payments.py`, `tests/test_parsers.py`, `tests/test_api_source.py`, `tests/test_limits.py`.

**Interfaces — Produces (HTTP, text/plain JSON):**
- `POST /register/quote {key, kind, target, lectures, private}` → `{due, currency: "usd", paid_lectures, private, owner: "you"|"other"|"none", name}`. Signed in required (401). The item need not exist yet (a first private publish): `due = price_due(kind, lectures, private, True, row.paid_lectures if row else 0)`; `owner` "other" → the client must not offer payment.
- `POST /register/pay {key, kind, target, title, page?, lectures, return}` → `{url}` (Stripe Checkout) or 409 `{error: "nothing-due"}` / 403 `{error: "owner"}` / 401 / 400. Creates the registry row if missing (as `/register` does, owner = caller, free name minted), writes a `pending_payments` row (purpose `"private"`, `lectures`, `amount = price_due(...)`), opens Checkout with product name `"Private: <free name>"` and description `PRIVATE_TERMS_LINE`, `success_url=/_/api/register/paid?p=<secret>`.
- `GET /register/paid?p=&s=` → verifies the session (`session_pays_for`), settles, 302 to `<return origin>/#privpaid=<free name>` (or `#privunpaid=`).
- Webhook: `checkout.session.completed` with `metadata[purpose]=private` settles the `pending_payments` row; name payments keep their path.
- **Settle** (`_settle_private(row, session, source)`, idempotent, in a transaction): registry row `private=True`, `access="enrolled"`, `paid_lectures = max(paid, covered(kind, lectures))`; if `item_key` is empty, set `encrypt(new_item_key())`; every run of the item → `join="approval"`; `payments.add_row(purpose="private", item=…, …)`.

`payments.checkout_fields(name, …)` gains keyword params `product=None, description=None, metadata=None` (defaults keep today's name behaviour byte-for-byte; `tests/test_payments.py` pins that) and puts `metadata[purpose]` when given.

- [ ] **Step 1: Failing tests** — payments: `checkout_fields(..., product="Private: x", description=D, metadata={"purpose": "private"})` has those fields and still `metadata[pending]`; the default call is unchanged. parsers: `parse_register_pay` accepts the body above, requires `return`, `lectures` an int 1–200, rejects `anvil/`/`gdrive/` targets. api source: `/register/quote`, `/register/pay`, `/register/paid` registered once; `_settle_private` is `@anvil.tables.in_transaction`, sets `private=True`, `access="enrolled"`, calls `registry.new_item_key(` only when `item_key` is empty, and updates `runs` `join="approval"`; the webhook branches on `metadata.get("purpose") == "private"`; `/register/pay` refuses when `price_due(...) == 0` (409) and when the row's owner is another account (403). limits: `"quote": 300`.
- [ ] **Steps 2–4**, `python3 -m pytest -q` → PASS.
- [ ] **Step 5: Commit** — `Private purchases: /register/quote, /register/pay, /register/paid, webhook purpose; settle makes the item private with a key and approval runs`

### Task 4: `/key`, private enrolment, cast items, key rotation

**Files:** `server_code/api.py`, `server_code/access.py` (`key_standing`), tests `tests/test_access.py`, `tests/test_api_source.py`, `tests/test_limits.py` (`"key": 2000`).

**Interfaces — Produces:**
- `access.key_standing(is_owner, is_teacher, is_admin, enrollment_state) -> "ok" | "none" | "pending" | "rejected"` — owner/teacher/admin → ok; `active` → ok; `pending`/`rejected` → that; else `none`.
- `POST /key {key, item}` (budget `key`) → 200 `{key: <item key>, item}`; no/unknown session → 401 `{error: "key"}`; not allowed → 403 `{error: "access", standing, title, page}`; item not private or unknown → 404 `{error: "not-private"}`. Decrypts `item_key` with `anvil.secrets.decrypt_with_key("registry_keys", …)`.
- `_course_key_of_cast(cast)` — for events and enrolment: if a registry row with `key = registry.item_key("cast", cast)` and `kind == "cast"` exists, that key; else today's folder (`rq.course_of`). Used by `http_event` and by the enrolment lookup, so a private single cast is its own enrolment unit.
- `_run_row` (default run creation) uses `join="approval"` when the course row is private.
- Key rotation: `_take_over_unproven` and the proven take-over in `_register_in_tx` set `item_key = encrypt(new_item_key())` when the moved row is private (paid state untouched).

- [ ] **Step 1: Failing tests** — `test_access.py` for `key_standing` (all branches); source tests: `/key` registered once, budget first, 401 before any table read of the key, the decrypt call appears only after the standing check, `decrypt_with_key("registry_keys"` present, the key value never passed to `print`/`json_response` except in the 200 branch; `http_event` uses `_course_key_of_cast(`; `_run_row` picks `"approval"` for a private row; both take-over paths call `registry.new_item_key(` under a `row["private"]` guard; limits `"key": 2000`.
- [ ] **Steps 2–5** — `/key: the item key for owner, teachers and active enrolments; private casts are their own enrolment unit; private runs join by approval; a take-over rotates the key`

### Task 5: dashboard

**Files:** `server_code/dashboard_server.py` (`list_items` + `private`, `paid_lectures`; new `item_key_for(item)` owner-only → the decrypted key), `client_code/Form1` (per item: "Private" / "Public", "paid for N lectures", and for private items a "Show key" button filling a Label — owner only; a note "Anyone you give this key to can watch without joining"), tests `tests/test_dashboard_source.py`.

- [ ] **Steps 1–5** (source tests: `item_key_for` checks owner before decrypting; Form1 components exist) — `Dashboard: private and paid state; the owner can show the item key`

---

## Part B — the app: crypto and the player (drawcast, worktree)

### Task 6: `src/crypto/lecture-lock.ts` (pure)

**Files:** Create `src/crypto/lecture-lock.ts`, `tests/lecture-lock.test.ts`.

**Interfaces — Produces:** `LOCK_HEADER = "drawcast-encrypted: 1"`; `isLocked(text) -> boolean`; `envelopeOf(text) -> {item, enroll, iv, data} | null`; `lockText(text, keyB64url, item) -> Promise<string>`; `unlockText(envelope, keyB64url) -> Promise<string>` (throws `Error("wrong-key")` on an authentication failure); base64url helpers that handle multi-MB inputs (chunked, no `String.fromCharCode(...bigArray)`).

- [ ] **Step 1: Failing tests**

```ts
import { describe, expect, it } from "vitest";
import { envelopeOf, isLocked, lockText, unlockText } from "../src/crypto/lecture-lock";

const KEY = "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8"; // 32 bytes 0..31
const OTHER = "HxwdHhscGxoZGBcWFRQTEhEQDw4NDAsKCQgHBgUEAwI";
const ITEM = "ann/casts/qalys";

describe("lecture-lock", () => {
  it("round-trips, header first", async () => {
    const env = await lockText("title: A\n# plain yaml æøå\n", KEY, ITEM);
    expect(env.startsWith("drawcast-encrypted: 1\n")).toBe(true);
    expect(isLocked(env)).toBe(true);
    expect(envelopeOf(env)).toMatchObject({ item: ITEM, enroll: "https://drawcast.anvil.app" });
    expect(await unlockText(env, KEY)).toBe("title: A\n# plain yaml æøå\n");
  });
  it("is deterministic: same text, same envelope; different text, different iv", async () => {
    const a = await lockText("one", KEY, ITEM);
    expect(await lockText("one", KEY, ITEM)).toBe(a);
    expect(envelopeOf(await lockText("two", KEY, ITEM))!.iv).not.toBe(envelopeOf(a)!.iv);
  });
  it("a wrong key or a moved envelope fails", async () => {
    const env = await lockText("secret", KEY, ITEM);
    await expect(unlockText(env, OTHER)).rejects.toThrow(/wrong-key/);
    await expect(unlockText(env.replace(`item: ${ITEM}`, "item: bob/x/y"), KEY)).rejects.toThrow(/wrong-key/);
  });
  it("plain YAML is not locked; the plaintext never appears in the envelope", async () => {
    expect(isLocked("title: A\n")).toBe(false);
    expect(await lockText("VERY-SECRET-LINE", KEY, ITEM)).not.toContain("VERY-SECRET-LINE");
  });
  it("handles a multi-megabyte file", async () => {
    const big = "x".repeat(3_000_000);
    expect(await unlockText(await lockText(big, KEY, ITEM), KEY)).toBe(big);
  });
});
```

- [ ] **Step 2: Run** `npx vitest run tests/lecture-lock.test.ts` → FAIL.
- [ ] **Step 3: Implement**

```ts
// Private lectures (registry delivery 2): a lecture YAML becomes an envelope —
// a plain header naming the item, then AES-GCM ciphertext. The IV is derived
// from the content (HMAC of the plaintext with a key derived from the item
// key), so an unchanged lecture locks to the same bytes: no diff, no
// re-upload. The item is bound as additional data, so an envelope can't be
// moved to another item. Pure; WebCrypto only (browsers and node).
export const LOCK_HEADER = "drawcast-encrypted: 1";
export const ENROLL_API = "https://drawcast.anvil.app";
const enc = new TextEncoder();
const dec = new TextDecoder();

function toB64url(u: Uint8Array): string {
  let s = "";
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000));
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function fromB64url(s: string): Uint8Array {
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function keysFor(keyB64: string) {
  const raw = fromB64url(keyB64);
  const aes = await crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
  const base = await crypto.subtle.importKey("raw", raw, "HKDF", false, ["deriveKey"]);
  const mac = await crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: new Uint8Array(0), info: enc.encode("drawcast-lecture-iv") },
    base, { name: "HMAC", hash: "SHA-256", length: 256 }, false, ["sign"]);
  return { aes, mac };
}

export function isLocked(text: string): boolean {
  return text.startsWith(LOCK_HEADER + "\n");
}

export function envelopeOf(text: string): { item: string; enroll: string; iv: string; data: string } | null {
  if (!isLocked(text)) return null;
  const f: Record<string, string> = {};
  for (const line of text.split("\n").slice(1)) {
    const i = line.indexOf(": ");
    if (i > 0) f[line.slice(0, i)] = line.slice(i + 2).trim();
  }
  return f.item && f.iv && f.data ? { item: f.item, enroll: f.enroll ?? ENROLL_API, iv: f.iv, data: f.data } : null;
}

export async function lockText(text: string, keyB64: string, item: string): Promise<string> {
  const { aes, mac } = await keysFor(keyB64);
  const pt = enc.encode(text);
  const iv = new Uint8Array(await crypto.subtle.sign("HMAC", mac, pt)).slice(0, 12);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: enc.encode(item) }, aes, pt));
  return `${LOCK_HEADER}\nitem: ${item}\nenroll: ${ENROLL_API}\nalg: AES-GCM-256\niv: ${toB64url(iv)}\ndata: ${toB64url(ct)}\n`;
}

export async function unlockText(envelope: string, keyB64: string): Promise<string> {
  const e = envelopeOf(envelope);
  if (!e) throw new Error("not-locked");
  const { aes } = await keysFor(keyB64);
  try {
    const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromB64url(e.iv), additionalData: enc.encode(e.item) }, aes, fromB64url(e.data));
    return dec.decode(pt);
  } catch {
    throw new Error("wrong-key");
  }
}
```

- [ ] **Step 4: Run** → PASS. **Step 5: Commit** — `lecture-lock: encrypted lecture envelopes (AES-GCM, content-derived IV, item-bound)`

### Task 7: the key client and the locked door in the viewer

**Files:** Create `src/item-key.ts`, `tests/item-key.test.ts`; modify `src/viewer.ts` (`runViewer` between the fetch and `parsePlaylistText`, ~:662), `src/security/view-origin.ts` (a `lockedRoute(origin, hash)` helper), tests `tests/view-origin.test.ts`, `tests/names-entry.test.ts` or a new `tests/viewer-locked.test.ts`.

**Interfaces — Produces:**
- `fetchItemKey(api, token, item, fetchImpl, storage) -> Promise<{key} | {denied: 401} | {denied: 403, standing, title, page} | {denied: 404}>` — asks Anvil (10 s bound); on 200 stores `drawcast.itemkey:<item>`; on 401/403/404 deletes it; on a network error returns the stored key if any (else `{denied: 401}` with an offline note).
- `unlockForViewer(text, deps) -> Promise<{text} | {door: …}>` — if `!isLocked(text)` returns the text; else asks for the key and unlocks (a `wrong-key` → drops the kept key and asks once more).
- `lockedRoute(origin, hash)` → the main-origin URL with the stay marker when on the view origin, else null.
- In `runViewer`: after the fetch, `if (isLocked(text))`: `lockedRoute` → `location.replace`; else `unlockForViewer`; a door result renders:
  - 401 → the existing `deniedDoor` 401 wording ("This lecture is private — sign in to watch it.").
  - 403 `none` → `courseDoor(<free name or item>, {kind: "course", target: item, page}, deps)` with lead "This lecture is private to its course. Ask to join — the teacher approves requests."
  - 403 `pending` → "Your request to join is waiting for the teacher's approval."
  - 403 `rejected` → "Your request to join this course was declined."
  - 404 → "This lecture is locked, and its key is no longer available."
  The join body's `course` is the envelope's `item` (a private single cast joins itself).

- [ ] **Step 1: Failing tests** — `item-key.test.ts` with a fake fetch and a Map storage: 200 stores; 403 deletes and reports standing; network error falls back to the stored key; `wrong-key` retry path. `view-origin.test.ts`: `lockedRoute` on the view origin → main + `&main`; on main → null. A source test in `viewer`: `isLocked(` is checked before `parsePlaylistText(` in `runViewer`.
- [ ] **Steps 2–5** — `The player unlocks private lectures: key from Anvil for enrolled learners, the join door for everyone else`

### Task 8: the author's own re-reads unlock

**Files:** modify `src/main.ts` (`loadCoursesFromGithub` ~:4245, `publishTextFor`'s `previousText` ~:4859), `src/ui/course.ts` (~:904 baked-audio reuse), tests (source-order tests like `tests/registry-client.test.ts`).

Each place that reads a published lecture back from GitHub passes the text through `unlockForAuthor(text)` — `isLocked` → `fetchItemKey` with the author's token → `unlockText`; on any failure the read behaves as "no previous file" (audio isn't reused; the load reports "locked — sign in as the owner to load it").

- [ ] **Steps 1–5** — `Loading and republishing a private course read its lectures unlocked (owner key)`

---

## Part C — the app: publishing private (drawcast, worktree)

### Task 9: the Private switch, the quote and paying

**Files:** modify `src/ui/share.ts` (a "Private" checkbox for casts and courses beside the GitHub publish choices, a price line filled from the quote, a "Pay N USD" button, the history warning), `src/registry.ts` (`quotePrivate`, `startPrivatePayment`), `src/main.ts` (return fragment `#privpaid=<name>` / `#privunpaid=<name>` handling like `paidInHash` at ~:4296, and `ShareDoc.private`), `src/store.ts` (`SavedDrawing.private?: boolean`), course document (`private: true` option line in `course.md` via `setCourseOption`, read by `parseCourse`), tests.

Behaviour:
- Ticking Private asks `/register/quote` (signed in required — otherwise the line reads "Sign in to publish privately") and shows "Private: N USD — enrolled learners only; you approve who joins" or "Paid — publish to lock the new lectures" (due 0).
- Pay opens Stripe Checkout (`/register/pay`, return = the app URL); back on `#privpaid=` the status line says "Private is paid — press Publish to publish locked." and the Share panel reopens on the GitHub row.
- Publish is disabled while Private is ticked and due > 0.
- An already-published item: ticking Private shows "Earlier versions stay readable in the repo's history. To keep them private too, publish under a new folder." (the existing Folder field).
- No new `input` listeners in share.ts (Global Constraint of delivery 1: exactly one `addEventListener("input"`, two `buildNameCheck(`).

- [ ] **Steps 1–5** (source/unit tests for the quote line states, the disabled Publish, the return handler) — `Share: make a course or drawcast private — quote, pay, publish locked`

### Task 10: publishing locked

**Files:** modify `src/publish/cast.ts` (`CastPublishArgs.lock?: (text) => Promise<string>`, applied to the cast file; no poster when locking), `src/course/publish.ts` (`PublishArgs.lock?`, applied to every lecture file in `plan.files` after `buildPublishPlan`; `poster` ignored when locking), `src/main.ts` / `src/ui/course.ts` (when the item is private: fetch the key as owner (`fetchItemKey`), pass `lock = (t) => lockText(t, key, item)`; a private course forces its Join door — `applyJoinDoor(text, true)` and `door = {name: <free name from the quote>, app: viewerBase}`), tests.

All-or-nothing: the lock runs over all lecture files before `commitFiles`; any failure aborts the publish with "Not published: could not lock the lectures (…)" and nothing is committed.

- [ ] **Step 1: Failing tests** — a publish plan for a private course with a fake lock: every lecture path's content starts with `drawcast-encrypted: 1`, `course.md`/`index.html`/`README.md`/`courses.json` are plain, no `.png` path is in the files; the page's door href ends `#<free name>&join`; a lock that throws on the 2nd lecture → `commitFiles` is never called. Same for a cast.
- [ ] **Steps 2–5** — `Private publish: lecture files locked before the commit, no thumbnails, the course page's Join door`

---

## Part D — the skill (drawcast, worktree)

### Task 11: `pull` unlocks, `push` locks, `private` pays

**Files:** `scripts/cast.mjs` (`pull`: a locked lecture/cast file is unlocked with the owner key while copying into the workdir, `origin.private = true`; `push`: when `origin.private`, the files the plan commits for lectures (course) or the cast file are locked with `lockText` (loaded through `withVite`) and no poster paths are added; a new command `private <workdir> [--price <cents>]` — quote without `--price`, with it open Checkout and wait until the quote says paid (like `name-wait`), then set `origin.private = true`); `scripts/cast-account.mjs` (pure helpers `lockPlanFiles(files, isLecturePath, lock)`), `.claude/skills/drawcast/SKILL.md` ("Private" section: quote → the user's yes to the price → `private --price` → pay in the browser → `push`), tests `tests/cast-account.test.ts`.

- [ ] **Step 1: Failing tests** — `lockPlanFiles` locks exactly the lecture paths and drops `.png` paths; a lock failure throws before anything is returned.
- [ ] **Steps 2–5** plus a read-only dry run against the test repo — `cast.mjs: private courses — pull unlocks, push locks, private pays`

---

## Part E — deploy and live check

### Task 12: deploy and verify

- [ ] **Hans:** push `private-2` to drawcast-anvil `master`; in the Anvil editor pull, apply the schema, and create an **encryption key** secret named `registry_keys` (App Secrets → "Create a new encryption key"). Merge/push the app.
- [ ] Live (Stripe is in test mode — card 4242 4242 4242 4242):
  1. Make the test course private from the skill (`private --price 500` for its 5 lectures), pay, `push --direct`.
  2. The repo's lecture files start with `drawcast-encrypted: 1`; the course page still lists the lectures; no lecture `.png`.
  3. Signed out, a lecture link shows "sign in"; signed in as the owner it plays.
  4. With a second account (Hans's other address): the lecture shows "ask to join"; after the request, "waiting"; the owner approves in the dashboard; it plays; the owner removes the learner (rejects) → the next open shows the door again.
  5. Add a lecture → the quote asks 100; pay; push; the new lecture is locked.
