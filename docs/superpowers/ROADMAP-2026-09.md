# Roadmap — everything outstanding, 2026-09-01

*Hans: "I realize that the spec is now more than a roadmap, but I want to list
all things and then make a final spec/plan that we implement stepwise based on
how we prioritize the issues. (So I am not finished)"*

**This file is the list.** It accumulates; nothing here is implemented. The
three design docs hold the reasoning, this holds the inventory. When the list
is complete, we pick an order and cut a plan from it.

Sources:
- **[P]** `specs/2026-09-01-publish-design.md` — Publish, embedding, names, folders
- **[S]** `specs/2026-09-01-style-and-vocabulary-design.md` — Instructions/References/Templates/Packs
- **[R]** this file — items not yet worked into a design doc

---

## A. Small and self-contained

| # | Item | Src | Notes |
|---|---|---|---|
| A1 | `Insert ▾` moves after `Open ▾` / `Save ▾` | S §7.1 | bar order only |
| A2 | Publish moves to the preview bar, after `✎ Review` | P §2, S §7.2 | |
| A3 | `fileSafe` gains a word-boundary length cap | P §8.1 | the one-line cause of long filenames |
| A4 | Share → **Publish**; "Link" → "Publish to GitHub" | P §1 | |
| A5 | Player/Editor pill removed; **▶ Player** row in the sidebar | S §7.3 | verified: player mode already has `✎ Edit` in its own control bar |
| A6 | Subtitle band is too dense — `rgba(24,20,16,0.82)` | R | see §D1 |
| A7 | Lint chip stops shouting at normal users | R | see §D2 |
| A8 | `👍 Learn from this` behind `developerMode` | S §6 | |

## B. Medium

| # | Item | Src | Notes |
|---|---|---|---|
| B1 | Publish shows destinations the author *can* enable, disabled with a reason | P §0.1 | why "Publish to GitHub" seemed missing |
| B2 | **Embed images** + **Embed narration** as checkboxes on the published copy | P §3 | must resolve on a **copy** — `exportSequence` hands out the document's own objects |
| B3 | Editable name field on each save/publish panel | P §8.2 | |
| B4 | One stable sources index, **before** any per-save folder | P §8.3 | reversed order scatters sources and Open sees one folder |
| B5 | Instructions → **Style**: an addendum, not the whole prompt; New/Save/Delete | S §4 | deletes improve/download/upload/rename by construction |
| B6 | Prompt editor moves behind `developerMode`, unchanged | S §5 | |
| B7 | One `Generate`/`Revise` button, state-determined | R | see §D3 |
| B8 | Startup state | R | see §D4 |

## C. Larger

| # | Item | Src | Notes |
|---|---|---|---|
| C1 | **Comments on published drawcasts via giscus** | R | see §D5 — has a user setup step |
| C2 | Thumbs up/down | R | §D5 — probably free with C1 |
| C3 | Share button on the viewer | R | §D5 — Web Share API, small |
| C4 | New logo | S §7.4 | three directions described; needs to be seen |
| C5 | Delete `halftone`/`poster`/`line` looks | P §5 | 0 of 114 bundled specs use them |
| C6 | `Insert → Image…` reduced to disk import only | P §4 | |
| C7 | **Player behaves and reads like YouTube's** | R | see §D6 |
| C8 | Mute/sound icon is ugly on macOS | R | §D6 — a symptom of C7 |
| C9 | Title moves **below** the player, YouTube-style | R | see §D7 — coupled to the drawcast opening with a drawn title |
| C10 | Chapter boundaries default to **timed**, not click | R | see §D8 — the mechanism exists; this is a default change |
| C11 | The continue pill should mean one thing | R | §D8 — chapter gate and authored `wait` currently share it |

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

| | Part | Contains | Why in this position |
|---|---|---|---|
| 1 | **Tidy-up** | A1–A8, C5, C6 | Pure UI, flags, CSS. No new concepts, no dependencies, immediately visible. |
| 2 | **The player** | C7, C8, C9, C10, C11, A6 | Self-contained, and it is what a viewer actually sees. |
| 3 | **Publish** | A4, B1, B2, B3 | Makes publishing explain itself, including why it appeared missing. |
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

## E. Still open, from earlier rounds

- Phone reproduction of the player's idle/gate fix — written blind, never
  observed.
- The parked course race: switching courses mid-generation writes the old text
  under the new id.
- The author dialog narrowed 880 → 736px on adopting the size scale; one line
  to revert if it bothers.
