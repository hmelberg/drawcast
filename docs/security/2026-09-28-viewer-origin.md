# A separate origin for other people's casts (2026-09-28)

Step 2 of the code-execution review
([inventory](2026-09-28-code-execution-inventory.md)). Step 1 made a cast's
own code ask before it runs. This step makes "Run it" cheap to say yes to:
other people's public casts play on an origin that holds no secrets, so code
that runs there has nothing to take.

## Where things stand today

- The editor and the share viewer are **one page on one origin**:
  `src/entry.ts` routes on the hash (`#gh=`, `#gdoc=`, `#gdrive=`,
  `#anvil=`, `#<name>` → viewer; anything else → editor).
- `NAME.drawcast.app` does **not** isolate anything. The edge function
  (`netlify/edge-functions/name-host.mts`) 302s it to
  `https://drawcast.app/#name` — deliberately, so the sign-in token and
  library are there (see the comment in `netlify/lib/name-host.mts`).
- On that origin's localStorage: the BYOK Anthropic key, the drawcast
  account token (`drawcast.token`), the GitHub token, the TTS key, the
  library, My templates. Google OAuth tokens live in memory on the same page.
- localStorage is per origin, so *any* other origin — a subdomain included —
  starts empty. Nothing else (cookies, service workers) is shared: the app
  sets no cookies of its own.

## Design

One build, one Netlify site, two hostnames. `VITE_VIEW_ORIGIN` (a build-time
env var, also read by the edge function at runtime) names the view origin;
unset, nothing changes. `src/security/view-origin.ts` decides everything,
before any storage is read (`src/entry.ts`):

| Arriving at | Link | Goes to |
|---|---|---|
| main | `#gh=`, `#gdoc=`, `#gdrive=` | **view** (same hash) |
| main | `#name` → public cast | resolves, then **view** (`namedRoute`) |
| main | `#name` → course door, `#anvil=` (private server cast), `…&join`, `…&t=` (sign-in), `#remix&…`, anything else | stays |
| view | public source or `#name` → public cast | stays, plays |
| view | the editor (no hash), `#remix&…`, `#anvil=`, `…&join`, a course door | **main** |
| view | a sign-in coming back (`t=`) | **main**, token intact, redeemed there |
| view | a cast whose `enroll:` reports to drawcast's server | **main** (`enrollRoute`) — learner progress needs the account |
| any other host (localhost, deploy previews, `*.netlify.app`) | — | untouched |

Every hand-back to the main origin carries `&main`, which the main origin
never bounces again (pinned by a no-bounce test).

**Nothing secret on the view origin, enforced where secrets are read, not
only by routing:** on the view origin `getApiKey`, `getTtsKey`,
`getGithubToken` (`store.ts`) and `getToken` (`account.ts`) answer `""`, their
setters do nothing, `requireScope` (`google/auth.ts`) refuses, and the
sign-in redeem never runs. So even a path nobody routed correctly cannot
leave a secret there.

**Edit a copy** (the remix path): on the view origin the viewer shows "Edit
a copy" beside "Made with drawcast". It links to
`https://<main>/#remix&gh=…` (credentials and markers stripped). The editor
(`main.ts`) fetches the public source itself and opens it as an unsaved
document — exactly an upload — so its template bodies and scripts go through
the step-1 gate in `present()`. Private server casts have no public copy and
get no button. Crafting a `#remix&` link oneself gets nothing more than an
upload would: the prompt.

**Framing:** the main origin keeps `frame-ancestors 'self'` (it holds
secrets; clickjacking "Run it" there would matter). On the view host the edge
function rewrites only that directive to `frame-ancestors *`, so a course
page or an LMS can iframe a cast. The edge function also never treats the
view host as a `NAME` label.

### Why a separate registrable domain (recommended) rather than `view.drawcast.app`

Both are separate origins, so both keep localStorage apart. A separate
*site* (a different registrable domain, e.g. `drawcast-view.app`) is
stronger:

- Chrome's site isolation puts same-site origins (`view.drawcast.app` and
  `drawcast.app`) in the same renderer process; a separate site gets its own,
  which is what contains a renderer exploit or a Spectre-style read.
- A cookie ever set with `Domain=drawcast.app` would reach every subdomain;
  none is set today, but it is one line away.
- `*.drawcast.app` is already a wildcard of *user-chosen* names; keeping the
  viewer out of that namespace avoids a name owner and the viewer ever
  sharing a hostname (a registered name `view` would today take
  `view.drawcast.app`).

`view.drawcast.app` works with this code (the edge function excludes the
configured view host from name redirects) and needs no new domain; if you
choose it, also reserve `view` on the server (below).

### What still runs on the main origin, and why

- **The editor**, and what you open in it: uploads, Drive files, "Edit a
  copy", your library. Gated by step 1.
- **Private server casts** (`#anvil=`) and **course doors / join links /
  learner-tracked lectures** — they need the account by design. Their
  authors are teachers of courses the viewer joined; still other people's
  code, still gated by step 1. Moving these would need a scoped
  learner-only token issued by the server (a server change; not in this repo).
- **A link crafted with `&main`.** Anyone can write one to force the main
  origin; they still meet the step-1 prompt. The origin split is defence in
  depth, the gate is the control.

### Costs of the split (for the owner to weigh)

- Viewers on the view origin hear the browser's voices unless the narration
  was baked at publish (no TTS key there — by design).
- Settings, local answer records and "Run it" approvals are per origin, so a
  viewer's preferences on the view origin start fresh.
- A `NAME.drawcast.app` link now takes three hops (name host → apex, name
  lookup → view origin). Could be cut to two later by resolving in the edge
  function.

## Owner checklist (nothing here was done by the agent)

1. **Choose the view domain.** Recommended: a new registrable domain you own
   (e.g. `drawcast-view.app`). Alternative: `view.drawcast.app`.
2. **Netlify → the drawcast site → Domain management → Add a domain alias**
   for the view domain (the same site — the same build serves both).
   - New domain, DNS at Netlify: add the domain to Netlify DNS and point the
     registrar's nameservers at the four Netlify nameservers shown.
   - New domain, DNS elsewhere: apex `A 75.2.60.5` (Netlify's load balancer)
     or an `ALIAS/ANAME` to `<site>.netlify.app`; a subdomain as
     `CNAME <site>.netlify.app`.
   - `view.drawcast.app`: DNS is already on Netlify with the `*.drawcast.app`
     wildcard; still add `view.drawcast.app` as its own alias so it is
     explicit.
   - HTTPS: Domain management → HTTPS → "Verify DNS configuration" /
     "Provision certificate" once DNS resolves.
3. **Environment variables** (Site configuration → Environment variables;
   scopes: *Builds* **and** *Functions/Edge functions* — the edge function
   reads it at runtime):
   - `VITE_VIEW_ORIGIN = https://<view domain>` (no trailing slash)
   - `VITE_MAIN_ORIGIN = https://drawcast.app` (optional; this is the default)
   Neither is a secret.
4. **Trigger a deploy** (Deploys → Trigger deploy). The build inlines the two
   values; without a rebuild nothing changes.
5. **Google Cloud console:** if the API key behind `VITE_GOOGLE_PICKER_KEY`
   is restricted by HTTP referrer, add `https://<view domain>/*` (the viewer
   fetches `#gdrive=` casts with it). The OAuth client needs no change — no
   sign-in happens on the view origin.
6. **drawcast server (drawcast.anvil.app):** allow CORS from the view origin
   for `/_/api/name` (name lookups now also happen there). If you chose
   `view.drawcast.app`, add `view` to `RESERVED_PREFIXES` in
   `server_code/names.py` (and then to `src/names.ts` and
   `netlify/lib/name-host.mts`, which the tests keep equal).
7. **giscus:** an author whose repository restricts comment origins
   (`giscus.json` `origins`) must add the view origin for comments to load.
8. **Verify after deploy:**
   - `https://drawcast.app/#gh=<owner>/<repo>/<cast>.yaml` lands on the view
     domain and plays;
   - on the view domain, DevTools → Application → Local Storage has no
     `drawcast.token` and no API key entries, even after signing in on
     drawcast.app;
   - response headers on the view host show `frame-ancestors *`, on
     drawcast.app `frame-ancestors 'self'`;
   - "Edit a copy" opens the editor on drawcast.app with the cast, and a cast
     with code shows the prompt;
   - `NAME.drawcast.app` for a public cast ends on the view domain; a course
     name stays on drawcast.app and shows its door; a learner-tracked lecture
     ends on drawcast.app with `&main`.
9. **Rollback:** delete `VITE_VIEW_ORIGIN` and redeploy.

## Verified locally

A production build with `VITE_MAIN_ORIGIN=http://localhost:4180` and
`VITE_VIEW_ORIGIN=http://localhost:4181`, both served with netlify.toml's
headers (`scripts/csp-headers.mjs`), headless Chromium, muted:

- `main/#gh=…` → redirected to the view origin; a cast with a template and a
  script prompted there; after "Run it", the view origin's localStorage held
  only `drawcast.packsDefault.v8` and `drawcast.trustedCode` — no token,
  though the main origin had one;
- "Edit a copy" → `main/#remix&gh=…` → the editor opened the copy (hash
  cleared) and the trust prompt appeared;
- `view/` (the editor) → main; `view/#anvil=…` → `main/#anvil=…&main`;
- zero CSP violations throughout.

Not verified: the edge function on Netlify's runtime (unit-tested with a
stubbed `Netlify.env`), real DNS/TLS, the drawcast server's CORS for the new
origin, the Google API key's referrer rules.

Tests: `tests/view-origin.test.ts` (routing table, no-bounce, remix, empty
secret getters on the view origin, the edge function's host exclusion and
framing rewrite).
