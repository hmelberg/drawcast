# Ledger — publish polish round, started 2026-09-01

- 2026-09-01: Task 1 (`#gdrive=` viewer route). The brief's stated normalization
  collision ("the existing `/gh-/` replace would otherwise not collide but keep
  it explicit") doesn't actually arise — `gdrive-` doesn't contain the
  substring `gh-`, and `#gdrive=…` doesn't match the `gdoc` literal either — so
  no id ever crosses into the wrong branch even without ordering. Kept the
  brief's instructed order anyway (gdrive-normalize, then gdoc-normalize, then
  gh-normalize) since it's harmless and matches the brief's intent explicitly
  rather than relying on the absence of a collision holding forever.

- 2026-09-01: Task 2 (Publish → Google Drive). `buildEmbedChoices`'s refresh
  takes `(doc, subject)`, not the brief's `(doc, settings)`. Settings is never
  read by these two rows — the narration gate reads `getTtsKey()` from the
  store, and the image count reads `unembeddedImages(doc.playlist)` — whereas
  the subject IS needed: a course gets "Embed images" with no number rather
  than a confident, wrong "(0)". A parameter that is always ignored would have
  been worse than one that is always used.

- 2026-09-01: The builder's two hints are created EMPTY and written only by
  `refresh()`, where the old code both created them with text and overwrote
  that text in `prepPanels`. With two instances the duplicated sentence would
  have been the copy-paste the extraction exists to prevent; `refresh()` runs
  on every open before the modal is shown, so nothing ever renders blank. A
  test now pins that each sentence appears exactly once in the file.

- 2026-09-01: Checkbox ids are per-panel (`${key}-embed-images`). Two
  instances in one document would otherwise share an id, and a `<label for>`
  resolves through `document.getElementById` — the Drive panel's label would
  have toggled the link panel's box. The link panel keeps key `"share"`, so
  its ids are byte-identical to before the extraction.

- 2026-09-01: `ShareDeps.publishDrive` is REQUIRED, and course.ts passes a
  stub that reports "A course publishes to GitHub, not to Drive". Optional
  would have been less code but lets a future third caller forget the field
  silently; the stub is unreachable either way (`courses: false`), so the
  choice is purely about which mistake is louder.

- 2026-09-01: Drive's DESTS row has no third (disabled-with-a-reason) state —
  `ready: () => true`, `reason: ""`. Every other row's reason names something
  the author can fix in Settings; Drive's only credential is the build's
  Google client config, which is what `offered` already hides on, and sign-in
  happens at the publish itself exactly as Save → Drive does. There is no
  reason to show because there is nothing to fix.

- 2026-09-01: The name field prefills `fileSafe(doc.title)` every open —
  there is no `drivePublishedName` to prefer the way Link prefers
  `publishedAs`, because only the file ID is persisted. Consequence, stated in
  the panel itself: republishing under an edited name RENAMES the same Drive
  file (saveSpec's PATCH carries the metadata part), and if the author edited
  the name once and republishes later without editing it again, the file is
  renamed back to the title-derived default. Accepted for now; the fix, if
  Hans trips on it, is a persisted `drivePublishedName` beside the id.

- 2026-09-01: `publishDriveCast` reads and writes the module-level `doc`
  rather than capturing a `target` the way `saveToDrive` does. Not an
  oversight: `publishTextFor` reads the live `doc` and `specArea.value`
  throughout, so a captured target would protect the id write and nothing
  else — a false guarantee. Same exposure `publishDrawcast` already has, and
  fixing it belongs to both at once or neither.

- 2026-09-01: KNOWN GAP — if the author deletes the published file in Drive,
  `drivePublishedId` still points at it and every republish fails with "Drive
  update failed (404)". There is no UI to clear the id. Not fixed here: the
  honest recovery (fall back to CREATE when the update 404s) means parsing a
  status out of a thrown Error's message, and minting a new file silently is
  its own surprise. Worth a follow-up if it ever bites.
  **RESOLVED in fix round 1 — see below.**

## Task 2, fix round 1 (review findings)

- 2026-09-01: FINDING 1 — Drive consent now happens FIRST, not at
  `ensureFolder`/`saveSpec`. Controller ruled the brief's ordering a plan
  defect, and the code agrees: a bake costs real money per line and takes
  minutes, so a declined popup on the far side of it threw away something
  already paid for. Worse, transient user activation lapses after ~5 s, so the
  popup would often be BLOCKED rather than declined — the exact failure the
  YouTube upload's consent-first ordering was written to avoid. Placed inside
  the `try` (after `shareBtn.disabled = true`) so the existing `finally`
  re-enables the button on the cancel path; there is no `await` before it, so
  activation is just as fresh as it would be above the try.

- 2026-09-01: FINDING 2 — the dangling-id dead end is fixed with a narrow,
  loud recovery. `isMissingFileError` lives in drive.ts, beside `saveSpec`,
  because it reads the message `saveSpec` itself throws; the two would drift
  apart anywhere else. It matches 403/404 ONLY: a 500 or a 429 is the same
  file temporarily unreachable, and treating those as "gone" would throw away
  a live publish target over a hiccup. On a match the id is cleared,
  `autosave()` writes that through (JSON.stringify drops the undefined key, so
  the library row genuinely loses it), and the status says the file is gone
  and that publishing again makes a new one. No silent minting: the link
  changes, so the author is told.

- 2026-09-01: The recovery clears `drivePublishedName` along with the id, and
  the success path sets them together. Keeping the name would have prefilled
  the next publish more helpfully, but "a name for a file that does not exist"
  is a state every future reader has to reason about. One invariant — the pair
  is set together and cleared together — is worth more than the small
  convenience.

- 2026-09-01: FINDING 3 — `drivePublishedName` (the base name, no `.yaml`) is
  persisted everywhere `drivePublishedId` is, including all three
  forward-preserving `Doc` rebuilds, and the panel prefills
  `doc.drivePublishedName ?? fileSafe(doc.title)`. This supersedes the
  earlier "accepted wart" entry above: a republish no longer renames the
  author's file back to the document title.

- 2026-09-01: ShareDoc gained BOTH `drivePublishedName` (the prefill) and
  `drivePublishedId` (the rename hint's gate) rather than reusing the name for
  both. The two mean different things — "what it is called" and "there is a
  file at all" — and ShareDoc's own rule is to name exactly the fields this
  module reads. Both arrive for free: main.ts's `doc()` already spreads
  `{...doc}`. The hint is now hidden before the first publish, where it
  described renaming a file that did not exist.

- 2026-09-01: Reviewer minors folded in — `readFileText`'s `requireScope` moved
  INSIDE its `try` (it can reject, not just resolve null: a blocked popup or a
  token endpoint that 500s would have thrown out of a function documented as
  never throwing, failing the publish the reuse exists to make cheaper — now
  covered by a real test), and the drive panel's hint ends at "…they open it
  in drawcast." The dropped clause pointed at "the link below", which is in
  the STATUS line after publishing, not in the panel.

- 2026-09-01: One of my own fix-round tests was wrong and was tightened, not
  relaxed: it counted `drivePublishedId: doc.drivePublishedId` to assert "the
  three in-place rebuilds" and matched autosave's line too. It now matches the
  rebuild's inline form specifically, which also pins that the id and the name
  travel together.

## Task 3 — the YouTube panel rework

- 2026-09-02: **`ensureTranslations` returns a result, not a boolean, and its
  progress callback takes the finished sentence.** The brief specified
  `Promise<boolean>` with `(label, i, n)`. Both callers need the exact same
  progress line — "Translating into German — 1 of 2…" — so building it in the
  callback would have duplicated the one sentence the routine exists to own;
  and the failure TEXT is known only inside (which language, which API error),
  while the two callers show it in different places (the export chip's status
  line vs. the panel's own hint). `{ ok, cancelled, message }` lets the routine
  say what happened and each caller decide where that goes. `cancelled` is a
  field of its own so a Cancel reads as info and a failure as an error.

- 2026-09-02: **The source language stays in the add-select once its chip is
  removed.** The brief said the select offers "LANGUAGES minus the source minus
  already-added". Taken literally, removing the original's chip — an explicitly
  supported move (upload the German version and nothing else) — would be
  irreversible without closing and reopening Share. It is now "minus
  already-queued", labelled "Norwegian (original)" wherever it appears, which
  behaves identically in the normal case (the source starts as a chip, so it is
  never in the list) and is recoverable in the case the ruling invented.

- 2026-09-02: **The caption note is a `.hint`, and `.yt-warning` is deleted.**
  The brief left the choice open. What the line says — the subtitle file
  downloads with each upload — is a fact about what just happened, not a
  hazard; the amber warning box was the loudest thing in the panel and said the
  least. No other rule used `.yt-warning`, so it went with the paragraph.

- 2026-09-02: **The Visibility select lost `.yt-field`.** In the old
  `.quiet-label` rows "100% width" meant the width of an inline-flex label; in
  the grid it means the whole field column, and a three-option dropdown
  stretched across the panel reads as a text field. It starts at the same x as
  every other field, which is what the grid was for.

- 2026-09-02: **`translateText` falls back to the source text when the model
  answers with a blank**, mirroring `verifyTranslation`'s rule that a blank is
  no answer: a description in the wrong language beats no description. An empty
  description in the FIELD still returns empty without calling anything —
  publishing without a description is a real choice, and paying to translate
  nothing is not.

- 2026-09-02: **One `AbortController` for the whole run, re-registered after
  every render.** `renderVideo` (main.ts) installs its own controller as
  `exportAbort` while it runs, so the run's controller has to be handed back to
  `setAbort` before each upload — otherwise Cancel during an upload would abort
  the render that already finished. The per-upload controllers this replaces
  ended the run on abort anyway, so nothing observable changed.

- 2026-09-02: **Translation notes (missing strings, lint errors) are reported
  on the Save-copies path only.** They used to land in `ytStatus` while the
  modal was open. On the Upload path the modal is closed before phase 1 runs
  and the chip is carrying progress, so there is nowhere honest to put them
  without pushing a second sentence into the upload's own result line. The run
  still returns them; the upload caller ignores them deliberately.

- 2026-09-02: **Settings' burn-in copy was a survivor.** main.ts's checkbox
  said "YouTube uploads have their own setting in Publish's YouTube panel" —
  false the moment ruling 4 landed. It now says a YouTube upload never burns
  them in, and the `burnCaptions` field comment in store.ts says why.

- 2026-09-02: The chip's × darkens to `--ink` on hover, not `--rust`:
  tests/palette.test.ts's allowlist spends the accent on primary actions and
  "you are here" only, and caught the first attempt.

- 2026-09-02: **CONCERN for the controller — ruling 1's "a cancel-and-retry
  does not re-translate" is only true inside one modal session.** The cache is
  per-session as the brief requires (`prepPanels` clears it), but Upload closes
  the modal before phase 1 starts, so a cancel during translation is followed by
  a REOPEN — and the next open clears the cache and pays for those translations
  again. Making it survive needs a cheap source signature (the specs' text,
  stringified, blobs elided) so a stale cache can never be uploaded against an
  edited document; that is a decision about scope, not a detail, so it is left
  here rather than taken.
