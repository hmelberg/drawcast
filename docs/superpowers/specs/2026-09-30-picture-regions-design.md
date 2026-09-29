# Pointing into pictures — design

2026-09-30 · status: draft for review

## 1. What this is for

Explaining a picture by pointing into it: a screenshot of a user interface
("this is the command line, this is where the variables are"), a web page, a
diagram from a manual. The voice explains while the pointer, a highlight box,
a spotlight and the camera move from part to part.

The driving example is the microdata.no manual's command window
(`microdata.no/manual/brukermanual/Om brukergrensesnittet/1.1 Kommandovinduet`):
a 1920 × 1041 screenshot with four parts the text explains — the dataset
panel (upper left), the register variables (lower left), the work area
(right) and the command line (bottom of the work area).

Decided with Hans (2026-09-30):

- **One element, the ordinary `image`.** No separate screenshot type. What is
  switched on per picture is the *mapping* (finding its parts), not the kind
  of element.
- **Pointing needs no mapping.** Any image can be pointed at by named spot
  (`top`, `left`, …) or by fractions of the picture (60 % across, 10 % down),
  and a box can be given as fractions too.
- **Mapping only on request**, because it costs a model call: by the author
  (right-click → Find parts), by the app's AI when the request is to explain
  that picture, or by the skill. The result is written into the spec as plain
  named boxes, and the picture is never analysed again.
- **Control over the map**: a level of detail, which kinds to look for
  (areas, controls, text), and `find` for exactly the things wanted. The full
  map is kept in a cache; only the regions the drawcast uses go into the spec.
  Region names are English.
- **Both the app and the local skill.** The app's pipeline does the mapping;
  the skill uses the same vocabulary and adds precision tools.
- **Movement, not just positions.** Pointing and highlighting can jump from
  part to part, *or* travel: the highlight slides from the first region to
  the second (to the third …), the pointer glides, the camera pans.
- **Zooming and scrolling** on pictures are part of it.
- **A picture can come from a URL or be imported** (a dropped file). Both.

Out of scope here (§10): fake interactivity (a click opening a menu), which
comes later as overlays and clickable regions; a working model of a UI, which
is not planned.

## 2. What exists today

- **`image`** (`render/image.ts`) resolves a *description* (`of`) to a
  Commons photo: a 480 px thumbnail, downscaled to `LOOK_DIM.photo` = 240 px,
  styled grayscale with a contrast bump, with a licence-gated credit. It has no
  `url` path. A **file dropped** through Insert image (`ui/insert.ts`) is
  *traced into sketch strokes*. Neither is usable for a screenshot: 240 px
  grey is unreadable, and tracing destroys a UI.
- **Raster drawing** already works: the SVG backend draws an `image` drawable
  (`render/svg-backend.ts:504`), and `frame.ts` / `caption-dark.ts` know its
  box.
- **`source` + `quote`** is the precedent for *named boxes on a picture*:
  the PDF text layer finds the passage, and its rectangles are stored as
  fractions of the page (`spec/trace.ts` `PhotoRect`, `encodeSourceImage`)
  and swept with a highlighter.
- **Verbs**: `point` (laser: tap / circle / underline; always glides in from
  the lower right and lifts — `render/effects.ts` `pointerPath`), `highlight`
  (pulse / circle / glow / underline, with `part` for a piece of a formula,
  label or code line), `focus` (dim all but the targets for a sentence),
  `camera` (`on` / `center` / `zoom` / `reset`, up to 8×, and a *world*
  larger than the page — `render/camera.ts`), `walk: "zoom"` (frame one part
  per step), and `cue` (an action starting part-way through its sentence —
  `render/cue.ts`).
- **The app already sends pictures to Claude**: the look pass
  (`llm/look.ts`), visual repair (`llm/visual.ts`) and the template author
  (`llm/author.ts`).
- The paused viewer can already pan and zoom by hand.

## 3. The picture

```yaml
- id: md
  type: image
  url: https://microdata.no/manual/assets/images/image79-3a6b840c804b98810159afecdbdab29c.png
  look: screen
  view: [0, 0.07, 1, 0.93]      # show only this part (cut off the browser bar)
  credit: "Sikt / SSB, microdata.no user manual"
  regions:
    datasets:      [0.00, 0.070, 0.20, 0.465]
    variables:   [0.00, 0.535, 0.20, 0.465]
    filter:        [0.00, 0.560, 0.20, 0.020]
    results:  [0.20, 0.070, 0.80, 0.900]
    command_line: [0.20, 0.970, 0.80, 0.030]
    toolbar:       [0.91, 0.070, 0.08, 0.035]
```

- **`url`** — a direct image URL. **Or a file**: a dropped picture is stored
  embedded (below). Both give the same element.
- **`look: screen`** — the faithful look for screenshots and diagrams:
  **full colour, no tint, no tracing, native resolution** (capped at a
  generous size, e.g. 2400 px on the long side). The default look of
  `image` stays what it is today. The mapping step (§8) may set
  `look: screen` when it sees a UI.
- **Resolution rule.** Only `look: screen` keeps full resolution, since
  zooming 4× into a 240 px picture is mush. Embedding a screen picture makes
  the file larger (a few hundred KB), which is accepted for these pictures
  and not for all.
- **`view`** — the part of the picture shown, `[x, y, w, h]` as fractions.
  Not `crop`: `crop` is already a boolean on `inset`.
- **`regions`** — named boxes, `[x, y, w, h]`, fractions of the *whole*
  picture (not of `view`, so changing the view never moves a region).
- **Picture coordinates are measured from the top-left, y down** — the way a
  screenshot is read and the way `PhotoRect` already stores them. This is
  deliberately unlike the canvas (y up), and it only ever appears inside a
  picture's own fractions.
- **URL fetching.** Showing a linked picture needs no CORS. Reading its
  pixels (mapping, OCR, embedding) does; hosts that refuse go through a small
  Netlify fetch function, like the name lookups.
- **Credit and rights**: `credit` as today. A screenshot of someone's
  manual is the author's responsibility; the app shows the credit line.

## 4. Naming a place on a picture

Every verb that takes a place takes these, whether or not the picture is
mapped:

| Written | Means |
|---|---|
| `md` | the whole (shown) picture |
| `md:command_line` | a region by name |
| `md@top`, `md@left`, `md@top_right`, … | a named spot (the existing anchor names) |
| `md@[0.6, 0.1]` | a point: 60 % across, 10 % down |
| `md@[0.2, 0.9, 0.8, 0.1]` | a box, unnamed |

The string forms are shorthand for `{ref: md, region: …}`, `{ref: md,
anchor: …}` and `{ref: md, at: [...]}`, so `EndRef` gains `region` and `at`
and nothing else changes. A region name that does not exist is a lint error
("md has no region command_line; it has: …"), never a silent miss.

## 5. The verbs on a picture

Existing verbs, new targets — plus one new highlight effect:

- **`point: {at: md:command_line}`** — the laser; `gesture: circle` traces
  the region's box.
- **`highlight: {target: md:variables, effect: box}`** — **new effect
  `box`**: a rounded rectangle drawn around the region in the highlighter
  colour, with a faint fill. On a picture, `box` is the default effect.
  (`part:` also works: `{target: md, part: variables}`.)
- **`focus: {target: md:results}`** — the spotlight: the picture (and
  everything else) dims except the region. On a picture this dims *inside*
  the picture, not just other elements.
- **`camera: {on: md:datasets}`** — frame the region (zoom `fit`, or a number).

## 6. Movement

### 6.1 Carry-over (the default)

The pointer, the highlight box, the spotlight and the camera **remember where
they are**. When the next step aims the same kind of mark at the same picture,
it **travels** from where it is — the laser glides, the box slides and
resizes, the spotlight's hole moves and changes shape, the camera pans and
rezooms — instead of fading out and appearing again.

- It carries over when the steps are **consecutive**: a sentence with no mark
  in between ends it, and so does `lift: true` on the step (the mark leaves
  and the next enters fresh).
- The box and the spotlight **stay up between consecutive steps** instead of
  fading at the end of each sentence; they fade when the run of steps ends.
- **Seek-safety.** Jumping into the middle, or scrubbing back, must show the
  mark where it would be. The planner computes each step's *from* box from
  the previous step at plan time, so the player never depends on having
  played the earlier steps (the same rule as `move`).

### 6.2 A path within one sentence

```yaml
- speak: From the list of datasets, down to the variables, and over to the command line.
  highlight: {target: [md:datasets, md:variables, md:command_line]}
```

A list is visited in order; the sentence's time is split between the stops.
With `cues: [0.1, 0.45, 0.8]` each stop starts at that fraction of the
sentence (the existing `cue` arithmetic). Word-synced stops — each stop when
its name is spoken — are later.

### 6.3 A tour as one field

```yaml
- id: md
  type: image
  tour: [datasets, variables, results, command_line]
  tour_look: box          # box (default) | focus | zoom | point
```

One region per step, travelling each time — the "here is the screen, part by
part" explanation without a command per step, in the spirit of `walk`. With
`tour_look: zoom` the camera frames each region in turn (as `walk: "zoom"`).

## 7. Zooming and scrolling

- **Zoom** is the camera on a region (§5), carrying over like the rest (§6.1).
  The paused viewer's own pan and zoom already work on pictures.
- **Scroll, first version: the camera world.** A picture taller than the page
  (a full web-page screenshot) becomes a *world* larger than the page, as
  wide decision trees already do. At rest the camera shows its top;
  `scroll: {target: md, to: 0.8}` glides down, and pointing at a region below
  the view scrolls there first, the way a person scrolls before pointing.
- **Scroll, later: a window.** The picture scrolls *inside a frame* (`window:
  0.4` — show 40 % of its height, perhaps in browser chrome) while the page
  stays still, like the code panel's `lines`. More convincing for teaching a
  UI; built if the camera version is missed.

## 8. Mapping — finding the parts

`regions: auto` asks for the parts to be found. It runs once, while
authoring, never during playback. The answer replaces `auto` with plain named
boxes, so the spec is then the same as one written by hand. It is cached by
the picture's content hash, so the same screenshot in two drawcasts is mapped
once.

### 8.1 Asking for what you want

`auto` alone uses the defaults. The longer form gives control, so the map
neither comes back far too detailed nor misses what the explanation needs:

```yaml
regions:
  auto:
    detail: some            # few | some (default) | many
    kinds: [areas, controls] # areas | controls | text — default all three
    find: [command line, "Filtrér variabler", search button]
```

- **`detail`** — how fine the map is. `few`: the main areas only (the four
  panels of the microdata window, about 3–8 regions). `some`: areas plus the
  controls a newcomer would be shown (about 10–25). `many`: down to single
  buttons, fields and labels (up to about 80).
- **`kinds`** — what to look for. `areas` (panels, sections, the parts of a
  diagram), `controls` (buttons, fields, menus, tabs, icons), `text` (visible
  words, via text recognition — exact boxes).
- **`find`** — be specific: mark only these things, if they exist. A quoted
  string is matched as visible text (exact, via text recognition); a plain
  phrase is looked for by the model ("search button"). With `find` alone,
  `detail` and `kinds` do not apply — only what is asked for is marked.
  **Anything not found is reported, never invented**: "not found in md:
  search button". The author sees that; the app's AI gets it back and writes
  around it.
- The author sets these in the Find parts picker; the app's AI sets them in
  the plan — usually `find` with the things its outline means to talk about,
  plus a small `detail: few` for context.

### 8.2 Capture generously, keep what is used

The cost of a map is one call that sees the picture, and it hardly depends
on how many regions come back (a picture is roughly 1.5k input tokens; 50
regions are roughly 1.5k output tokens). What does grow with detail is the
*spec* and the *compiler's prompt*. So the two are kept apart:

1. **The full map lives in the cache**, not in the spec: every region found,
   at the requested detail, with its kind and a confidence.
2. **The compiler is given the names** from the map (one compact line each:
   `command_line — control — "demografidata»"`), not the boxes, and writes
   the narration against them.
3. **After compiling, unused regions are dropped from the spec**: only
   regions the drawcast actually points at, highlights, focuses or frames are
   written into `regions:`. Regions written or edited by hand are never
   dropped.
4. **Adding a mention later is free**: a revision that names a region the
   spec no longer has picks it up from the cached map with no new call. Only
   a region the map never had asks for a new, targeted `find`.

This way a generous default (`some`) costs little, the spec stays small and
readable, and what the explanation needs is there.

Region names are **English ids**, whatever the language of the picture or
the narration (`command_line`, not `kommandolinje`); a region's visible text,
when it has one, is kept beside it in the map so `find` and the compiler can
match it.

**Who asks for it:**

- **The author**: right-click the picture → **Find parts**. That only starts
  it; the boxes then appear *on the picture*, where they are renamed, dragged
  and deleted (the rule that interaction happens on the figure, not in the
  tray).
- **The app's AI**: when the request is to explain a picture the user gave
  ("explain the microdata command window from this screenshot"), the plan
  marks that picture `regions: auto`. The mapping runs *before* the compiler
  writes the narration, so the compiler sees the region names and writes
  `point`/`highlight` against them — it does not need to see the picture
  itself. A decorative picture is never marked.
- **The skill**: the same, with the extra tools below.

**How:**

1. **A model that can see** gets the picture and returns named boxes: short
   names (the voice says the sentence; the region name is a word or two),
   in English. Good at panels, buttons and menus; a few percent off.
2. **Text recognition** (Tesseract.js) makes text-labelled parts exact: a
   region whose label is visible text snaps to the text's box, and
   `part: "Filtrér variabler"` finds the words the way `quote` finds a
   passage on a PDF page.
3. **The look pass** checks the result as today: it sees the boxes drawn on
   the frames and the fix round nudges one that misses.
4. **The skill only**: for a web page it can open, a headless browser reads
   each element's exact box from the page itself.

The mapping prompt is its own small prompt; the compiler prompt grows only by
the place syntax (§4), the `box` effect and `tour` — a few lines.

## 9. Worked example

```yaml
- speak: This is the command window in microdata.
  show: md
- speak: On the left, the datasets you have made.
  highlight: {target: md:datasets}
- speak: Below them, every variable in the registers.
  highlight: {target: md:variables}       # the box slides down
- speak: You can filter them by name here.
  camera: {on: md:filter}                   # the box shrinks to the filter; the camera follows
- speak: Commands go in at the bottom.
  camera: {on: md:command_line}
  point: {at: md:command_line, gesture: underline}
- speak: And the results appear above.
  camera: {reset: true}
  focus: {target: md:results}
```

or, with the tour: `tour: [datasets, variables, filter, command_line,
results]` and one plain sentence per step.

## 10. Later: interaction

- **Overlays**: a second picture (the same screen with a menu open), cut to a
  region and laid over the first on a step. During playback it reads as
  "clicking opens the menu". This is how most UI tutorial videos work.
- **Clickable regions** while paused: a click plays a short clip or shows a
  picture over the figure (precedent: `link` with `open: window`, and the
  paused-only click of `code.game`).

## 11. Deliveries

1. **Pictures you can point into.** `image` with `url` and dropped files,
   `look: screen` (colour, native resolution), `view`, hand-written
   `regions`; the place syntax (§4) with lint; `point`, `highlight` (new
   `box`), `focus` and `camera` on regions. Enough to make the microdata
   drawcast by hand.
2. **Movement.** Carry-over (§6.1) with seek-safety, paths in a sentence
   (§6.2), `tour` (§6.3), the camera-world scroll (§7).
3. **Mapping in the app and the skill.** `regions: auto` with `detail`,
   `kinds` and `find` (model-found; `text` and quoted `find` wait for
   delivery 4), the cached full map and the drop-unused step, the mapping prompt,
   the plan step that marks a picture, the content-hash cache, the Netlify
   fetch for CORS-refusing hosts.
4. **Precision and editing.** Text recognition, the Find parts picker with
   boxes edited on the picture, the skill's headless-browser boxes.
5. **Later.** The scrolling window, overlays, clickable regions.

## 12. Open questions

- **The region separator**: `md:command_line` reads well, but must not clash
  with anything that already uses `:` in a target string. Check before
  delivery 1; `md/command_line` is the fallback.
- **`look: screen` on a traced drop.** Today a dropped file is traced. Should
  Insert image ask ("sketch it" / "keep it as a screenshot"), or guess from
  the picture (a UI has large flat areas and small text)?
- **Box style**: highlighter-yellow fill (matches the new highlighter) or an
  ink outline (matches the house style)? Try both on the microdata picture.
- **Size cap** for embedded screen pictures, and whether publishing links
  large pictures instead of embedding them.
