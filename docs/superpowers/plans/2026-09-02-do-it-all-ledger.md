# "Do it all" — ledger (2026-09-02)

Plan `2026-09-02-do-it-all-plan.md`. Six feature commits, suite 2861 → 2886.
Everything open on the roadmap delivered or explicitly ruled; final review
run over the whole range before push — it CONFIRMED eight findings (and
refuted two), all fixed in the closing commit. The catch that mattered
most, and that no single task could see: `runsActive` was checked and
decremented but NEVER incremented — the very race the round claimed to
close had a dead guard under it, and a per-lecture ⟳ during a batch ran
two generations concurrently. Also in that class: republish silently
stripped a live page's comments; unsaved style text died on a row click;
a stored cloud voice displayed as "Default" while silently driving
playback; an explicitly preferred voice that 400s would have baked the
default voice under the preferred name and the reuse check would have
kept the lie forever. Full list in commit ccb8900.

## Rulings taken (⚖ in the plan)

1. **B4 built nothing** — adopted review F.1(1): per-save folders dropped,
   single Settings folder stays. Hans can reverse; the stable-index rework
   would then come first, as P §8.3 argues.
2. **B8 was already done.** `initialDoc()` restores the newest library
   entry and shows a bundled example on first run — exactly D4's advice.
   The deliverable was B7's honesty (the restored doc greets you with
   Revise), not new startup code.
3. **B7's mode is derived, never flagged**: "generate" ⟺ the editor holds
   the blank ＋New document (or nothing). A hand-edited blank flips to
   Revise by itself — the edits become the thing to revise — which also
   closes the "Generate discards my hand-edits" hazard without a dialog.
4. **Style is an append, not a placeholder** (B5). `styleBlock()` goes onto
   the request suffix in compile/revise: a user-made prompt fork predating
   the concept cannot drop a placeholder it never had, and last-wins is
   guaranteed for every variant. Source-pinned in tests (2 sites + 1).
5. **S §9.3 ruled: Style stays its own sidebar row** (two axes visible);
   S §4.1 ruled: localStorage only — "a paragraph; syncing it is a bigger
   machine than the thing it syncs."
6. **B12's voice preference applies to the primary speaker only.** A named
   voice pins one voice; applying it to dialogue speaker "b" would collapse
   an a/b exchange into one voice. Speaker b keeps the gender-contrast
   default.
7. **B12's reuse wrinkle closed at the clip, not the key.** Track keys are
   what published documents already carry and what viewers' players look
   up — changing the key format would have silenced every published bake.
   Instead each clip records its `voice` and `linesToBake` compares it
   against what synthesis WOULD use (`preferredVoice`, same `detectLang`),
   so a changed voice re-bakes while pre-B12 publishes reuse unchanged.
8. **C1's giscus ids travel in the published yaml** (`meta.comments`) —
   the viewer runs in a stranger's browser and can reach nothing of the
   author's but the file and its own URL. Repo comes from the cast link;
   the thread keys to the file path (`mapping: specific`), so course
   lectures get their own threads for free. Written onto the published
   COPY only (§F.3.1: Save verbatim, Publish prepares a copy). Drive
   publishes don't offer it — no repo in a Drive link.
9. **C2 built nothing** — giscus surfaces the Discussion's reactions.
10. **C7's grouping was already delivered** by the existing flex layout
    (the progress bar spans; clusters sit at the ends), so the remainder
    was hover-scrub — the chip and the click share one pure `seekStep`,
    so the promise IS the destination — and the deliberate ruling that
    the k/N step readout beats a clock (D6.4).
11. **The parked course race closed at all three doors** (picker, ＋ New,
    sidebar rows refuse while `inFlight` is non-empty); the sidebar path
    guards inside `loadCourse` because it bypasses the disabled picker.

## Traps hit

- **A source-regex drift test reads comments as code**: course-panel.test
  forbids `openCoursePanel(` inside the function body, and a COMMENT
  naming the call tripped it. Reworded; the lesson stands — that suite
  does not strip comments before matching.
- `styleSel` name collision: the render-style select already owned the
  name; the profile picker is `styleProfileSel`.
- `settings.cloudVoices` must be replaced, never mutated: with nothing
  stored, the loaded settings share DEFAULT_SETTINGS' own object.

## Awaiting Hans

- E2e of the whole batch: one Generate/Revise button (try: ＋ New →
  Generate; load → Revise; hand-edit a blank → flips to Revise), the
  Style modal + a style riding a generation, the cloud-voice pickers
  (Settings and CC menu — a pick speaks a sample), Allow comments
  (needs the one-time giscus setup on github.com first), ↗ Share on a
  published cast, the seek-bar hover chip.
- **C4: open `docs/logo-candidates.html` and pick a direction** (or say
  what to change). Adoption is a separate small round (favicon + topbar
  + viewer footer swap).
- B4 ruling stands unless reversed.

## Follow-up: blank ＋New and the sidebar (Hans, same day)

Hans: empty spec on New; the expanders wear two icons (caret + emoji) and
the emoji are colorful; the panel scrolls and "that is ugly"; reorder if
something is more logical.

- **The blank page is the one valid nothing, admitted at the editor's gate
  only.** First attempt relaxed `validateSpec` — and the generation-loop
  tests failed immediately, because the pipeline DEPENDS on empty-is-invalid
  to trigger repair rounds (their INVALID fixture is `{commands: []}`). So:
  `isBlankSpec` in `checkSaveable` admits exactly the blank page for
  editing/saving; generation stays strict. The tests were the design
  argument.
- **One icon per row.** Section headers keep the caret and lose the emoji;
  every tool row goes text-only (Player/Style/Instructions/Data/Help/
  Sign in/Settings) — emoji render as colorful bitmaps, which was also the
  control-bar lesson (2a). A pinned drift test on "▶ Player" updated.
- **Accordion sections** (pure `accordionOpenState`): opening one closes
  the rest; only Library opens by default. At most one 13rem list is ever
  expanded, so the panel fits the viewport instead of growing its own
  scrollbar. The search filter still auto-opens every section with hits —
  a view, not a preference. Order kept (New → Search → Library → Courses →
  Examples → Templates → tools): create, find, configure — already the
  logical read.

## Live bug: published pack-template casts drew NOTHING in the viewer

Hans published with narration and got voice + captions over a blank canvas
(drawcast.app/#gh=hmelberg/dcast/casts/stress-testing-a-discontinuity.yaml).
Reproduced against the LIVE file in node: part 1 (template `rd_plot`,
empirics pack) laid out to 0 drawables. Root cause: `viewer.ts` was the one
entry point that never registered pack templates — main.ts, compiler.ts and
engine-render.ts all do — and `layoutSpec` treats an unknown template as a
silent fall-through to the spec's loose elements (its warning is returned
in `LayoutResult.warnings`, which nothing on the viewer path reads). Part 1
carries only one annotation, so: blank.

Fixed in two layers: the viewer awaits `ensureEnabledPacks(Object.keys(
PACK_DEFS))` before mounting — ALL packs, since the AUTHOR's template
choice must not depend on the viewer's browser settings (engine-render.ts
had already established that rule) — and an unknown template now throws a
named, visible error instead of mounting a near-blank page. Pinned by
tests/viewer-packs.test.ts including a real layout of the live cast's
first-part shape.

Standing lesson (the six-silent-deaths class): `LayoutResult.warnings` is
a channel with no reader outside the editor — anything load-bearing must
not end there.

## Course publish placement + Studio-Q default (Hans, same day)

Hans could not find course publishing — it existed as a small `↗ Publish`
in the course modal's FOOTER, visually identical to Save. His ruling: Save
and Publish go in the top row beside ＋ New; Publish wears primary. Also
found while answering: the C1 Allow-comments checkbox was silently DROPPED
by the course publish path — now the giscus wiring is written into every
lecture's header (before the bake, so formatPublished carries it), and
each lecture gets its own thread. Course publish stays GitHub-only (the
Drive refusal was already deliberate and loud).

Default narrator = en-US-Studio-Q (Hans, by ear): UNDECLARED case only —
`narrationVoice()` is now the one decision synthesis and the bake stamp
share (pref → undeclared default → gendered table). Authored genders and
a/b dialogue keep the table. Studio voices reject pitch (Google's
documented limitation, verified) → delivery pitch omitted for Studio names
instead of 400ing into the silent no-name fallback. Stamps mirror the
decision, so a republish re-bakes exactly the undeclared English lines
into Q and reuses everything else. NOTE for Hans: Studio voices bill at
Google's premium tier (~10× Neural2 per character).

## Narration cost estimates (Hans, same day)

Measured from his live cast (5 parts, 89 lines, 11,436 chars → the
TYPICAL_LECTURE_CHARS constant): a 20-lecture course ≈ 229k characters ≈
$37 at Studio rates, $7 Chirp3 HD, $3.70 Neural2. Built three surfaces,
all priced by the SAME narrationVoice decision the synthesizer uses
(export/tts-cost.ts): the course Generate confirm projects the whole
course (from its own done lectures, else the measured typical lecture);
the Embed-narration hint shows the exact upper bound (drawcast: editor
text; course: sum over done lectures) noting republished lines are free;
the Settings TTS note stops promising a thousand free drawcasts now that
the default narrator bills premium. Traps: three source-pin tests broke on
SHAPE changes whose guarantees still held (doc() grew a body, the bake
hint needed its literal built once) — pins updated to assert the guarantee,
not the shape.

## B15 delivered: resumable narration bake (same day)

`export/bake-cache.ts` — the portrait-cache IndexedDB idiom. Rulings:
clips are cached the MOMENT they are synthesized (put before return — a
failure right after cannot lose the clip); the key carries everything
that determines the audio (rate, the exact narrationVoice decision
incl. languageCode, speechKey); cache reads/writes never fail the bake
(read error → API, write error → clip still returns); 30-day lazy
expiry — the cache is a wallet-protector, the published copy remains the
durable reuse source. Both bake sites (drawcast publish, course publish)
wrap their synthesizer; pinned by tests incl. the saved-before-resolving
order. Deliberately NOT wired: the video export's live synthesis (a
different path with an AudioContext in the loop) — same trick applies if
an export quota-death ever hurts.

## Live bug: GitHub 422 on narration-baked course commits

The B15 bake succeeded — and then the commit died: commitFiles inlined
every file's content into one /git/trees request, and a course of baked
lectures (megabytes of base64 audio each) exceeded what GitHub will
process (422 "input was too large… consider building the tree
incrementally"). Fix: blobs first (one POST /git/blobs per file, base64),
tree of SHAs only. Blobs are content-addressed and created OUTSIDE the
non-fast-forward retry so a rebuilt commit reuses them. NOTE the test
lesson: three tests had PINNED the inline design as a virtue ("sends file
content inline, needing no separate blob calls", exact five-call counts)
— pins that encode a scaling assumption become the bug's bodyguards.
Rewritten to pin the new contract, with URL-based lookups instead of call
positions.

## Live bug 3: /git/trees 502 surfacing as an opaque NetworkError

Hans's console had the truth the error hid: GitHub's edge answered the
tree call with 502, and 5xx error pages carry NO CORS headers, so Firefox
reported only "NetworkError when attempting to fetch resource". Fix:
call() retries thrown fetch errors and 502/503/504 twice with backoff, in
place — safe because every write on the path is content-addressed or
idempotent, and far cheaper than re-running a whole publish. Failures now
name their request ("POST /git/trees failed 3 times… press Publish again,
nothing was half-committed"), a dead blob names its file and size, and
blob uploads drive a progress line ("Uploading to GitHub — file k/N…").
setRetryDelaysForTests() keeps the retry tests instant. Standing lesson:
a browser "NetworkError" on a CORS API is as likely a 5xx wearing a mask
as a dropped connection — retry it like one.
