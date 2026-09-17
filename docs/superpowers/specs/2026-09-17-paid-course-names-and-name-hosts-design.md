# Paid course names, and NAME.drawcast.app — design (2026-09-17)

Hans: "Giving a course a name should cost 3 dollars. or 5? Can we implement
that? How? Maybe we can use anvil (it has stripe)." And: "can drawcast.app
also redirect NAME.drawcast.app to drawcast.app#name?" — with the ruling
"the redirect should only work for named drawcasts or courses (those that
buy a name)". Both delivered on the same day as this document; the design is
recorded for the decisions, not as a plan.

## 1. What is sold

The **door name** of a course — `drawcast.app/#<name>`, the course
document's `name:` option (name round, same day) — one time. Cast names stay
free behind the 8-character floor. A course name has no floor but three
characters, and is priced by the base name's length, in US cents:

| base length | price |
|---|---|
| 3–5 | 2000 (20 USD) |
| 6–7 | 1000 (10 USD) |
| 8+ | 500 (5 USD) |

Re-registering a name you own is free (a republish). A rename buys the new
name; the old one keeps resolving (the registry never forgets a name). The
tiers live in `server_code/names.py` (`PAID_MIN_LENGTH`, `PRICE_TIERS`,
`PRICE_LONG`, `PRICE_CURRENCY`) and are mirrored in `src/names.ts`;
`tests/names.test.ts` pins the mirror to the Python source.

## 2. How the money moves

**Stripe Checkout** — Stripe's hosted page — created and read back by plain
REST from Anvil server code (`anvil.http.request`, form-encoded in, JSON
out), with the secret key and the webhook secret in Anvil's Secrets
service. No SDK: the server runs `python310-minimal` with no package list.
Not Anvil's built-in Stripe popup: it rides Stripe's legacy Checkout, which
lacks the bank authentication (SCA) European cards require.

The road:

1. `POST /name` for a course name that is free answers
   `402 {error: "pay", price, currency}` — BEFORE the course claim, so a
   refused sale never repoints a course. A name already yours registers free.
2. `POST /name/pay` (the registration body + `return`, an allowlisted
   drawcast.app address) walks the same verdicts, claims the course, parks
   the registration in `pending_names` (secret, owner, the name fields,
   amount, currency, return_url, state `pending`), creates the session with
   `payments.checkout_fields` — metadata AND client_reference_id carry the
   pending secret, `success_url` is `<anvil>/_/api/name/paid?p=<secret>&s={CHECKOUT_SESSION_ID}`,
   `cancel_url` is `<return>#unpaid=<name>` — and answers `{url}`. A failed
   Stripe call deletes the pending row (`503 stripe`).
3. `GET /name/paid?p=&s=` trusts nothing in the query: it fetches the session
   from Stripe and judges it with `payments.session_pays_for` (paid, our
   pending id, our amount, our currency), settles, and `302`s to the return
   address with `#paid=<name>` — or `#unpaid=<name>`, or `#taken=<name>` when
   the name went to someone else between checkout and payment (refund by
   hand from the Stripe dashboard).
4. `POST /stripe/webhook` — `checkout.session.completed`, signature verified
   over the RAW bytes (`payments.verify_signature`: `t=`/`v1=` HMAC-SHA256,
   300 s tolerance) before anything is parsed — settles too, for a tab
   closed after paying.

**Settling** (`_settle_pending`) writes the `names` row through
`_name_write`, exactly as a free registration does, marks the pending row
`paid`, and adds a `payments` row (session, owner, name, amount, currency,
source `return|webhook`, at). Idempotent: the second confirmation is a no-op.

**The client.** `registerName` answers `pay` on 402; the course publish then
goes through doorless and the panel shows a **Pay 5 USD for
drawcast.app/#micro-i** button on its status line (`offerPayment`), which
calls `startNamePayment` and sends the browser to Stripe. Back on
drawcast.app, `paidInHash` reads the marker; `paid` says "publish the course
again to put the Join door on its page" with an Open-courses action — the
page's door is only ever built from a name this account has registered, and
that rule stands. The Check button asks as a course when the subject is a
course (`checkCourseName`: paid floor, `kind: "course"`, price back) and the
note says what a free name costs; the Name field's hint names the tiers.

Rate budgets: `pay` 20/h, `paid` 60/h, `webhook` 600/h per IP.

## 3. NAME.drawcast.app

An edge function on every path (`netlify/edge-functions/name-host.mts`)
reads the Host. When it is ONE label under `drawcast.app` that passes the
base half of the name rule and is not reserved (`www` joined
`RESERVED_PREFIXES` in both repos), it answers `302 https://drawcast.app/#<label>`;
everything else — the apex, www, Netlify's own hosts, two labels — passes
through. The registry then resolves the name as it resolves any hash, so
only a registered name opens anything, paid or free; an unknown label lands
on the app's own "No drawcast called …". A redirect rather than the app on
the subdomain because localStorage is per origin: the token, settings and
library live on drawcast.app. The rule is pure (`netlify/lib/name-host.mts`,
`tests/name-host.test.ts`, pinned to `src/names.ts`). Names with a second
segment (`spanish/1`) have no host form.

## 4. What Hans does

- **Netlify:** add `*.drawcast.app` as a domain alias on the site (DNS is on
  Netlify DNS — NS1 — so the wildcard certificate is issued there).
- **Stripe dashboard:** test mode first. Developers → API keys → the secret
  key into Anvil Secrets as `stripe_secret_key`. Developers → Webhooks → add
  endpoint `https://drawcast.anvil.app/_/api/stripe/webhook`, event
  `checkout.session.completed`, its signing secret into Secrets as
  `stripe_webhook_secret`. Repeat with live keys when going live.
- **Anvil:** pull; accept the schema (two new tables, `payments` and
  `pending_names`); the new server module `payments.py` gets its editor id on
  the pull (`.anvil_editor.yaml` was left alone — its ids are the editor's).
- **Rotate** the Stripe Connect refresh token committed in plaintext in
  `anvil.yaml` if that repo is ever public.
- **Business side** (not code): a registered business for Stripe, and VAT on
  digital sales to consumers in Norway/EU — Stripe Tax can compute and
  collect it (`automatic_tax` is one field in `checkout_fields`, off today).

## 5. Terms of the name service

Hans (2026-09-17): "Donation to Drawcast for name service with no guarantees
or refunds (uptime or existence over time)." Rephrased, because a donation
given in return for a delivered name is a paid digital service under
Norwegian and EU consumer rules whatever it is called, and because one
refund case already exists (`#taken=`):

> Registering a course name is a one-time contribution to drawcast, not a
> subscription. It registers the address drawcast.app/#name to your account
> for as long as drawcast operates. drawcast is a free research project and
> offers the service as-is: no guarantee of uptime, of the address
> continuing to resolve, or of the service existing in the future. No refund
> is made once the name is registered. If the name cannot be registered
> after payment, because someone else took it in the meantime, the payment
> is refunded.

Where it shows: the Name hint in the Publish dialog (short form), the Pay
button's tooltip and Stripe's product description (`payments.TERMS_LINE`,
one line, on Stripe's page and receipt), the help page's Names section, the
Anvil README, and here.

## 6. Not done

- Refunds are manual (Stripe dashboard); the `taken` outcome names the case.
- No receipt mail beyond Stripe's own.
- No price in NOK/EUR; the currency is one constant in both repos.
- Deleting a single drawcast's previous file on a rename (cast publish says
  "no deletions").

## 7. Addendum 2026-09-18 — the pretty link, for every work

Hans: "publishing a single drawcast with a 'paid' name is not an option (is
it only for courses? it should not be). Add 'Buy pretty link' as an option in
the menu and we then use the name in the name box and charge people." Three
rulings followed the discussion:

1. **The direct link stays free; every pretty link is bought.** The
   automatic free registration of 8+-character cast names at a GitHub or
   server publish is gone (it lived in `publishDrawcast` and
   `publishServerCast` until commit 181305a — one call site each, the
   functions stay). Names already registered keep resolving.
2. **Same prices for casts and courses** (§1), floor 3 for both. The server's
   write rule is `names.payable` for every kind; `POST /name` answers 402 for
   any name not yet the caller's; `/name/pay` takes both kinds (the claim only
   for a course); `/name/check` prices every name.
3. **Renames never move files** (§1 and the name round).

**The panel.** A "Pretty link" row in Share's rail, for both subjects, with
its own panel: the name box (prefilled from the published name or the
title), the one Check button in Share (`checkPaidName`, kind by subject,
price in the note), a live price line, "Points at" — the published copies
the link can point at (`prettyCopies`: a drawcast's GitHub copy from
`publishedAs` + the settings' repo, its server copy from the new
`serverCast` field the server publish records, its Drive copy from
`drivePublishedId`; a course's page) — the terms (§5), and Buy, which signs
in first when needed. Nothing published → "Publish first — the link needs
somewhere to point" and Buy disabled. Link's and the server's Name fields
name FILES and lost their Check buttons.

**Drive becomes nameable:** a cast target may be `gdrive/<file id>`
(`parsers.GDRIVE_RE`); `anvilHashFor` plays it through `#gdrive=`. Sharing
the file stays the author's job.

**Buying.** A drawcast: `buyPrettyLink` in main.ts → `startNamePayment`
(kind cast, the chosen copy) → Stripe → `#paid=`. A name already the
account's is re-pointed for free (`registerName`). A course: the panel
writes the name into the document as `name:` (`applyCourseName`), then
`startNamePayment` (kind course, the course folder as target; the server
claims the course first); at every later publish the course's registration
re-points the owned name for free and builds the page's door from it. The
course panel's own Pay button (§2) is gone — the Pretty link panel is the
one place.

Not done: a name before anything is published (a reservation without a
target invites the squatting the price deters); deleting a cast's previous
file on a rename.
