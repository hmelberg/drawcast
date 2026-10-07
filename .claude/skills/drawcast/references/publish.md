# Publishing, names, private, listing, credit

Read this when the user wants something made here published to GitHub, a drawcast.app/#name link, a private (locked) course or cast, a change to its catalogue listing, or narration credit. Every step that costs money waits for the user's own yes to the exact price.

## Publishing something new (to a GitHub repo of the user's)

A drawcast or a course made here goes to a
public repo the user chooses; after that it is revised like anything published.

0. **The workdir.** A course: its folder (`dev-casts/courses/<slug>/`). A single drawcast
   made as `dev-casts/<slug>.json`: `node scripts/cast.mjs pack dev-casts/<slug>.json
   dev-casts/publish/<slug>` writes the one-cast-file folder that is its workdir. Run `check` and
   `frames` once more before publishing if it changed since you last looked.
   A cast or lecture file is `.cast` (script) or `.yaml`; every command reads both. New files
   are `.cast`, and a push or `lecture-build` turns a `.yaml` into `.cast` and removes the old
   file, here and on GitHub.
1. **Which account and repo.** `gh api user --jq .login` names the account gh is signed in
   as; say it, and ask which repo (an existing public one, or a new one) and folder. If gh
   is not signed in, ask the user to run `! gh auth login`.
2. `node scripts/cast.mjs publish-target <workdir> <owner/repo> [--dir <folder>] [--create]`
   — `--create` only when the user said to make the repo (public). It switches Pages on,
   picks a slug no other cast or course in the repo has (rewriting `slug:` in course.md),
   and writes `origin.json`.
   `--dir` is a folder INSIDE the repo's casts folder (`--dir casts` gives `casts/casts/`): leave
   it out to publish beside the other casts.
3. **Record the narration** (studio voices, both speakers of a dialogue), or the cast plays in
   the browser's own voice: `node scripts/bake-narration.mjs <workdir>/<file>.cast` prints the
   cost (nothing spent); on the user's yes to it (a few dimes a cast, their own Google key in
   `.env` — a worktree links the main checkout's), add `--apply`, which writes the recordings
   into the file. Unchanged lines keep their recordings on later bakes. It records in the
   cast's own `voices:` (SKILL.md's brief); `--a "<voice | style>"` / `--b "…"` set them
   from here and write them into the file. Changing a voice or its style re-records that
   speaker's lines; a Gemini voice speaks with `GEMINI_API_KEY` from `.env` (a key of its own).
4. `push <workdir> --dry-run`, show the file list, and on a yes `push <workdir> --direct`
   (it is the user's own repo; a PR to themselves is noise — unless they want one, or the
   repo is someone else's: then plain `push` opens a PR from a fork).
   A public push also commits each cast's link-card picture (`<file>.png`, drawn the way
   the app draws it); to give an older published repo its pictures, `pull` it and `push` again.
   A public single cast also gets its own page, `<file>.html` beside it: a small door that
   plays the `.cast` next to it (so an edit to the `.cast` shows at once), with the player
   from drawcast.app and the spoken lines as a Transcript for search engines — the fastest
   link to it (no name lookup), at `https://<owner>.github.io/<repo>/<dir>/<file>.html`.
   Its file name is the cast's slug, so the name chosen at publish-target is the page's name
   too. Views and comments are the cast's. A private push removes the page.
   The folder's `index.html` links the pages and a `sitemap.xml` lists them: to be found in
   Google, the user submits `https://<owner>.github.io/<repo>/<dir>/sitemap.xml` once in
   Google Search Console (Sitemaps). Say so when they ask how to be found.
5. Report the player link (`drawcast.app/#gh=…`), for a single cast its own page, and, for a course, the course page (Pages
   can take a minute the first time). Without step 3 the narration is the browser's voice. Later revisions: references/revise.md from its step 2 (unpack), on the same workdir — no new pull.
   `push --direct` now also registers the item with Anvil (drawcast's backend at drawcast.anvil.app — the registry behind names and the catalogue) and prints its free link
   (`drawcast.app/#<name>`) itself; a PR push instead prints when to run
   `node scripts/cast.mjs register <workdir>`, which does the same once the PR is merged.
   "not registered (rate limited …)" is the registry's hourly budget, not a failure of the publish:
   run `register <workdir>` later, or `register <workdir> --wait` (retries every 5 minutes for up to an hour).

## A pretty link (drawcast.app/#<name>)

Only for something already pushed (it needs `origin.json`; a course or a cast). Every name is
bought, one-time: 20 USD up to 5 characters, 10 USD up to 7, 5 USD longer; 3 at least.
The `#gh=` link stays free — say so if the user only wants a link to share.

1. **Signed in?** `name` says so if not: `node scripts/cast.mjs login` prints a code and
   drawcast.anvil.app/#device; the user signs in there and types the code. Once per machine
   (`logout` undoes it; so does "Sign out everywhere" on the account page).
2. `name <workdir> <name>` — free (with its price) / yours / taken. Tell the user the price.
3. **Only on the user's yes to that price:** `name <workdir> <name> --buy --price <cents>`.
   It opens Stripe Checkout in their browser; they pay there. Never ask for card details,
   and never pick a price for them. A name already theirs is repointed here at no cost.
4. `name-wait <workdir>` (in the background; up to 9 minutes) until the name resolves here.
   "Not paid (yet)" is not a failure: run it again after they pay. A course: push once more
   so the course page carries the name.

## Private (locked on GitHub, only for enrolled learners)

Make it private right after `publish-target` and BEFORE the first `push` (it needs
`origin.json`; a course or a cast) — never publish it plain first: every version pushed stays
readable in the repo's git history, and locking later does not reach back. A private
course/cast still lives on the user's public repo, but every lecture file (or the cast's own
file) is committed as an encrypted envelope, not plain text — only a learner (or the owner,
pulling it back here) with the key can read it; a private course's course.md is pushed with
`private: true` and its Join door.

Already pushed in the clear? Warn the user before going on: the earlier versions stay readable
in the history. To avoid that, publish into a new folder (`publish-target` with a new name)
and make that one private before its first push.

1. `node scripts/cast.mjs private <workdir>` — the quote: what is due right now, in USD.
2. **Only on the user's yes to that price** — never pick it for them, never ask for card
   details: `node scripts/cast.mjs private <workdir> --price <cents>` (must equal the quote's
   due). It opens Stripe Checkout in the browser and waits (up to 9 minutes) for it to clear.
   "Not paid (yet)" is not a failure: run it again after they pay.
3. Once paid, `push <workdir> --dry-run` then, on a yes, `push <workdir> --direct` (or a PR, as
   any revision) — this is what actually locks every lecture file and commits it; `private`
   itself never writes to GitHub. A course that grows (a new lecture built and pushed later)
   quotes and may owe again on its next push — say so before pushing if it refuses.

Pulling a private course or cast needs the OWNER's own login (`cast.mjs login`, same account
that made it private) — `pull` unlocks it with that key while copying it into the workdir; a
locked file it cannot unlock stops before writing anything, rather than leaving plaintext or a
half-made workdir.

`private <workdir> --unlisted` (before paying) buys private AND unlisted in the same
purchase — one payment, no separate step. Without `--unlisted` the item stays listed in the
public catalogue (drawcast.app/#browse) once it is registered.

## Listing (drawcast.app/#browse)

Whether an already-registered course or cast (it needs `origin.json`) shows in the public
catalogue — takes effect at once, no `push` needed, and never touches whether it is locked
private. Listing (again) is always free.

1. `node scripts/cast.mjs listing <workdir> --listed` — turns it back on, free, done.
2. `node scripts/cast.mjs listing <workdir> --unlisted` — free at once if it has ever paid for
   Private or an earlier unlisted purchase; otherwise it prints what is due (the same one-time
   fee as Private).
3. **Only on the user's yes to that price:** `node scripts/cast.mjs listing <workdir>
   --unlisted --price <cents>` (must equal what was printed). It opens Stripe Checkout in the
   browser and waits (up to 9 minutes) for it to clear. "Not paid (yet)" is not a failure: run
   it again after they pay. The item stays public throughout — only the catalogue listing changes.

## Narration credit

An author signed in to drawcast but with no Google TTS key of their own can still publish
narration from the app: the server synthesizes it against prepaid credit. This skill's own
`frames`/bake here always uses a local TTS key when one is configured — credit only matters
for publishing narration from the app without one.

1. `node scripts/cast.mjs credit` — the signed-in author's balance.
2. **Only on the user's own yes to the exact amount** (never pick it for them): `node
   scripts/cast.mjs credit --buy <cents>` — 500, 1000 or 2000 (5/10/20 USD), the only three
   packs. It opens Stripe Checkout in the browser and waits (up to 9 minutes) for the balance
   to rise, then prints the new one. "Not paid (yet)" is not a failure: run `credit` again
   after they pay.
