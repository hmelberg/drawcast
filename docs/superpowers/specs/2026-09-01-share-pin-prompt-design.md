# Design: Share asks about pinning, without owning it

*2026-09-01. A small follow-up from a conversation with Hans, who asked
whether Pin belongs behind Share. The short answer was no — but the instinct
behind the question was right, and this is what it becomes.*

## The question this answers

Hans: *"Would it be a better fit to put it as a choice after selecting share?"*

Pinning **is** mostly about the published artifact: it embeds every portrait's
traced strokes and every source's page image into the spec, so the drawcast
renders identically forever — offline, on any machine, after a Wikipedia
article is renamed or an API is discontinued. You care about that most at the
moment you hand someone a link.

So Share is where the *question* belongs. It is not where the *verb* belongs.

## Why Pin does not become a Share option

The obvious model is `☑ with narration`, already a Link option. Pinning looks
like its sibling — both are expensive one-time preparations that make the
published thing self-sufficient. The parallel breaks on one property:

| | Touches the author's document? |
|---|---|
| **Bake narration** | **No.** `publishTextFor()` builds the published *text* and hands it to `publishCast`. `doc` and `specArea` are untouched. |
| **Pin** | **Yes.** `applyPlaylist` rewrites `specArea.value`, pushes a manual-edit history entry, and autosaves. |

Bake is a property of the copy you send. Pin is an **edit to your source** — a
large one, and effectively one-way: un-pinning means stripping embedded stroke
data back out, and the small original survives only in history. Bake is
undone by publishing again without it.

Making Pin a Share checkbox would mean **choosing a destination silently
rewrites the document you are editing**. Share does not do that to anything
else, and it should not start.

Two more reasons it is not only a publish concern: pinning matters when you
are working offline, archiving, or handing someone a `.yaml`; and it protects
a drawcast you are still editing against a link dying underneath you.

## What this builds

When **Link** is the selected Share destination and the drawcast contains
portraits or sources that are **not** pinned, the Link panel shows a note
above the publish button:

> **3 images are fetched when someone plays this.** They will break if a link
> dies or an API changes. **Pin them into the file** — the drawcast then
> renders identically forever, offline and on any machine, at the cost of a
> larger document.
>
> `[ Pin now ]`

- The count is real — the number of `portrait` and `source` elements lacking
  embedded `strokes`.
- **`Pin now` runs the existing pin**, the same code the menu item calls. It
  is not a copy.
- When it finishes, the note is replaced by a quiet confirmation and publish
  continues normally. Pinning does not publish, and publishing does not pin.
- When every image is already pinned, or the drawcast has none, **nothing is
  shown at all.** A note that is always there is a note nobody reads.
- The note never blocks publishing. It informs; the author decides.

That is the whole feature. It surfaces the trade-off at the moment it is real,
in the words that explain it, without moving a document-editing verb into a
delivery menu.

## Non-goals

- **Pin as a Share checkbox or destination option.** See above.
- **Auto-pinning on publish.** Silently enlarging someone's document because
  they published is the same violation, just without the click.
- **A warning on YouTube or Video file.** Those destinations record the
  drawing as it plays; unpinned images are resolved during that render, so
  nothing rots afterwards. The note is Link-only.
- **Blocking publish.** An unpinned drawcast is a legitimate thing to publish.

## Open question for Hans

The menu is now **`Insert ▾ → Portrait… · Pin all images`**, after his rename.
`Pin all images` is not an insert, and once this prompt exists, Share becomes
its main point of discovery. So its menu home is worth revisiting:

1. **Leave it under Insert** — one extra item, slightly miscategorised.
2. **Move it under `Save ▾`** — pinning is about the durability of the saved
   artifact, which is closer to what Save means.
3. **Drop the menu entry entirely** and let Share's prompt be the only path —
   simplest, but it strands the offline/archival cases that have nothing to do
   with publishing.

I lean **2**. Not deciding here; it is a one-line change once chosen.

## Testing

`vitest`, `environment: "node"` — no DOM, so the decision is a pure function
and the wiring is a drift test.

- `unpinnedImages(playlist): number` — counts `portrait` and `source` elements
  with no embedded `strokes`. Pure, unit-tested: zero for an empty playlist,
  zero when all are pinned, the right count when some are, and it must count
  across **every part** of a multi-part playlist, not just the first.
- A test that the note renders only for `subject === "drawcast"` **and**
  `shareTo === "link"` **and** `unpinnedImages > 0` — the three-way gate is
  where this will rot first.
- A drift test that `Pin now` calls the same entry point as the menu item,
  so the two cannot diverge into two pinning implementations.

## Note on the bug found while discussing this

Both items in that menu — Insert portrait and Pin — were **dead on arrival**:
`createModal()` builds a `<dialog>` but does not attach it, and `insert.ts`
never did, so `showModal()` threw on a detached element and the clicks did
nothing. Fixed in `812d993`, with a guard that follows aliases (`main.ts`
legitimately attaches via `const d = m.dialog; app.appendChild(d)`).

Worth recording because of *how* it survived: every review checked those
dialogs were **built** correctly and none checked they were **connected** —
the same shape as the course row that opened the wrong course. Construction
is what a static reviewer sees; connection is what the user sees.
