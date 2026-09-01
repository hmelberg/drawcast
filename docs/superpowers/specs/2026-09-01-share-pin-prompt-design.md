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

## 3. Pinning: the prompt, made kind-aware

Hans: *"pinning (embedding) mainly belongs in the publish category."* Agreed,
with the boundary established earlier: **Publish asks the question; Publish
does not own the verb.** Baking narration builds the published *text* and
leaves the document alone; pinning **rewrites `specArea`, pushes a history
entry and autosaves**. A destination choice must not silently enlarge the
document being edited.

The draft counted every unpinned image. Hans's objection to that is correct and
the measurements support it:

| | Traced at | Weight each | Fragility |
|---|---|---|---|
| Portrait from a **Wikipedia name** | 240px | ~15–25 KB | low — stable article, free CORS-open API |
| Portrait from a **URL** | 240px | ~15–25 KB | ordinary link rot |
| **Source page** | **640px** | **~70–140 KB** | high — this project's own notes record PLOS serving PDFs without CORS, Open Library returning 1×1 GIFs instead of 404s, IHSN TLS failures, OpenAlex choking on encoded DOI slashes |
| Portrait from a **local file** | — | already embedded | none — `traceFromBlob` writes `strokes` at insert (`insert.ts:217`) |

*(Sizes derived from `LOOK_DIM` and `toDataURL("image/jpeg", 0.8)` plus base64's
33% overhead; no bundled example is pinned, so nothing could be weighed
directly.)*

Two things follow:

- **The cheap pin is the least worth doing and the expensive pin is the most.**
  A Keynes portrait costs 20 KB to protect something that will resolve fine for
  years; a source page costs 100 KB to protect a resolver chain that is
  documented to break.
- **The real risk is availability at playback, not Wikipedia's stability.**
  Every play makes a live call. Offline, on a plane, behind a school or
  corporate firewall, or where Wikimedia is blocked, the image is simply
  absent. For a lecturer that is the case that bites, and it has nothing to do
  with whether the article still exists.

**Proposed prompt, kind-aware:** when Publish → GitHub is selected, say nothing
about Wikipedia-name portraits. Name only the risky kinds, and count them:

> **2 source pages and 1 linked image are fetched when someone plays this.**
> They break if a link dies or an API changes — and none of them load without a
> network. **Pin them into the file?** The drawcast then renders identically
> forever, offline and anywhere, at about 250 KB.
>
> `[ Pin these ]`

Nothing is shown when there is nothing risky to pin. The note never blocks
publishing. `Pin these` calls the existing pin — not a copy of it.

**Open:** whether pinning becomes **selective** (pin the fragile source, leave
the Keynes portrait alone) rather than all-or-nothing. It is the better
behaviour and a larger change: today's operation resolves everything in one
pass.

**Also worth having:** the same prompt, reachable when *presenting* rather than
publishing — "I am about to show this on a network I do not trust." That is the
non-publish case pinning exists for, and it currently has no entry point.

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

- `riskyImages(playlist)` → counts by kind: `{ sources, linked }`, excluding
  Wikipedia-name portraits and already-embedded ones. Pure. Must count across
  **every part** of a multi-part playlist, not just the first.
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
- **Kind-aware counting hard-codes a judgement** that Wikipedia is safe. If
  that stops being true the prompt goes quiet exactly when it should not.
- **Deleting the looks is irreversible** without a revert, and a saved drawcast
  using one changes appearance silently rather than erroring.
