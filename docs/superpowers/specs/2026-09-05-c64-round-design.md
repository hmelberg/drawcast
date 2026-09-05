# The C64 round — what was decided, and what is left to build

Date: 2026-09-05. Status: **decided, barely started.** Written as a handover:
this round was discussed in a session that ended before the work did.

## What Hans asked for

1. A Commodore 64 element: a C64 screen ON the drawn screen — colours, font,
   text — and simple BASIC on it ("starte C64 med den blå skjermen og gjøre
   noen enkle ting").
2. **Most of all**: to SHOW and PLAY C64 games and demos, with sound.
3. Ruling on scope (2026-09-05): "det er ikke så veldig viktig å programmere
   C64, men det er viktig å kunne se og høre demo og spill … vi kunne ta rute
   3, men ikke ta med alle mulige kommandoer med en gang hvis det tar lang
   tid."

## What already exists in drawcast

- `frame: "c64"` (src/layout/code.ts) already draws the tube monitor standing
  on a home-computer keyboard, and `frame: "crt"` the monitor alone. The
  OBJECT is drawn; only what is on its screen is missing.
- The code element carries a script through the runtime facade
  (`src/code/run.ts`: one module per language, `run(req) → CodeRunResult`),
  and the panel draws code as ink with a beat per line, a marker pen
  (`marks`), an editor on the panel, and `ask` with a code widget.
- `src/ui/media-modal.ts` is the established shape for a LIVE thing over the
  stage: an iframe on the stage, player-only, never in an export.

## The two halves, and why they are different

**Games and demos — an emulator, and it can only ever be an overlay.** A
running emulator is a canvas, and the house rule is that everything drawn is
SVG ink while everything live is an HTML layer a movie skips. So a running
game can never be in an exported MP4, exactly as the piano, the quiz and the
YouTube modal are not.

**Decision: vc64web** (VirtualC64 compiled to WASM), embedded as its own
player iframe from vc64web.github.io:

```html
<script src="https://vc64web.github.io/js/vc64web_player.js"></script>
vc64web_player.load(el, '#openROMS=true#navbar=hidden#wide=true#border=0.3', '<url to .prg>');
```

Four reasons, in the order they matter:
1. `openROMS=true` loads the MEGA65 **Open ROMs**, so drawcast never
   distributes Commodore's KERNAL/BASIC. (A viewer with legal access can
   install the originals themselves in its ROM panel.)
2. vc64web is GPL-3. Iframing a third party is not distribution; **vendoring
   it would pull drawcast into the GPL**.
3. A program can be injected from the page as base64 —
   `vc64web_player.samesite_file = { base64: "…", name: "x.prg" }` — so a
   drawcast can carry its own C64 program the way a portrait carries strokes.
4. It works on a phone: virtual keyboard, touch joystick, gamepads, reSID
   audio, snapshots.

Fallback if it ever has to be self-hosted (offline, kiosk, or that site dying):
**floooh/tiny8bit** — zlib licence, `c64.wasm` 259 KB + `c64.js` 34 KB,
`c64.html?file=game.prg`. Then WE ship the baked-in Commodore ROMs and lose
the touch controls. Third path for "just show me that famous game":
`https://archive.org/embed/<id>` in the media modal.

**BASIC — our own interpreter, because it must be INK.** Route 3 of three
that were weighed:
1. BASIC typed into the emulator: no new engine, but live-only.
2. basic64-js behind an iframe: real C64 BASIC (its POKE reaches screen RAM
   1024-2023, colour RAM 55296-56295, VIC registers 53248-53294, sprite
   pointers 2040-2047, cursor colour 646; SYS/WAIT/USR are stubs that throw
   and there is NO SID sound) — but it is **GPL-3**, so it may not be bundled,
   only isolated, and then it is live-only too.
3. **Chosen**: a small CBM BASIC V2 in TypeScript, written from the C64
   Programmer's Reference Guide (NOT from basic64-js's GPL source), as
   `language: "basic"` in the facade. Then the C64 screen is drawn as ink: it
   scrubs, exports, takes the marker pen, and `ask` can ask a viewer to write
   BASIC. No licence, no ROM, no third party.

## The plan for route 3

Files (the first one is written and committed; the rest are not):

| file | state |
|---|---|
| `src/code/c64.ts` | **DONE** — the palette (Pepto values), the 40×25 screen type, PETSCII colour codes, screen-code conversions, `blankScreen()` |
| `src/code/basic.ts` | to write — tokenizer, parser, interpreter, screen writer, and `run(req)` |
| `src/code/languages.ts` | add `"basic"` to LANGUAGES / RUNTIME_LABEL / RUNTIME_VERSION / cacheTag |
| `src/code/run.ts` | add `basic: () => import("./basic")` to RUNTIMES |
| `src/code/envelope.ts` | add `screen?: C64Screen` and bump CODE_VERSION 6 → 7 |
| `src/layout/code.ts` | draw the screen when the envelope carries one: border rect, background rect, one text drawable per colour run per row, sized from the pane |
| `src/spec/schema.ts`, prompt | the language value and one sentence |
| `tests/basic.test.ts` | the interpreter is pure, so it is node-testable end to end |

Scope for the first cut (Hans: not every command at once):
- Statements: PRINT (`;` `,` and the C64's own number spacing), LET and bare
  assignment, GOTO, GOSUB/RETURN, IF/THEN, FOR/NEXT/STEP, REM, END/STOP,
  DATA/READ/RESTORE, DIM, POKE, ON…GOTO/GOSUB, `?` for PRINT.
- Functions: ABS INT RND SQR SIN COS TAN ATN EXP LOG SGN LEN LEFT$ RIGHT$
  MID$ CHR$ ASC STR$ VAL PEEK TAB( SPC(.
- POKE/PEEK reach the screen (1024+), colour RAM (55296+), border (53280),
  background (53281) and the cursor colour (646); other addresses are a
  sparse store so PEEK gives back what was POKEd.
- PRINT CHR$(147) clears, CHR$(13) is a newline, the sixteen colour codes
  change the text colour.
- RND is SEEDED — a figure must render the same every time.
- A step/time cap, so a runaway loop fails honestly instead of hanging.
- Not in the first cut, and the error must SAY so: SYS, WAIT, USR, OPEN/CLOSE,
  INPUT/GET, sprites, sound. Errors read like the machine's
  (`?SYNTAX ERROR IN 20`) with drawcast's own explanation in parentheses.

Open, for later: the PETSCII font. **C64 Pro Mono** (style64.org) ships
WOFF/WOFF2 and its licence allows embedding in a web page but NOT offering the
font for download — vendoring it in `public/` and inlining it in the video
export (the Patrick Hand pattern in src/export/video.ts) is the shape, but it
is Hans's call to make. Until then the screen draws in the system mono, and
the colours carry the look.
