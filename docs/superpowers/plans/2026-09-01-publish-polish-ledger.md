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
