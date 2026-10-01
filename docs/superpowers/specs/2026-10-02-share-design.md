# Share a drawcast — design

2026-10-02. Status: spec, not built.

## 1. What this is for

Someone has watched a drawcast — or made one — and wants to show it to other
people where those people already are: a Facebook or LinkedIn feed, a group
chat, an email. Today they can copy the address bar, and whatever they paste
shows a bare link with no title and no picture, because every drawcast link
keeps the cast after a `#`, which link-preview crawlers never see.

The aim, in one line: **a Share button in the player that hands out a link
which shows up in a feed as the cast's own card — its title, one line, and its
picture.** Viewers and authors share the same way; the author is just the
first person to share.

Not in this version: sharing a question (a guess) as the hook, opening a link
at a moment, embedding in course platforms, video formats for social media
(teaser, square, vertical, MP4), posting through a platform's own API, and
email sent by Anvil. §9 says where each would attach later.

## 2. What exists today

- **The picture.** `posterForPlaylistText` (`src/export/snapshot.ts:125`)
  draws one picture per cast: the author's `poster:` image when it can be
  fetched, else the finished drawing of the **last** content part (never the
  end page), 1000×750. The app's GitHub publish commits it beside the cast as
  `<file>.png` (`posterPathFor`, `src/publish/cast.ts:93`); course publishes
  do the same per lecture (`src/course/publish.ts:418`). The viewer shows it
  while the cast loads (`src/viewer.ts:713`). Private casts never get one.
- **Names.** Every officially published cast has a name (the free ones are
  long). `drawcast.app/#<name>` resolves through `netlify/functions/name.mts`
  → Anvil's registry to a target: `owner/repo/path.yaml` (GitHub),
  `anvil/<slug>/<file>` (the drawcast server) or `gdrive/<id>`
  (`src/names.ts:88–97`). Each lookup records a visit with its referring
  domain.
- **`NAME.drawcast.app`** is built (`netlify/edge-functions/name-host.mts`)
  but waits on the wildcard domain at the host. This design does not depend
  on it.
- **Card text.** A cast already has `title` and `subtitle` (`PlaylistMeta`,
  `src/playlist/playlist.ts`). The subtitle is the card's one line — no new
  field.
- **The player's ⋯ menu** (`src/ui/controls.ts:746`, `foldedControls`) holds
  Credits always, plus mode, speed, mute and captions on a narrow screen.

## 3. The link Share hands out

Crawlers read only the path, never the `#`. So Share hands out a **path**
link, and the site answers it two ways.

| The cast | Link | Card |
|---|---|---|
| Has a name | `https://drawcast.app/c/<name>` | the cast's own |
| GitHub, no name (older casts) | `https://drawcast.app/c/gh/<owner>/<repo>/<path>` | the cast's own |
| Drive, or a `#cast=` link, or unpublished | the current `#` link | generic |

Why `/c/`: a bare `drawcast.app/<name>` would compete with the site's own
paths (`/api/…`, assets, future pages), and a page added later could break
someone's link. Two characters buy that away. When the wildcard domain
works, `<name>.drawcast.app` becomes an alias answered by the same code;
`/c/` links already shared keep working.

**How the site answers `/c/…`** (the edge function, extended):

- **A person** (any browser): `302` to the `#` form —
  `/c/vaccines` → `/#vaccines`, `/c/gh/o/r/p.yaml` → `/#gh=o/r/p.yaml`. The
  player then works exactly as today. The browser keeps the original
  `Referer` across a redirect, so the visit is still counted with the site
  it came from (facebook.com, linkedin.com…).
- **A link-preview crawler** (user agent matches a short list:
  `facebookexternalhit`, `Facebot`, `LinkedInBot`, `Twitterbot`, `Slackbot`,
  `Discordbot`, `WhatsApp`, `TelegramBot`, `Bluesky`, `Mastodon`,
  `redditbot`, `Applebot`, `Googlebot`, `SkypeUriPreview`, `Iframely`,
  `Embedly`): a small HTML card page (§4). The same page also carries a
  `<meta http-equiv="refresh">` and a link to the `#` form, so a crawler not
  on the list that follows it — or a person who lands there — still arrives.

`/c/` lookups never record a visit themselves (a crawler is not a viewer);
the person's lookup after the redirect does.

## 4. The card page

```html
<!doctype html><html><head><meta charset="utf-8">
<title>Why vaccines work — drawcast</title>
<meta property="og:type" content="website">
<meta property="og:site_name" content="drawcast">
<meta property="og:title" content="Why vaccines work">
<meta property="og:description" content="Herd immunity, drawn in three minutes.">
<meta property="og:url" content="https://drawcast.app/c/vaccines">
<meta property="og:image" content="https://drawcast.app/card/vaccines.png">
<meta property="og:image:width" content="1000"><meta property="og:image:height" content="750">
<meta name="twitter:card" content="summary_large_image">
<link rel="canonical" href="https://drawcast.app/c/vaccines">
<meta http-equiv="refresh" content="0; url=https://drawcast.app/#vaccines">
</head><body><a href="https://drawcast.app/#vaccines">Why vaccines work</a></body></html>
```

**Where the text comes from.** The edge function resolves the target (a
name through the same lookup `name.mts` makes — sharing its warm cache — or
a `gh/` path directly), fetches the cast's YAML and reads `title` and
`subtitle` from the head of the first document. It reads only those two keys
with a small line reader; it does not parse the cast. Missing title →
"A drawcast"; missing subtitle → no description tag.

**Fallbacks — every failure is a generic card, never an error page:**
unknown name, unreachable GitHub or Anvil, a private cast (the YAML is a
locked envelope — the reader sees no `title:`), a Drive target. The generic
card: title "drawcast", the line "Drawn explanations you can watch and play
with", the site's own image (`/share-card.png`, a static 1200×630 file — outside `/card/`, which the card function owns).

**Caching.** The card page is sent with `Cache-Control: public, max-age=600`
so a burst of crawler fetches costs one lookup. Platforms keep their own
copy for days; Facebook's Sharing Debugger and LinkedIn's Post Inspector
force a re-fetch (noted in the author-facing help, §6).

## 5. The card image

`og:image` points at a stable drawcast address, `/card/<name>.png` (or
`/card/gh/<owner>/<repo>/<path>` with `.yaml` turned into `.png`), never at `raw.githubusercontent.com`.
A Netlify function behind that path resolves the target the same way as §4
and streams the picture back:

- GitHub target → `posterPathFor(path)` at `raw.githubusercontent.com/…/HEAD/…`.
- Drawcast-server target → the generic image in this version (its own
  picture is version 2, §7.2); the card's title and line are still its own.
- Anything missing or failing → the generic image.

Sent with `Cache-Control: public, max-age=3600`. Why a proxy rather than the
raw URL: the fallback lives in one place, a missing file never shows a broken
image, and a repo or folder move never strands a card that is already out in
a feed.

**Shape.** The picture is 4:3; Facebook and LinkedIn cards are about 1.91:1
and crop the middle. This version sends it as it is (with its true
`og:image:width/height`, which lets platforms that respect it pick a taller
card). A cropped 1200×630 variant is a later refinement once real cards have
been looked at (§9).

## 6. Share in the player

**Where.** The player's share icon (already in the control bar beside
fullscreen, on every screen width — `src/viewer.ts` `shareButton`) opens
the share box instead of copying the address. It appears when the cast has a
**source someone else can open**: a name, a GitHub path, a drawcast-server
key or a Drive id. Not for a `#cast=` link, an unpublished draft in the
app, or a locally opened file.

**The share box** (a small dialog over the player):

1. **The card as it will look**: picture (from `/card/…`), title, subtitle.
   For a Drive cast, the generic card and the line "Links to Drive casts
   show a plain card."
2. **The link**, in a read-only field, with **Copy link**.
3. **Your comment** (optional, one short text field, up to 280 characters).
4. **Where:**
   - **On a phone or tablet** (when `navigator.share` exists): one large
     **Share…** button. It opens the device's own share sheet with the link,
     the title and the comment; when `navigator.canShare({ files })` allows
     it, the picture rides along as a file. Below it, a quieter line with the
     desktop list for those who want it.
   - **On a computer**: Copy link, Copy image, Email, Facebook, LinkedIn, X,
     Bluesky, WhatsApp. Each platform opens its own share page in a new tab
     with the link filled in:
     - Facebook `https://www.facebook.com/sharer/sharer.php?u=<link>`
     - LinkedIn `https://www.linkedin.com/sharing/share-offsite/?url=<link>`
     - X `https://x.com/intent/post?url=<link>&text=<comment or title>`
     - Bluesky `https://bsky.app/intent/compose?text=<comment or title> <link>`
     - WhatsApp `https://wa.me/?text=<comment or title> <link>`
     - Email `mailto:?subject=<title>&body=<comment>%0A%0A<link>`
   - **Facebook and LinkedIn refuse pre-filled text** (their policy). When
     there is a comment, pressing either copies it to the clipboard first and
     the box says "Your comment is copied — paste it into the post."
5. **Copy image** puts the picture on the clipboard as a PNG
   (`ClipboardItem`), for slides and documents. Hidden where the browser has
   no image clipboard.

**Text the share carries.** Title is the cast's title. The comment, if any,
leads; otherwise the title is the text. No hashtags, no "via drawcast"
padding — the card already says it.

**The share link carries where it went.** Each destination appends a short
`?s=` tag to the `/c/` link — `fb`, `li`, `x`, `bs`, `wa`, `em`, `ln` (copy
link), `sh` (device share sheet). The edge function carries it across the
redirect (`/#vaccines&s=fb`), and the client's lookup passes it on with the
visit, so the author's existing visit stats can say "14 from Facebook, 3 by
email" (§7.4). The tag never changes what plays.

**Accessibility.** The box is a `<dialog>` with focus moved into it, Escape
to close, every button labelled, the platform buttons as a list with their
names as text (icons are decoration).

**In the app.** After a public GitHub publish, the editor's status line
gains a **Share…** button that opens the same box, so an author who has just
published can share without opening the player.

## 7. The picture on every publish route

One picture per cast, the same everywhere: the author's `poster:`, else the
last real page — `posterForPlaylistText`, unchanged. What changes is that
every route that can show a card makes and stores it.

| Route | Today | This version |
|---|---|---|
| App → GitHub | commits `<file>.png` | unchanged |
| Claude Code (`scripts/cast.mjs push`) → GitHub | no picture; an older `.png` left stale | draws and commits it (§7.1) |
| App → drawcast server | no picture | still none — own title, generic image; version 2 (§7.2) |
| App → Google Drive | no picture | still none — generic card (§7.3) |

### 7.1 Claude Code publishes

`scripts/cast.mjs push` already launches headless Chromium against a Vite
dev server for `frames`. For a public push it renders each changed cast (or
lecture) through `posterForPlaylistText` on a page in that browser, takes the
PNG bytes back, and adds `posterPathFor(path)` to the commit — the same file
the app commits. Every public push redraws the picture for every cast whose
YAML it writes, so a revision never leaves an old ending behind.

If Chromium or the dev server is not there (the portable skill, outside the
repo), the push goes ahead without a picture and says so in one line:
"No picture drawn (no headless browser) — the link will show a plain card.
Publish once from the app to add it." A missing picture never stops a push.

**Backfill.** `node scripts/cast.mjs pictures <workdir>` redraws and commits
the picture for every cast in a published folder, for casts published before
this change or edited by hand on GitHub. It respects private casts: none.

### 7.2 The drawcast server — version 2

Deferred to version 2 (it needs the `drawcast-anvil` repo as well). Until
then a server cast's card has its own title and line and the generic image.
The intended shape: the server stores a cast at `anvil/<slug>/<file>` through Anvil's
`/_/api/cast`. It gains:

- `PUT /_/api/cast/poster?cast=<key>` — the same account check as the cast
  upload, PNG only, at most 2 MB, stored beside the cast.
- `GET /_/api/cast/poster?cast=<key>` — the picture, public, for a cast whose
  access is public; 404 otherwise.

`publishServerCast` (`src/main.ts:5403`) draws the picture with
`posterForPlaylistText` and uploads it after the cast, best-effort (a failed
picture upload is a status note, never a failed publish). A restricted cast
uploads none. This is a change in the `drawcast-anvil` repo as well.

### 7.3 Google Drive — not in this version

A Drive cast plays only after the author turns on link-sharing by hand; a
picture would be a second file needing the same step, and a Drive link
(`#gdrive=`) has no name a card could be looked up by. Drive casts get the
share box with a generic card. Giving a Drive cast a drawcast name (whose
target is `gdrive/<id>`) would let the card page read its title later; the
picture would still need a public file. Revisit only if asked.

### 7.4 Visit stats by destination

`name.mts` already stores, per name and day, visits by referring domain. It
gains a count by share tag (`s`), from the client's lookup. The app's stats
view lists both: where visitors came from, and which share button sent them.
Never per person — the same rule as the existing visit records.

## 8. Testing

- **Pure functions, unit-tested:** the `/c/` path → `#` hash mapping (names,
  `gh/` paths with nested folders, encoded characters, the `s` tag); crawler
  detection on a table of real user agents (and real browsers that must not
  match); the title/subtitle line reader (quoted, unquoted, folded, missing,
  a locked envelope); the card HTML (escaping of `<`, `"`, `&` in titles);
  share URLs per platform (encoding of comment, link, title); which casts get
  Share (`source someone else can open`).
- **Edge function:** a person's request → 302 with the right `Location`; a
  crawler's → the card page; an unknown name → the generic card; GitHub
  unreachable → the generic card, status 200.
- **Card image proxy:** existing picture → PNG with cache header; missing →
  generic; private → generic.
- **`cast.mjs push`:** a dry run lists `<file>.png` beside each public
  cast it writes; a private push lists none; no browser → the one-line note
  and the push still succeeds.
- **Live checks after deploy** (by hand): Facebook Sharing Debugger and
  LinkedIn Post Inspector on a named GitHub cast, a `gh/` cast, a
  drawcast-server cast (own title, generic image) and an unknown name; the share box on a phone
  (share sheet with picture) and on a computer (each platform opens with the
  link; Facebook with a comment copies it).

## 9. Order of work

1. **Cards.** `/c/` and `/card/` in the edge layer, the card page, the
   generic card and image, the line reader. GitHub targets first. Check with
   the platforms' debuggers on the existing GitHub casts that already have a
   picture.
2. **Share box.** The ⋯ item, the dialog, device share sheet, the desktop
   list, Copy link and Copy image, the comment, the `s` tag. The same link
   and preview at the top of the editor's Share panel.
3. **Pictures everywhere.** `cast.mjs push` draws and commits; the
   `pictures` backfill command.
4. **Stats by destination.** The `s` count in `name.mts` and its line in the
   stats view.

Each delivery is useful alone: after 1, a `/c/` link pasted by hand already
shows its card; 2 makes the `/c/` link the one people get without thinking.

**Later, attaching to this design:**
- *Version 2: the drawcast server's own picture* — §7.2.
- *Share the question* — a choice in the share box when the player is paused
  at a guess; the link gains a moment (`/c/<name>/q1`), the card the question
  as title and a picture drawn at publish beside the cast (`<file>.q1.png`).
- *Share from here* — a moment on any link; the cast's own picture.
- *A 1200×630 picture* — cropped or letterboxed from the 4:3 one.
- *Email from drawcast* — through Anvil, picture in the mail, signed-in
  senders, one recipient a send, a daily limit, a fixed template, a
  recipient's "don't send me these".
- *Embedding* — an `<iframe>` code in the share box for blogs and course
  platforms, from the view origin.
- *Video for social media* — teaser with burned-in captions ending on the
  link, MP4, square and vertical.
