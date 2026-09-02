# Roadmap — everything outstanding, 2026-09-01

*Hans: "I realize that the spec is now more than a roadmap, but I want to list
all things and then make a final spec/plan that we implement stepwise based on
how we prioritize the issues. (So I am not finished)"*

**This file is the list.** The three design docs hold the reasoning, this
holds the inventory. Items marked ✅ were delivered 2026-09-01 (Parts 1 + 3,
plan `plans/2026-09-01-tidyup-and-publish-plan.md`, rulings in
`plans/2026-09-01-tidyup-publish-ledger.md`); the rest is outstanding.

Sources:
- **[P]** `specs/2026-09-01-publish-design.md` — Publish, embedding, names, folders
- **[S]** `specs/2026-09-01-style-and-vocabulary-design.md` — Instructions/References/Templates/Packs
- **[R]** this file — items not yet worked into a design doc

---

## A. Small and self-contained

| # | Item | Src | Notes |
|---|---|---|---|
| A1 ✅ | `Insert ▾` moves after `Open ▾` / `Save ▾` | S §7.1 | bar order only |
| A2 ✅ | Publish moves to the preview bar, after `✎ Review` | P §2, S §7.2 | |
| A3 ✅ | `fileSafe` gains a word-boundary length cap | P §8.1 | the one-line cause of long filenames |
| A4 ✅ | Share → **Publish**; "Link" → "Publish to GitHub" | P §1 | |
| A5 ✅ | Player/Editor pill removed; **▶ Player** row in the sidebar | S §7.3 | verified: player mode already has `✎ Edit` in its own control bar |
| A6 ✅ | *(→ Part 2)* Subtitle band is too dense — `rgba(24,20,16,0.82)` | R | see §D1 — delivered in Part 2a (2026-09-02): 0.6 alpha (0.55 measured under AA) + stronger shadow, contrast drift-tested |
| A7 ✅ | Lint chip stops shouting at normal users | R | see §D2 |
| A8 ✅ | `👍 Learn from this` behind `developerMode` | S §6 | |

## B. Medium

| # | Item | Src | Notes |
|---|---|---|---|
| B1 ✅ | Publish shows destinations the author *can* enable, disabled with a reason | P §0.1 | why "Publish to GitHub" seemed missing |
| B2 ✅ | **Embed images** + **Embed narration** as checkboxes on the published copy | P §3 | must resolve on a **copy** — `exportSequence` hands out the document's own objects; **Publish + courses only** (ruling §F.3 narrows P §3.5's table — no embed on any Save) |
| B3 ✅ | Editable name field on each save/publish panel | P §8.2 | |
| B4 ⚖ | One stable sources index, **before** any per-save folder | P §8.3 | RULED 2026-09-02 per review F.1(1): per-save folders are DROPPED (highest harm, lowest miss), the single Settings folder stays — so nothing needs to precede anything. Buildable if Hans reverses |
| B5 ✅ | Instructions → **Style**: an addendum, not the whole prompt; New/Save/Delete | S §4 | delivered 2026-09-02: StyleProfile {id,name,text} in localStorage (⚖ S §4.1 opt 1), styleBlock() APPENDED to the request suffix (a user prompt fork can't drop a placeholder it never had) so the author wins; rides Generate/Revise/multi/courses; ⚖ S §9.3: own sidebar row |
| B6 ✅ | Prompt editor moves behind `developerMode`, unchanged | S §5 | delivered 2026-09-02: sidebar row + the … row's Instructions select both gated; … reads Template · Style · Model for normal users |
| B7 ✅ | One `Generate`/`Revise` button, state-determined | R | see §D3 — delivered 2026-09-02: mode DERIVED (editor text = blank ＋New doc or empty → Generate, else Revise; ui/author-mode.ts), placeholder carries the mode, viewing keeps Revise-from-here, busy keeps Cancel |
| B8 ✅ | Startup state | R | see §D4 — verified 2026-09-02 as ALREADY implemented: initialDoc() restores the newest library entry, bundled example on first run (D4's advice verbatim); B7's Revise label is what makes the restore honest |
| B9 ✅ | `prompt:` round-trips through the yaml header | R | ruling §F.3 — original Generate request only; revise trail stays in history/log; all-default single docs gain a header (one test) |
| B10 ✅ | Drive saves land in an app-created `drawcast` folder | R | ruling §F.3 — `drive.file` covers app-created folders; `parents` on create; name hardcoded first |
| B11 ✅ | `render()` resolves portraits/sources on the document's **own** spec objects | R | found by the 2026-09-01 final review: root cause of the embed-count lie (fixed at the counter) and of strokes leaking into library saves; fixed 2026-09-02 — `render/resolve.ts` clones at render entry, guarantee proven with fake resolvers like publish/embed's |
| B12 ✅ | Voice selection for Google TTS | R | delivered 2026-09-02 exactly as specced: settings.cloudVoices per language, durable picker in Settings → Playback (catalog from the voices API, ▶ Listen) + quick pick in the CC menu (saves the same preference, speaks a sample); dialogue speaker b keeps the contrasting default; the wrinkle closed by recording each clip's voice and comparing in linesToBake — pre-B12 publishes replay and reuse unchanged |
| B13 ✅ | Axis-label placement | R | Hans 2026-09-02, delivered same day (ce38f62): x-label right-justified ending at/past the arrow tip, tighter to the axis (short words may sit in line with the arrow); y-label centered above the arrow when short, ending at/left of the axis when long; PPF example is the test case. Follow-up 2026-09-02 (Hans: "there should be some space there"): on the standard plot the canvas-top clamp pressed the label ONTO the arrowhead — PLOT_MARGIN.top 55→75 + the four y1:695 literals →675 make the room, Y_LABEL_GAP 8→12 |

## 2026-09-01/02 publish-polish round (delivered)

Spec `specs/2026-09-01-publish-polish-design.md`, plan+ledger in `plans/`.
Delivered: translate-on-publish (chips, "Translate to", cost line, per-language
descriptions, YouTube burn deleted), Publish → Google Drive (same options as
GitHub, consent-first, 404 recovery, persisted id+name), `#gdrive=` viewer
route, PPF example teaches by contrast (STYLE 2026-09-01). NOT built (spec §3):
Drive permission automation, Docs-as-transport, Netlify fetch proxy (fallback
only if Hans's live `#gdrive` smoke fails). Outstanding verification: Hans's
live e2e of the Drive publish + `#gdrive` link; his eyes on the axis labels
(did_trends' inline "Time" first) and the Save-vs-Publish Drive filename
question (same default name in the same folder — wants a naming ruling).
Follow-up parked: an Upload cancelled during phase-1 translation re-pays
translations on reopen (cache is per-open by ruling); a source-signature
cache key would fix it if it ever hurts.

## C. Larger

| # | Item | Src | Notes |
|---|---|---|---|
| C1 ✅ | **Comments on published drawcasts via giscus** | R | see §D5 — delivered 2026-09-02: the published yaml carries the giscus ids (playlist.meta.comments; the viewer can reach nothing of the author's but the file + its own URL), repo from the cast link, thread keyed to the file path → course lectures free; "Allow comments" checkbox disabled-with-the-route until the ids are pasted (Settings → Publishing). AWAITS Hans's one-time github.com setup + live smoke |
| C2 ✅ | Thumbs up/down | R | §D5 — built nothing, by recommendation: giscus surfaces the Discussion's own reactions |
| C3 ✅ | Share button on the viewer | R | §D5 — delivered 2026-09-02: ↗ Share in the viewer footer, Web Share API with clipboard fallback |
| C4 ◐ | New logo | S §7.4 | the three directions are DRAWN (docs/logo-candidates.html — paper/dark, 64→16px, tab simulation); adoption awaits Hans's eye |
| C5 ✅ | Delete `halftone`/`poster`/`line` looks | P §5 | 0 of 114 bundled specs use them |
| C6 ✅ | `Insert → Image…` reduced to disk import only | P §4 | |
| C7 ✅ | **Player behaves and reads like YouTube's** | R | see §D6 — icons (2026-09-02, Part 2a), title move + chapter gates (same day, below). **Hans's ruling 2026-09-02: the progress bar STAYS inline** (D6.2 declined). Same day: hover-scrub preview (chip = exactly where the click lands, shared seekStep), grouping verified already-delivered by flex layout, and the k/N step readout ruled over a clock (D6.4) |
| C8 ✅ | Mute/sound icon is ugly on macOS | R | §D6 — delivered in Part 2a (2026-09-02) per review R4: EVERY control glyph became inline currentColor SVG in one pass (`ui/icons.ts`), not just the speaker |
| C9 ✅ | ~~Title moves below the player~~ → **the drawn title IS the title** | R | see §D7 — REVISED by Hans same day: the below-the-player move was a misreading ("I did not want a title text above the screen where we draw. But titles that are part of the drawcast go on top when that is natural"). Now: a title drawn on the canvas (the prompt's opening-beat rule, kept) suppresses the app's own title text entirely — player AND video frame (`render/title.ts` titleIsDrawn, exact-match after normalization); the chrome title returns to ABOVE the drawing only as the fallback for casts that never draw theirs |
| C10 ✅ | Chapter boundaries default to **timed**, not click | R | see §D8 — delivered 2026-09-02: DEFAULT_META.advance = auto; click stays per-playlist + URL override; unwritten playlists flip with the default (serializer omits defaults — ruled fine) |
| C11 ✅ | The continue pill should mean one thing | R | §D8 — delivered 2026-09-02: a click-gated chapter card says "Next chapter ▸"; "Click to continue ▸" belongs to the authored `wait` alone (and under the auto default the chapter card usually just holds and dissolves) |

## D. Detail on the items not yet in a design doc

### D1. The subtitle band

`figure-style.ts:35` — `linear-gradient(to top, rgba(24,20,16,0.82) 55%,
rgba(24,20,16,0))`. At 0.82 the band is nearly opaque ink over the drawing.

It exists so words stay readable over whatever is beneath them, which is a real
constraint — a caption over a pale figure with no ground is unreadable. So the
fix is not simply "less alpha": it is to keep contrast while taking up less
visual weight. Options: lower the alpha and add a text shadow; keep the
gradient but start it lower so it covers less; or drop the band and outline the
text. **Worth trying at ~0.55 with a shadow first** — cheapest, and it keeps
the same shape.

This band is burnt into exported video when `burnCaptions` is on, so a change
here changes every future export. Not a reason not to; a reason to look at one
before committing.

### D2. The lint chip shows to everyone — and that is inconsistent

Hans: *"The red warnings above the preview player in the editor is mainly just
annoying."*

Found it, and it is not what the design intended. `setLint` (`main.ts:2236`):

```ts
if (total === 0) { lintChip.hidden = !settings.developerMode; … }   // clean → dev only
…
lintChip.hidden = false;                                            // warnings → EVERYONE
```

So the **clean** chip is developer-gated and the **warning** chip is not. Round
one's spec described `developerMode` as showing "the lint list even when
clean", which reads as: non-developers still see real problems. In practice
these are layout warnings — label collisions, overlap heuristics — which are
compiler-quality signals the author cannot act on by editing YAML. So they are
noise to exactly the person who cannot fix them.

**Options:** (1) gate the chip entirely behind `developerMode`; (2) show only
`severity: "error"` and hide `warn`. **Recommend 2** — something genuinely
broken still surfaces, cosmetic complaints stop. (1) if even errors turn out to
be unactionable.

### D3. One button instead of Generate and Revise

Hans: *"It is confusing that we have 'Generate with AI' and 'Revise with AI' as
two buttons. One idea would be to have 'revise' as long as we have one loaded
and 'generate' after we pressed 'new drawcast'."*

Agreed, and the current arrangement is worse than merely redundant: **both
buttons read the same prompt box and do opposite things to your document.**
Generate replaces it; Revise edits it. Pressing the wrong one either discards a
drawcast or fails to start the new one you wanted — and nothing in the UI says
which is which beyond the verb.

One button, its label set by state:

| State | Button | Prompt placeholder |
|---|---|---|
| Empty document (after **＋ New drawcast**) | **Generate** | "Describe a drawcast…" |
| A drawcast is loaded | **Revise** | "What should change?" |

The placeholder carrying the mode too is what makes it legible *before* you
type rather than after you read the button.

**The cost, stated:** you can no longer generate something unrelated without
pressing New first. That is one extra click, and it is the right friction —
starting a new document should be deliberate, which is exactly the accident the
two-button version invites.

**It also reinforces D4:** if the app restores your last drawcast on open, the
button says **Revise**, which correctly warns you that typing here edits
something rather than making something.

### D4. What the app should show on startup

Hans: *"Right now it starts from where you ended. I am not sure if that is the
best. Always start the same way. OK, maybe it could be always start with a
blank spec… but make it very easy to get an example. Well, I am not sure here
and would like advice."*

Three candidates:

| | For | Against |
|---|---|---|
| **Restore last** (today) | you never lose your place | unpredictable; a returning user meets a document they may not remember |
| **Always blank** | predictable; "new presentation" | a blank editor teaches a first-time user nothing, and discards work |
| **Always an example** | welcoming, shows what the app is | overwrites nothing but hides your own work behind a click |

**Advice: restore if there is something to restore; show an example on a first
run.** It is not a compromise so much as the recognition that these are two
different people. A returning author loses their place under "always blank",
and losing your place is a worse failure than being surprised. A first-time
user meets a blank page under "restore", and a blank page is the worst
introduction this app could give — its whole argument is what it draws.

That needs no mode setting: "have I ever saved anything" already answers it.
And with D3 in place the restored state is honest, because the button reads
**Revise**.

**Against "always blank":** nothing is lost by not choosing it — Examples are
one click in the sidebar, and `＋ New drawcast` is one click to get the blank
page on purpose.

### D5. Comments, reactions and share on published drawcasts

Hans: *"When we publish to github (both individual and courses), also make it
possible to 'Allow comments' (using giscus)… these comments should be stored in
the users github… So I have no editing responsibility. If this is possible?
Also allow thumbs up and down… and even share."*

**Yes, and the architecture already suits it — with one caveat.**

**What is published today:** publishing commits a **`.yaml`**, not a page
(`publish/cast.ts`). The link points at drawcast's own hosted viewer with the
file's location in the URL — `castHref(viewerBase, owner, repo, file)`. So the
*page* is drawcast's; the *content* is the author's repo.

**Why that is good news here.** The viewer already knows `owner/repo` from the
link it was opened with. giscus is configured by `data-repo` — so the viewer
can mount giscus pointed at **the author's** repository, keyed on the cast
slug. Comments then live in that author's GitHub Discussions. Hans hosts the
page and owns none of the content, moderates nothing, and stores nothing. That
is precisely the arrangement he asked for.

**The caveat, which is a user-facing setup step and cannot be automated:** the
author's repo must have **Discussions enabled** and the **giscus GitHub App
installed**. Neither is reachable from the fine-grained `Contents: read/write`
token the app already asks for — enabling Discussions needs admin scope, and
installing an app is a web flow. So "Allow comments" is a checkbox *plus* a
short setup the author does once on github.com, and the UI has to say so
plainly rather than failing quietly.

**Thumbs up/down: probably free.** giscus surfaces the GitHub Discussion's own
**reactions**, so 👍/👎 arrive with C1 rather than needing a mechanism. Reactions
*without* comments is the harder ask — giscus is one widget — and storing votes
externally would mean Hans running a service and owning the data, which
contradicts the whole point. **Recommend: take the reactions giscus gives, and
do not build a separate vote store.**

**Share: small and independent.** A button on the viewer using the Web Share
API with a copy-link fallback. No dependencies, no accounts, works on a phone.
Can ship before or without C1.

**Courses:** every lecture is its own cast link, so per-lecture comments come
for free once the viewer mounts giscus — no extra work beyond the course
publish carrying the same flag.

**Open:** where the flag lives. It is a property of the published artifact, so
it belongs with **Embed images / Embed narration** in the Publish panel — a
third checkbox, "Allow comments", with the setup note beside it.

### D6. The player should read like YouTube's — and the mute icon shows why

Hans: *"Basically I want the player (and controls and behaviour) to be a bit
like a youtube player… Which reminds me: The icon for mute/sound is ugly (at
least on mac)."*

The mute icon is not a separate complaint; it is the clearest instance of the
general one.

**The bar mixes two kinds of glyph.** `▶ ⏮ ⏭ ▭ ⛶` are geometric symbols that
render as monochrome text and take `currentColor`, so they sit in the ink
palette. `🔊` and `🔇` are true emoji, and macOS renders them as **full-colour
Apple bitmaps** that ignore `color` entirely. So one control in an otherwise
inked bar is a small cartoon speaker — which is exactly what "ugly on mac"
looks like. It will not respond to the dark-mode work either, because a bitmap
has no `currentColor`.

**The structural difference from YouTube** is the progress bar. YouTube puts a
full-width scrubber **above** a row of buttons split into a left group
(play, next, volume, time) and a right group (captions, settings, theater,
fullscreen). Ours puts the progress bar *inline*, between the transport buttons
and the selects, so it competes for width with everything else — which is also
why the bar wraps and why the fold behind `⋯` was needed on a phone.

**Suggested direction**, smallest first:

1. **Replace the emoji with monochrome icons.** Inline SVG taking
   `currentColor` for every control, so the bar is one material and themes
   correctly. This alone fixes the mute icon and is independent of everything
   else.
2. **Move the progress bar to its own row above the buttons**, full width. This
   is the change that makes the bar read as a video player, and it removes the
   width contention that forced the `⋯` fold.
3. **Group left and right** — transport and volume left; captions, speed,
   theater, fullscreen right — with the same `.bar-group` idea the editor bars
   already use.
4. **Behaviour**: hover-scrub preview, click-anywhere-on-the-bar to seek, and a
   time readout are the YouTube behaviours we do not have. The step indicator
   (`3/12`) is drawcast's own idea and probably better than a clock here, since
   a drawcast is a sequence of drawn steps rather than a continuous tape —
   worth keeping, worth deciding deliberately.

**Note:** 1 is cheap and self-contained. 2 changes the fullscreen layout, which
already has its own sizing rules and a drift test, so it needs care there.

### D7. The title below the player, and what that obliges

Hans: *"like youtube players, perhaps the 'title' should be below the video and
not on the top (But in that case also try to make sure to start drawcasts with
a title)."*

Today `.cs-title` is a sibling **above** `.cs-stage` (`render/index.ts:104`),
so the order is title → drawing → controls. YouTube's is drawing → controls →
title.

**The parenthesis is the substantive half.** Moving the title below the player
means the viewer no longer reads what the piece is *before* it starts — the
first thing they get is a drawing with no label. So the drawcast has to
introduce itself. Two mechanisms already exist and should be checked before
anything new is built:

- `makeTitlePage` (`playlist/playlist.ts:282`) already generates a title card,
  used for playlists (`session.ts:420`). Whether a **single** drawcast gets one
  is the question to answer first.
- The compiler prompt's opening rules decide whether a generated drawcast draws
  its title at all. That is now a STYLE.md entry (2026-09-01) rather than a
  guess.

**So this item is really two:** move the title (small, and it touches the
fullscreen sizing rules and their drift test), and make a drawcast open with
its title on screen (a prompt change, and the more valuable of the two).

**Open:** whether a single drawcast gets a full title card like a playlist does,
or simply draws its title as the first beat of the first scene. The second is
lighter and keeps the piece moving, which is what the STYLE.md entry argues
for.

### D8. Chapter separation: click or a timed card

Hans: *"chapter separation is currently by click. I wonder if that is ok…
An alternative would be like a title card intro with some pause… clicking can
be used when a break is required and/or when the video has been going on for
'too' long and we need to make sure the user is awake."*

**Most of what he describes already exists.** `makeChapterCard`
(`playlist.ts:355`) ends with either gate:

```ts
commands.push(opts.gate === "click" ? { wait: "click" } : { pause: opts.gap ?? 1 });
```

and the caller passes `gate: advance`, where
`advance = opts.advanceOverride ?? playlist.meta.advance` — a **per-playlist
setting** with a viewer URL override (`&advance=auto`). So the timed card is
not a thing to build; it is a default to change.

**And it is already proven.** `exportSequence` (`playlist.ts:453`) hardcodes
`gate: "auto"`, and video export auto-resolves every `wait` — *"there is no
viewer to click during an export"* (`export/video.ts:350`). So **every
published drawcast video already crosses its chapters on a timer**, and those
work. The click gate is a live-playback-only behaviour, and the alternative has
been shipping in every upload all along.

**The real problem is not the click — it is that two different things share one
pill.** A chapter boundary is *structural*: the piece is moving on, and the
viewer need do nothing. An authored `wait` is *pedagogical*: stop, think,
answer, wake up. Both currently present the same "Click to continue ▸" pill, so
the viewer cannot tell "a section ended" from "you are being asked to engage" —
and a click that happens constantly stops reading as a request at all.

**Recommendation:**

1. **Chapter boundaries default to `auto`.** A viewer watching a lecture should
   not have to click to reach section 2, passive watching is a legitimate mode,
   and the exported videos already demonstrate that the timed card reads fine.
2. **Keep `meta.advance: "click"`** for the cases that want it — a kiosk, a
   self-paced exercise, a workshop. It exists, it is per-playlist, and the URL
   override already covers the "let it run" case.
3. **Give the two gates different presentation** so the pill means one thing.
   The chapter card can simply hold and dissolve; the pill belongs to `wait`.

**Hans's second half is a prompt matter, not a structural one.** *"Clicking can
be used when a break is required and/or when the video has been going on for
too long"* is a rule about **when a `wait` is earned** — after a dense stretch,
before a turn, when attention is likely gone. That belongs with the other
engagement rules in `STYLE.md` and then in the compiler prompt, not in the
chapter machinery. It will be filed there once the direction above is settled.

## F. Proposed split into parts — NOT yet agreed with Hans

Offered 2026-09-01, awaiting his decision. A reviewer should treat this as a
proposal to critique, not a settled plan.

*Reviewed 2026-09-01 by a second model — see
`2026-09-01-roadmap-review.md`: five of the six revisions endorsed, F.1(3)
rejected in favour of D2's errors-only chip, one contradiction found (F.1(2)
vs B2's Save → Drive checkboxes — since resolved by ruling, see §F.3), and a
proposal to swap Parts 2 and 3.*

| | Part | Contains | Why in this position |
|---|---|---|---|
| 1 | **Tidy-up** | A1–A8, C5, C6 | Pure UI, flags, CSS. No new concepts, no dependencies, immediately visible. |
| 2 | **The player** | C7, C8, C9, C10, C11, A6 | Self-contained, and it is what a viewer actually sees. |
| 3 | **Publish** | A4, B1, B2, B3, B9, B10 | Makes publishing explain itself, including why it appeared missing. |
| 4 | **Authoring loop** | B7, B8 | Small, changes daily use, independent of the above. |
| 5 | **Style / Instructions** | B5, B6 | The conceptual rework; deliberately after the mechanical work. |
| 6 | **Comments** | C1, C2, C3 | External-facing, has a user setup step, best when the rest is stable. |
| 7 | **Logo** | C4 | Needs an eye, not code. Parallel to any of the above. |

### F.1 Six places the proposal revises Hans's stated intent

Each is a suggestion to simplify, offered because he said: *"I do not want to
make it too complicated, but also I want the intent of these changes to be
respected when possible. I am willing to revise and adapt if you have
suggestions that are more intuitive or makes it significantly easier."*

1. **Drop per-save folders (B4) entirely**; keep the single Settings value. It
   needs the stable-index rework first, and without that, saves scatter and
   Open sees one folder. Highest harm, lowest miss.
2. **Name field only where a panel already exists.** Fix `fileSafe`'s cap (A3),
   add the field to Publish and Save → disk, and do **not** give Drive and
   GitHub saves a dialog — they are one click today.
3. **Hide the lint chip entirely** rather than the "errors only" refinement in
   D2. One flag beats severity logic. Risk: a genuinely broken layout goes
   unannounced.
4. **Split the player part**: icons (C8) are cheap and independent; moving the
   progress bar touches the fullscreen sizing rules and their drift test.
5. **On the title (C9), do the prompt half first** — drawcasts opening with a
   drawn title. The DOM move may then prove unnecessary.
6. **Thumbs up/down: build nothing.** Take giscus's reactions. An external vote
   store means Hans running a service and owning the data, contradicting the
   reason for choosing giscus.

### F.2 Two things defended rather than simplified

- **Embed checkboxes (B2)** — the spec version is already the simplification
  (no warning prompt). The one thing that must not be cut is resolving on a
  **copy**: `exportSequence` hands out the document's own objects.
- **One Generate/Revise button (B7)** — the only item that prevents active data
  loss. Two buttons reading one prompt box and doing opposite things is how a
  drawcast gets discarded.

### F.3 Rulings taken 2026-09-01, in conversation after the review

1. **Save writes the document verbatim; Publish prepares a copy.** Embed
   checkboxes appear **only** on Publish (GitHub and courses). Save → Drive
   and Save → GitHub stay one click; Save → disk keeps its dialog (format,
   plus the B3 name field). This resolves the review's R2/B2 contradiction
   and settles P §3.5's open question (disk: no). The route to a
   self-contained save remains `Insert → Embed images in the file` first,
   then save — the file you send is the file you see. **Accepted gap:** no
   document-level narration bake; baking is a publishing act (it spends the
   author's TTS budget for viewers). Buildable later into the spec's `audio`
   field if ever missed.
2. **Drive saves stop landing in root** (→ B10). The `drive.file` scope is
   per-file, not per-folder: the app can create its own folder and save into
   it with `parents`, it just cannot see folders it did not create. So: on
   first Drive save, find-or-create a folder named `drawcast` and save there.
   Name hardcoded first; a Settings value beside the GitHub folder only if a
   different name is ever wanted. Open is unaffected — the Picker shows every
   accessible file regardless of folder, so nothing can be lost by
   scattering (the B4 hazard has no Drive analogue).
3. **The yaml carries its founding prompt** (→ B9). Today the local library
   keeps `doc.prompt` but the exported yaml drops it, so a Drive/disk/GitHub
   round-trip loses the request — which B7's Revise and D4's restore both
   want. Fix: optional `prompt:` in the playlist header, written from
   `doc.prompt`, read back on open. **Original Generate request only** —
   revise instructions stay in version history and the generation log
   (`doc.prompt` is untouched by revision, `main.ts` revise path; the
   `⟶ revise:` chains appear only in log entries). The published copy keeps
   the field — one serializer, no special cases.

## E. Still open, from earlier rounds

- Phone reproduction of the player's idle/gate fix — written blind, never
  observed.
- ~~The parked course race~~ — closed 2026-09-02: all three doors (picker, ＋ New,
  sidebar rows) refuse while `inFlight` is non-empty.
- The author dialog narrowed 880 → 736px on adopting the size scale; one line
  to revert if it bothers.
