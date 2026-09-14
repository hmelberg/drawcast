# Code controls: a script's variables as tray controls

**Status:** design agreed in chat 2026-09-13/14 (Hans + Claude), not yet built.
This is round 1 of the "users extend drawcast themselves" direction. The
widget body (interaction on the drawing: chess-like games, clicks on parts,
sound) is a separate later round with its own spec. Nothing in this round
persists past Continue ▶ — one movie, experiments while paused (Hans
2026-09-14: "retain the linearity of the story").

## 1. The problem

A code element runs a real script and shows its output. To change a number
in it, the viewer has to open the editor, find the line, edit it and press
Run. A simulation a lesson wants the viewer to *play with* — a transmission
rate, a sample size, a cohort length — should be a slider in the ⊕ tray next
to the template's own sliders, and moving it should re-run the script and
repaint the panel and any figure the script feeds.

Everything but the control itself already ships: the tray's Run path
(`src/ui/tray.ts` `runEdited`) re-executes an edited script, patches its
`code_result`, re-substitutes `{id.path}` tokens into template params and
previews the whole thing through one `previewSpec` call; `runCode` caches
each script text; the baked `code_result` in the document is what movies and
embeds show; Continue restores the lesson. This round adds the way to change
a value without editing text.

## 2. Design

### 2.1 Names in the spec, shapes in the script

```yaml
- id: sim
  type: code
  language: python
  show: left
  controls: [n, beta, model, log]
  code: |
    n = (1, 50)
    beta = (0.1, 1.0, 0.05)
    model = ["SIR", "SEIR"]
    log = False
    ...
```

`controls` is a list of variable names. For each name the host finds the
variable's **birthplace** in the script — a top-level assignment or a default
argument in a function signature — classifies its literal, and rewrites that
literal in place with the current value before the script runs. The spec
carries nothing else: no kinds, no ranges, no labels. The script is the one
source for what a control is (the "two truths" rule from `panel-view.ts`).

### 2.2 The literal grammar

Shorthand (a plain literal) and longhand (a constructor call) classify the
same way. Longhand is where labels, defaults and steps go.

| Shorthand | Longhand | Control |
| --- | --- | --- |
| `(1, 50)` | `Slider(1, 50)` | integer slider, step 1, default midpoint (25) |
| `(0.1, 1.0)` | `Slider(0.1, 1.0)` | float slider, step a rounded hundredth of the range |
| `(0.1, 1.0, 0.05)` | `Slider(0.1, 1.0, step=0.05)` | float slider |
| `(0, 100, 5)` | `Slider(0, 100, step=5)` | integer slider |
| — | `Slider(1, 50, default=10, label="Cycles")` | slider with explicit default and label |
| `["SIR", "SEIR"]` | `Choice("SIR", "SEIR", label="Model")` | segmented row, default first |
| `False` / `True` | `Toggle(False, label="Log scale")` | switch |
| `"Alice"` | `Text("Alice", label="Name")` | text field |
| `3` / `2.5` | `Number(3, label="Seed")` | number field (integer if written without a decimal point) — never a guessed range |
| — | `Button("Roll again")` | counter: each press rewrites the line with the next integer, starting at 0 |

**Integer vs float:** a slider is integer-valued only when every number in
its literal is written without a decimal point (`(1, 5)` steps by ones;
`(1.0, 5.0)` and `(1, 5, 0.5)` are float). Display decimals follow the step
(`formatMeasure` rule with the step's decimals). A `Number` is integer by
the same rule.

**Defaults:** midpoint for a range (the `interact` convention), first item
for a choice, the literal itself for toggle/text/number, 0 for a button.
`default=` in longhand overrides. The default is what the baked run and the
movie use (§2.5).

**R** reads the same grammar in its own syntax: `n <- c(1, 50)`,
`c("SIR", "SEIR")`, `TRUE`, `"Alice"`, `3`, `function(n = c(1, 50))`, and
the same longhand names `Slider(1, 50)`, `Choice("a", "b")`, `Toggle(TRUE)`,
`Text("x")`, `Number(3)`, `Button("Roll")`.

The longhand names are parsed, never executed: the rewrite replaces the call
with a value before any runtime sees the script. A stub `drawcast` module in
pylib defining `Slider`, `Choice`, `Toggle`, `Text`, `Number`, `Button` as
plain functions returning their default is a courtesy so a script also runs
unchanged in a notebook; the app never needs it.

### 2.3 Birthplaces: plain code and functions

```python
# plain code
n = (1, 50)
run(n)

# function form
def simulate(n=(1, 50), beta=Slider(0.1, 1.0, step=0.05)):
    ...
simulate()
```

The host searches, per language, (a) top-level assignments `^name\s*=\s*LIT`
(`^name\s*<-\s*LIT` in R) and (b) keyword defaults `name\s*=\s*LIT` inside a
`def name(...)` / `name <- function(...)` header. Both forms rewrite in
place; the call at the bottom stays as written and picks up the new default.

**One birthplace per name** (lint error otherwise, §2.7): the host must know
which line to rewrite, and a name born twice is the less clear script anyway.

### 2.4 The rewrite

A control value is applied by replacing the literal's span with the value's
source form in that language (`12`, `0.35`, `"SEIR"`, `True`/`TRUE`,
`"Alice"`). Invariants:

- **The line count never changes.** `<id>_line_N` beats are indexed by
  source line (`src/layout/code.ts`); a rewrite is always within one line.
- **The rewritten script is what runs AND what the panel draws.** The viewer
  sees `n = 12` change under the slider; the tuple and the constructor never
  appear on screen. (The editor card shows the same rewritten text; a viewer
  who edits and Runs takes over the text as today, and the controls go quiet
  for that script until Continue.)
- **The cache is free.** `codeCacheKey` hashes the code text, so every value
  combination is its own cached envelope; sliding back to a seen value is
  instant and never re-runs.

`src/code/controls.ts` (new, pure, DOM-free): `parseControls(language, code,
names) → {controls: ControlSpec[], issues}` and `applyControls(language,
code, controls, values) → code`. Both are string functions so the lint, the
resolver, the tray and node tests share them.

### 2.5 Where the defaults are applied

`resolveCode` (`src/render/code.ts`) runs a script with the defaults applied
before stamping `code_result`, so the document's baked result, the movie,
the `<drawcast-figure>` embed and the lean-back viewer all see the default
run. A spec with a tuple in its code is therefore never run raw. The panel
layout (`src/layout/code.ts`) draws the default-rewritten text for the same
reason.

### 2.6 The tray

The tray (`src/ui/tray.ts`, plan from `src/ui/tray-model.ts`) gets a
**controls group per code element**, placed with that script's card, above
the template sliders. Rows reuse the existing slider row (`cs-tray-row`) and
segmented choice (`cs-tray-choice`) markup; toggle, text and number are
plain inputs in the same row style; a button is a `cs-tray-pill`.

- **Order** is the order written in `controls`.
- **Layout:** sliders and text fields take a full row; toggles, choices,
  numbers and buttons flow two per row. On the mobile bottom sheet
  everything is one column.
- **Autorun** (default): a change debounces ~250 ms (Pyodide ~400 ms) and
  runs through the existing `runEdited` path with the rewritten text —
  status, busy state, "Continue restores the lesson" all as today. Text and
  number fields commit on Enter/blur. A code element with `autorun: false`
  shows the tray's existing Run ▶ and applies pending values on press.
- **Linking:** while a control has focus or is being dragged, the script's
  panel and every template element whose params carry that script's tokens
  get the pause-reveal glow, so the viewer sees what the control feeds.
- **`explore.code`** already opens the tray on a script; an explore beat
  that names a controlled script shows its controls expanded.
- **One-click from playback** (agreed 2026-09-14 as the general rule; this
  round implements it for scripts only): a left-click during playback that
  lands on a control-bearing code panel pauses at the step boundary and
  then opens the tray with that script's controls. Ordering is pause first,
  hit-test the paused scene second (the `infocard.ts` rule). A click on
  anything else keeps today's meaning.

Nothing here persists: control values are preview state, discarded on
Continue like sliders and edited scripts. `ask` with `store`/`default`
stays the only persistence channel and is untouched by this round.

### 2.7 Lint (`src/lint/lint.ts`, rule `controls`)

Errors (the repair round sees these):
- a name in `controls` with no birthplace in the script;
- a name born twice (two assignments, two signatures, or one of each);
- a literal that is none of the grammar (a dict, a call other than the six
  longhands, an expression);
- a longhand with a bad argument (non-numeric bound, `default` outside the
  range, a `Choice` default not among its options);
- `controls` on a non-code element, or on a `basic` script (§4).

Warnings:
- a call site passes a controlled name as an explicit keyword
  (`simulate(n=5)`): the slider would be silently defeated. Positional
  overrides are not detected — accepted gap, a parser is not worth it;
- a step that does not divide the range; two controls with the same label;
- a controlled script whose pane is `show: none` and whose id no template
  param tokens reference: the control would change nothing visible.

### 2.8 What the model sees

`compiler-v1-code.md` (the code section, included only for code requests)
learns one paragraph: a code element may list `controls` — the names of
variables the viewer may change from the ⊕ tray; each is born once in the
script as a range tuple `(min, max[, step])`, a list of choices, a bool, a
string or a number, or as `Slider(...)`/`Choice(...)`/`Toggle(...)`/
`Text(...)`/`Number(...)`/`Button(...)` when a label or default is wanted;
the default (midpoint of a range) is what the movie shows; a bare number is a
field, never a guessed range; prefer controls over an `explore` beat that
tells the viewer to edit the script. `schema.ts` describes `controls` as
`string[]` on the code element in one sentence. `tests/prompt-size.test.ts`
re-pins both constants in the same round (feedback rule 2026-09-10). The
schema stays anyOf-free: the spec surface is a list of strings.

## 3. Testing and evidence

Pure modules first, no DOM (no jsdom in this repo):

- `tests/code-controls.test.ts`: the grammar table above, per language
  (python, r, brython, micropython share Python's or R's grammar); integer
  vs float by decimal point; defaults; longhand keyword parsing; birthplace
  search in plain and function form; the rewrite keeps line count and
  replaces exactly the literal span; round trips (`apply` then `parse` finds
  no tuple, finds the value).
- `tests/code-controls-lint.test.ts`: every error and warning in §2.7, each
  with a spec that trips it and one that does not.
- `tests/tray-model.test.ts` (extend): the plan carries a controls group in
  written order; layout rows; `explore.code` expands it.
- `tests/code-element.test.ts` (extend): `resolveCode` stamps the
  default-applied run; a stamped result at defaults `covers()`; the panel
  draws the rewritten line text.
- Examples gate (`tests/examples.test.ts`): the two new examples lint clean
  with zero warnings.

Evidence before "done": the mini-DOM tray test pattern from the ghost round
for one slider driving one Run; Hans' smoke checklist
(`docs/superpowers/plans/2026-09-14-code-controls-smoke.md`): slider moves
`n` on the panel and the histogram, Choice swaps models, Button re-rolls,
Continue restores, movie export shows the default, an R script with
`c(1, 50)` gets a slider, Pyodide and Brython both respond.

## 4. Out of scope (this round)

- **Persistence.** No `store` on controls; no answer logging; no branching.
- **`basic`.** C64 BASIC's line-numbered assignments need their own grammar;
  not worth it now (lint error if `controls` is set on a basic script).
- **Motion.** A control re-runs a script; it never tweens. Smooth motion
  stays with `animate` on vars.
- **Controls drawn in the figure.** A control the lesson is *about* is a
  template part (the CRT chin switches); this round's controls operate the
  script and live in the tray.
- **The widget body** (events on the drawing → effects; games; sound) —
  next round, separate spec.
- **A `drawcast` stub module** for notebooks — a courtesy, may ship later.

## 5. Bundled examples (Hans: always add examples)

1. **"The law of large numbers, live"** (exists) gains `controls: [n, seed]`
   with `n = Slider(20, 2000, default=200, label="Draws")` and
   `seed = Button("Draw again")`: the histogram fills in as `n` grows and a
   press re-rolls.
2. **SIR epidemic** (new, python): `beta = (0.1, 1.0, 0.05)`,
   `gamma = (0.05, 0.5, 0.05)`, `model = ["SIR", "SEIR"]` in the function
   form; the panel plots the three curves; narration explains what the
   viewer can now try, with an `explore` beat on the script.
3. **Bootstrap the mean** (new, r): `n <- c(10, 500)`, `resample <-
   Button("Resample")`: a fresh sample and its mean each press, in R, so the
   grammar's R half is exercised by the examples gate.

## 6. Build order

1. `src/code/controls.ts` + grammar tests (pure).
2. Lint rule + tests; schema line; prompt paragraph; prompt-size re-pin.
3. `resolveCode` and `layout/code.ts` apply defaults; stamped-run tests.
4. Tray group + autorun via `runEdited`; linking glow; explore expansion;
   mini-DOM test.
5. One-click pause-and-open for control-bearing panels.
6. Examples 1–3, help.html paragraph, ROADMAP entry, smoke checklist.
7. `tsc` clean before push (Netlify runs `npm test && npm run build`).
