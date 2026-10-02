# Registry, private courses, free names and paid extras — design

Decided with Hans in conversation, 2026-09-29. Supersedes the parked "Private
courses on the drawcast server" plan (ROADMAP, 2026-09-17) for its first steps:
private content now lives **encrypted in the author's public GitHub repo**, not
on Anvil. Anvil storage for courses stays a later option.

## The principle

Everything shared openly is free and encouraged. Fancy names, privacy, being left
out of the catalogue, and anything that costs server time (narration made with
drawcast's voice key) are paid for, as one-time payments through Stripe.

## Decisions

| Topic | Decision |
|---|---|
| Registration | Every publish, from the app or the skill, is registered with Anvil. |
| Switches | Two, independent: **listed / unlisted** (in the catalogue) and **public / private** (who can watch). |
| Private means | Only **enrolled** learners watch (plus teachers and owner). Joining is always **by approval**. |
| Where private lives | The author's **public** GitHub repo; each lecture file **encrypted** with a per-course key. |
| Key handling (first step) | **Mode 2a**: Anvil holds the key and gives it to signed-in, enrolled learners' browsers. The owner can see and share it. |
| Overview | Title, lecture list, course page and join page are **public for private courses too**; only lecture content is locked. |
| Prices | Public + listed: free. Any other combination: **3 USD** per drawcast; per course **1 USD per lecture, 3 USD minimum**. Private includes unlisted if the author wants it; private + listed is allowed. |
| Growth | A later publish that adds lectures pays **1 USD per new lecture**. Removing lectures refunds nothing; revising is free. |
| Names | Paid names as today, by length. Plus **one free name per item, made from the title, not editable**. |
| Name visits | Counted **always**, per name per day, with country and source; visible to the name's owner. Lookups go through a caching Netlify function (option B). |
| Narration | Authors without their own Google voice key can buy **narration credit**; Anvil records lines with drawcast's key at **3× Google's list price**. |
| Later | Mode 1 (author-held key / secret link), mode 2b (Anvil decrypts, so access can be taken back), Anvil storage, authors charging learners (Stripe Connect), catalogue page. |

## 1. The registry

Anvil's `courses` table (today: `key, title, page_url, owner, access, lectures,
created`) becomes the registry of published items. New columns:

- `kind`: `course` or `cast`
- `listed`: bool, default true
- `private`: bool, default false
- `paid_lectures`: int, the lecture count paid for (0 for free items)
- `course_key`: the per-item encryption key, stored encrypted with Anvil's
  `anvil.secrets.encrypt_with_key` (a table leak alone does not reveal keys)
- `claimed`: datetime the GitHub location was proven (see *Ownership*)
- `updated`: datetime

Keys (unchanged form): a course is `owner/repo/<folder>`. A single drawcast is
its own path **without the extension**, e.g. `owner/repo/casts/qaly-intro`, so
a private drawcast is its own enrolment unit. Server progress tracking maps an
event's cast key to its course by folder today (`courseKeyOf`). For a
registered single cast the mapping must yield the cast's own key; the server's
`course_of` looks for a registered single-cast row first, then the folder.

`access` keeps its column: public → `open`, private → `enrolled`. `signed-in` is
no longer offered; existing server casts that use it keep it.

Free public + listed registrations may be made without sign-in (owner empty).
Anything paid or private needs a signed-in owner.

### Ownership of a GitHub location

Today the first drawcast account to register a location owns it. Once
registration is the default, that invites someone to claim another person's
repo first. **Proof by claim file:** on a signed-in publish, Anvil issues a
nonce; the publish commits `.drawcast/claim` containing it in the repo (one
file per repo, rewritten when a new account claims); Anvil reads it from
`raw.githubusercontent.com` and records `claimed`. An unproven owner can be
replaced by a proven one. Only a proven owner can make an item private, pay
for it, or see its key.

## 2. Names

Two tables stay separate: `names` (the small public lookup: name → kind,
target, page, lectures, owner) and the registry. A name points at a registry
item; an item can have several names.

### Paid names (as today, one tier added)

| Base length | Price |
|---|---|
| 3–5 | 20 USD |
| 6–7 | 10 USD |
| 8 and longer | 5 USD |

Any name the author **chooses** is paid, whatever its length.

### The free name

On an item's first registration Anvil gives it a name made from its title:

1. `slugify(title)` (already folds æ→ae, ø→o, å→a, accents), cut at a word
   boundary to fit the 40-character limit.
2. If it is shorter than 20 characters, or starts with a reserved word
   (`gh`, `gdoc`, `gdrive`, `url`, `anvil`, `api`, `name`, `course`, `learner`,
   `me`, `www`), append `-by-<author>` (the drawcast account's handle, else the
   GitHub owner), then cut again at 40.
3. If it is empty (a title with no convertible letters), use `<author>-` plus a
   short code.
4. If taken, append `-2`, `-3`, …

Rules: not editable; one per item; it follows its item to a new location (a
repo move) but can never point at a different item; kept when the title
changes; released 90 days after its item is deleted. Private items get one too
(it leads to the public course page and join page).

`names` gains `free` (bool) and `item` (the registry key it belongs to).

### Name lookups and visit counts (Netlify)

The app resolves a name through a new Netlify function, `/.netlify/functions/name`,
instead of calling Anvil directly. It:

- answers from a short cache (about 60 s) and asks Anvil's `GET /name` only on
  a miss, which gives the fast lookup;
- records one visit per lookup in a daily total for that name: count, by
  **country** (Netlify's `context.geo`), by **source** (bare `#name`,
  `name.drawcast.app` subdomain, `name/n` lecture form) and by **referring
  domain**. No IP address, no cookies, no visitor id;
- stores totals in Netlify Blobs, one record per name per day.

The totals are shown only to the name's owner: the Anvil dashboard reads them
from Netlify with a server-to-server secret. The public view counter
("count views") is unchanged and separate.

## 3. Publishing (app and skill)

The Share panel gets **Listed / Unlisted** and **Public / Private** next to
Publish, defaulting to public + listed, with the price shown live. The skill
takes `--unlisted` and `--private`.

A publish runs in this order:

1. **Quote.** `POST /register/quote {target, kind, lectures, listed, private}`
   → `{due_cents, reason, may}`: the price (0, full, or the difference for new
   lectures) and whether this account may publish there.
2. **Pay** if `due_cents > 0`: `POST /register/pay` opens Stripe Checkout (the
   pending → settled flow names use today, generalised by purpose). The skill
   requires `--price <cents>` equal to the quote, as `name --buy` does.
3. **Key** for private items: `POST /key` as owner returns the course key
   (created at the item's first private registration).
4. **Encrypt** each lecture file (below) and **commit** to GitHub as today.
   Paths and file names do not change; the course page, READMEs, `courses.json`,
   `casts.json` and `course.md` stay readable.
5. **Register** the final state: `POST /register {target, kind, title,
   lectures, listed, private, page}`. The response carries the item's free name.

A failed commit after payment costs nothing to retry: the paid lecture count is
already recorded.

### Changing switches later

- listed → unlisted, public → private: the price once; an item already paid
  for pays only for new lectures.
- unlisted → listed: free.
- private → public: **not a switch (2026-10-03).** An author republishes a public copy under a new name or folder (new links; learner progress stays with the private original). The Share panel says so when Private is unticked on a server-private item. A real switch is designed in `2026-10-03-private-to-public-design.md`, shelved.
- public → private warns that **earlier unencrypted versions stay readable in
  the repo's git history**, and offers publishing into a new folder instead
  (new links; names can be repointed).

### Encrypted lecture format

The file keeps its path and `.yaml` extension; its content becomes:

```yaml
drawcast-encrypted: 1
item: owner/repo/folder
alg: AES-GCM-256
iv: <base64, 12 bytes>
data: <base64 ciphertext of the original file's bytes>
```

A fresh IV for every file and every publish. Browsers (WebCrypto) and Node
(`node:crypto`) both do AES-GCM natively. The key is 256 random bits, made by
Anvil.

The skill's `pull` / `unpack` / `repack` / `push` decrypt and re-encrypt with
the owner's key, so revising a private course works as before; on GitHub a
revision's diff shows only ciphertext.

## 4. Viewing

- **Drawcast name** → plays it (sign-in / join first if private).
- **Course name** → its GitHub course page, public or private. No page (Pages
  off) → today's course door on drawcast.app.
- **Course page**: as today, plus a Join section for joinable public courses
  and always for private ones ("Request to join"). Join links go to
  `drawcast.app/#<name>&join` (or the GitHub link + `&join`), never back to the
  bare name.
- **Encrypted lecture**: the player sees `drawcast-encrypted`, then asks Anvil
  `POST /key {item, key: <session>}`:
  - 401 → "This lecture is private. Sign in to watch" + Request to join
  - 403 with `standing: none | pending` → Request to join / Waiting for approval
  - 200 → key; decrypt and play. The key is kept per item in the browser.
- The player **asks Anvil every time it is online**, using a kept key only when
  Anvil cannot be reached; a 401/403 deletes the kept key.
- Encrypted lectures play on the main origin (where the account lives), like
  private server casts today (`namedRoute` / `accountBound`).
- Progress tracking is unchanged: events are keyed by the lecture's path.

## 5. Narration credit

- `POST /tts/credit` buys credit (Stripe, e.g. packs of 5 USD).
- `POST /tts {lines, voice}` (session key) → audio per line, charged at 3× the
  rates in `src/export/tts-cost.ts` (`TTS_PRICE_PER_MILLION`), deducted from a
  `credit` ledger. Refused with the balance when it would go negative. Rate
  limited per account.
- The app uses it when there is no Google key in Settings and the author has
  credit; already recorded lines are reused as today and cost nothing.
- drawcast's Google key lives in Anvil Secrets.

## 6. Anvil changes, summarised

- Tables: `courses` extended (above); `names` + `free`, `item`; `pending_names`
  generalised to `pending_payments` with a `purpose` (`name`, `register`,
  `credit`); `payments` + `purpose`; new `credit` (owner, balance, ledger rows).
- Endpoints: `/register/quote`, `/register/pay`, `/register`, `/key`,
  `/tts/credit`, `/tts`, `/claim` (nonce); `/name` answers include the free
  flag.
- Dashboard: course key (show / copy), listed switch, join approvals (exists),
  name visit totals, narration credit balance, delete registration (free).
- Deleting a registration or account is always free (GDPR); personal data is
  the owner link only.

## 7. Deliveries

1. **Registry, prices, names.** Registration on every publish (app, skill);
   claim-file ownership; unlisted with its fee and pay-the-difference; the free
   title name; the Netlify name lookup with visit counts; course name → GitHub
   course page; Join links to `&join`; dashboard: items, names, visits.
2. **Private (mode 2a).** Per-item enrolment for single casts; encryption on
   publish (app, skill); the player's key flow and messages; "Request to join"
   on course pages; key in the dashboard.
3. **Narration credit.**
4. **Catalogue page** of listed items.
5. **Later**: mode 1, mode 2b, Anvil storage for courses, Stripe Connect for
   authors charging learners.

## Open points for the plans

- The dashboard's server-to-server read of Netlify name totals: a shared secret
  in both Anvil Secrets and Netlify env.
- Whether the app's own GitHub reads (manifests, "Load courses") need anything
  for private items: they read plaintext files only, so no.
- Grace period mechanics for released free names (a scheduled Anvil task).
