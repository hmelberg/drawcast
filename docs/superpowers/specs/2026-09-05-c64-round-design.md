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

## M3 — BASIC (open)

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
