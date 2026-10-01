# Guess and reveal — the viewer estimates on the figure, then sees the truth

Date: 2026-10-01 · Status: design, approved in conversation; not built

## 1. Purpose

Drawcasts should keep the viewer *doing* something, not only watching. The
strongest moment for that is right before an answer: "How much does Norway
spend on health per person?", "How likely is it you are sick after a positive
test?", "How much of all wealth does the top 1 % own?", "When was Mozart
born?". The viewer commits to a guess, then the figure shows the truth *from
their guess*, and the voice says how close they were.

Multiple choice already exists (`quiz`). What is missing is answering a
**quantity** — on a scale, a bar, a line, a pie, a crowd of people — and a
**reveal that shows the gap**.

Success looks like:

- A viewer drags a bar, sketches a line, moves a pie divider or clicks a point
  on a number line, presses Answer, and watches the truth arrive from where
  they put it, with their guess left behind as a ghost.
- The LLM, given `#interactive`, asks such guesses before key numbers, varies
  the form, and talks about the viewer's actual guess afterwards.
- A viewer can also turn any guessable chart into a self-test without the
  cast asking ("Test me").
- Movies and exports still play straight through.

## 2. Decisions

1. **Layered, not either/or.** `ask` stays the only command that *asks*
   (pause, Answer/skip, scoring, store, right/wrong, goto, score, movie
   auto-answer, playlist carry). Figures gain a **guessable** ability: a
   small contract a template implements. `ask` points at it with a new
   field `on`. One gate and one scoring path; the guess happens on the real
   figure; the reveal is the figure's own animation.
2. **One value or the whole chart.** `on: chart.bar_3` asks one value;
   `on: chart` asks every guessable value of that chart, scored as average
   error.
3. **The truth comes from the figure's data.** For an `on` ask the answer is
   the chart's own value — the LLM never writes it a second time, so the
   "correct" answer cannot disagree with the drawn chart.
4. **A number line is just another guessable figure** — a new `scale`
   element — so "click on a line" is not a special case.
5. **Two tags, kept apart:** `#interactive` (the viewer responds, often)
   and `#lively` (the drawing moves a lot; the viewer is passive).

## 3. The guessable contract

A template (or element) that can be guessed declares **guess handles**. A
handle is one value the viewer can set:

```ts
interface GuessHandle {
  /** The part this value belongs to: "bar_3", "line_1", "slice_2", "marker". */
  part: string;
  /** Where the true value lives in the params (e.g. values[2], or the series). */
  path: ParamPath;
  /** The gesture: drag a height, sketch a curve, move a divider, click a point,
   *  set a count. Decides input, keyboard fallback and gap drawing. */
  kind: "height" | "curve" | "divider" | "point" | "count";
  /** Domain bounds the input clamps to (the chart's axis, 0–100 for a share). */
  min: number; max: number;
  /** "curve" only: the x values the sketch is sampled at, and from which x on
   *  the viewer draws (earlier points stay visible as the given part). */
  xs?: number[]; from?: number;
}

interface Guessable {
  handles(params, scene): GuessHandle[];
  /** Params with the asked values replaced by the guess — the figure is drawn
   *  from these while the question stands, so the guess IS the figure. */
  withGuess(params, guess: Map<string, number | number[]>): params;
  /** Where the asked values start before the viewer touches them (§5). */
  start(params, handles): Map<string, number | number[]>;
}
```

- **The guess is a param override.** The data charts are already
  param-driven and already interpolate (`stage`, `animate`). So the guess
  edits a copy of the params, the figure redraws live under the pointer
  (like `live` widget bodies, `drag_move`), and **the reveal is a tween from
  the guessed params to the true params**. No new animation code per chart.
- **The host owns the gestures**, reusing the widget host (domain
  coordinates, `drag_move`, the editable number field from
  `src/ui/number-edit.ts`) — a template only says what kind each handle is.
- **Keyboard and typing fallback for every handle.** Arrow keys step the
  focused handle (Tab moves between handles); tapping the value label opens
  the typed number field.

## 4. `ask` changes

New fields:

| field | meaning |
|---|---|
| `on` | A drawn figure's id (`health`) or one of its parts (`health.bar_3`). Turns the ask into a guess on that figure. The answer comes from the figure; `answer` must be absent. |
| `tolerance` | Already exists for drag. For a guess: how close counts as right, as a fraction of the handle's range (default 0.1). `{"rel": 0.2}` means within 20 % of the true value (for log-like quantities, money). |

Stored variables (with `store: g`), on top of today's `{g}`, `{g.ok}`, `{g.secs}`:

- `{g}` — the guess, formatted like the figure's value labels (one value) or
  the number of handles within tolerance, "3 of 5" (whole chart).
- `{g.true}` — the true value, same formatting (one value only).
- `{g.err}` — signed difference (guess − truth), formatted; `{g.off}` — its
  absolute size; `{g.pct}` — relative error in percent.
- `{g.ok}` — within tolerance (one value), or average error within tolerance
  (whole chart).

Feedback lines: `right` is spoken when within tolerance, `wrong` otherwise —
**both should name the guess** ("You said {g}; it is {g.true}, {g.off} too
high." / "Close: {g} against {g.true}."). A guess is never "wrong" in a
harsh sense; the brief steers the tone (§9).

`store` keeps the guess for later speech ("Remember you guessed {g}…") and
for `if` branches, as today.

**Whole-chart scoring:** each handle's error as a fraction of its range,
averaged; `curve` handles average over their sampled points. The score
counts one answer, ok when the average is within tolerance.

**Validation** (spec checks, so the LLM gets a repair message):

- `on` must name a drawn guessable figure or a handle part of one.
- The asked part must **not yet be drawn** (the truth would be visible) —
  the same rule `drag` uses. For `on: chart`, the asked parts (bars, lines,
  slices) must be undrawn; axes and labels may be drawn.
- `answer`, `widget`, `items` are not allowed together with `on`.

## 5. What the viewer sees

1. **Question stands.** The voice asks. The asked parts appear at their
   *start* state with a handle and a subtle "?" (not the truth):
   - bar: a short ghost bar at the axis floor with a drag handle on top
     (whole chart: all bars at one flat middle height);
   - line: the given part of the line up to `from`, then a dashed hint the
     viewer sketches over from there to the end;
   - pie: equal slices (or one divider at 50 % for two slices);
   - icon array: no dots filled, a fill handle;
   - scale: an empty line with its ticks, the marker appears where clicked.
2. **The viewer works the figure**; the value label follows the handle live.
   An **Answer** button (the ask's existing button) commits; skip works as
   today and counts as a miss.
3. **Reveal.** The guess freezes as a **ghost** (dashed outline in the
   viewer's colour), the figure tweens from guess to truth (~0.8 s), and a
   **gap mark** spans the difference (a bracket on a bar or scale, a shaded
   band between sketch and line, an arc on a pie) labelled with the
   difference. Then `right`/`wrong` is spoken.
4. The ghost stays until the next `clear`/`erase` of the figure, so later
   speech can point at it ("your guess, here").

## 6. Forms in this delivery

| form | where | handle kind | status |
|---|---|---|---|
| Number line | new `scale` element: `{scale: {min, max, kind: linear\|log\|year\|percent, unit, ticks}}` | point | new |
| Bar chart | `bar_chart` (data pack), parts `bar_i`; grouped bars give one handle per series bar | height | extend |
| Line chart | `line_chart`, parts `line_i`; `from` = first x the viewer draws (default: the second half of x) | curve | extend |
| Pie | **new** `pie_chart` template in the data pack (labels, values, parts `slice_i`) — also useful without guessing | divider | new |
| Icon array | **new** `icon_array` template (n people/dots, groups with counts and colours, parts `group_i`) — the Bayes/screening picture; the guess is a count | count | new |

The `scale` is the fallback when no chart fits: Mozart's birth year
(`kind: year`, 1700–1800), "NOK per person on health" (`kind: log`), "share
earning over $100 000" (`kind: percent`).

**Later rounds (not this spec's build):** range guess (two handles, the
truth lands inside or outside), scatter placement (`scatter_plot.point_i`,
kind point2d), ranking cards, sorting into bins, matching pairs, timeline
placement, higher/lower, confidence wager, "others guessed…" (needs a
backend).

## 7. "Test me" — self-serve guessing

Any guessable chart drawn in full shows a small **Test me** chip on the
figure (corner, when paused or at the end — on the figure, never in the
tray). Pressing it:

- hides the chart's guessable values (start state, §5), the viewer guesses
  any or all of them, presses Answer, gets the same reveal and gap marks;
- does not enter the cast's score or `_answers` (it is the viewer's own
  play), and is undone by pressing the chip again or by playing on.

It uses exactly the same contract and host as an `on` ask.

## 8. Movies, exports, books

- Movies and embeds never wait (as today). An `on` ask needs `default` (the
  demo guess, a number or a list) — the laser pointer drags/sketches to it,
  then the reveal plays. Without `default`, the movie uses the start state
  as the guess and goes straight to the reveal.
- The stored variables in a movie come from the demo guess, so `right`/
  `wrong` lines still read correctly.
- Books: no change; the guess happens on the figure pane.

## 9. Tags and the LLM

### 9.1 `#interactive` (new; group `engagement`, not exclusive with `#quiz`/`#ask`)

`#quiz` and `#ask` sit in the exclusive `interaction` group today, so
`#interactive` gets its own group and can combine with them. Brief (draft):

> The viewer takes part every minute or so. Before each key number or
> surprising result, ask them to GUESS it first — an `ask` with `on` the
> chart that will show it (the asked part not drawn yet), or a `scale` when
> no chart fits. Pick the form from the answer: an amount or year → scale
> or bar; a share of a whole → pie; a trend → line chart (they draw the
> rest); "how many of these people" → icon array; a fact with few options →
> quiz. Never the same form twice in a row; mix in a quiz or a click
> question. Ask only what can be guessed by intuition, not what needs a
> fact they cannot know. Open with one guess as the hook. In `right` and
> `wrong` name their guess and the gap ({g}, {g.true}, {g.off}), kindly — a
> guess is a starting point, not a test; come back to it later when it
> teaches something ("you guessed {g} — most people do").

### 9.2 `#lively` (new; its own group `motion`, so it combines with style and tone tags)

Brief (draft): more motion in the drawing — builds part by part, highlights
and soft marks that glide, numbers counting up, charts animating between
stages, the hand moving often; the viewer watches. No guesses or questions
added by this tag.

### 9.3 Prompts and references

- `src/spec/schema.ts`: `ask.on`, the tolerance rule for guesses, the new
  stored variables; `scale` element; `pie_chart` and `icon_array` templates
  in `src/scenes/packs/data.yaml` (descriptions say "guessable: ask on …").
- `src/llm/prompts/compiler-v1.md` "Ask the viewer": a guess paragraph
  with one example per form.
- `.claude/skills/drawcast/references/rule-card.md` "Ask:" — the same, short.
- The tag hints in `src/llm/tags.ts` and the autosuggest.

## 10. Testing

- **Contract unit tests** per template: handles, `withGuess`, `start`,
  tween endpoints (guess → truth) for bar, line, pie, icon array, scale.
- **Scoring tests** in `src/spec/answers.ts`: one value, whole chart,
  absolute and relative tolerance, curve averaging, formatted variables.
- **Validation tests**: `on` to an undrawn figure, to an already-drawn
  asked part, with `answer` → repair messages.
- **Player tests**: ask gate with an `on` guess resolves with numbers;
  movie path uses `default`; skip counts as miss; `store` variables
  interpolate.
- **In the browser** (muted, per the run-muted rule): one example cast per
  form, plus one `#interactive` cast made by the LLM from a prompt
  (health spending per capita, screening, top 1 %, Mozart) — checked by
  hand for the reveal feel and gap marks, and with keyboard only.

## 11. Delivery order

1. Contract + host + `ask.on` + scoring/variables + validation.
2. `scale` element.
3. `bar_chart` guessable.
4. `line_chart` guessable (sketching).
5. `pie_chart` template, guessable.
6. `icon_array` template, guessable.
7. "Test me" chip.
8. `#interactive`, `#lively`, prompts, rule card, example casts.

Each step is usable on its own; the tags come last so the LLM is only told
about forms that exist.

## 12. Out of scope

The later-round forms in §6, crowd comparison, and any change to `quiz`.
