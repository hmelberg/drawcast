# The C64 round — the machine on the drawing, the game in the machine

Date: 2026-09-05 (rewritten the same evening after review). Status: **M1
shipped; M2 folded into it; M3 open.**

## What Hans asked for, in his order of importance

1. **Most of all**: to SHOW and PLAY C64 games and demos, with sound.
2. The blue screen: "starte C64 med den blå skjermen og gjøre noen enkle
   ting" — that is fun.
3. Programming the C64 is "ikke så veldig viktig". Route 3 (our own BASIC)
   is fine, "men ikke ta med alle mulige kommandoer med en gang hvis det tar
   lang tid."

The first draft of this document had the order inverted — two thirds of it
on BASIC, no implementation plan for the emulator. Reordered.

## What drawcast already had

- `frame: "c64"` (src/layout/code.ts) draws the tube monitor standing on a
  home-computer keyboard; `frame: "crt"` the monitor alone. The OBJECT was
  drawn; only what is on its screen was missing.
- The code element runs a script through the runtime facade
  (`src/code/run.ts`, one module per language) and draws code as ink with a
  beat per line, a marker pen (`marks`), an editor on the panel, and `ask`
  with a code widget.
- `src/ui/media-modal.ts`: the established shape for a LIVE thing over the
  stage — an iframe on the stage, player-only, never in an export.

## The house rule that shapes both halves

Everything drawn is SVG ink; everything live is an HTML layer a movie skips.
A running emulator is a canvas, so a running game can never be in an
exported MP4 — exactly as the piano, the quiz and the YouTube modal are not.
The drawn machine with its boot screen IS the movie's picture.

## M1 — the game (SHIPPED)

**Vocabulary.** One field on the code element and one word on `explore`:

```json
{"id": "c64", "type": "code", "frame": "c64",
 "game": "https://…/boulderdash.prg"}
…
{"draw": ["c64"], "speak": "A Commodore 64."}
{"explore": {"game": "c64"}, "speak": "Now you play."}
```

- `draw: [id]` switches the machine on: the blue boot screen (light-blue
  border, blue paper, `**** COMMODORE 64 BASIC V2 ****` / `64K RAM SYSTEM
  38911 BASIC BYTES FREE` / `READY.` in light-blue mono) with a white play
  mark on its centre — all in the PANEL's group, all ink, 40 × 25 characters
  at the machine's own 320 × 200 shape. A machine with a game and nothing to
  run is not an error (`resolveCode` skips it) and draws no ruled
  placeholders.
- While the app is paused, a click on the play mark opens the emulator over
  the figure; the cursor says so (`cs-playable`); the rest of the screen
  still opens the editor. `explore: { game }` is the authored beat: the run
  parks on the emulator and closing it — ✕, Escape, the scrim — is Continue;
  a scrub aborts and closes it.

**The emulator: vc64web, as its own page in an iframe, never its script in
ours.** `src/code/c64.ts` builds the URL:

```
https://vc64web.github.io/#openROMS=true#navbar=hidden#wide=true#border=0.3#<program url>
```

Why this and not the alternatives:
1. `openROMS=true` loads the MEGA65 **Open ROMs** — drawcast never
   distributes Commodore's KERNAL/BASIC. Verified 2026-09-05 against the
   emulator's own console: `kernal_generic.rom`, `chargen_pxlfont_2.3.rom`,
   `basic_generic.rom` loaded as "M.E.G.A. C64 OpenROM", the .prg fetched
   from the hash, `FILE_FLASHED`, `flash done`, 50 frames/s executed. No
   dialog, no click.
2. vc64web is GPL-3. Iframing a third party is not distribution; vendoring
   it would pull drawcast into the GPL.
3. The bare direct-start link needs **no third-party script in our page**.
   The player script (`vc64web_player.js`) would run with our origin's
   privileges; the only thing it adds is base64 injection of a program from
   the page (`samesite_file`), which stays on the list for later.
4. It works on a phone: virtual keyboard, touch joystick, gamepads, reSID
   audio, snapshots.

Fallback if it ever has to be self-hosted (offline, kiosk, that site dying):
**floooh/tiny8bit** — zlib licence, `c64.wasm` 259 KB + `c64.js` 34 KB,
`c64.html?file=game.prg`; then WE ship the baked-in Commodore ROMs and lose
the touch controls. Third path for "just show that famous game":
`https://archive.org/embed/<id>` in the same modal.

**Guards.** The emulator page is https and takes the program in its hash, so
the lint refuses a plain-http `game` (mixed content) and a URL containing
`#` (ends the hash early) — both would fail silently in a viewer's browser.
An `explore.game` naming an unknown id is a plan warning. Programs: only what
the author has the right to point at; drawcast hosts nothing.

**Measured in the live smoke:** the boot screen's three lines and the play
mark drawn; the cursor a pointer over the mark; a click opened the modal with
the URL above and `allow="autoplay; gamepad; fullscreen; clipboard-write"`;
the explore beat parked the run on "Now you play.", Escape closed the
emulator, and the run went on to the next line and finished.

## M1b — the catalogue, and the viewer's own choice (SHIPPED)

Hans: can the program put in a URL dynamically, and can the viewer choose —
maybe from a standard list we ship? Yes to both, and the list matters more
than it looks: **without a catalogue the compiler invents .prg URLs**, and
"never invent a URL" has no honest way to hold for programs. So:

- `game` is a **key** from `src/code/c64-catalogue.ts` (today: `wolfling`,
  vc64web's own demonstration program) or an https URL when the user's
  request supplied one. `resolveGame(value)` is the ONE rule, shared by the
  lint, the tray and the gate; the schema lists the keys and their notes to
  the model.
- **CORS is the gate.** The emulator PAGE fetches the program from its own
  origin, so the host must answer cross-origin. Measured 2026-09-05: GitHub
  Pages (`hmelberg.github.io`, `vc64web.github.io`) send
  `access-control-allow-origin: *`; **csdb.dk sends none, even with an
  Origin** — refused by name (`NO_CORS_HOSTS`), with the fix in the message:
  host the file on GitHub Pages. Hans's own programs go in `public/c64/`
  (published to hmelberg.github.io/drawcast/c64/ with CORS for free), only
  what he has the right to distribute; the catalogue's demo stays on
  vc64web's URL rather than being vendored, since its licence is theirs.
- **The ⊕ tray** grows a "Commodore 64" row for every machine with a game: a
  select with `This lesson's: <title>`, the catalogue, and `Own URL…` (a
  field, remembered in localStorage under `drawcast.c64.ownUrl`, guarded),
  and a Play ▶ that refuses with `resolveGame`'s reason inline. Not during
  an explore gate. The play mark on the screen keeps starting the lesson's
  own program; a machine whose value the lint refused opens the tray instead.

Measured in the live smoke: the row lists the lesson's program and "Own
URL…"; a csdb URL is refused with the CORS reason and opens nothing; a good
URL opens the modal with the emulator URL, closes the tray, and is remembered.

## M1c — five programs with licences, and the Internet Archive (SHIPPED)

Hans has no files of his own; "se om det er noe på nett … uten
lisensproblemer", and let the viewer pick from an archive.

**The catalogue is five programs, each with the licence that lets us point
at it**, found by searching GitHub for permissively licensed C64 repositories
and checking every URL the same three ways (an https host that answers
cross-origin, a real PRG — load-address bytes `01 08` — and a LICENSE beside
the file): `c64maze` (GPL-3.0), `crowboy` (MIT), `space-shooter` (MIT),
`tenlander` (GPL-3.0, a lander in ten lines of BASIC that LISTs), `wolfling`
(vc64web's own demo). GitHub's raw files are the ideal host: the licence sits
next to the file and CORS is on for the whole domain. Rejected on the way:
retrobrews/c64-games ("approved for free distribution on this site/project
only") — a collection we may not point at.

**The Internet Archive is the viewer's own source, and it runs in the
Archive's own player.** The reason is a measurement: the Archive's 17 945 C64
items are almost all `.d64` disk images (one of the sixty most-downloaded had
anything else), and the MEGA65 Open ROMs have no disk-drive ROM — a `.d64`
fetched into vc64web (it fetches fine through `archive.org/cors/<id>/<file>`,
which reflects the Origin where `/download/` sends nothing) ends in a dialog
asking for a floppy ROM. `archive.org/embed/<id>` is the Archive's Emularity
player with the Archive's own ROM arrangement, embeddable (no frame-ancestors),
click-to-start. So the tray's second row searches the library
(`advancedsearch.php`, CORS `*`, scoped to `collection:softwarelibrary_c64`)
and a pick opens the embed in the media modal, with the item's page as the
escape link. Nothing hosted, nothing chosen by us. `src/code/c64-archive.ts`
holds the pure half.

Measured in the live smoke: the catalogue row lists the lesson's program and
the other four; a search for "baffle" from the page found "Baffle
(1994)(Feniks)"; Play opened the Archive's player in the modal.

## M2 — the blue screen as ink

Folded into M1 for the no-script case: the boot screen IS what a switched-on
machine shows, and it is the still a movie needs. What is left of M2 is the
case where a script has RUN — which is M3's screen.

## M3 — BASIC (SHIPPED, first cut) and two bundled examples

`src/code/basic.ts`: Commodore BASIC V2 as `language: "basic"`, written from
the Programmer's Reference Guide, ~700 lines, pure and node-tested end to
end. The run leaves a `screen` in the envelope (CODE_VERSION 6 → 7) and the
layout draws it where the boot screen was: the field takes the program's own
border and background (POKE 53280/53281), and every run of one colour on a row
is its own text — so a POKEd cell in another colour is its own ink.

What the first cut has: PRINT and `?` (with `;` `,` and the machine's own
number spacing, ` 5 `), assignment, GOTO, GOSUB/RETURN, IF/THEN (a line or a
statement, and -1 for true), FOR/NEXT/STEP (nested; a loop that starts past
its end runs once, as on the machine), REM, END/STOP, POKE/PEEK to screen RAM
(1024+), colour RAM (55296+), border, background, cursor colour (646) and a
sparse store for everything else; CHR$(147) clears, CHR$(13) is a newline,
the sixteen colour codes set the ink; INT ABS SGN RND LEN CHR$ ASC STR$ VAL
LEFT$ MID$ RIGHT$ PEEK. RND is seeded (a figure renders the same every time).
Unnumbered lines run in order; a repeated number replaces the earlier line.
A runaway program stops after 400 000 statements with `?BREAK IN <line>` and
the reason. Everything else is refused BY NAME in the machine's voice with
drawcast's reason in parentheses — `?SYNTAX ERROR IN 10 (there is no machine
code here — this BASIC runs on paper, not on a 6510)` — and the error lands
on the screen too. `stdout` is what PRINT wrote, so `ask` with
`expect: "stdout"` works, and the data bridge harvests variables
(`{prog.T}`, `{prog.N$}`).

Not in it, and said so: DATA/READ/RESTORE, arrays, ON…GOTO, INPUT/GET,
files, SYS/WAIT/USR, DEF FN, TAB/SPC, trigonometry, sprites, sound.

The overlap lint stands aside for `<id>_mark_k` under `<id>_line_n` — a
highlighter under its own line is what a highlighter is.

**Two bundled examples** (src/examples.json), both clean under every example
check: "The Commodore 64" (the machine switched on, three facts drawn beside
it, `c64maze` to play) and "Type your first Commodore 64 BASIC program" (a
six-line program typed onto the machine, two marks, the run's black screen
drawn as ink, then `tenlander` — a lander in ten lines of BASIC — to fly).

Measured in the live smoke, through the real app path: the ensure phase ran
the program, the envelope carried the screen, the layout drew five
HELLO, WORLD lines on a black field with both marks as real strokes and the
play mark on top, and the joystick beat opened the lander's URL.

## M4 — the screen alone, in the machine's own face (SHIPPED)

Hans, 2026-09-06, on seeing M1–M3: "commodore bare bør bestå av den blå
skjermen, ikke tegningen av monitor og keyboard. Og den blå skjermen bør ligne
mye mer på den ekte" — fonts, colours, border. Three things changed.

**The C64 is a screen, not a panel.** `src/layout/c64-screen.ts` lays out a
code element that is a C64 (`language: "basic"`, or a `game` with nothing to
run) as one field of 40 × 25 cells inside a border four cells wide — the PAL
machine's proportions, 48 : 33 — with nothing on paper. `frame` still draws
chrome around it if an author asks; the examples ask for none. The listing
is TYPED ONTO THE SCREEN (`_line_k`, wrapped at the screen's edge, uppercase
outside quotes — the machine has one case), RUN is typed under it, and
`_out` repaints the field with the screen the run left: the interpreter now
types the listing and RUN before it runs, so a program that does not clear
the screen leaves them visible above its output, as the real machine would,
and one that does (CHR$(147)) leaves only its own. A game's play mark sits
on the screen and comes back inside `_out`, so a run never paints it over.
The marker pen works on the cell grid (yellow, 7). An error prints under the
listing in the machine's voice, then READY.

**The face.** Style's **C64 Pro Mono** (public/fonts/c64/, licence beside
it): its licence allows @font-face embedding and shipping in free software,
unmodified and unrenamed, which drawcast is. Its cell is exactly one em
square (advance 1.0, ascent 0.875), so a 40-column screen at width W gives
cells of W/48 and rows exactly one em apart — measured in the live smoke:
advance per character 13.33 at font size 13.33. `font: "c64"` on a text
drawable selects it (svg-backend), `figure-style.ts` declares it from three
URLs (the app's root, a subpath build, drawcast.app for embeds — CORS on
`/fonts/*` in netlify.toml), the video export inlines it beside Patrick
Hand, and the first paint waits for it.

**Two lints learned the grid.** A text in the C64 face measures one em per
cell and one em tall (geometry.ts); two rows of the face touching by
construction are not an overlap; and its readable floor is 11 units, not
the handwriting's 14 — an 8 × 8 pixel glyph fills its cell.

Found on the way and fixed: the font first landed in the wrong folder
(the shell's cwd had been reset), which the browser reported as an OTS
parsing error — the served file was index.html.

## M5 — white type, no halo, the cursor, and the conversation (SHIPPED)

Hans, 2026-09-06: "fargen på fonten er feil … lyseblå font med hvitt omriss.
Fonten skal være hvit uten omriss." And: a slowly blinking white square for
the cursor, if easy. And: on the machine the output comes right under the
command, then you type the next — a layout "often called notebook or cells";
generalise it to every language only if it is easy.

- **The outline was the text halo**: every text drawable is painted with a
  5-unit stroke in the paper's colour under its glyphs (svg-backend.ts),
  which on a blue screen is a cream outline around every letter. A screen
  has no paper: `font: "c64"` gets no halo.
- **White** (`C64_TEXT = 1`). The machine's own power-on default is light
  blue (14) — one number to flip back — and POKE 646 and the colour codes
  still do what they do.
- **The cursor**: a cell in the type's colour at the screen's cursor
  (`cursor` in the envelope's screen), blinking at 1.1 s in the live figure
  through a CSS animation (`blink` on an area drawable → `.cs-blink`); a
  frame of the video export simply shows it on.
- **READY.** after a program ends (a newline first when the cursor is
  mid-line), after an error, and after every immediate-mode line — what the
  machine says, and where the cursor waits.
- **Immediate mode IS the cell layout, and the machine already had the
  rule**: lines with numbers are a program (LISTed, RUN); lines without are
  typed one at a time, each answered right under it, READY. between, the
  screen scrolling when it must. `isImmediate(source)` (code/c64.ts) is the
  one rule, read by the interpreter and by the layout — the layout must know
  which beats to mint before any run has happened. The interpreter keeps one
  state across the lines (variables, colours, the screen), reports an error
  and goes on to the next line as the machine does, and returns the screen
  after each line (`screens`, `lineRows`; CODE_VERSION 8). The layout mints
  `_out_k` per line — the screen after line k — and `_out` as the last, and
  types `_line_k` where the cursor stood when that line was typed.
- **Not generalised.** A `show: "cell"` for Python or R is a notebook: the
  script run once per line prefix (N runs, cacheable), and a layout that
  interleaves each line with output of any height, figures included. That is
  a round of its own, not a flag — and the C64 got it free because the
  machine's own conversation is exactly that layout.

A third bundled example, "Talk to a Commodore 64 in immediate mode": PRINT
2+2, POKE the border and background black, PRINT a word in yellow — eight
beats, each `_line_k` then `_out_k`.

Measured in the live smoke: fill #ffffff with no stroke and no paint-order
on a screen's text; the cursor's group carries `cs-blink` and the computed
animation runs; four screens with lineRows [0, 3, 5, 7] and the cursor at
[10, 0]; the border black from the second screen on; HELLO in #edf171.

## M6 — rows in their cells, the repaint above the lines, and the ≡ (SHIPPED)

Hans, 2026-09-06, on the live screen: the output landed ON the commands
rather than under them; the cursor sat partly on the line above; the big
play mark in the middle of the screen was in the way — put it bottom-right,
smaller, fainter, maybe as a menu of what to do with the machine.

- **The cursor** was right and the rows were wrong: a text drawable's `pos`
  is its CENTRE (the backend sets `dominant-baseline: central`), and the
  rows had been placed by a baseline offset — every row 0.375 cell too low.
  Rows now sit at the centre of their cell. Measured: row 0's glyph box top
  0.2 px from the screen's top, one cell tall; the cursor's top at READY.'s
  bottom.
- **The output on the commands** was the renderer's three layers: areas
  under strokes under texts, whatever the document order — so a field that
  REPAINTS the screen after lines were typed sat under those lines, and the
  run's rows painted over them. A repaint now lives in the text layer
  (`z: Z_TEXT`), above what was typed before it; the machine's own field
  stays under everything. Measured: in the text layer the repaint's field
  follows the typed line.
- **The ≡.** The play mark is gone. Every Commodore — with a game or not —
  wears a small half-transparent ≡ in the bottom-right corner of its border
  (a couple of cells; 23 × 17 px at figure size), repeated inside every
  `_out` beat so a repaint never covers it. A paused click opens the ⊕ tray,
  which is the machine's menu, and the Commodore rows now lead the tray:
  play the lesson's program, pick another from the catalogue, load an own
  URL, search the Archive — and the script editor under those. Ink, so it is
  in a movie too, tiny and faint.

## M3 — the original plan (kept for the record)

Our own CBM BASIC V2 in TypeScript as `language: "basic"`, written from the
C64 Programmer's Reference Guide — NOT from basic64-js, which is GPL-3 (and
whose POKE reaches screen RAM 1024–2023, colour RAM 55296–56295, VIC
registers 53248–53294, sprite pointers 2040–2047, cursor colour 646, while
SYS/WAIT/USR are stubs that throw and there is no SID sound). Ours must be
ink: a run's screen scrubs, exports, takes the marker pen, and `ask` can ask
a viewer to write BASIC.

The first cut, per Hans's ruling, is small:
- Statements: PRINT and `?` (with `;` `,` and the machine's own number
  spacing), assignment, GOTO, GOSUB/RETURN, IF/THEN, FOR/NEXT/STEP, REM,
  END/STOP, POKE.
- POKE/PEEK reach the screen (1024+), colour RAM (55296+), border (53280),
  background (53281), cursor colour (646); other addresses are a sparse store.
- PRINT CHR$(147) clears, CHR$(13) is a newline, the sixteen colour codes
  change the text colour.
- Functions: INT RND LEN CHR$ ASC STR$ VAL LEFT$ MID$ RIGHT$.
- RND is SEEDED (a figure renders the same every time); a step cap so a
  runaway loop fails honestly.
- Out of the first cut, and the error SAYS so: DATA/READ/RESTORE, DIM/arrays,
  ON…GOTO, TAB/SPC, trigonometry, SYS/WAIT/USR, OPEN/CLOSE, INPUT/GET,
  sprites, sound. Errors read like the machine's (`?SYNTAX ERROR IN 20`)
  with drawcast's explanation in parentheses.

Files: `src/code/basic.ts` (tokenizer, parser, interpreter, screen writer,
`run(req)`), `languages.ts` + `run.ts` (the language), `envelope.ts`
(`screen?: C64Screen`, CODE_VERSION 6 → 7), `layout/code.ts` (draw a run's
screen where the boot screen is drawn now), schema + prompt, `tests/basic.test.ts`.
The run must also fill `stdout` with what PRINT wrote, or `ask` with
`expect: "stdout"` and panels without a screen would see nothing; the data
bridge then gets BASIC variables (`{prog.A}`) for free.

`src/code/c64.ts` already holds what M3 needs and M1 used: the palette (Pepto
values), the 40 × 25 screen type, the PETSCII colour codes, screen-code
conversions, the boot lines, the screen's aspect, and the emulator URL.

## Open, and Hans's call

- **The PETSCII font.** C64 Pro Mono (style64.org) ships WOFF/WOFF2 and its
  licence allows embedding in a web page but NOT offering the font for
  download. Vendoring it in `public/` and inlining it in the video export (the
  Patrick Hand pattern in src/export/video.ts) is the shape. Until then the
  screen draws in the system mono, and the colours carry the look.
- **A program inside the spec** (base64) needs vc64web's player script or a
  reimplementation of its postMessage handshake. Later, if wanted.

## M7 (2026-09-06): keys reach the joystick; a bigger catalogue

- **Joystick on the keyboard by default** — the emulator URL carries
  `port2=true` (cursor keys + space in port 2), and the media modal hands
  keyboard focus INTO the iframe on open and on load. Hans: the emulator
  opened with the controls off and had to be clicked first. (64e26bd)
- **Seven more programs**, all GitHub-raw, all licensed by their repository,
  each booted in vc64web + Open ROMs and watched running: `invaders`,
  `puralax` (XC-BASIC examples, MIT), `c-rex` (GPL-3), `ronino` (BSD-3),
  `3d-cube` (MIT), `panopticon` (Unlicense demo, Revision 2014), `diffusion`
  (MIT). Search: 13 GitHub queries → 39 licensed repos with .prg files → 18
  CORS-checked `$0801` candidates → 13 smoked in the browser.
- **Open ROMs finding**: plain BASIC V2 programs mostly FAIL there
  (`?NOT IMPLEMENTED ERROR`, `?UNDEF'D STATEMENT ERROR`) and compiled BASIC
  that calls KERNAL routines by address BRKs — machine-code games written
  with cc65/KickC/Oscar64/XC-BASIC are the safe kind. `tenlander` is the
  BASIC exception that happens to run. A `page.goto` to a URL that differs
  only in the hash does NOT restart vc64web — the smoke used
  `location.reload()`.
- **Archive picks: .prg now plays HERE** (built the same day Hans asked).
  The Archive tells us what an item boots from — every result carries
  `emulator_ext`/`emulator_start`, and they ride along in the SEARCH response,
  so the choice of player costs no extra request. Measured over the whole
  collection: 96 038 items boot from `.d64`, 2 520 from `.tap`, 196 from
  `.prg`, 14 from `.t64`/`.crt`. A `.prg` hit is marked in the result list and
  runs in OUR emulator from `archive.org/cors/<id>/<file>` (the only path of
  theirs that answers cross-origin — `/download/` redirects to a node that
  does not); everything else keeps the Archive's own player, and the modal's
  "open in new tab" goes to the item page, which is the fallback when a
  program will not start on the free ROMs.
- **What the free ROMs cannot do, measured 2026-09-06**: a `.d64` sits at
  READY with no drive even with `dialog_on_missing_roms=false` and
  `dialog_on_disk=false`; a `.tap` gets through vc64web's tape dialog and then
  answers `?DEVICE NOT PRESENT`. So disks and tapes are not a matter of
  suppressing a dialog — the ROMs are missing, full stop.
- **Hit rate on the eight most-downloaded `.prg` items: six ran** (Portal,
  Nyan Cat, Big Pixel Nyan, Angry Birds, Chemical Plant Zone, Iceblox Plus);
  Sonic jammed the CPU and Deflex Remake came up as garbage. A jam raises
  vc64web's own `alert()` inside the iframe — we cannot catch it, which is
  the other reason the item page stays one click away.
- **A wrong file name is an `alert("Error: Failed to fetch")`**, so the name
  must come from the item's `emulator_start`, never be guessed from the id.

## M8 (2026-09-07): demos, and what the free ROMs make of them

Hans asked what about demos. Measured, not guessed:

- **The scene is already in the search** — the Archive imported pouet.net's C64
  productions as `pouet_*` items: 245 in the C64 collection, 147 of them one
  `.prg` file. Those are marked and play right here like any other program.
  Nobody would think to search for "pouet", so the tray got a **Demos** button
  that browses exactly that set (`identifier:pouet_* AND emulator_ext:prg`).
- **Three of five booted demos ran**: Lines (LSR 64, Function 2019), 2600 AD,
  and the Skyrim demo — graphics and SID music, no click to start. Epic Sax
  Gandalf and Piano Intro both stopped with `?UNDEF'D STATEMENT ERROR IN 30`.
  That is NOT the start-up line: every one of them, working or not, is the
  same `SYS2061` BASIC stub (checked byte by byte against panopticon, c64maze,
  nyan and invaders, which all run). The two that fail crash back into BASIC
  from machine code, on a KERNAL the free ROMs implement differently.
- **The famous multi-part demos cannot come here at all.** We Are Demo,
  Comaland, Edge of Disgrace, Uncensored, Mekanix, Royal Arte, Deus Ex
  Machina — every one is a `.d64`, and a disk needs the drive ROM. They stay
  in the Archive's own player, which has the ROMs and plays them fine. Even
  if we extracted the first file from the image ourselves, multi-part demos
  load more parts through custom fast-loaders that talk to the drive
  hardware — so a D64 reader would not buy them either. Not worth building.
- **SID music has no home on the Archive**: one item with a playable `.prg`
  (a PSID64 conversion). The music people actually hear here comes from the
  demos and from music intros in the same pouet set.

## M9 (2026-09-07): can we mount a 1541 ROM and get .d64? Measured: no

Hans passed on a correct analysis — vc64web emulates the drive, and a `.d64`
needs a 1541 ROM the free set lacks — and asked whether it works. The
mechanism is real; the ROM is the wall. Everything below was measured, not
read off a wiki.

**The injection path works, and we would not need their script.** The player
script is only a convenience wrapper over a postMessage protocol we can speak
ourselves: fetch the bytes in our page, then post
`{cmd:"load", floppy_rom: Uint8Array, file: Uint8Array, file_name}` to the
iframe. Two details cost an hour to find:
- the emulator NEVER announces itself. It answers `render_run_state` only
  when the parent posts the string `"poll_state"` — poll until it replies,
  then inject. Waiting for an unsolicited ready message waits forever.
- an injected ROM is written to `localStorage` on vc64web.github.io, so it
  persists for that viewer across visits, and our iframe shares that origin.

**But VirtualC64 whitelists ROMs by signature.** `Emulator/Media/RomFile.cpp`
accepts a 1541 ROM only at exactly 16384 bytes AND starting with one of
`97 AA AA`, `97 E0 43`, `97 46 AD`, `97 DB 43` (the four Commodore
revisions), or two Dolphin DOS layouts. Anything else is not "unknown but
loadable" — it is refused: `wasm_loadfile("1541.rom", …)` returns `""` and
nothing is stored.

**There IS a free 1541 ROM, and it is refused.** `Pascual_DOS-1541` (MIT,
clean-room, 16384 bytes, verified in VICE, sister project of free BASIC and
KERNAL ROMs) is the real thing — and it starts `78 D8 A2`, so it fails the
whitelist. Measured end to end: ROM and a 175 KB `.d64` delivered to the
iframe, emulator reset, then `LOAD"$",8` → `?DEVICE NOT PRESENT ERROR`, and
`localStorage` holds only the three Open ROMs. Even if the signature check
were relaxed, that ROM says in its own README that it deliberately does not
support fast loaders or internals-based protection — which is what nearly
every commercial disk title and every multi-part demo uses.

**The one arrangement that would work**: the viewer supplies their own
original 1541 ROM. vc64web's ROM dialog already stores it under its origin,
so a viewer who installs it once at vc64web.github.io gets disks inside
drawcast with no change from us; a file input in the tray would do the same
more visibly. We would ship no ROM either way. Not built: the Archive's own
player already plays those disks, so the gain is integration polish for the
few viewers who own a ROM.

## M10 (2026-09-07): cartridges join; Jumpman Junior cannot

Hans asked whether Jumpman Junior could play on the free ROMs instead of the
Archive's player. It cannot: every copy the Archive holds is a `.d64`
(`Jumpman_Junior_1983_Epyx_cr_Antirom`, `…_cr_MrO`, and a compilation), and a
disk needs the drive ROM that M9 showed we cannot supply. It plays in the
Archive's own player, which has the ROMs — search, pick, Play, one click on
its screen.

Looking for it turned up two formats we had never tried:

- **`.crt` cartridges now run here.** A cartridge takes the machine over at
  reset and never asks the ROMs to load anything, so it is the one format
  with nothing to go wrong. Both tried ran perfectly: Joust's unreleased
  prototype and Nono Pixie. Five in the collection. Routed to our emulator.
- **`.t64` stays with the Archive.** It is a tape ARCHIVE, so it does load
  into memory with no drive — and then does not start: Sword of Fargoal
  (Epyx 1983) answered `?NOT IMPLEMENTED ERROR IN 1` on a `POKE…CLR:SYS`
  line, and ZZ Top's RUN did nothing at all. Both failures are the free
  ROMs' unfinished BASIC again. Nine items; not worth a special case.

The direct-URL rule now also insists the file name agrees with the type the
item declares, so a mislabelled item cannot smuggle one format in as another.

## M9b (2026-09-07): the ROM route, read properly

Hans pointed at the wiki again. He is right that embedding, ROM preloading
and `.d64` autostart are all documented — and reading the code behind those
pages changes one thing in M9's conclusion.

- **The project supplies no drive ROM, and neither does Open ROMs.** The repo
  ships three files (`roms/basic_generic.rom`, `kernal_generic.rom`,
  `chargen_openroms.rom`), and `fetchOpenROMS()` fetches basic, kernal and
  chargen from mega65.github.io. Their `bin/` folder has no 1541 ROM at all.
  Every ROM URL in the whole wiki is a `my-site.de/floppy.rom` placeholder,
  and the base64 example on the ROM page decodes to `97 AA AA` — the original
  Commodore image. The documented arrangement IS "bring your own".
- **The emulator has a fourth socket.** The ROM dialog carries `basic`,
  `kernal`, `charset` and `disk drive rom`, and the disk dialog says so:
  "no rom-chip in floppy drive installed … Head over to roms setting and
  provide the rom first."
- **The load order is what matters, and it is in our favour.** On
  `MSG_ROM_MISSING` the emulator calls `load_roms(true)` FIRST, which installs
  whatever `localStorage` holds — including `vc1541_rom.bin` — into the core,
  and only falls back to `fetchOpenROMS()` if something required is still
  missing. Our `openROMS=true` does not override an installed ROM. And that
  storage belongs to vc64web.github.io, the origin our iframe loads.

So: a viewer who drops their own 1541 ROM into that socket once, at
vc64web.github.io, has it inside drawcast too, and disks would run in our
frame — real drive emulation, so fast loaders and protection work, unlike the
free clean-room ROM.

What we do NOT get from that alone: our tray routes by file type, so `.d64`
picks still go to the Archive's player. Benefiting would need drawcast to
know the viewer has a ROM — a file field in the tray that stores the ROM on
our side and injects it with `{cmd:"load", floppy_rom, …}` (the postMessage
handshake in M9, which we can speak without their script). Offered to Hans,
not built: it means holding a copyrighted file the viewer supplies, and the
Archive's own player already plays those disks today.

## M11 (2026-09-07): our embed against their player — one real gap

Hans asked whether our embedding is already good. Compared against the
`vc64webplayer` pages: yes, and deliberately so. Their player is a
convenience wrapper that puts THEIR script (and jQuery) in OUR page, replaces
an element with the iframe, and draws its own icon bar. We build the same
iframe from the same hash config ourselves, which keeps a third-party script
out of the page and lets our own modal chrome (close, open in new tab,
Escape) do the framing. The two things their bar has that we do not are a
reset and an audio toggle; the emulator's own navbar would give both, and we
hide it.

The one real gap the comparison found was **touch**. `touch=true`, set
BEFORE `port2=true` (their documented order), makes port 2 an on-screen
joystick instead of the keyboard. Without it a phone or tablet viewer got a
keyboard joystick with no keyboard, and — because we hide the navbar — no way
to reach the switch. The game simply would not respond. Now the URL carries
it whenever the viewer's MAIN pointer is coarse (`(pointer: coarse)`, not
`any-pointer`, so a laptop with a touchscreen keeps the better keyboard
joystick). Verified in the emulator: port 2 reports `touch` and a
`touch_joystick1` element appears over the running game.

