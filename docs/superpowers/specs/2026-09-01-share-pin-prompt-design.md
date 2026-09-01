# Design: Publish — the menu, where it lives, and what embedding is for

*2026-09-01. Started as a small follow-up about pinning; grew, after Hans's
review, into the round that renames Share, moves it, and questions two pieces
of surface. **Nothing here is implemented — this is for Hans to instruct
against.** Open questions are marked as such rather than decided.*

## 0. Two findings from the conversation, verified in code

### 0.1 "Publish to GitHub" is missing because it hides itself

Hans could not find it. It is not a bug in the usual sense — it is working as
designed, and the design is wrong:

```ts
{ id: "link", label: "Link", action: "Publish", needs: (c) => c.github }
github: Boolean(getGithubToken() && parseRepo(settings.githubRepo))
```

With no GitHub repo *and* token in Settings, the destination is **not rendered
at all**. The rule is "a capability without its credential does not advertise
itself", inherited from `driveOpenBtn.hidden = !pickerConfigured()`.

That rule is right for Drive, whose credential is an **environment** value the
author cannot set — advertising it would offer something they are powerless to
enable. It is wrong for GitHub, whose credential is a **Settings** value the
author can set in thirty seconds. Hiding it means the one thing that would
tell them how is the thing withheld until they already know.

Round one's spec flagged exactly this and deferred it: *"it does mean a user
who has never connected Google never learns YouTube exists. Revisit separately
if that trade turns out wrong."* It turned out wrong, on the first destination
the author actually wanted.

**Proposed:** a credential the author can supply is shown **disabled, with the
reason and a route** — `Link — set a repository in Settings →`. A credential
they cannot supply stays hidden. That splits the rule along the line that
actually matters.

### 0.2 The engine already does what Hans proposed

> *"the player engine should be able to handle both url links as well as base64
> images. pinning should convert links to base64."*

Both halves already hold. `loadRaster` (`portrait.ts:96-103`) sets
`img.src = url` with no scheme check, so a `data:` URI loads exactly like an
`https:` one. And pinning already embeds: it resolves the image and writes the
result into the spec as `strokes`, a `t2:`/`img2:` string whose payload is a
JPEG data URI (`encodePhoto`, `spec/trace.ts:68`).

So the architecture Hans described is the architecture that exists — under the
field name `strokes` rather than a base64 `url`. **No work is proposed here.**
It is recorded so nobody rebuilds it.

## 1. Share becomes Publish

Rename the verb and the modal to **Publish**. It is what the thing does, it is
the word Hans reaches for, and "Share" invited the confusion that put a source
download inside it for a whole round.

The destination labelled **Link** becomes **GitHub Pages** or **Publish to
GitHub** — "Link" describes the output, not the act, and is the reason a
destination Hans wanted read as something else.

**Open:** whether the button keeps `↗` or takes a different glyph.

## 2. Publish moves above the picture

Today `↗ Share` sits in the **spec** pane bar, with the YAML. It belongs in the
**preview** pane bar, above the drawing.

The reasoning matches the rule the last round established: a bar's controls act
on the thing the bar is attached to. The spec bar edits the document; the
preview bar acts on the result. Publishing sends the *result* somewhere, so it
belongs with the result. It also puts it beside `✎ Review` and the export
chip — the other things that treat the drawcast as finished output.

Consequence to check when implementing: the preview bar is the one that folds
on a phone, and the spec bar's group dividers assume three groups. Both need
re-checking after the move; neither is hard.

## 3. Embedding: one count, one choice, said plainly

Hans: *"pinning (embedding) mainly belongs in the publish category"*, and then:
*"maybe no need to make a distinction between wikipedia and other links when
pinning. if people want to embed, let them embed, but we make it explicit."*

The boundary established earlier holds: **Publish asks the question; Publish
does not own the verb.** Baking narration builds the published *text* and
leaves the document alone; embedding **rewrites `specArea`, pushes a history
entry and autosaves**. A destination choice must not silently enlarge the
document being edited.

### 3.1 The kind-aware draft was wrong, and its own reasoning says so

An earlier draft of this section proposed counting only "risky" images —
staying quiet about Wikipedia-name portraits and naming only linked images and
source pages. Hans rejected it, and he is right on three counts:

1. **Availability does not discriminate.** The same draft argued the dominant
   risk is not link rot but *availability at playback* — offline, on a plane,
   behind a school or corporate firewall. On a filtered network Wikipedia is
   exactly as unreachable as anything else. Ranking by provider stability
   answered the smaller question while the larger one applies uniformly.
2. **It hard-codes a judgement that will rot.** §7 of this spec already listed
   that as a risk in the same breath as proposing it: if Wikipedia stops being
   reliable — Commons deletes files for licensing routinely — the prompt goes
   quiet exactly when it should not.
3. **Nobody thinks in those terms.** The author's question is "are my images in
   the file or not". A prompt saying "2 of your 5 are risky" invites "why not
   the other 3?", and that answer is a paragraph.

### 3.2 Two things get embedded, and they should read as one idea

Hans: *"maybe also use embed about speech data too. This is a choice when we
publish, both google drive as well as github. Also a choice when we publish
courses."*

A drawcast has exactly two things that live outside the file and are fetched
later:

| | What it costs | What it buys |
|---|---|---|
| **Images** | size (~15–25 KB a portrait, ~70–140 KB a source page) | renders anywhere, offline, after a link dies |
| **Narration** | size, plus TTS budget spent once by the author | plays for a viewer who has no key of their own |

They are the same idea and should use the same word. Today one is called
"pinning" and the other "with narration", which is why neither reads as what it
is.

### 3.3 Both become publish-time choices, and neither touches the document

**Verified:** `publishTextFor(signal, bake)` (`main.ts:3440`) builds
`formatPlaylist(doc.playlist, "yaml")` and returns a *string* — the baked
narration goes into the published text and `doc` is never touched. Narration
embedding is already non-mutating and already a checkbox.

Image embedding can work the same way, and this resolves the tension the
earlier draft worked around. Instead of a prompt whose button rewrites the
author's document, **the published copy gets the images embedded and the
document is left alone**:

```
☑ Embed images      the published file carries them; your document is unchanged
☑ Embed narration   the published file speaks; viewers need no key
```

Two plain checkboxes, one shape, stated cost. That is the "make it explicit"
half, and it needs no warning prompt at all.

### 3.4 The trap this must not fall into

`exportSequence` hands out the document's **own** spec objects — the hazard
this project has documented before and that round two's review verified clean.
`resolvePortraits` and `resolveSources` write `strokes` onto the elements they
are given. So a publish-time image embed **must resolve on a copy**, or it
silently rewrites the author's document — exactly what putting it on the
published side is meant to prevent.

`playlistWithSpecs(playlist, specs)` (`playlist/playlist.ts`) already builds
fresh entries and is already used for the YouTube translation path for this
same reason. Use it. A test must assert the document's spec objects are
unchanged after a publish with embedding on.

### 3.5 Where the choice appears

Embedding is offered wherever the output is **a spec someone else will play**:

| Destination | Embed images | Embed narration | Note |
|---|---|---|---|
| Publish → GitHub | yes | yes | today only narration, labelled "with narration" |
| Save → Google Drive | yes | yes | today neither — Hans asked for both |
| Save → To disk | yes | yes | same argument: a `.yaml` you email is a spec someone else opens |
| Publish a **course** | yes | yes | GitHub only — `shareDestinations(caps, "course")` returns `["link"]`, confirmed |
| Video file / YouTube | — | — | already rendered; images and speech are baked into the frames by definition |

**Open:** whether Save → To disk should carry them. Hans named Drive and
GitHub. The argument extends — a `.yaml` handed to a colleague has the same
problem — but it also puts two checkboxes on a save that is currently one
click.

### 3.6 The menu item stays, for the case publishing does not cover

`Insert → Embed images in the file` remains, and now has a clearly distinct
job: it changes **your document**, on purpose, for the times you are not
publishing — working offline, archiving, or about to present on a network you
do not trust. That last case still has no other entry point.

So the two paths differ in exactly one way, and the copy should say so:
publishing embeds into **the copy you send**; the menu item embeds into **the
file you are editing**.

### 3.7 Rename: pin → embed

Hans's own word throughout has been **embed**, and it is the better one. "Pin"
is jargon that needed a paragraph to explain — which is how he came to ask what
the button did in the first place. Rename the menu item to **Embed images in
the file**, "with narration" to **Embed narration**, and drop "pin" and "bake"
from the copy entirely. The spec fields stay `strokes` and `audio`; only the
language the author reads changes.

*(No longer proposed: the warning prompt, selective embedding, per-kind counts,
and a `riskyImages` function. §3.1 removed the reason for the ranking, and
§3.3 removed the reason for the prompt — a checkbox that does not touch your
document needs no warning.)*

## 4. Open: does `Insert → Image…` earn its place?

Hans: *"I am not sure we need it. Maybe if people want to import an image from
the hard disk."*

The evidence agrees with the instinct, and narrows it to exactly that case:

- The **name** path is redundant — the AI already emits portraits, and
  `type: portrait, of: "Ricardo"` is one line of YAML. What the dialog adds is
  *eager* resolution: a misspelled name fails loudly now instead of silently at
  playback.
- The **URL** path is equally expressible in YAML.
- The **file** path has no substitute at all. `traceFromBlob` has no other
  caller, and no YAML can say "trace this image on my disk".

**Options:**

1. **Reduce to one item** — `Insert → Image from disk…`, dropping the name and
   URL fields. Smallest surface, keeps the irreplaceable path.
2. **Keep all three**, for the eager-resolution safety net.
3. **Drop the menu**, and let disk import ride on Publish's pin flow or a
   drag-and-drop onto the editor.

Recommendation: **1**. It states what the control is uniquely for. The eager
resolution is worth something, but not a menu of its own.

## 5. Open: delete the unused `look` variants?

Hans: *"we tend to use photos and not the other formats now since the other
formats did not work well. We could clean up if it creates complexity."*

Measured: `look` appears in **0 of the 114 bundled specs** — every one uses the
default. And `halftone`/`poster` appear **0 times in the compiler prompt**, so
the model learns of them only through the injected schema description.

So `halftone`, `poster` and `line` are: advertised to the model only obliquely,
exercised by no bundled example, and judged poor by the person who commissioned
them. That is a strong case for deletion — and this project's standing rule is
replace-or-delete rather than freeze, since there are no outside users.

**Open**, because it is a real deletion: it removes `LOOK_DIM` entries, the
schema enum, and the styling branches, and any saved drawcast that used one
would change appearance. Worth confirming Hans has none before cutting.

## 6. Testing

`vitest`, `environment: "node"` — no DOM. Pure functions plus source-text drift
tests, as established.

- `unembeddedImages(playlist)` → `{ count, bytes }` for every image still
  fetched at playback, whatever its source — used to label the checkbox with
  its cost. Pure. Must count across **every part** of a multi-part playlist,
  not just the first, and must exclude locally-traced images, which are
  embedded already.
- **The document is unchanged after publishing with embedding on.** Assert the
  spec objects `exportSequence` hands out are byte-identical before and after.
  This is §3.4, and it is the one test that matters most in this section.
- `shareDestinations` gains a third state — offered, **disabled-with-reason**,
  hidden — and its tests must pin which credential produces which. This is the
  §0.1 fix and the place it will rot.
- A drift test that the Publish button is built in the **preview** pane bar,
  not the spec bar.
- A drift test that `Pin these` and the menu item reach the same entry point,
  so the two cannot diverge.

## 7. Risks

- **Moving Publish rearranges muscle memory** for the one control most likely
  to be used under time pressure.
- **The size estimate is derived, not measured** — from `LOOK_DIM` and JPEG
  quality plus base64 overhead. If it reads far off in practice, the author
  stops trusting the one number the decision rests on.
- **Deleting the looks is irreversible** without a revert, and a saved drawcast
  using one changes appearance silently rather than erroring.

## 8. Names and folders — currently derived, never chosen

Hans: *"consider whether it should be possible to change the default subfolder"*
and *"whether people should be able to change the name (currently it is a bit
long) for all saving and publishing options."*

### 8.1 There are two naming rules, and only one of them is sane

| Rule | Caps length? | Used by |
|---|---|---|
| `slugify(title, 40)` (`github.ts:115`) | **yes** — 40 chars, cut at a word boundary | GitHub source save, publish |
| `fileSafe(title)` (`share.ts:149`) | **no** — strips illegal characters and trims, nothing else | disk save, Drive save, video export, YouTube |

So the GitHub paths are already short, and every *other* destination carries
the **entire title** as the filename. A drawcast called "Ricardo on trade and
comparative advantage in the nineteenth century" saves to disk under that whole
string. That is the "a bit long", and it has a one-line cause: `fileSafe` never
learned what `slugify` knows.

**Proposed, and cheap:** give `fileSafe` the same word-boundary cap. Keep its
character rules — a disk file may keep spaces and read as "Ricardo on
trade.yaml"; it does not need to become a URL slug. This alone fixes the
complaint with no UI at all.

### 8.2 Letting the author choose the name

Today no destination shows its filename before committing. Disk save has a
dialog (format only); Drive and GitHub source save have no dialog at all —
they fire on click; publish derives a slug the author never sees.

**Proposed:** each destination's panel shows the name it is about to use, in an
editable field, pre-filled. One click still works; editing is available for
those who want it. Concretely: a name field in the Publish → GitHub panel, in
Save → To disk, and in Save → To Drive and To GitHub (which need a small dialog
they do not currently have).

**Open:** whether Save → Drive/GitHub gaining a dialog is worth the friction.
They are one click today. An alternative is to keep them one click and let the
name be corrected only from the destination that already has a panel.

### 8.3 The subfolder — and the hazard behind it

One global `settings.coursesDir` currently governs three trees at once:

```
<coursesDir>/
  casts/
    <slug>.yaml          ← published drawcasts
    sources/
      <slug>.yaml        ← saved sources
      index.json         ← the ONLY manifest Open reads
```

It is set once, in Settings → Publishing, and never at save time.

**The hazard:** `openSourceFromGithub` reads exactly one manifest,
`sourceIndexPath(dir)` for the *current* `coursesDir`. Round two already
recorded a deferred minor here — changing `coursesDir` leaves a document listed
in the old folder's manifest while new saves go to the new one. Making the
folder **choosable per save** turns that from an edge case into the normal
case: sources scatter across several folders, each with its own index, and Open
shows only whichever folder the setting currently points at. Earlier saves
vanish from the picker without being deleted — the worst kind of loss, because
nothing failed.

**So a per-save folder requires fixing the index first.** The manifest entry
already carries a full `path` per source, so the fix is small: keep **one**
index at a stable location (the repository root, or a fixed `drawcast/`
folder), independent of wherever the files themselves are written. Then the
folder becomes free to vary and Open still sees everything.

**Proposed order:** single stable index first, per-save folder second. Doing
them in the other order ships the scattering.

**Open:** whether the folder belongs in the save panel at all, or whether the
Settings value plus a per-document memory (`sourcePath`, which already exists
and already keeps a re-save stable) is enough. A folder field on every save is
one more decision at a moment the author usually does not want one.

### 8.4 A note on the tree itself

Sources currently land at `<coursesDir>/casts/sources/` — *nested inside*
`casts/`, because the caller passes `dir: joinPath(settings.coursesDir,
"casts")`. Round two's review noted the deviation from the spec's
`<coursesDir>/sources/` and judged it benign, which it is: save and open agree.
But if §8.3's stable index is built, this is the moment to lift sources out of
`casts/` — they are not casts, and the nesting will confuse anyone who opens
the repository.
