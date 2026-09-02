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
