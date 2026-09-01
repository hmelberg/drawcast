# Review of ROADMAP-2026-09 §F — second model, 2026-09-01

*An independent review of the proposed seven-part split and the six revisions
of Hans's stated intent, per the brief in `README.md`. Code claims below were
re-checked against `src/` at review time, not taken from the documents.*

**Verdict in one line:** the list and the split are sound; take five of the six
revisions, reject one (the lint chip), resolve one genuine cross-document
contradiction (revision 2 vs B2), and swap Parts 2 and 3.

---

## 1. The six revisions, judged

### R1. Drop per-save folders — **agree**

Hans said *"consider whether…"* — and "possible, but it needs the stable-index
rework first and buys little" is a real answer, not a dodge. One honest loss to
record: the already-noted edge case (changing `coursesDir` orphans the old
folder's manifest) stays unfixed, and §8.4's lift-sources-out-of-`casts/`
cleanup loses its natural moment. Accepted, not forgotten.

### R2. Name field only where a panel exists — **agree on names, but it collides with B2**

The publish spec's own §3.5 gives **Save → Drive** embed checkboxes (*"Hans
asked for both"*), which requires exactly the small dialog revision 2 refuses
to add — Drive save is a one-click item in the Save ▾ menu (`main.ts`,
`buildSaveMenu`), not part of the Publish modal. The two proposals cannot both
ship.

The real question is *what Drive save is*. Hans's framing — *"a choice when we
publish, both google drive as well as github"* — reads as publishing; then
Drive gets the small panel and the name field rides along free. If it is a
quick backup, keep it one click and drop embed-on-Drive. A middle path: sticky
embed toggles inside the Save ▾ menu itself, destinations stay one click.

**This is the one §F question to put back to Hans before cutting the plan.**

### R3. Hide the lint chip entirely — **disagree; take D2's errors-only version**

Checked in code, and the facts favour D2:

- Exactly **one** rule is error-severity: `out-of-canvas` (`lint/lint.ts`) —
  an element drawn partly off-screen. Actionable, worth knowing.
- "One flag beats severity logic" overstates the saving: `setLint` already
  computes worst-severity (`main.ts`); errors-only is a one-line filter, not
  new machinery.
- Generation **auto-repairs** error-severity lint (`llm/compile.ts`), so an
  errors-only chip stays silent for generated casts and speaks almost only for
  **hand-edited YAML** — precisely the person who can fix it, i.e. the author.

### R4. Split the player part — **agree, and widen the icon step**

The documents blame only 🔊/🔇, but ⏮ and ⏭ (`ui/controls.ts`) are also
emoji-class codepoints whose monochrome rendering is font-fallback luck on
macOS. "Icons first" should mean **every control glyph becomes inline SVG in
one pass** — same cost, kills the class of problem instead of one instance.
The layout half (progress row, fullscreen sizing, drift test) stays second.

### R5. Title prompt-half first — **agree**

The prompt change (drawcasts open by drawing their title) is the thing that
was wanted; the DOM move is cosmetics touching fullscreen sizing and its drift
test. On the open question: draw the title as the first beat of scene one and
skip full title cards for single casts — the lighter option STYLE.md already
argues for.

### R6. No vote store — **agree, and it is not even a reduction**

Hans asked for votes *"saved externally if possible"*; giscus reactions **are**
stored externally, in the author's GitHub Discussions. Intent fully delivered.
Two caveats the documents missed:

- giscus requires the **repo to be public** — already true for the viewer to
  fetch the yaml, but the setup note should say it;
- the giscus iframe carries its own theme, so dark mode needs one extra sync
  call.

## 2. The part order

1. **Swap Parts 2 and 3.** Part 3 fixes the thing Hans actually ran into —
   "Publish to GitHub" hiding itself (B1) — and is low-risk. Part 2 is the
   riskiest layout work in the plan. Felt pain first, risky layout later.
2. **Split Part 2** per R4: **2a** = all-SVG icons + subtitle band (cheap,
   visible); **2b** = progress-bar row, title move, chapter gates.
3. **Move the References-tab hiding into Part 1 with A8.** As split now,
   Part 1 hides `👍 Learn from this` but Part 5 removes the References tab —
   in between, users see a pool they can no longer add to. Both are the same
   `developerMode` gate; do them together.
4. Part 1's "pure UI, flags, CSS" undersells **C5**: deleting the looks
   removes a schema enum and styling branches and is irreversible. Keep it in
   Part 1, but run the "do any saved casts use a `look`?" check first, as the
   spec itself asks.
5. Note for **C10**: the serializer omits default values
   (`playlist/playlist.ts`, `DEFAULT_META`), so flipping the default to
   `auto` silently flips every saved playlist that never wrote `advance`
   explicitly. Under replace-don't-freeze that is fine — a ledger line, not a
   migration.

## 3. Over-engineered / missed

**Cut:**

- The **bytes estimate** on the embed checkboxes — the publish spec's own risk
  list admits the derived number may be wrong and erode trust. Label with the
  count only ("Embed 5 images"), which is always true.
- **Hover-scrub preview** (D6 item 4) — for a step-based player, click-to-seek
  plus the step indicator deliver the YouTube feel; a frame-preview scrubber
  is video-tape machinery this medium does not have.

**Missed:**

- The R2/B2 collision above — the one genuine cross-document contradiction
  found.
- The two giscus caveats above (public repo; theme sync).
- The "Allow comments" flag lives in the published yaml, so toggling it later
  means republishing; one line of copy in the Publish panel should say so.

## 4. What held up

Everything else spot-checked clean: the advance default and its per-playlist
override, the lint gating asymmetry as described in D2, the destinations table
and `needs` predicates in `ui/share.ts`, the one-error-rule claim, and the
`exportSequence` shared-objects hazard (B2's resolve-on-a-copy requirement is
correct and is the load-bearing constraint in that item).
