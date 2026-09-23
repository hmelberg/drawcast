# Music — standard symbols, the staff as an instrument, and activities a cast can start

Status: design agreed 2026-09-24 (Hans + Claude); §14's three
recommendations accepted by Hans the same day ("i accept your
recommendations. implement."). Implementation in the four rounds of §11.

## 1. What this is

Three connected pieces of work on drawcast's music support, and one
general piece the music work needs first:

- **A. Standard symbols.** Music symbols drawn from a real music font's
  outlines (SMuFL, the W3C community standard), with the font's own
  stem-attachment points, lazy-loaded as an engine. A `music` element for
  freehand figures, and `note_sheet` rebuilt on the same symbols, which
  also brings the bass clef and the grand staff.
- **B. The staff as an instrument.** While paused, the staff is live:
  click a line or a space and it sounds; compose by clicking on the staff
  OR by playing the piano under it, with a small row of controls under the
  staff. On screen, never in the tray.
- **C. Activities a cast can start.** Staff drills (find the note, name the
  note, which note did you hear), a `staff` answer device for `ask`, and
  `explore: {activity: …}`: a cast stops and opens a named activity
  directly on the figure. The same activities appear on the right-click
  card of the object.
- **D. Structure-derived sugar.** `sound: true` on `note_sheet` (the notes
  sound as they are drawn, no `play` beat to write), and three more synth
  instruments.

## 2. Problems it solves

1. **Hand-built symbols do not join.** The note-value example (bundled
   2026-09-23) builds each note from an ellipse and a line; the stem does
   not quite meet the head (Hans: "the connection between the line and the
   dot was not perfect"). `note_sheet` draws its own heads, stems, flags,
   rests and clef as pen strokes, with the same risk.
2. **Treble clef only.** Piano music, bass lines and anything below C3 are
   out of reach.
3. **The staff cannot be touched.** The piano is playable while paused and
   has a "Find the note" drill; the staff has no interaction at all.
4. **A cast cannot start an activity.** The ready-made activities (Find the
   note/square/element/family/part, Drill openings, Play the computer) can
   only be launched from the tray. The interactivity spec's "scheduled
   convergence" (2026-08-27 §13 — the right-click card and the tray list
   the same activities) is half built: the card has no activities.
5. **Sound needs choreography.** A staff that should sound as it is drawn
   needs a `play` beat with `reveal` and `press` lists written in step
   with the drawing. The model forgets choreography (STYLE.md 2026-09-23).

## 3. Decisions

1. **SMuFL, via Petaluma.** Glyph outlines and anchors come from Petaluma
   (Steinberg, hand-drawn style, matches drawcast's look). Licence
   verified 2026-09-24: SIL OFL 1.1, © 2018 Steinberg Media Technologies
   GmbH, Reserved Font Name "Petaluma". Ships `petaluma_metadata.json`
   (SMuFL font-specific metadata: stem attachment coordinates, bounding
   boxes, engraving defaults, in staff spaces). Consequences of the
   licence: the derived data may be bundled with the app with OFL.txt and
   the copyright notice beside it; the derived data must not be called
   "Petaluma" (we call it the music glyph set and credit Petaluma as its
   source in FONTLOG/credits); it stays under OFL.
   Bravura or Leland (engraved style, also OFL) are drop-in alternatives
   if the hand-drawn look proves hard to read small.
2. **Lazy and isolated.** A new engine, `music`, in `KNOWN_ENGINES`
   (src/scenes/engines.ts): a code-split chunk plus a JSON data file,
   loaded on first use only — by a spec that uses `note_sheet` or a
   `music` element. Enabling the music pack loads nothing. The font file
   itself never ships; only path data for ~40 glyphs and their anchors.
   The engine turns "symbol + position + size" into ordinary drawables;
   the renderer, player and export never learn that music exists.
3. **Interaction on the figure, not in the tray** (Hans 2026-09-23, memory
   `drawcast-interaction-on-screen`). The tray and the right-click card
   DISCOVER and LAUNCH; the doing happens on the staff, the keys, the
   drill overlay. A cast that stops to hand over must not open the tray
   unless what it asks for lives only there.
4. **Compose controls sit UNDER the staff** (Hans 2026-09-24).
5. **Composing keeps the authored melody** and writes after it (Hans
   2026-09-24); ↺ gives an empty staff.
6. **Both ways in.** Click the staff → the note sounds and is written.
   Press a piano key → it sounds and the note is written on the staff.
   Either, freely mixed.
7. **Motion from structure** (STYLE.md 2026-09-23, memory
   `drawcast-structure-derived-animation`). Where the model would have to
   place several commands in step, give it one field that expands into
   them before layout (`expandSpec`, next to cards and walks).
8. **Music teaching stays in the sound fragment.** New prompt text goes in
   `compiler-v1-sound.md` (filled into the prompt only for a request about
   sound or music) and new schema keys under the same gate
   (`SOUND_ONLY_COMMAND_PROPS` and its element counterpart), so ordinary
   requests pay nothing.

## 4. Part A — the symbols

### 4.1 Build

`scripts/build-music-glyphs.py`, the same shape as
`scripts/build-patrickhand-glyphs.py` (fontTools, SVGPathPen): reads
`scripts/fonts/Petaluma.otf` and `petaluma_metadata.json`, writes
`src/scenes/music/glyphs.json` with, per glyph, `{d, bbox, anchors}` in
staff spaces, y-up, origin at the glyph's own origin. Also writes the
engraving defaults the engine needs (stem thickness, staff-line and
ledger-line thickness). OFL.txt and a FONTLOG note go beside it.
Run again only if the font or the glyph list changes.

The glyph list (SMuFL names), about 40:
noteheads (`noteheadWhole`, `noteheadHalf`, `noteheadBlack`), flags
(`flag8thUp/Down`, `flag16thUp/Down`), rests (`restWhole`, `restHalf`,
`restQuarter`, `rest8th`, `rest16th`), clefs (`gClef`, `fClef`, `cClef`),
accidentals (`accidentalSharp`, `accidentalFlat`, `accidentalNatural`,
`accidentalDoubleSharp`, `accidentalDoubleFlat`), `augmentationDot`,
time-signature digits `timeSig0`–`timeSig9` and `timeSigCommon`,
`timeSigCutCommon`, `fermataAbove`, `brace`, dynamics (`dynamicPiano`,
`dynamicMezzo`, `dynamicForte`), `repeatLeft`/`repeatRight`, `segno`, `coda`.
The exact list is settled in the round-1 plan; the size budget is < 80 KB
of JSON (measure it; expected well under).

### 4.2 Engine

`src/scenes/music/engine.ts`: `glyph(name, at, staffSpace)` → an exact-area
drawable (the fill-only kind letterforms use, so it is never stroked into a
blob), and `note({duration, stem, dots, at, staffSpace})` → head glyph +
stem as a PEN STROKE starting exactly at the head's `stemUpSE` (or
`stemDownNW`) anchor + flag glyph attached at the stem's end, all in one
group. Stems and staff lines stay strokes so the figure keeps its
hand-drawn animation; heads, flags, rests, clefs and accidentals are
glyphs and fade/sketch in the way text does.

### 4.3 The `music` element (freehand)

```json
{"id": "q", "type": "music", "symbol": "quarter_note", "x": 300, "y": 400, "size": 26, "stem": "up"}
```

- `symbol`: friendly names mapped to SMuFL — `whole_note`, `half_note`,
  `quarter_note`, `eighth_note`, `sixteenth_note`, the five rests,
  `treble_clef`, `bass_clef`, `alto_clef`, `sharp`, `flat`, `natural`,
  `fermata`, `segno`, `coda`, `p`/`mp`/`mf`/`f`/`ff`, `common_time`,
  `cut_time`, and `time` with `"time": "3/4"`.
- `size`: one staff space in logical units (default 26, `note_sheet`'s
  gap). `stem`: `up` (default) / `down`. `dots`: 0–2.
- `x`/`y` place the note head's centre (or the symbol's own origin).
- Sub-ids for draw/highlight: `<id>_oval`, `<id>_stem`, `<id>_flag` — NOT
  `_head`, which the schema reserves (found building the note-value
  example).
- Validation: unknown symbol → error listing the names. The element and
  its properties sit behind the sound gate (§3.8).

The bundled note-value example ("How long does each kind of note last in
music?") is rewritten on this element — five one-liners in place of
ellipses and paths — as the round-1 acceptance figure.

### 4.4 `note_sheet` on the symbols

Heads, flags, rests, the clef, accidentals and dots become glyphs from the
engine; stems, staff lines, ledger lines and bar lines stay strokes, with
stems attached at the anchors. Element ids do not change (`note_<i>`,
`clef`, `staff`, `bar_<i>`, `label_<i>`, `key_<i>`), so every existing cast
and example keeps working — the examples gate is the regression test.

New param `clef`: `treble` (default), `bass`, `grand`. `grand` draws two
staves joined by a brace; `notes` go on the treble staff and a new
`bass_notes` param on the bass staff (ABC: the first two voices). Ranges:
treble C3–A5 as today, bass E1–C4.

## 5. Part B — the staff as an instrument

### 5.1 Free play (always, when paused)

`note_sheet` declares `interactions: [staff]` (a new kind in
`KNOWN_INTERACTIONS`). While paused:

- Click on a line or space → that pitch sounds (hit test
  `staffPitchAt(layout, point)` → "E4", the staff's own geometry, like
  `pianoKeyAt`). Ledger positions above and below count within range.
- With `keyboard: true`, the piano keys are playable as today.

Free play is an excursion (interactivity spec §13): it previews over the
paused frame and is discarded on Continue.

### 5.2 Compose

Composing needs no mode switch: while paused, a click on the staff to the
RIGHT of the last note writes a note (clicking elsewhere only sounds, as
in 5.1). A piano key pressed while paused also writes its note on the
staff when the figure has one.

- **Where it writes:** after the authored melody (decision 3.5), in the
  accent ink, so the viewer's notes are visibly theirs. ↺ clears the staff
  to write from the start. The staff holds 16 tokens (today's limit); when
  full, the control row says "Staff full — ↺ to start over".
- **The control row, under the staff** (decision 3.4), drawn as DOM over
  the stage and placed from the staff's (and its letter labels') bounding
  box, so it never covers a note or a label and stays clear of the caption
  band: duration (𝅝 𝅗𝅥 ♩ ♪ 𝅘𝅥𝅯), rest 𝄽, ♯/♭ for the next note, ▶ play
  what is written, ↺ clear, ↶ undo, instrument. It appears on the first
  click that writes and stays while paused.
- **Keys:** 1–5 durations (whole → sixteenth), 0 rest, space plays, ⌫
  undoes, the piano's existing A S D F G H J row writes notes too.
- **Playback** uses the existing tone engine with the chosen instrument.
- **Keeping it:** free composing is discarded on Continue (§13 rule). A
  cast that wants the melody writes `{"explore": {"store": "melody"}}`: the
  written notes are kept as notation text in `{melody}`, which later
  `speak` lines and `play` can use (`{"play": "{melody}"}` — `play` must
  interpolate vars; add it if it does not, round 2 checks).

### 5.3 Touch

Tap = click. Long-press on an object opens the same card right-click
opens (§6.4); no hover-only affordances.

## 6. Part C — activities

### 6.1 New drills (generators, interactivity spec §6)

| id | Label | Figure | The viewer |
|---|---|---|---|
| `staff_find` | 🎯 Find the note on the staff | note_sheet | clicks where G4 goes |
| `staff_name` | 🔤 Name the note | note_sheet | sees a note, picks its letter (choices) |
| `ear_key` | 👂 Which key did you hear? | piano_keys, note_sheet with keyboard | hears a note, presses the key |
| `ear_staff` | 👂 Which note did you hear? | note_sheet | hears a note, clicks the staff |

Five questions, a score, Again ↻ — the loop `src/ui/quiz.ts` already runs
for the piano. Range follows the clef (treble C4–G5, bass G2–C4 by default;
harder levels later). `activitiesFor` (src/ui/quiz-model.ts) gains one
entry per drill, keyed on the declared interactions; the tray (and, per
§6.4, the right-click card) then list them with no work of their own.

### 6.2 `ask` answered on the staff

`staff` joins `BUILTIN_WIDGETS` (src/spec/types.ts): answer = a pitch,
like `piano`. `{"play": "E4:h"}` then `{"ask": {"widget": "staff", "answer":
"E4", …}}` is the ear question inside a cast.

### 6.3 `explore: {activity: …}` — a cast starts an activity

```json
{"explore": {"activity": "note_quiz"}, "speak": "Your turn: find five notes."}
```

The run stops and the named activity opens DIRECTLY on the figure — no
tray (decision 3.3). Closing it (✕, or after the score) is Continue, the
way `explore: {game}` already works. Any id `activitiesFor` offers for the
figure is valid (`note_quiz`, `square_quiz`, `openings_drill`,
`vs_computer`, `element_quiz`, `group_quiz`, `parts_quiz`, and the four
above); validation lists the ids the figure offers when one is wrong.
Movies skip the beat, speak included, like other viewer-only beats. The
activity's score is kept as `{score}`/`{score_total}` the way quizzes keep
theirs — so a cast can go on "You found {score} of {score_total}".

`exploreSurface` gains the case: `activity` → its own surface, tray shut.

**Settled 2026-09-24 (was an open worry):** the editor preview that "ran
past the gate" on 2026-09-23 was a malformed test cast, not a player bug —
`use: piano_keys with: {…}` on ONE line parses as a template named
"piano_keys with: {…}" (the header takes one setting per line), so there was
no figure, no piano, no tray, hence no gate, and the player rightly skipped
an `explore` it had no gate for.

### 6.4 The right-click card lists the object's activities

Completing the interactivity spec's "scheduled convergence" (§13): the
card that right-click (or long-press) opens on an object carries that
object's activities as buttons, from the same `activitiesFor` the tray
reads. A button starts the activity on the figure and closes the card.
The tray keeps listing them (the touch path and first-session
discoverability — "a context menu is never the only route").

## 7. Part D — structure-derived sugar and instruments

### 7.1 `sound: true` on `note_sheet`

One param: the notes sound as they are drawn. `expandSpec` rewrites a
`draw` whose ids are `note_<i>` tokens of a sounding `note_sheet` into a
`play` of exactly those tokens with `reveal: [note_i…]` (and `press:
[key_i…]` when the keyboard is on) — the choreography the model now has to
write by hand, derived from what it drew. A `draw` of `staff`/`clef`
stays a draw. An explicit `play` from the author wins (no double sound).

### 7.2 Three more instruments

Synth recipes in `src/render/tones.ts` beside tone/piano/organ/pluck/bell:
`strings` (slow attack; triangle body with a quiet sawtooth), `flute`
(nearly pure sine, faint 2nd and 3rd harmonics), `marimba` (short decay
with the 4th and 10th partials a tuned bar is cut for). Built as plain
harmonic layers — the engine has no filter or noise stage, and adding one
was not worth a new mechanism (deviation from the first draft, which said
"through a low-pass" and "breath noise").
No samples, no network — the existing rule. Sampled instruments stay a
non-goal (§12) unless realism is asked for.

## 8. Movies and export

Interactions exist only while paused, so a movie has none: `explore`
activity beats are skipped, free play and composing never appear. `ask`
with the `staff` device plays its automatic answer in the movie as the
`piano` device does (the pointer demo, `pianoKeyBox`'s counterpart
`staffPitchBox`). `sound: true` works in movies — it expands to ordinary
`play` beats.

## 9. Schema, prompt, lint

- **Schema:** the `music` element and its properties; `note_sheet`'s
  `clef`, `bass_notes`, `sound`; `staff` in the ask widget list;
  `explore.activity`, `explore.store`; three instrument names. All behind
  the sound gate except `explore.activity`/`store` (they serve chess and
  the periodic table too).
- **Prompt:** `compiler-v1-sound.md` gains: the `music` element in one
  sentence with the symbol list, `clef: grand`, `sound: true` ("never write
  play + reveal for a note_sheet you can mark sound: true"), the staff
  device. The main prompt's `explore` bullet gains `activity` in one
  clause.
- **Lint:** `explore.activity` not offered by the figure → error with the
  offered list; `sound: true` plus a hand-written `play` of the same notes
  → warn (double sound).
- **Budget:** the ordinary request's system prompt should grow only by the
  `explore.activity` clause and schema; the sound gate carries the rest.
  Re-pin in `tests/prompt-size.test.ts` with a dated note, as usual.

## 10. Examples

Each round adds or rewrites bundled examples, gated like all others:

1. Round 1: the note-value example rebuilt on `music` elements; a
   `note_sheet` with `clef: grand` ("How do the two hands share a piano
   score?").
2. Round 2: a note_sheet cast that ends with `explore: {store: "melody"}`
   and plays the viewer's melody back.
3. Round 3: an ear-training cast (`play` + `ask` with `widget: staff`,
   then `explore: {activity: "ear_staff"}`); example 84 (the major chord)
   gains a closing `explore` on the piano.
4. Round 4: an existing note_sheet example moved to `sound: true`,
   dropping its hand-written `play`/`reveal`/`press`.

## 11. Rounds

| Round | Content | Size |
|---|---|---|
| 1 | Part A: build script, glyph data + licence, `music` engine, `music` element, `note_sheet` on symbols, bass clef and grand staff | ≈ the walk round |
| 2 | Part B: `staff` interaction, free play, compose (staff and piano, control row, keys), `explore.store` | ≈ the piano interactivity round |
| 3 | Part C: the four drills, `ask` staff device, `explore.activity`, activities on the right-click card, long-press | medium |
| 4 | Part D: `sound: true`, three instruments; live Sonnet eval of music requests | small |

Each round ends with the full test suite, the examples gate, a look in the
frames harness (and the player for interactive parts), and a commit.

## 12. Acceptance

- Round 1: no gap between stem and head at any size in the frames
  harness; every existing music example unchanged in ids and clean in the
  gate; the glyph JSON under budget and fetched only by music figures
  (checked in the network panel of a non-music cast: no request).
- Round 2: in the player, click-to-sound and click-to-write work on the
  staff; a key press writes on the staff; ↺, ↶, ▶ and the durations work;
  the row never covers a note, a label or the caption; Continue discards,
  `store` keeps.
- Round 3: each drill runs five questions on the figure with no tray;
  `explore.activity` opens it directly and continues on close; the
  right-click card lists the same activities as the tray.
- Round 4: a `sound: true` cast plays in step with the drawing in the
  player and in a movie export; a live Sonnet run on three music requests
  uses `sound: true` or `music` elements where they fit.

## 13. Non-goals

- Sampled instruments, MIDI input, microphone input (singing a note).
- Rhythm tapping (timing tolerance is its own design).
- Full engraving: beams across notes, ties, slurs, tuplets on the staff,
  lyrics, multiple voices on one staff. `note_sheet` stays a teaching
  staff of up to 16 tokens.
- Editing the authored melody in place (compose only writes after it).
- A "selected object" state (interactivity spec §13: pointing is the
  selection).

## 14. Questions settled (Hans accepted all three recommendations, 2026-09-24)

1. Petaluma (hand-drawn) or Leland/Bravura (engraved) — recommendation
   Petaluma, with a size check in round 1: if small heads read poorly, the
   engraved set is the fallback.
2. Should composing be possible on a staff the cast has not finished
   drawing (paused mid-melody), or only after the last authored note is
   on the page? Recommendation: after whatever is drawn at the pause —
   the viewer continues from where the cast stopped.
3. Grand staff input: `notes` + `bass_notes`, or a single `notes` split at
   middle C? Recommendation: the two params (explicit; the split rule
   guesses wrong for crossing hands).

## 15. Implementation notes

### Round 1 (2026-09-24), with parts of rounds 3 and 4 done early

- Font files live in `scripts/fonts/petaluma/` (Petaluma.otf, its
  metadata, SMuFL's glyphnames.json, OFL.txt, FONTLOG.txt); the build
  writes 42 glyphs, 58.9 KB, to `src/scenes/music/glyphs.json`, with
  OFL.txt beside it.
- A glyph is ONE exact area: its first ring the outline, the rest drawn
  even-odd as holes — counters and separate pieces both come out right,
  so the ring grouping `engines.ts` keeps for MathJax is not needed.
- The element's parts are group children `<id>__oval`, `<id>__stem`,
  `<id>__flag` — addressable as part of the element, not on their own
  (§4.3 said `<id>_oval`; `_`-suffixed top-level ids are reserved).
- `note_sheet` scales its staff to the line's density (about 2.4 staff
  spaces per note, 16–26 units), because font heads are wider than the old
  hand-drawn ellipses and a full line otherwise ran flags into the next
  note. A grand staff's keyboard spans up to three octaves (two before),
  so both hands' keys can be marked.
- The grand staff's labels are off unless `labels: true` (between two
  staves they crowd the ledger lines of middle C).
- Done early: `explore.activity` + `store` (§6.3) — the score is kept as
  `{<store>}`/`{<store>.total}` rather than folded into `{score}`, which
  counts one right/wrong per question; the three instruments (§7.2).
- The "preview ran past the gate" worry (§6.3) was a malformed test cast.

### Round 2 (2026-09-24)

- `interactions: [staff]` on note_sheet; `ui/staffplay.ts` (stage) and
  `ui/staffplay-model.ts` (pure: staves read off the drawn lines, pitch
  under a point, the note_sheet keyboard's keys, the draft). Composing is a
  `notes` preview with a hidden `draft_from` (and `bass_draft_from`) that
  paints the viewer's notes in the accent ink — Continue discards it like
  any free play; `explore.store` keeps it.
- Keys: 1–5 durations, 0 rest, ⌫ undo, ↵ plays what is written — NOT space
  (§5.2 said space): space already resumes the lesson, which would discard
  the draft.
- The control row's duration and rest icons are drawn from the music font
  (the Unicode music characters are missing from the text fonts and
  rendered as ≡). Its top edge sits just under the letter names, scaled to
  the stage; on a small stage it overlaps the keys' top edge a little.
- `play` accepts a stored answer (`{"play": "{melody}"}`): validation and
  the planner let a `{…}` voice through, the player fills it in and times
  the step by what it became.
- Checked live in the editor's preview: a bare explore holds with the tray
  shut and the Continue pill up; a staff click and a key press each write
  a note after the authored line.

### Round 3 (2026-09-24)

- Drills in the existing loop (`ui/quiz.ts`), a new kind `staff`:
  `staff_find` (click where G4 goes), `staff_name` (a note shown on the
  staff, seven letter buttons at the top of the figure), `ear_staff` (hear
  it, click it; 🔊 plays it again); the piano gains `ear_key`. Targets are
  natural notes from two steps below a staff to two above it, on either
  staff of a grand staff.
- `ask` with `widget: "staff"`: the pitch under the click, sounded and
  marked. Movies sound the answer; the pointer demo that TAPS the answer
  on the staff (the piano has one) is not built.
- One starter for every door (`ui/activities.ts` `startActivity`): the
  tray's pills, `explore.activity`, and cards. A right-click (or a touch
  long-press, which now sends the same event) on a figure that offers
  activities opens a small "Try it" card AT the pointer — the drills, and
  "⊕ All controls" for the tray; info cards (a periodic cell's) list the
  figure's activities too.
- The stored-name lint knows `explore.store`.
- Checked live: `explore activity staff_name store drill` opens the drill
  on the figure with the tray shut; the right-click card on the staff
  lists the three drills and starts one; "Click where E4 goes" accepts a
  click on the bottom line.

### Round 4 (2026-09-24)

- `sound: true` on note_sheet, expanded before layout by `spec/sound.ts`
  (in `expandSpec`, between cards and walks): a draw of note ids becomes a
  play of exactly those tokens with `reveal` (and `press` with the
  keyboard); rests, the staff and a grand staff's other hand are drawn
  quietly at the start of the beat; the beat's sentence rides the play.
  The author wins: a cast with its own play + reveal/press is untouched
  (instead of the lint warning §9 planned — nothing to warn about when
  the hand-written choreography simply takes over).
- The instruments (§7.2) shipped in round 1.
- Example: Twinkle moved to `sound: true` — its one hand-written play with
  fourteen reveal and fourteen press ids became a draw of fourteen notes.
