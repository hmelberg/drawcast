# Design: The editor shell — fewer controls, one pattern, a menu that folds

*2026-08-31. Decisions made in brainstorming with Hans, after auditing the
shell as it stands (§0). Hans's brief: "The drawcast editor is a bit crowded
and ugly. See what can be done to make it both better looking and better
organized… publishing may open a new modal with choices… This could be a
general pattern. Also make it flexible… courses should have courses listed
below like examples and libraries, but it should also be possible to 'close'
the list. And make the design and layout more consistent and professional."*

## Goals

1. **Cut the two pane bars from 14 permanently visible controls to 9**, by
   moving options out of the bars and into the dialog of the verb they
   modify — and give what remains a visible structure.
2. **State that as a rule, once**, so later features land the same way:
   a button in a bar is a verb; its options live in what it opens.
3. **One Share verb** covering every way a drawcast leaves the app — link,
   YouTube, video file, spec file.
4. **A sidebar of uniform, collapsible sections** — Library, Courses,
   Examples, Templates — each with a count, each remembering whether it is
   open, with the configuration rows visually separated below them.
5. **Courses get their own section**, instead of being nested inside Library.
6. **One visual vocabulary**: one control size per bar, explicit groups, and
   an icon only where the icon is the whole meaning.
7. **One anatomy and one size scale for all nine modals** — the same rule as
   the bars, applied to the other half of the surface. The course modal is
   the worst offender in the app and is restructured; Settings gains the
   scroll cap it never had.

## Non-goals

- **A topbar rework.** The document title stays out of the topbar and the
  mode pill keeps its place. Considered and declined as a separate round.
- **Rewriting what the modals contain.** §7–§9 move controls between regions
  and give them one frame; they do not redesign the course document format,
  the template packs UI, or what any setting means.
- **Changing what any of these actions do.** Publishing, uploading,
  exporting, tracing and saving keep their current behaviour and their
  current code paths; this moves where they are reached from. The one
  exception is portrait *placement*, §3.
- **Rethinking `developerMode`.** The 1–5 rating and the Data row are already
  gated behind it (`main.ts:1190`); they are not part of the crowding.
- **Batch or multi-destination sharing.** One destination per Share.

## 0. What is actually there — verified, not assumed

The editor shows **about 25 controls at once**, in three bars plus the menu.

**Top toolbar** (`main.ts:786–800`) — prompt textarea, tag chips, the version
`view-bar`, then `…` `◀ 1/1 ▶` `Generate with AI` `Revise with AI`, with
Template / Instructions / Model folded behind the `…` (`gen-choices`).

**Spec pane bar** (`main.ts:805–823`) — ten controls in one flat run:

```
YAML▾  ↻ Re-render   [spacer]   ⬇  ⬆  👤 Portrait  📌  ☁ Open  ☁ Save  ⬆ Publish  ☑ with narration
```

**Preview pane bar** (`main.ts:828`) — lint chip, `[spacer]`, `✎ Review`,
`★★★★★`, `👍 Learn from this`, `🎬 Export video`, `▶ YouTube`, export chip.
The stars and the lint chip only appear in developer mode.

**Sidebar** (`main.ts:843–897`) — `＋ New drawcast`, a search box, two
`h2`-headed lists (Library, Examples), then seven flat rows: Templates,
Instructions, Course, Data, Help, Sign in with Google, Settings.

What is already right, and is kept:

- **The modal-with-options pattern already exists.** `ytDialog`
  (`main.ts:3332–3352`) holds title, description, per-language checkboxes,
  visibility and burn-captions. This design generalizes that dialog rather
  than inventing a shape.
- **`createModal` / `createTabs` / `dialogHead`** (`ui/modal.ts`) already give
  every dialog the same head, ESC handling and backdrop dismissal.
- **The type scale in the menu is already one scale** — `.sidebar-heading` and
  `.sidebar-row` are both `0.92rem`, with a comment saying so
  (`styles.css:336–345`). What the sections lack is a caret, a count, and the
  ability to close.
- **A capability without its credential does not advertise itself.**
  `driveOpenBtn.hidden = !pickerConfigured()`, `uploadYtBtn.hidden =
  !googleConfigured()` (`main.ts:574–584`). Carried over verbatim into §2.

What is specifically wrong:

- **`⬆` means two different things in the same bar** — import a file, and
  Publish — with `⬇` for download beside them.
- **Four control vocabularies in one row**: icon-only, icon+text, text-only,
  a bare `<select>`, and a checkbox, separated by nothing but one
  `.pane-spacer`.
- **Sizes disagree inside one bar**: `.pane-bar button` is `0.82rem`,
  `.pane-bar .icon-only` is `0.92rem` (`styles.css:429–430`). The row steps.
- **`☑ with narration` is a publish option renting permanent bar space.**
- **The menu mixes two species under identical styling** — content lists you
  open, and modals you configure.
- **Courses are nested inside Library** as per-course `<details>`
  (`main.ts:2550–2555`), so a course is both a library item and not one.
- **Neither list can be closed.** Each is capped at `max-height: 13rem` and
  scrolls internally (`styles.css:356–363`).

### 0.1 The modals have the same three diseases

There are nine. Five go through `createModal` (Templates, Instructions, Data,
Subtitles, Course); **four build a raw `<dialog>` by hand** — Settings
(`main.ts:1103`), the author dialog, the 3D viewer and the YouTube upload.

- **The course modal is the worst bar in the app**: twelve controls in one
  flat `.pane-bar` (`ui/course.ts:832`) —
  `[Saved courses ▾] ＋New ✦Plan ✎Revise ▶Generate ✕Cancel ⟲Match 💾Save
  ⬆Publish ☑with narration ⬇Backup ↩Undo` and the cost note. Four unrelated
  species in one row: a document picker, lifecycle verbs, persistence and
  history.
- **`☑ with narration` exists twice**, identically — `main.ts:567` and
  `ui/course.ts:106`. The same rule violation, copied.
- **`⬇ Backup` is app-global** — "Download every course and drawcast as one
  file" — inside one course's toolbar.
- **Three of those twelve are `hidden` and appear mid-row** (`matchBtn`,
  `undoBtn`, `cancelBtn`), so the row reflows and buttons move under the
  cursor while the author works.
- **Settings has no scroll cap.** Because it skips `createModal` it has no
  `.dialog-body`, and so never gets the `max-height: min(70vh, 42rem);
  overflow-y: auto` every other modal has (`styles.css:480`). Eight
  `.settings-field` blocks with long notes simply grow the dialog.
- **Two settings are misfiled.** "Skip questions" and "Burn captions" sit
  under the *Google Cloud TTS key* field (`main.ts:1128–1134`). Neither is
  about a key.
- **No size scale.** Three widths, all one-offs: `dialog { max-width: 30rem }`,
  `.wide-dialog { 46rem }`, `.course-modal { min(104rem, 96vw) }`.
- **Actions have no home.** Some modals put them in a top bar (Course), some
  mid-body (Instructions has two loose `.row`s of four buttons each,
  `main.ts:992–993`), some at the end (YouTube).

What is already right: **Templates and Instructions** use `createTabs` +
`.tab-panel` + a leading `.hint` line. That is the pattern §7 standardizes
on — it is not invented here.

## 1. The rule

> **A button in a bar is a verb. Its options live in the modal that verb
> opens.**

No checkbox and no `<select>` sits permanently in a bar beside the button it
modifies. The two `<select>`s that survive — the spec format and the
generation choices behind `…` — are not options *of* an adjacent button; they
describe the pane itself.

This is the general pattern Hans asked for. Everything after it is an
application: §2–§4 in the pane bars, §7–§9 in the modals. The clearest test
of it is that `☑ with narration` currently exists twice, in two different
surfaces, and afterwards exists nowhere but inside Share.

## 2. Share — one verb, four destinations

A single `↗ Share` button replaces **five** controls: `⬇`, `⬆ Publish`,
`☑ with narration`, `🎬 Export video`, `▶ YouTube`.

It opens a modal with the destinations down the left, that destination's
options on the right, and one primary button whose label names the act:

| Destination | Options | Button |
|---|---|---|
| **Link** | with narration baked in | Publish |
| **YouTube** | title, description, languages, visibility, burn captions | Upload |
| **Video file** | burn captions, language | Export |
| **Spec file** | YAML / JSON | Download |

**No shared options row.** An earlier draft put language and narration at the
top as common ground. They are not common: baking is Link-only, the language
checkboxes are YouTube-only, burn-captions differs between the file and the
upload *on purpose* (`Settings.burnCaptions` vs `burnCaptionsOnUpload`,
`store.ts:69–81`). Faking commonality would cost more than it buys.

**The last destination is remembered** in `Settings.shareTo`, so a repeat
publish stays *Share → Enter*.

**Unconfigured destinations stay hidden**, exactly as the buttons do today
(§0). This is a deliberate carry-over of the existing rule, not an oversight:
it does mean a user who has never connected Google never learns YouTube
exists. Revisit separately if that trade turns out wrong.

**Behaviour is unchanged.** `publishDrawcast()` (`main.ts:3094`), the YouTube
upload path, `exportVideo()` and the spec download keep their code; Share
calls them. One improvement comes free: when the GitHub repo or token is
missing, the modal can say so *in place* with a link to Settings, instead of
today's red status line after the click (`main.ts:3097–3100`).

**Share is context-aware.** Opened from the editor it shares the open
drawcast; opened from the course modal (§8) it shares the course, showing
`Link` alone with "Course — N lectures" and calling `publishCourse()` instead
of `publishCast()`.

An earlier draft made course publishing a Non-goal. Finding the *identical*
bake-narration checkbox in both places (`main.ts:567`, `ui/course.ts:106`)
reversed it: two publish buttons carrying two copies of one question is
exactly the duplication §1 exists to prevent. One dialog asks it once. If
batch video export is ever written, it slots in as a second destination here
rather than as another button somewhere else.

## 3. ＋ Insert — and what portrait becomes

`👤 Portrait` becomes an **`＋ Insert ▾`** menu, holding `Portrait…` today and
`Source…` when someone writes it.

Portraits themselves are a first-class element — cameo mode, four reveal
effects, four styles (`spec/schema.ts:142–186`), used 20 times in
`examples.json`, and actively prompted for. The *button* is the problem:

1. It is driven by **`window.prompt()`** (`main.ts:2962`) — one of only two
   left in the app.
2. It inserts at hardcoded `x: 170, y: 550, width: 170` **and emits no draw
   command** (`main.ts:2947–2959`). The element therefore appears through the
   implicit final-draw rule (`render/plan.ts:515–519`): as an extra step
   tacked onto the very end of the drawcast, in a fixed corner. Almost always
   wrong, so the author edits YAML anyway.
3. On a multi-part playlist it always lands in part 1 regardless of which part
   is open — the status message says so itself (`main.ts:2958`).

The dialog replaces all three:

```
┌─ Insert portrait ────────────────────┐
│  ◉ By name   [ John Maynard Keynes ] │
│  ○ Image URL [                     ] │
│  ○ From file [ Choose… ]             │
│                                      │
│  Part   [ 1 – Comparative cost   ▾ ] │
│  Place  [ Cameo ▾ ]  after step [ 4 ]│
│                            [ Insert ]│
└──────────────────────────────────────┘
```

- **All three input paths stay.** Name and URL are largely redundant with
  asking the AI or typing YAML — what they add is *eager* resolution, so a
  misspelled name fails loudly now rather than silently at playback
  (`main.ts:2971–2985`). The file path is **not** redundant:
  `traceFromBlob()` has no other caller in the editor, and no YAML expresses
  it.
- **It emits a real `draw` command** at the chosen step, instead of relying on
  the implicit tail-draw. This is the one behaviour change in the design.
- **It targets the chosen part**, defaulting to the part being viewed.
- **Cameo or corner** picks between the two presentations the schema already
  has (`schema.ts:175`); corner keeps today's x/y/width defaults.

`📌` stays as it is, next to Insert. It is a document operation over portraits
*and* sources, not an insert, and its icon is its whole meaning.

## 4. Open and Save

`☁ Open` and `☁ Save` become **`Open ▾`** and **`Save ▾`**, each holding
*From disk* / *From Google Drive* and *To disk* / *To Google Drive*.

This is what finally kills the `⬆`-means-two-things collision: import stops
being a stray icon beside Publish and becomes what it is, a way of opening.
When Google is not configured the menu has one item and collapses back to a
plain button, so nobody without Drive pays a click.

The resulting bar:

```
YAML▾  ↻ Re-render  │  ＋ Insert ▾  📌  │  Open ▾  Save ▾  │  ↗ Share
```

Ten controls become seven, with three explicit groups instead of one spacer.
The preview bar becomes lint chip · `✎ Review` · `👍 Learn from this` · export
chip — plus the stars in developer mode.

## 5. The sidebar

Four sections, all built the same way, each a `<details>` with a caret, a
count, and remembered open state:

```
 ＋ New drawcast
 [ Search…                ]

 📚 Library      (12) ▾
 🎓 Courses       (3) ▸
 ✨ Examples     (24) ▾
 ✦ Templates      (8) ▸
 ──────────────────────────
 Instructions · Data · Help · Sign in · Settings
```

- **Library** holds loose drawcasts only. The per-course `<details>` grouping
  inside it (`main.ts:2530–2556`) moves out.
- **Courses** is new. One row per `SavedCourse` (`store.ts:312–333`); the row
  opens the course panel, the caret expands that course's lectures inline,
  reusing the grouping logic being moved out of `refreshLibrary`. A
  `＋ New course` row ends the section and takes over from today's
  `🎓 Course` tool row.
- **Templates** lists the author's own templates, with a `Manage…` row into
  the existing four-tab modal. The modal is unchanged.
- **Open state is per section**, in `Settings.sidebarSections`. Library and
  Examples default open; Courses and Templates default closed — four lists at
  `max-height: 13rem` would otherwise be a very tall menu.
- **Search auto-expands.** The filter already covers Library and Examples
  (`main.ts:917–921`) and now covers all four. A section with matches opens
  itself while a filter is active and returns to its remembered state when the
  filter clears — a hit inside a closed section is a hit that does not exist.
  While filtering, counts read `3 of 12`.
- **The footer rows get their own quieter style**, so configuration reads
  differently from content. `.sidebar-tools` already sits at the foot behind a
  rule (`styles.css:372–378`); it gains a muted colour and a smaller size.

## 6. The consistency pass

- **Delete the size exception.** `.pane-bar .icon-only { font-size: 0.92rem }`
  (`styles.css:430`) goes; every control in a bar shares one size and one
  height via a new `--bar-h` token.
- **Explicit groups.** `.bar-group` with a hairline `--line` divider between
  groups, replacing the single `.pane-spacer`.
- **One icon rule.** Icon + text for verbs; icon-only only where the glyph is
  the whole meaning — `📌`, `✕`, the mode pill. `⬇` and `⬆` disappear into
  Share and Open.
- **One panel treatment.** The same border, radius and shadow for the two
  editor panes and the dialogs.

## 7. Modals — one scale, one anatomy

**A named size scale**, replacing three one-offs:

| Class | Width | For |
|---|---|---|
| `.modal-s` | 30rem | one subject, a confirmation — today's bare `dialog` |
| `.modal-m` | 46rem | lists and tabs — today's `.wide-dialog` |
| `.modal-l` | min(104rem, 96vw) | working surfaces — today's `.course-modal` |

The body cap scales with the size rather than being overridden per modal
(`70vh` for s/m, `86vh` for l, as `.course-modal` already does).

Note for implementation: `tests/course-panel.test.ts:77–86` currently pins
`dialog { max-width: 30rem }` and `.course-modal`'s `min()` widths. Those
assertions move to the new class names in the same commit — they must not be
deleted, they are the drift guard.

**One anatomy, in this order, for every modal:**

```
┌──────────────────────────────────────────┐
│ head    title · optional context · ✕     │
├──────────────────────────────────────────┤
│ tabs    (only when there is more than    │
│         one subject)                     │
├──────────────────────────────────────────┤
│ body    scrolls; a leading .hint line    │
│         says what this is for            │
├──────────────────────────────────────────┤
│ footer  actions, right-aligned,          │
│         primary last                     │
└──────────────────────────────────────────┘
```

`createModal` grows a `footer` alongside `body`, and the four hand-built
dialogs move onto it. A modal's actions live in the footer; verbs that act on
something *inside* the body (per-lecture "again", per-template "Delete") stay
with their row. Nothing else floats mid-body.

## 8. The course modal

The twelve-control bar splits four ways, by what each control is *about*:

```
┌─ 🎓 Course   [ Causal inference ▾ ]  ＋ New ────────── ✕ ─┐
├───────────────────────────────────────────────────────────┤
│  ✦ Plan    ✎ Revise    ▶ Generate    ✕ Cancel             │
│  <status · links>                                         │
│                                                           │
│  [ course document ]              [ lectures ]            │
│                                                           │
├───────────────────────────────────────────────────────────┤
│  ↩ Undo   ⟲ Match                      💾 Save   ↗ Share  │
└───────────────────────────────────────────────────────────┘
```

- **Picker + `＋ New` move into the head.** They answer *which document am I
  editing*, which is context, not action.
- **Plan / Revise / Generate / Cancel stay with the document** as the working
  verbs, in one group. `✕ Cancel` keeps its reserved slot instead of being
  `hidden`, so the row stops reflowing under the cursor — disabled when
  nothing is in flight.
- **Undo / Match / Save / Share move to the footer.** `⟲ Match` keeps its
  conditional appearance but on the left, where a reflow moves nothing the
  author is aiming at.
- **`☑ with narration` goes into Share** (§2).
- **`⬇ Backup` moves to Settings → Advanced** (§9). It is an app-global
  export; it was never about this course.

Everything the panel *does* is unchanged: `runCourse`, `reviseCourse`,
`matchLibrary`, the `inFlight` AbortController set and the per-lecture rows
keep their code.

## 9. Settings

**Routed through `createModal`**, which is what gives it the missing scroll
cap, and **split into four tabs** with the existing `createTabs`:

| Tab | Holds |
|---|---|
| **Keys** | Anthropic key, Google Cloud TTS key, usage note |
| **Playback** | drawing style, voice, rate, cloud playback, skip questions, burn captions |
| **Publishing** | GitHub repo, token, subfolder |
| **Advanced** | contact email, developer mode, ⬇ Backup |

This is what refiles "Skip questions" and "Burn captions" out from under the
TTS *key* field, where they have no business being. No setting changes
meaning, and the long `.settings-note` explanations are kept verbatim — they
are the reason someone trusts pasting a token.

Two additions to `Settings` (`store.ts:41–106`) and `DEFAULT_SETTINGS`:

```ts
/** Which Share destination was used last, so a repeat publish is one keypress. */
shareTo: "link" | "youtube" | "video" | "spec";
/** Sidebar sections that are open, by section id. Absent = the section's default. */
sidebarSections: Record<string, boolean>;
```

Defaults: `shareTo: "link"`, `sidebarSections: {}`.

The portrait dialog's default part is deliberately **not** a setting — it is
read from the live playlist when the dialog opens.

## 10. Testing

`vitest`, `environment: "node"` (`vite.config.ts`) — there is no DOM, so the
established pattern applies: extract the decidable parts as pure functions and
test those, plus source-text drift tests (already used against `styles.css` in
`tests/course-panel.test.ts:77–86`).

**New pure functions, unit-tested:**

- `shareDestinations(caps)` → which destinations are offered, given which
  credentials exist. Pins the hidden-without-credential rule.
- `sidebarSections(lib, courses, examples, templates, filter, open)` →
  sections with counts, which are expanded, and `"3 of 12"` labels under a
  filter. Pins that Library excludes `courseId` items and that a section with
  matches auto-expands.
- `portraitInsert(playlist, choice)` → the spec edit: the element, its part,
  and the `draw` command. Pins that a draw command is emitted, that the target
  part is honoured, and that cameo omits x/y/width.
- `settingsTabs()` → which field belongs to which tab. Pins that skip-questions
  and burn-captions are no longer under Keys.

**Drift tests against source:**

- No `.icon-only` rule inside a `.pane-bar` selector.
- `--bar-h` is defined and used by both bars.
- No `window.prompt(` in the portrait path.
- `.modal-s` / `.modal-m` / `.modal-l` are the only modal width rules — no
  per-modal `max-width` override survives. (This replaces, and must not
  delete, the two existing width assertions at
  `tests/course-panel.test.ts:77–86`.)
- No `<dialog>` is constructed outside `createModal` — pins the four
  hand-built dialogs onto the helper so none can lose the scroll cap again.
- `with narration` appears once in the source, not twice.

**Regression:** the existing suite must stay green. `exportSequence` hands out
the document's own spec objects, so anything that reaches into the playlist —
Share's YouTube path especially — keeps translating into fresh playlists
rather than mutating `doc` (the trap recorded on `ytTranslations`,
`main.ts:3358–3365`).

## 11. Risks

- **Share costs frequent publishing one extra click.** Mitigated by the
  remembered destination: Share → Enter.
- **Hiding unconfigured destinations hides discovery** (§2). Carried over
  knowingly; flagged for a later decision.
- **`main.ts` is 3828 lines and this touches its spine.** The shell assembly
  (`main.ts:786–897`) is the part being rewritten; Share, the Insert dialog
  and the sidebar sections each land in their own module under `src/ui/`
  rather than growing `main.ts` further.
- **Four sections make a taller menu than two.** Two default closed, and the
  `13rem` per-list cap stays.
- **The course panel is the app's most stateful surface.** `ui/course.ts` runs
  a set of in-flight AbortControllers, a one-step undo, and per-lecture
  re-runs. §8 moves buttons between regions and must not disturb `syncBusy()`
  or the `inFlight` set — the buttons change place, not wiring.
- **Settings tabs hide fields that were previously all visible.** Someone who
  scrolled to find a key now needs the right tab. Mitigated by four
  self-evident tab names and by Keys being first.

## 12. Order of work

1. `--bar-h`, `.bar-group`, the icon rule, the panel treatment (§6), and the
   `.modal-s/m/l` scale (§7) — visible immediately, no behaviour change.
2. `createModal` grows a footer; the four hand-built dialogs move onto it
   (§7). Settings gets its scroll cap here, before its tabs.
3. `src/ui/share.ts` + the Share modal (§2), absorbing `ytDialog`, with the
   course context wired in.
4. `src/ui/insert.ts` + the portrait dialog (§3), and `Open ▾` / `Save ▾` (§4).
5. Settings tabs and the Backup move (§9).
6. The course modal's four regions (§8).
7. `src/ui/sidebar.ts` + the four sections (§5), moving course grouping out of
   `refreshLibrary`.
