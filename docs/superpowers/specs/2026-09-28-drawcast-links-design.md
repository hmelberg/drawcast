# Links between drawcasts — design

2026-09-28 · status: approved 2026-09-29 (with `image`) · built 2026-09-29 — see "As built" at the end

## 1. What this is for

A drawcast can point to another drawcast, and the viewer can click through:
"for more on the theory, see this", a course lecture's Previous / Next, an
author's related videos at the end. One element does all of it — a `link`,
written in the YAML like any other element and placed on the screen.

Decided with Hans (2026-09-28):

- A link is an **element** in `elements`, drawn, pointed at and erased like
  any other.
- Two looks: **text** (clickable words) and **card** (a thumbnail, or a
  title card when there is none).
- Following a link **reloads** the page into the target — fine for now. A
  link clicked **mid-video opens a new tab** by default (the viewer keeps
  their place); an `open` field overrides it, and can also open the target
  in a **window over the video** (an iframe), closed to carry on where one
  left off.
- **Related links are the author's**, written in the YAML; there may be
  none. A server that suggests links is later, not here.
- **Thumbnails are best-effort everywhere.** A publish never fails for lack
  of one, and a link never fails for lack of one (the title and a generic
  mark instead).
- The thumbnail is also the **poster shown while a drawcast loads**, and it
  is **never the end page** (the slide of links).

Out of scope (roadmap): a **live mini drawcast as the card** — the card
plays a small drawcast of its own (or the target's first seconds) instead of
a still picture; a server for suggested links; `#url=<any address>` (opening a
YAML from an arbitrary host); in-place navigation that keeps progress and
answers across the jump.

## 2. What exists today

- **Poster** (2026-09-24): `<name>.png` committed beside a cast published to
  GitHub — the author's `poster:` image if it can be fetched, else the
  *first* part's finished drawing (`export/snapshot.ts` `posterPng`,
  `main.ts` `publishedPoster`). Any failure is null, never a failed publish.
  The viewer shows it while the cast loads (`viewer.ts`). Only the single-cast
  GitHub publish writes one: course lectures and Drive get none.
- **Next**: `course/run.ts` `lecturePlaylist` appends a drawn Next card
  (`makeNextCard`, ink only). `course/publish.ts` writes `meta.next =
  {title, href}` (an absolute `#gh=` link) onto each published lecture;
  `playlist/session.ts` `showNextLink` shows it as a "Next ▸" pill when the
  last item ends. `course/load.ts` strips `meta.next` on load, so in the app
  nothing is clickable.
- **Opening by link**: the viewer takes `#gh=`, `#gdrive=`, `#gdoc=`,
  `#anvil=` (`viewer.ts` `parseViewerHash`).

## 3. The element

```yaml
- id: more_theory
  type: link
  to: ./03-what-theory-holds-the-qaly-up.yaml
  title: The theory behind it     # optional
  image: https://example.org/pic.png   # optional: the author's own picture for the card
  look: card                      # card (default) | text
  open: auto                      # auto (default) | tab | here | window
  x: 760
  y: 420
  # or: at: <anchor>, as for other elements; size: s | m | l (card only)
```

Fields:

- `to` (required) — the target (§4).
- `title` — what the link says. Missing: the target's own `meta.title`
  (fetched once, cached), else its file name without extension.
- `image` — the author's own picture for the card: a URL (or a data URL).
  It wins over the target's thumbnail. If it fails to load, the card falls
  back to the target's thumbnail, then to the fallback card. Ignored by
  `look: text`.
- `look` —
  - `text`: the title in the house hand, underlined, at the element's font
    size, with a trailing ▸. No thumbnail is fetched.
  - `card` (default): a 4:3 frame holding the target's thumbnail, the title
    under it. With no thumbnail (missing, 404, blocked, still loading) the
    frame holds the **fallback card** instead: the title large in the house
    hand on paper, with a generic mark (a small play triangle) — the same
    look as today's drawn Next card, so it never reads as broken.
  - `size` (card only): s / m / l = 200 / 300 / 420 logical units wide
    (defaults m).
- `open` —
  - `auto` (default): **here** (reload into the target) once the drawcast
    has finished playing — the end page — and **tab** (a new tab) at any
    other moment, playing or paused.
  - `tab` / `here`: always that.
  - `window`: the target plays in a window over the video — an iframe of
    the target's player link in the app's existing media window
    (`ui/media-modal.ts`, the one the C64 emulator opens in: ✕, Escape and
    the scrim close it; its "Open in new tab ↗" is there too). The video
    underneath pauses when the window opens and stays paused when it
    closes, so the viewer resumes with ▶. Only for targets with a player
    link (GitHub, Drive); a local-course target falls back to `tab`,
    since the app's local lectures have no URL to frame.
  - A modified click (⌘/Ctrl/Shift, middle button) always keeps browser
    semantics: new tab or window.

Behaviour:

- The ink is drawn by the engine like any element (a card is a frame plus an
  image or the fallback text; a text link is text plus an underline), so
  draw, erase, point, highlight and focus all work on it.
- The click target is a real HTML `<a href>` overlaid on the element's
  painted box while the element is visible — the same approach as today's
  `.cs-nextlink`: real links (hover URL, new-tab semantics, keyboard focus,
  screen readers), and the press never reaches the stage's play/pause.
  Registered through `ui/control-press.ts`'s region registry so the stage
  gesture stands down over it.
- A link whose target cannot be read (§4) draws, but is not clickable, and
  shows its title only; lint warns at authoring time (§7).
- Video export: the card's thumbnail must be drawable into the export canvas
  (CORS-clean). When it is not, the export uses the fallback card. A video
  cannot be clicked, so nothing else changes.

## 4. Naming a target

One pure function — `resolveLink(to, base) → { href, poster? } | null` in a
new `src/links/resolve.ts` — used by the player, the lint and publish.

Accepted forms of `to`:

| Form | Example | Opens |
|---|---|---|
| Player link | `https://drawcast.app/#gh=owner/repo/c/01.yaml` | as is |
| GitHub short | `owner/repo/path/to/cast.yaml` | `#gh=…` |
| github.com / raw | `https://github.com/o/r/blob/main/c/01.yaml`, `https://raw.githubusercontent.com/o/r/main/c/01.yaml` | `#gh=…` |
| Drive | `https://drive.google.com/file/d/<id>/…`, `gdrive:<id>` | `#gdrive=<id>` |
| Relative | `./02-how-is-a-qaly-calculated.yaml`, `../other/intro.yaml` | against `base` |

`base` is where the playing drawcast came from:

- **GitHub** (`#gh=owner/repo/dir/file.yaml`): a relative `to` resolves
  against `dir` → `#gh=owner/repo/<resolved>`; its poster is
  `<resolved>.png` on raw.githubusercontent.com.
- **The app, a local course**: a relative `to` names a lecture of the same
  course by its `file:` (the status line in `course.md`); the app plays that
  lecture as the course panel does. No match → not clickable.
- **Drive, a pasted YAML, an unsaved cast**: no folder, so a relative `to`
  does not resolve (null). Full links still work.

The href is built from the viewer base the app already uses
(`settings.viewerBase`), so links work on drawcast.app and on a fork's own
host alike. The GitHub link parsing the drawcast skill's `pull` accepts is
the reference for what counts as a GitHub link — one parser, shared.

## 5. The end page

The last page of a lecture is a page of links — no separate mechanism:

- **Courses.** `lecturePlaylist` replaces today's Next card with a generated
  **end page**: one item of `link` elements, laid out by a small builder
  (`makeEndPage`, next to `makeNextCard`):
  - Previous (a card; not on lecture 1) and Next (a card; not on the last
    lecture), with **relative** `to`s — the files sit in the same folder, so
    nothing has to be rewritten on publish or after a reorder beyond
    regenerating this page (push and the course publish already regenerate
    the Next card; they regenerate the end page instead).
  - Watch again (a `text` link back to the lecture itself, `open: here`).
  - The narration says the next lecture's title, as the Next card did, so a
    narrated video export still ends on it.
- **Related links** are ordinary `link` elements the author writes — on this
  end page (the course runner keeps any author-written links it finds on a
  regenerated end page, identified by `meta.links_page: true` on that item),
  or anywhere mid-video. None written, none shown.
- **A single drawcast** has no end page unless its author draws one; nothing
  is generated.
- **Old published files** keep working: `meta.next` is still read and shown
  as the "Next ▸" pill when a lecture has no end page. Publish stops writing
  `meta.next` once a lecture has an end page.

## 6. Thumbnails

**What the picture is.** The finished drawing of the **last content part**:
the last `item` entry that is not a generated end page (or legacy Next
card) — "the end picture", never the slide of links. The author's `poster:`
still wins when it can be fetched. (Today it is the first part; this
changes that rule for every publish.)

**Where it is saved** — every step best-effort, every failure null, never a
failed publish:

- GitHub single cast: `<name>.png` beside it (as today).
- GitHub course: `<NN-title>.png` beside each lecture's YAML (new), written in
  the same commit as the lectures. The drawcast skill's `push` writes them too
  (its publish code is the app's).
- Drive: the PNG is uploaded next to the YAML with the same sharing; its
  address is written into the YAML's `poster:` field (Drive files are found
  by id, not by folder, so the YAML has to say where its thumbnail is). A
  failed upload leaves `poster:` as it was.

**Where it is used:**

- The loading poster (as today, now also for course lectures and Drive).
- `link` cards: the resolver gives the poster address for GitHub targets
  (`<path>.png`) and reads `poster:` from the target YAML for Drive targets
  (fetched once, with the title, cached). Shown as an `<img>` inside the
  card, so no CORS is needed to *show* it; a load error → the fallback card.

## 7. Lint and schema

- Schema: `link` in `ElementType`; `to` (string, required), `title`, `image`,
  `look` (`text|card`), `open` (`auto|tab|here|window`), `size` (`s|m|l`).
- Lint warns when:
  - `to` matches no form in §4;
  - a relative `to` sits in a drawcast that has no folder (not in a course,
    not from GitHub) — it will not be clickable;
  - in a course, a relative `to` names a file the course does not have;
  - a `card` link has no `title` and its target's title cannot be known at
    authoring time (a note, not an error: the file name is the fallback).
- The crowding count treats a card as one figure and a text link as one text.
- Prompts: not in this round. The compiler learns the element once there are
  links worth writing; the course end page is generated, not written by the
  model.

## 8. Testing

- `resolveLink`: every form in §4; relative against GitHub dirs (`./`,
  `../`, nested); relative with no base → null; the local-course case by
  `file:` name; junk → null.
- `open: auto`: here once finished, tab while playing or paused; modified
  clicks untouched.
- `open: window`: opens the media window on the player link and pauses the
  video; closing leaves it paused at the same place; a local-course target
  falls back to a new tab.
- End page: Previous / Next present or absent by position; relative targets
  match the lectures' `file:` names; author links on a regenerated end page
  survive; a reorder regenerates the right neighbours.
- Poster rule: the last content part, skipping the end page and a legacy
  Next card; `poster:` wins when fetchable.
- Publish never fails on a missing thumbnail: a `posterPng` that throws or
  returns null still gives a full commit (GitHub) or upload (Drive).
- The card's picture order: `image`, then the target's thumbnail, then the
  fallback card — each step on a load error.
- The link card falls back on an image error (DOM test), and the export uses
  the fallback when the image is not CORS-clean.
- Lint: each warning in §7, and none on a well-formed course.
- Legacy: a published lecture with `meta.next` and no end page still shows
  the "Next ▸" pill.

## 9. Order of work

1. `resolveLink` + the `link` element (text and card, fallback card, the
   `<a>` overlay, `open`), schema and lint.
2. The course end page replacing the Next card (course runner, publish,
   the skill's `push`), keeping author links; `meta.next` read-only.
3. Thumbnails: the last-content-part rule, course and Drive saving, cards
   showing them.

## As built (2026-09-29)

What changed from the text above while building it:

- **Field names.** The target is `href` (elements already use `to` for an
  arrow's endpoint); the look is `form: card | text` (a `look` field was
  deliberately removed from elements earlier and a test guards it); `size` is
  the card's width in logical units (default 300, 120–600), as `size` is a
  number on icons.
- **Course neighbours are `lecture:N`**, resolved against the course's
  `course.md` (its status lines give each lecture's file and library id): the
  end page is generated before later lectures have files, and a number works
  in the app, in dev and on GitHub alike. The end page is marked
  `end_page: true` on its spec (not `meta.links_page`). The skill's `push`
  keeps an author's own `link` elements on a regenerated end page.
- **Clicks are hit-tested** on the stage against the link's box (like info
  cards), not an HTML `<a>` overlay; modified and middle clicks open a tab.
- **Pictures are embedded** as data URIs in the ensure phase
  (`render/link.ts`), so layout stays synchronous and the video export shows
  them when they could be fetched.
- **The app** opens a local course's lecture through the library
  (`links/base.ts` `setDrawingOpener`); the dev server's `?open=` reads
  relative links against the file's folder (and its `course.md`).
- **Not built yet: Drive thumbnails.** The Drive upload sends text only, and a
  picture there would need its own link sharing; a Drive target shows the
  author's `image` or the fallback card. GitHub casts and course lectures get
  their `<file>.png`.
