# Narration credit (delivery 3) and the catalogue with unlisted (delivery 4) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** (A) An author without their own Google TTS key can buy prepaid **narration credit** and publish with narration: Anvil synthesises each line with drawcast's Google key and charges 3× Google's list price per character. (B) A public **catalogue** page at `drawcast.app/#browse` lists listed drawcasts and courses with search; the Share panel gets a **Listed** switch, and being **unlisted** costs the same as private (paid once, covered by a private purchase).

**Architecture:** (A) A new Anvil ledger of micro-dollar credit per account; `POST /credit/pay` buys packs through the existing Stripe Checkout plumbing (purpose `"credit"`); `POST /tts` takes one line's Google request body, checks the balance, reserves the cost, calls Google with the `google_tts_key` secret, and refunds on failure. The app's bake already takes an injected `synthesize(line) → base64 mp3`; a server synthesizer plugs into that seam. (B) `GET /catalogue` returns listed registry items (proven owners only); the app renders `#browse` as a standalone page; `/register/quote` and `/register/pay` gain `listed`, and a free `/register/listing` turns listing back on.

**Tech Stack:** Anvil server Python (pure modules + source-tested `api.py`, pytest), TypeScript/Vite (vitest), Netlify, Stripe Checkout (currently test mode), Node skill scripts.

**Spec:** `docs/superpowers/specs/2026-09-29-registry-private-names-design.md` (§5 narration credit; §2/§7 catalogue; pricing table). Delivery 2 plan and its ledger for conventions: `docs/superpowers/plans/2026-09-30-registry-delivery-2-private.md`.

## Rulings this plan makes

1. **The existing vended TTS key stays.** The app already hands the owner's Google key to password holders (`loadVendedFlags().tts`, 250k chars/month soft cap). Narration credit is the path for everyone else; an author with their own or a vended key keeps using it (it is cheaper for them). Order: own key → vended key → credit.
2. **One line per `/tts` request**, like today's sequential bake (Anvil HTTP endpoints have a ~30 s limit; one line is a small, bounded request).
3. **Money is integer micro-dollars** (1 USD = 1,000,000). Price per character = 3 × `TTS_PRICE_PER_MILLION[tier]` micro-dollars (studio 480, chirp 90, neural2/wavenet 48, standard 12). The server keeps its own copy of the tier table, pinned to `src/export/tts-cost.ts` by a test in each repo.
4. **Reserve, then refund.** `/tts` deducts the line's cost before calling Google and credits it back if Google fails, in two transactions — the balance can never go negative, and a failed line costs nothing.
5. **Credit packs:** 5, 10 and 20 USD (Stripe minimums and fees make smaller packs poor value).
6. **The catalogue lists only items whose owner is proven** (a verified repo claim) and that have a kind and a free name. Unproven rows (anyone can register any public repo signed out) would let junk into a public listing.
7. **Listed private items show in the catalogue** with a "Private — ask to join" badge, as decided with Hans ("private and listed" is allowed).
8. **Unlisted = same price as private, bought once.** An item that has paid for private (any `paid_lectures > 0`) can be unlisted free; listing again is always free. A public-unlisted item is not locked — it is only left out of the catalogue.
9. **`browse` becomes a reserved name prefix** in both repos (like `gh`, `anvil`), so `drawcast.app/#browse` can never be a name.

## Global Constraints

- Repos: app `~/Documents/GitHub/drawcast` (worktree; `npm ci` in it), server `~/Documents/GitHub/drawcast-anvil` (branch `credit-catalogue`). Tests: `npm test`, `npx tsc --noEmit -p .`; `python3 -m pytest -q`. (A timing test in `tests/des-hta.test.ts` can flake under full-suite load; it passes alone.)
- The Google TTS key lives only in Anvil Secrets as `google_tts_key` (a text secret) and never reaches a client, a log, or a response.
- A credit failure never publishes a half-narrated item silently: the bake either completes or the publish stops with the reason ("Not enough narration credit — N needed, M left. Buy credit…").
- `share.ts` keeps exactly one `addEventListener("input"`, two `buildNameCheck(`, no keyup/keydown.
- Every Anvil table column keeps the editor's shape; new endpoints budget first via `_allowed` and search-first lookups.
- Deploying (Anvil push to master + editor pull + schema + secrets, Netlify deploy) is done at the end: Anvil push and secrets are Hans's steps; the Netlify deploy may be run with `netlify deploy --build --prod` from a clean `main` (Hans asked for it on 2026-09-30).
- Commits end with the session's Co-Authored-By / Claude-Session lines.

## Review Focus

1. **Charging correctly** — a line is charged exactly once at the right tier; a Google failure refunds; concurrent `/tts` calls can't overdraw (the reserve is transactional). *(Tasks 2–3 tests.)*
2. **The Google key never leaks** — not in responses, errors, logs, or the client bundle. *(Task 3 source tests.)*
3. **Abuse** — `/tts` requires a signed-in account with credit; per-account rate limit; text length capped (Google's 5000 bytes). *(Task 3.)*
4. **Catalogue privacy** — no account email, no item keys, no unproven or unlisted rows, no private lecture content. *(Task 7 tests.)*
5. **Listing state** — unlisting is paid unless already covered; listing again is free; a private purchase with `listed: false` leaves the item unlisted. *(Tasks 8–9 tests.)*

---

## Part A — narration credit

### Task 1 (server): pricing and schema for credit

**Files:** `server_code/credit.py` (new, pure), `anvil.yaml`, tests `tests/test_credit.py`, `tests/test_schema.py`.

- `credit.py`: `PRICE_PER_MILLION = {"studio": 160, "chirp": 30, "neural2": 16, "wavenet": 16, "standard": 4}`; `MARKUP = 3`; `voice_tier(name)` (same rule as the app's `voiceTier`: first of studio/chirp/neural2/wavenet/standard found in the lower-cased name, default neural2); `line_cost_micro(text, voice_name) = len(text) * MARKUP * PRICE_PER_MILLION[tier]` (micro-dollars, since price per 1M chars in USD = micro-dollars per char); `PACKS_CENTS = (500, 1000, 2000)`; `micro_from_cents(c) = c * 10_000`.
- Schema: new table `credit` — `owner` (link users), `delta` (number, micro-dollars, + for purchases/refunds, − for use), `reason` (string: `purchase` | `tts` | `refund`), `ref` (string: session id or line hash), `at` (datetime). `pending_payments` gains `amount` already — reuse with purpose `"credit"`.
- Tests: tier rule matches the app's cases (`en-US-Studio-Q` → studio, `nb-NO-Wavenet-A` → wavenet, `""` → neural2); `line_cost_micro("hello", "en-US-Studio-Q") == 5*3*160`; packs; schema columns.
- App side of the pin: `tests/tts-cost-pin.test.ts` asserts `TTS_PRICE_PER_MILLION` equals the server's table (read `../drawcast-anvil/server_code/credit.py` text if present, else skip with a note — mirror the existing `names` pin pattern in `tests/names.test.ts`).

### Task 2 (server): buy credit and read the balance

**Files:** `server_code/api.py`, `server_code/parsers.py`, `server_code/payments.py` (a `CREDIT_TERMS_LINE`), `server_code/limits.py` (`"credit": 120`), tests.

- `POST /credit/pay {key, cents, return}` → `cents` in `PACKS_CENTS` → pending_payments row purpose `"credit"` → Stripe Checkout (product "Narration credit — N USD", `expires_at` like private) → `{url}`.
- `/register/paid` pattern for return: `GET /credit/paid?p=&s=` → settle → 302 `#creditpaid=<cents>` / `#creditunpaid=0`.
- Webhook branch `metadata.purpose == "credit"` → `_settle_credit` (in-transaction re-fetch, idempotent; adds a `credit` row `+micro_from_cents(amount)`, reason purchase, ref session id; a `payments` row purpose `credit`).
- `POST /credit/balance {key}` → `{balance_micro, balance_usd: "12.34"}`.
- `_balance(user)` = sum of the user's `credit.delta`.
- Tests: source tests for ordering, idempotence (re-fetch inside tx), webhook branch, names/private payment paths unchanged.

### Task 3 (server): `/tts`

**Files:** `server_code/api.py`, `server_code/parsers.py` (`parse_tts`), `server_code/limits.py` (`"tts": 3000` keyed by account), tests.

- `POST /tts {key, body}` where `body` is exactly the Google `text:synthesize` request body the app builds today (`input.text`, `voice {languageCode, name?|ssmlGender}`, `audioConfig {audioEncoding: "MP3", speakingRate?, pitch?, volumeGainDb?}`). Validate: text ≤ 5000 bytes UTF-8, `audioEncoding == "MP3"`, only the known keys.
- Flow: session → budget (`_allowed("tts", key=<user id>)`) → cost = `line_cost_micro(text, voice.name or "")` → **reserve** in a transaction (refuse 402 `{error: "credit", needed_micro, balance_micro}` if balance < cost; else add a `credit` row `−cost`, reason tts, ref sha256(text+voice) short) → call Google (`anvil.http.request(url, method="POST", data=json.dumps(body), headers={"Content-Type": "application/json"}, timeout=25)` with `?key=<google_tts_key>`) → on success return `{audio: <audioContent>, charged_micro}`; on any failure add a refund row `+cost` and answer 502 `{error: "tts"}` (never Google's message, which may echo the key-bearing URL).
- Missing `google_tts_key` secret → 503 `{error: "unconfigured"}` before any charge.
- Source tests: the key only appears in the Google URL construction; no response or print includes it; reserve precedes the Google call; refund on the failure path; 402 carries needed/balance.

### Task 4 (app): the credit synthesizer and publishing with credit

**Files:** `src/export/tts.ts` (extract `ttsRequestBody(cfg, text, opts)` from `synthesizeBase64` — the same body, reused), new `src/credit.ts` (`creditBalance`, `startCreditPayment`, `creditInHash`, `serverSynthesize(line) → Promise<string>` calling `/tts` with a 30 s bound, throwing `CreditError {needed, balance}` on 402), `src/main.ts` (`publishTextFor` bake: when there is no own/vended TTS key and the user is signed in, use `serverSynthesize` instead of throwing "needs a Google TTS key"), `src/ui/course.ts` (`bakeLectures`: same), `src/ui/share.ts` (the "Embed narration" box enabled when signed in even without a key; hint "uses narration credit — about X of Y left" with a **Buy credit** button (5/10/20 USD) when short), return-fragment handler for `#creditpaid=` / `#creditunpaid=`, tests.
- The cost estimate in the Share hint uses 3× `bakeCost` when credit will be used.
- A `CreditError` mid-bake stops the publish before any commit: "Not enough narration credit — about N needed, M left. Buy credit in the Share panel." Lines already baked are kept in the clip cache (paid for), so a retry after buying credit only pays for the rest.
- Order: own key → vended key → credit (ruling 1).
- Tests: `ttsRequestBody` byte-identical to today's body for representative cases; `serverSynthesize` maps 200/402/401/5xx; publish picks the right synthesizer by the order; Share hint states; source tests for the no-key path no longer throwing when signed in.

### Task 5 (app + server): the dashboard shows the balance; the skill can buy credit

**Files:** `server_code/dashboard_server.py` (`credit_balance()` + last 20 ledger rows for the owner), `client_code/Form1` (a "Narration credit" line: balance, and a "Buy credit" link to `https://drawcast.app/#buy-credit` is NOT needed — just show the balance and recent use), `scripts/cast.mjs` (`credit [--buy <cents>]`: show balance; with `--buy` open Checkout and wait until the balance rises), `.claude/skills/drawcast/SKILL.md` (a short "Narration credit" note: the skill's own bake still uses the local key if any; `credit --buy` needs the user's yes to the amount), tests.

---

## Part B — the catalogue and unlisted

### Task 6 (both): reserve `browse`

**Files:** `src/names.ts` + `server_code/names.py` (add `"browse"` to `RESERVED_PREFIXES`), `server_code/registry.py` (free names already avoid reserved words — add a test that a title "Browse the stars" gets a valid name), `netlify/lib/name-host.mts` `RESERVED_LABELS` (add `browse`), the pins in `tests/names.test.ts` / `tests/test_names.py` / name-host tests.

### Task 7 (server): `GET /catalogue`

**Files:** `server_code/api.py`, `server_code/registry.py` (pure `catalogue_entry(row, free_name)` → the public fields), `server_code/limits.py` (`"catalogue": 1200`), tests.

- `GET /catalogue?q=&kind=&page=` → `{items: [{kind, title, name, page, owner, lectures, updated, private}], page, more}`; 50 per page, newest `updated` first.
- Included rows: `listed` true, `kind` in (course, cast), a free name exists, and the owner is proven for the item's repo (`_proven(owner, repo_of(key))`). `owner` in the answer = the GitHub owner segment of the key (never the account email). `lectures` = the number of lecture keys for a course, 1 for a cast. `private` true shows the badge. `q` matches title case-insensitively (Anvil `tq.ilike('%q%')`), max 80 chars; `kind` optional.
- `Cache-Control: public, max-age=60` on this one endpoint (public data).
- Tests: pure `catalogue_entry` never returns key/item_key/owner email/lectures list; source tests: filters present (`listed`, proven, free name), budget first, 50 cap, q length cap.

### Task 8 (server): listed in quote, pay and settle; `/register/listing`

**Files:** `server_code/parsers.py` (`listed` optional bool, default true, in `parse_register_quote` and `parse_register_pay`), `server_code/api.py`, `anvil.yaml` (`pending_payments` + `listed` bool, `want_private` bool), tests.

- Quote: `price_due(kind, lectures, private, listed, paid)` with the real `listed`.
- Pay: stores `listed` and `want_private` on the pending row; purpose `"private"` stays for any paid switch (rename-free).
- Settle: sets `row.listed = pending.listed`; applies the private changes (key, access, approval runs) only when `want_private`; `paid_lectures` as before.
- `POST /register/listing {key, item, listed}` → owner only; `listed: true` always free; `listed: false` free only when `paid_lectures > 0` (else 402 `{error: "pay", due}` — pay through `/register/pay` with `listed: false`).
- Tests: every branch; settle with want_private false leaves access/runs/key untouched.

### Task 9 (app): the Listed switch and the `#browse` page

**Files:** `src/ui/share.ts` (a "Listed in the catalogue" checkbox beside Private, default ticked; the quote passes `listed`; unticking shows the price unless already covered; ticking back calls `/register/listing` free), `src/registry.ts` (`listed` in quote/pay bodies; `setListing(api, token, item, listed)`), `src/entry.ts` (a `#browse` branch before the name test → `import("./catalogue")`), new `src/catalogue.ts` (renders a standalone page: title "drawcast catalogue", a search box and a kind filter (All / Courses / Drawcasts) — search on `change`/submit, not per keystroke; cards with title, kind, "by <owner>", lectures count for courses, updated date, a "Private — ask to join" badge; each card links `https://drawcast.app/#<name>`; "More" pages), a link to the catalogue from the app (the help page and the editor's menu — follow how help.html is linked), tests (entry routing; catalogue rendering from a fixture with DOM-free helpers + source tests; Share listed states).

### Task 10 (skill): unlisted from the skill

**Files:** `scripts/cast.mjs` (`private` gains `--unlisted`; new `listing <workdir> --listed|--unlisted [--price N]` using quote/pay/listing), `scripts/cast-account.mjs` + `.d.mts`, `.claude/skills/drawcast/SKILL.md`, tests.

---

## Part C — deploy and live check

### Task 11: deploy and verify

- [ ] **Hans:** push `credit-catalogue` to drawcast-anvil master; Anvil editor pull, apply the schema (`credit` table; `pending_payments.listed`, `want_private`); add the text secret **`google_tts_key`** (the Google key that should pay for credit narration).
- [ ] Merge and push the app; `netlify deploy --build --prod` from the clean `main`.
- [ ] Live (Stripe test mode): buy 5 USD credit from the skill; publish a short drawcast with narration from a browser with no TTS key (the key field emptied) → balance drops by ≈3× the estimate; the cast plays narrated. Open `drawcast.app/#browse` → the test course appears (proven owner, listed, private badge); unlist it (covered by its private payment, free) → it disappears; list it again → it returns.
