# Live drawn controls, the code sweep, and the movie default

**Status:** design agreed in chat 2026-09-15 (Hans + Claude), not yet built.
Supersedes §2 (the five-line movie rule) and §3.2 (the HTML card) of
`2026-09-14-pane-controls-design.md`; everything else in that spec and in
`2026-09-14-code-controls-design.md` stands. Three stages, each its own
round with its own smoke list, in this order:

1. **Live drawn controls** — the SVG panel is the control; the HTML card goes.
2. **The sweep** — a `run` verb, and a demo on every explore beat, so a lesson
   with knobs plays as a movie without a second storyboard.
3. **`#movie`** — one tag for the author who wants a lesson that also works
   unattended.

## 1. The problem

Hans, after two rounds of code controls: "It works, but it is ugly and
clunky. It would be better if the svg drawn controls themselves could work,
instead of replacing them with html when we actually want to use it. The
point is: not have two slightly different looking, but one." And: "Relax
the rule about everything being designed as a movie. It is too restrictive.
Sometimes we really want to design an interactive lesson with lots of
visible interactions and user input."

What the pane-controls round built is a drawn panel that is a *picture*,
with a second copy of the tray's controls group mounted over it in HTML when
paused (`src/ui/controls-card.ts`). Its own header admits the cost: two
hosts, one state, eventual consistency, so the two knob copies can drift. The
panel's text is set in the mono code font rather than the handwritten face,
the card and the tray wear a hand-drawn border that reads as chrome, the
explore beat opens the tray as well as the card, and every door demands a
click that the stage may read as play.

The restriction is not in the engine. The engine's rule — the timeline never
waits on a response (`2026-08-27-interactivity-principles.md` §3) — is what
keeps export free, and it stays. The restriction is the model-facing law
from the pane-controls spec: an ordinary `speak` never invites, the
invitation lives only in the explore beat, and the `explore-invite` lint
enforces it. Stage 2 makes that law unnecessary; stage 3 turns what is left
of it into an opt-in.

## 2. Decisions (the rulings)

1. **One look.** A control has one representation: the drawn one. It is
   live while paused. There is no HTML twin. The only HTML left is a
   transient text input for `text`/`number` fields, in the sketch font.
2. **The panel is exempt from the play gesture.** A press that begins
   inside a control panel is a control gesture, never play/pause, wherever
   it is released. While playing, that same press pauses *and* starts the
   adjustment: one click, not two.
3. **Pause is the door; the tray stays shut.** Neither the explore beat nor
   a click on the panel opens the ⊕ tray. The tray keeps a controls group
   only for scripts with no panel (`show: output`).
4. **Bake the default, run everything else live.** One result per script is
   baked (`code_result`, as today) so a runtime-less viewer shows the drawn
   figure. Knob changes and sweeps run live through the existing run path,
   memoised by the IndexedDB cache keyed on the rewritten code. Nothing
   else is stored; there is no combination space to bake.
5. **Boot once, warm early.** The interpreter boots once per page. Stage 1
   measures where the wait at the first knob actually is before adding any
   warm-up.
6. **A sweep is a path, not a product.** `run` plays a series of values,
   at most 20 steps, precomputed before the first frame.
7. **The explore beat demos by default.** `explore: {code: x}` plays a
   short, seeded walk over the knobs, then in the app stops with the knobs
   live and in the movie continues. The only difference between the modes
   is the stop. Its `speak` plays in both.
8. **The invitation law is retired.** An ordinary `speak` may invite. The
   `explore-invite` lint and its ratchet go. `#movie` (stage 3) is how an
   author asks for a lesson with few live gates.
9. **Fresh namespace per run stays.** A shared instance (`session:`) is
   reserved, designed in §6, and not built in these stages.

## 3. Stage 1 — live drawn controls

### 3.1 The controls body

`pane: controls` panels get a host in the style of `src/ui/widget-host.ts`:
a DOM-free core that tests drive (`controlsHostFor(hd, deps)`) and a
source-pinned stage listener (`attachControlsHost`). The core knows, per
`pane: controls` element, the pane rectangle (`ctx.panes[id]`, logical
y-up) and each row's boxes (`<id>_ctl_<name>`: label, track or chips or
pill, value), which the layout already mints in
`src/layout/code-controls-pane.ts`.

Gestures, all delivered as logical points through `logicalPoint`:

| Kind | Gesture | Effect |
| --- | --- | --- |
| slider | press or drag anywhere on the row's track band | x → fraction of the track → value snapped to the slider's step and clamped |
| choice | click a chip | that option |
| toggle | click the pill | flip |
| text, number | click the box | a transient `<input>` over the box (§3.2) |
| button | click the pill | one forced run |

A commit goes through the existing `controlsDeps.commit` in `src/ui/tray.ts`
→ `nextValues` → `runControls` → `applyControls` → `runEdited` → `repaint`.
Nothing new runs code. The debounce per language stays: during a drag the
panel is relaid from the rewritten script on every move (cheap, pure
geometry — the knob follows the pointer), while the run itself fires on the
language's debounce as today. `autorun: false` draws a `Run ▶` pill as the
panel's last row; pressing it forces the run.

Pointer capture: a slider press takes `setPointerCapture` on the stage, so
the knob keeps following when the pointer leaves the row, and the release is
the panel's. The cursor over a live row is a pointer, via the host's
`over(p)` rule like the widget host's.

Keyboard adjustment (arrow keys on a slider) is out of scope for this stage.

### 3.2 The transient input

`text` and `number` are the one place HTML remains. A click on the box
mounts one `<input>` positioned over the drawn box through `clientPointFor`
(the code editor's `reposition` idiom, `src/ui/code-editor.ts`), in
`var(--sketch-font)` at the drawn text's size, with no border of its own —
the drawn box is its frame. Enter and blur commit, Escape cancels, and the
input is removed on either. It stops propagation to the stage.

### 3.3 The doors

Three doors, all in the app, all landing on the same live panel:

- **Paused click** on the panel — the panel is already live; the click is
  the gesture itself (§3.1).
- **One click from playback** — the existing one-click path in `tray.ts`
  pauses on the panel press; the press then continues as the gesture.
  Ordering is pause first, then the gesture, so a slider drag that begins
  in playback lands on a paused stage.
- **The explore beat** — `explore: {code: x}` holds the run
  (`exploreGate` in `src/render/player.ts`) with the panel live. It does
  **not** open the tray and mounts no card. Continue is the control bar's
  play button, or a click on the figure outside any panel (the stage's own
  play gesture); both resolve the gate. The caption band carries the beat's
  `speak` as it does today.

### 3.4 The play-gesture exemption

`src/ui/controls.ts` keeps the press-origin rule from a6b77de
(`pressOnControl`, set on capture-phase `pointerdown`). It gains a second
test beside the CSS selector: a press whose logical point lies inside any
`pane: controls` rectangle is a control press. The pinned source test
`tests/stage-click.test.ts` gains the corresponding pin. `freezeClick` in
`tray.ts` lets panel presses through the same way it lets `.cs-codeedit`
through today.

### 3.5 What goes, what changes

- **Deleted:** `src/ui/controls-card.ts`, `.cs-ctlcard` CSS, `controlsCards`
  bookkeeping and the second `buildControlsGroup` call in `tray.ts`,
  `syncControlsGroup`'s cross-host branch (the tray copy for `show: output`
  scripts remains single-host). The two-host eventual-consistency note in
  the card's header is the bug this deletes.
- **Font:** the panel's labels and values switch from `font: "mono"` to the
  figure's default (the sketch face) in `code-controls-pane.ts`. Numeric
  values keep tabular alignment by right-aligning on the value column, as
  now. The code pane itself stays mono; it shows code.
- **Chrome:** the hand-drawn border and radius on `.cs-paramtray` (and its
  popped-out form) go; the tray keeps the paper, the ink and the fonts, with
  a plain 1px `--line` top edge. No `overflow: auto` boxes inside it; the
  tray grows to its content and the page scrolls.
- **Unchanged:** the drawn panel's geometry and ids; `<id>_ctls` as a group
  id; `show: output` scripts and their tray group; the movie export (the
  panel draws at defaults; the explore beat is skipped whole until stage 2).

### 3.6 Warm-up, measured first

The runtime modules are dynamic imports (`src/code/run.ts`), and the render's
ensure phase resolves every code element before play, which already boots
Pyodide or webR and runs each script at its defaults. So the wait Hans sees at
the first knob is not necessarily the boot. Stage 1 measures, on the SIR
example with the cache cleared: boot, package install, first run, and the
first knob's run, as console timings behind a `?perf` query flag. Then:

- If boot or install dominates, add `warmRuntimes(playlist)` beside
  `speech.prefetch` in `src/viewer.ts` (the play-start hook), at idle
  priority, only for playlists whose scripts have `controls`, an `explore`
  or (stage 2) a `run`. A plain code pane never needs a runtime.
- If the script's own run dominates, there is nothing to warm in stage 1;
  stage 2's step precompute is the fix.

### 3.7 Tests

- `tests/controls-host.test.ts` (core, no DOM): a slider press at 30 % of
  the track commits `min + 0.3·(max−min)` snapped to the step; a drag past
  the track end clamps; a choice click at the second chip commits option
  two; a toggle click flips; a button click forces a run when `autorun` is
  false; `over(p)` is true on a row and false in the gutter.
- `tests/stage-click.test.ts` (extend): the panel-rectangle exemption is
  pinned in source, and the one-click order (pause, then gesture).
- `tests/tray-controls.test.ts` (rewrite): no card is mounted on the explore
  beat or the paused click; the tray is not opened by either; the
  `show: output` group still exists.
- `tests/code-pane-controls.test.ts` (extend): the panel's text drawables
  carry no `mono` font.
- Deletion pin: `controls-card.ts` absent; `grep cs-ctlcard` empty.

### 3.8 Smoke (Hans)

SIR with `pane: controls`: (1) play; click the beta track mid-playback —
the cast pauses and the knob is already under the pointer; drag, the curve
follows on release of the debounce; (2) the explore beat stops with the
panel live and the tray closed; pressing play continues; (3) a click on the
figure while paused resumes, a click on the panel does not; (4) the
Markov example's `days` number field: click, type, Enter; (5) the movie
export shows the panel at defaults; (6) dark mode; (7) mobile: a slider drag
does not scroll the page.

## 4. Stage 2 — the sweep

### 4.1 The `run` verb

```yaml
- run: {code: sim, values: {beta: {from: 0.1, to: 0.9, steps: 5}, gamma: 0.2}}
  speak: "Watch the peak move as the rate rises."
- run: {code: sim, values: {model: [SIR, SEIR]}, every: 0.8, loop: 2}
```

| Field | Meaning |
| --- | --- |
| `code` | the id of a code element with `controls` (lint error otherwise) |
| `values` | one entry per control name (lint error for an unknown name); a bare value holds constant, a list is the step values, `{from, to, steps}` is linear, snapped to the slider's step |
| `every` | seconds per step; default: the paired `speak`'s duration divided by the step count, else 0.5 s |
| `loop` | play the series this many times (default 1) |

The step count is the longest series; a shorter series holds its last value
(a bare value is a series of one). More than 20 steps is a lint error. Choice
values are option names; toggles are booleans. After the run the script
stays at its last values — the figure shows what the narration arrived at —
and the drawn knobs, chips and pills show them, since the panel is laid out
from the rewritten script. A later `draw`, `run` or the viewer's own knob
continues from there.

`values` is nested rather than flat so a control named `every` or `loop`
cannot collide with an option.

### 4.2 Precompute, then play

When a `run` (or an explore demo) begins, every step's script is produced by
`applyControls` and run through `runCode` before the first frame; cache
hits are free. The player then steps through the results with the `animate`
tween's timing (`src/render/player.ts`, the `progress` loop), one result
per step, repainting through `previewSpec` as a knob commit does. Steps are
discrete: no interpolation between two runs.

Early warm-up: at play start, after speech prefetch, every `run` and
explore demo in the playlist has its steps scheduled at idle priority, so by
the time narration reaches the beat the results are cached. A failed step
holds the previous result and is logged; it cannot be linted (a runtime
fact), so the review pass ignores it.

### 4.3 The explore demo

`explore: {code: x}` gains a demo, on by default:

- `explore: {code: x}` — a seeded walk (below), then the stop.
- `explore: {code: x, play: {values: {...}, every: 0.4}}` — a planned sweep,
  the `run` shape without `code`.
- `explore: {code: x, play: false}` — no demo; the stop only.

The seeded walk: seed = a stable hash of the element id and its control
names, so a cast plays the same demo every time and a test can pin a frame.
Controls are visited in seeded order, one at a time, at most five steps in
all: a slider goes to a point near a quarter and near three quarters of its
range (seeded which first), snapped; a choice goes to the next option; a
toggle flips; text, number and button are skipped. The walk ends on the
defaults, so the figure the lesson continues from is the one that was
drawn. Default cadence 0.5 s, so a demo is two to three seconds.

In the app the gate then holds with the panel live (stage 1's door). In the
movie there is no gate: the demo plays and the timeline continues. The
beat's `speak` is voiced in both — `src/export/video.ts` stops dropping the
explore line — because it narrates the demo, not only the invitation.

### 4.4 The law retired

- The `explore-invite` lint rule, `src/lint/invite.ts`, its unit tests and
  the `INVITE_BASELINE` ratchet in `tests/examples-style.test.ts` are
  deleted.
- `src/llm/prompts/compiler-v1.md` (explore) and `compiler-v1-code.md`
  (controls) lose the sentences "the ONLY place a line may tell the viewer
  to slide…" and "an ordinary speak must never invite interaction". They
  gain: "Introduce interactive code with an `explore` beat: it plays a
  short demo of the knobs and, in the app, stops for the viewer. Use `run`
  to walk the knobs mid-narration." The schema descriptions for `explore`
  and the new `run` say the same in one sentence each. Both prompt-size
  pins are re-pinned in the same round.

### 4.5 Tests

- `tests/run-lint.test.ts`: unknown code id; a script without controls; an
  unknown control name; 21 steps; a choice value that is not an option.
- `tests/sweep-model.test.ts` (pure): series expansion (`from/to/steps`
  snapped; a short list holds its last; `loop`); the seeded walk is
  deterministic for a fixed id and lands on defaults; text/number/button are
  skipped; five steps at most.
- `tests/player-run.test.ts`: a `run` step precomputes N results before the
  first frame (the runner is called N times, then frames follow); the panel
  after the run is laid out from the last values; an explore demo without a
  gate (autoAnswers) continues.
- `tests/export-speech.test.ts` (extend): the explore speak is in the
  movie's line list.
- Examples: SIR's explore beat keeps the default demo; the CE plane gets a
  planned `run` on the willingness-to-pay threshold. Render gate as usual.

### 4.6 Smoke (Hans)

SIR: the explore demo moves the drawn knobs and the curve, ends on the
defaults, stops in the app with the panel live; the movie shows the demo
and continues with the speak voiced. CE plane: the `run` walks the threshold
with the narration; the knob ends at the last value. Second play of either is
instant.

## 5. Stage 3 — `#movie`

One entry in `src/llm/tags.ts`, group `structure`, beside `#click`:

> `#movie` — hint "a lesson that also works unattended"; brief: "This
> lesson will also be exported as a movie: no `quiz`, `ask` or `wait: click`
> gates, at most one `explore` beat, and `run` sweeps where a live knob would
> otherwise be the point."

Nothing else. The prompt's remaining movie sentences were removed in stage
2; the engine has no mode to sniff. Prompt-size pin re-pinned.

## 6. Reserved: a shared instance (`session:`)

Not built. Designed here so the field name is fixed and the stages above do
not paint it in.

Each run today gets a fresh namespace (Pyodide) or a purged shelter (webR),
so the result cache keyed on code text is order-independent. A data-science
lesson whose blocks build on each other would opt in with `session: ds1` on
each code element. Blocks in a session run in document order in one shared
namespace (one shelter kept alive for the session in R). The cache key of a
block becomes the hash of every earlier block in the session plus its own
text, which keeps results deterministic and cacheable. The cost is the
cascade: a knob change or sweep on block two must re-run blocks three and
four. That cascade is its own round; until then, `run` and controls are
allowed only on session-less blocks or the last block of a session (lint).

## 7. Out of scope

- Keyboard adjustment of drawn controls.
- A per-command `movie: skip`. With the demo default nothing in these
  stages needs it; the explore beat and the movie's auto-resolved gates
  cover the cases raised.
- Interpolated frames between two runs of a sweep.
- Drawn controls outside a code element (the earlier ruling stands).
- Persistence of knob values.

## 8. Build order

Stage 1: (1) the controls host core + tests; (2) the stage listener, the
exemption, pointer capture, the transient input; (3) the doors rewired,
card deleted, tray/CSS/font changes; (4) the `?perf` timings and, if
warranted, `warmRuntimes`; (5) examples untouched, help row, smoke list,
tsc, push.

Stage 2: (1) schema/types for `run` and `explore.play`, lint, prompt
sentences, pins; (2) series + seeded walk model; (3) player: precompute and
step, export voices the explore line, idle warm-up; (4) lint rule and
ratchet deleted; (5) examples, help, smoke, tsc, push.

Stage 3: the tag, the pin, one example request under `#movie` in the tag
tests.
