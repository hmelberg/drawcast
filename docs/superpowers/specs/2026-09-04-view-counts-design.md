# View counts — how often has a published drawcast been played?

Date: 2026-09-04. Status: draft for review.

## 1. Goal

Know how many times each published drawcast and each course lecture has been
played, and show that number in the player. Counting is a publish-time choice
like "embed narration": on by default, and when it is off **nothing is
recorded at all** — no request, no stored key.

## 2. Ruling answers that shaped this design (Hans, 2026-09-03/04)

- **The number is the point.** "The main aim is that we should be able to get
  the number." A dashboard is optional; a readable figure is not.
- **No password.** Reads are public. Anyone who knows the repo can ask.
- **Badge in v1.** The count is shown in the player, YouTube-style.
- **Opt-out must be real.** For a drawcast published with counting off, no hit
  may reach the store — not a server-side filter, no request at all.
- **Missing flag means on**, so everything already published starts counting on
  deploy without being republished.
- **`meta.views`** is the flag name (parallel to the existing `meta.comments`).
- **Counter first**, player/viewer work in a separate round.
- No per-source breakdown (github.io vs github.com vs direct link) in v1.

## 3. Why not the obvious alternatives

Recorded so the question is not reopened later.

- **GitHub's own numbers do not exist.** GitHub Pages has no analytics, and
  `GET /repos/:o/:r/traffic/views` counts views of the *repository page on
  github.com* plus clones — not visits to the rendered Pages site. It also
  requires write access and keeps only 14 days.
- **The count cannot live in the author's repo.** The player runs in the
  visitor's browser, so a repo-local counter would mean shipping a write-scoped
  token to every visitor. Doing it server-side instead means one commit per
  view: API rate limits, commit spam, write conflicts.
- **Anvil (data tables + server functions) is a legitimate alternative** and has
  the better data model — serialisable transactions make `row['n'] += 1` an
  atomic counter, storage stays bounded, and the dashboard is nearly free. It
  loses on delivery: the endpoint would sit outside the repo, outside
  `npm test`, and outside the push that deploys everything else. Because reads
  here are public and keyed, an Anvil dashboard can still be built later as a
  *client* of this endpoint, with no migration.

## 4. Principles

1. **Writes never read.** Netlify Blobs has no compare-and-set
   (`netlify/lib/rate-limit.mts:98` records this). A read-modify-write counter
   loses hits exactly when a class opens a lecture together. Every recorded view
   is therefore an independent key, and totals are derived by counting keys.
2. **Rollups are derived, never incremented.** Two compactions racing compute
   the same number from the same raw keys and write the same result. The race
   is benign — which is the property an increment lacks.
3. **Counting never affects playback.** The beacon is fire-and-forget; every
   failure path is silent. A broken endpoint must not delay or break a drawcast.
4. **The server knows nothing about the option.** Opt-out is expressed by the
   client not calling. No flag plumbing on the server side.
5. **No personal data.** No cookies, no IP storage, no identifiers. A recorded
   view is a key and a date.

## 5. Identity: what is counted

The cast key is the content path, `owner/repo/path.yaml`:

| Published thing | Key |
|---|---|
| Single drawcast (`src/publish/cast.ts:103`) | `owner/repo/<dir>/casts/<slug>.yaml` |
| Course lecture (`src/course/publish.ts:114`) | `owner/repo/<coursesDir>/<course>/<lecture>.yaml` |

This is already the identifier in every shared link
(`drawcast.app/#gh=owner/repo/path`), so no new IDs are minted. Slugs are frozen
at publish time and written back into the course document
(`src/course/publish.ts:197-200`) precisely so links never move — the same
property keeps count keys stable across retitling and reordering.

Because the course slug is a path segment, **per-course totals come from
grouping keys on their parent directory** — no manifest lookup.

The key is derived from content, not from the referrer, so a lecture reached
from the GitHub Pages course page, from the repo README, and from a pasted
`#gh=` link all increment the same number.

## 6. Storage

Netlify Blobs, new store `views` (the existing `rate-limits` store is
untouched). The key is percent-encoded into a single path segment; call it
`<enc>`.

```
h/<enc>/<YYYY-MM-DD>/<uuid>     raw hit, empty body
r/<enc>                          rollup: {"2026-09-01": 12, "2026-09-02": 7}
```

Writing a hit is one `set` with no preceding read. Reading is a prefix `list`;
the date falls out of the key, so a per-day series needs no blob bodies fetched.

**Key validation** (rejected with 400, so the store cannot be polluted):
decoded key has ≥3 segments, ends `.yaml`, contains no `..` or leading `/`,
matches `[A-Za-z0-9._/-]+`, and is ≤300 bytes. Netlify caps keys at 600 bytes;
real keys land near 100 since slugs are capped at 40 characters
(`src/publish/github.ts:145`).

## 7. Endpoint — `netlify/functions/views.mts`

Modelled on `netlify/functions/keys.mts`: CORS allowlist, uniform errors, no
secrets. Origin allowlist is `https://drawcast.app`,
`https://hmelberg.github.io`, `http://localhost:5173`, `http://localhost:8888`
— a free speed bump against casual inflation by curl, not a security boundary.

| Request | Does | Returns |
|---|---|---|
| `POST {key}` | writes one raw hit, then reads that cast's total | `{count}` |
| `GET ?cast=<key>` | reads one cast's total, no write | `{count}` |
| `GET ?repo=owner/name` | reads every cast under that repo | `{casts:[{key,total,days}], courses:{<folder>:total}}` |

`GET ?repo=` carries `Cache-Control: public, max-age=60` so repeated dashboard
reads hit the CDN rather than relisting. An unknown repo returns empty
collections, not an error.

**Reading one cast** is a single pass, in this order:

1. `get r/<enc>` with `consistency: "strong"` — the rollup, a date→count map.
   Strong is required, not cosmetic: compaction writes the rollup and deletes
   the raws it replaces, so a stale rollup read alongside already-deleted raws
   would silently lose those views.
2. `list h/<enc>/` — every raw hit not yet rolled up, whatever its date.
3. Total = sum of rollup values + number of raw keys. Both are summed
   unconditionally: a raw key from a past day still counts, it has simply not
   been compacted yet.
4. Compaction, from the listing already in hand: for each date *strictly before
   today*, add its count into the rollup, write `r/<enc>`, and only then delete
   those raw keys (capped per invocation; the remainder waits for the next call).

This is self-limiting — the first read of a new day compacts yesterday — so
step 2 lists only today's hits from then on, permanently, no matter the lifetime
total. That is what makes the badge affordable on every view.

**Blobs is eventually consistent**, so a POST's own key may be missing from the
list it performs immediately afterwards. The response therefore adds its own hit
when it does not find it, rather than reporting a number that briefly goes
backwards.

(Noted while writing this: `netlify/lib/rate-limit.mts:39` calls `getStore` with
no `consistency: "strong"`, so its failed-password budget reads stale values and
under-counts. That is a pre-existing one-line bug in a different feature, not
this one — recorded here so it is not lost.)

## 8. Client

**`src/views.ts`** (new): `recordView(key)` and `readCount(key)`. The endpoint
is resolved through the same two-origin list pattern as `VENDING_ENDPOINTS`
(`src/keys.ts:21`), because the player runs on both `drawcast.app` and
`hmelberg.github.io` while the function exists only on Netlify. All errors are
swallowed; the return type is `number | null`.

**Dedupe:** a `sessionStorage` marker per cast. First view in a browser session
POSTs; a reload in the same tab reads with `GET ?cast=` instead, so the badge
still shows a number without inflating it. A fresh visit counts again.

**Call site:** `src/viewer.ts`, immediately after the YAML is fetched and parsed
(around `viewer.ts:221`) and *before* `mountPlaylist` — the flag arrives with
the playlist, and mounting takes seconds, during which a visitor may leave. It
is not awaited.

Counting happens only in the `#gh=` viewer. A drawcast opened from a local file,
from the editor, or through the vendored engine (`src/engine-element.ts`) has no
published key and is never counted.

**Badge:** rendered into a `.viewer-meta` row placed directly *below* the
player figure — not beside the title and not in the control bar. Both of those
move in the player round; a meta row under the player is where the count
belongs in that layout too, so it is built once. Hidden entirely when counting
is off or when no number comes back — never "N/A", never "0" from a failure.

## 9. The publish option

`meta.views: true | false`, written into the published YAML exactly where
`meta.comments` is written today (`src/main.ts:4009`, `src/ui/course.ts:871`).
Always written explicitly, so a published file describes its own behaviour.

- Checkbox in the share panel beside the two embed checkboxes
  (`src/ui/share.ts:323-390`), default on, preference persisted like its
  neighbours.
- Checkbox in the course publish modal (`src/ui/course.ts:834`), course-level,
  applying to every lecture — the same shape as baking narration. No per-lecture
  override.
- The viewer treats a **missing** flag as on, so existing publications count
  from the day this deploys.

Opt-out is honoured by the player, not enforced by the server: the flag is data
and the player is public code. For counting drawings, with no personal data
involved, that is the right place to stop.

## 10. Scaling

Writes are O(1) forever, with no contention. Storage is ~120 bytes of key per
view; 100,000 views is a few MB, and Netlify documents no object-count limit.

Reads are the part that grows, because `list()` pages at 1,000 keys. **With
compaction, both read paths are proportional to one cast's hits today**, so the
ceiling is the number of distinct drawcasts in a repo — dozens for a course —
rather than the number of views. Without compaction the repo read would be
comfortable to ~10,000 views and uncomfortable near 100,000; that is why
compaction is in v1 rather than deferred.

If this ever needed millions of views, the move is Postgres with an atomic
increment. Nothing here blocks it.

## 11. Testing and verification

`vite.config.ts:9` pins `environment: "node"` and there is no jsdom, so tests
are unit-level; the fit is verified in a browser.

- Key encode/decode/validate: accepted and rejected forms.
- Endpoint with a fake store: POST writes exactly one key; malformed keys 400;
  disallowed origin refused; `?repo=` groups by course folder; totals merge
  rollups with raw hits.
- Compaction: past days only, today untouched; running it twice yields the same
  totals; raws deleted only after the rollup is written.
- Client: session dedupe POSTs once then reads; every failure returns `null`.
- Viewer: `meta.views: false` issues **no request at all**; a missing flag
  counts; a failing endpoint never prevents mount.

Live smoke: publish a drawcast, open its link, badge shows 1, reload shows 1,
`?repo=` shows it, republish with the box unticked and confirm no new key.

## 12. Out of scope

- **Course index landings.** The generated course page
  (`src/course/page.ts:62`) is script-free HTML the player never sees. A small
  inline script would count landings, but it changes published output and needs
  courses republished. Separable; not in v1.
- **Per-source breakdown.** A source token in the key
  (`h/<enc>/<date>/<source>/<uuid>`) would keep counting-by-prefix intact, but
  referrers are coarse and often absent.
- **The player round** (next, separately specced). Its frame is a YouTube-like
  separation: the player is a hard boundary containing everything that changes
  what you see (stage, controls, params tray, code panels), while everything
  *about* the drawcast — title, view count, share, comments — sits below it as
  page furniture. Fullscreen already honours that boundary
  (`tests/fullscreen-frame.test.ts` enforces that every `:fullscreen` selector
  names `.player-figure`); the non-fullscreen layout does not yet. Unlike
  YouTube the box must be allowed to grow taller when a tray or code panel
  opens, rather than being pinned to a video-shaped rectangle. Concretely:
  fit-to-window sizing for
  `#gh=` links, giscus comments below the drawcast, the `.viewer-footer` strip
  dropped and Share moved to an icon — in the control line as Hans first asked,
  or in the meta row beside the count as YouTube would have it; that round
  decides. A poster frame showing the final
  image before play (designed so a user- or LLM-supplied start image can replace
  it later), the replay icon wrongly flashing at chapter boundaries, and
  drawcasts sometimes ending on an empty chapter.

## 13. Files touched

New: `netlify/functions/views.mts`, `netlify/lib/view-key.mts`, `src/views.ts`,
plus tests.

Changed: `src/viewer.ts` (count after parse, badge near the title),
`src/ui/share.ts` and `src/ui/course.ts` (checkbox), `src/main.ts` and
`src/ui/course.ts` (write `meta.views`), `src/styles.css` (badge).

The publish *flow* is unchanged: no new files in the author's repo, no change to
what gets committed beyond one `meta` line, and nothing already published needs
republishing to start counting.
