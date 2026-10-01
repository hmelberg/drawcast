# The compiler's rules, short (the rule card)

The condensed form of `src/llm/prompts/compiler-v1.md`: every tool fact the
renderer depends on, in one line where one line will do, and the house taste
as single lines. The teaching craft (question, insight, example, one change
at a time, quiz) is the storyline's job (`treatment-v3.md`); this card is how
to STAGE it. Used for course parts (references/course.md); a single
drawcast reads the whole prompt. Prompt lab 2026-09-30 (LEDGER.md): no
loss against the full read in three blind pairs, about 30% fewer tokens. When a field's exact shape matters, grep `dev-casts/_schema.json`;
when a verb's behaviour matters, grep `src/llm/prompts/compiler-v1.md`.

## The page

- Canvas 1000 × 750, **y up**, (0,0) bottom-left, centre (500, 375). Prefer
  never to write coordinates.
- Keep the top strip (y > 660) for the `card` heading; keep captions' band
  (y < 150) clear of scratch cards.
- **Units:** bare x/y are canvas units, except a chart's own things on a page
  with a `domain` (a point's `at`, arrow ends, point/camera targets) — domain
  units. `{"data": [x, y]}` puts anything at a data position (the page's
  domain, or a chart template's own axes; follows `params.box`). A `move` is
  in the units of what it moves.

## Choosing the approach

1. **Template** (best): a READY scene from the catalogue → `template` +
   `params`; it names its element ids for your commands. Something else on
   the page (script, formula, table) → `params.box: "right"|"left"|"top"|"bottom"`
   (default `full`). Present large, then make room:
   `{"animate": {"box": "right"}, "duration": 3, "speak": …}`, then draw the
   code element (`"pane": "controls"`).
2. **Tier 2** (semantic elements): `axes`, `curve` (qualitative, `expr` in x,
   or parametric `x_expr`/`y_expr`/`t_from`/`t_to`), `point` (incl. on a
   curve: `at: {"x": 3, "on": "wave"}`, or an intersection), `arrow`,
   `label` (ALWAYS `attach_to` + `side`), `region` (between curves; `x_from`/
   `x_to`, may be `{"ref": "eq"}`), `node`, `edge`, `annotation`, `sector`,
   `arc`, `polygon` (`points` or `sides`+`radius`), `pieces` (`of: sectors |
   strips | grid | rings | triangles | halving` → `<id>_1…<id>_n`), `angle`
   (`at`, `from`, `to`; writes its degrees), `measure` (`of` or `from`/`to`;
   `what` length/width/height/area/perimeter; `label: "b = {value}"`; its
   number is `label_<id>`), `ellipse`, `line` (`through`, `slope`/`angle`).
   `domain: {"x": [..], "y": [..]}` when curves live in real units.
3. **Tier 3 raw** (`path`, `text`, `shape`): only what tier 2 cannot say;
   font ≥ 18.

## Vars and live numbers

- `"vars": {"f": 1}` — read by `expr`, by `bind` (`"bind": {"end": "30 + 60*f",
  "at.x": "t"}`, dot paths), and by text as `{f}`, `{f:2}`, `{f:0,}`.
- With a var named `t` or `q`, curves must be written in `x` (else the
  alias is the var: a flat line).
- Var shapes: `{"value": 0.035, "min": 0, "max": 0.1}`, `{"value": 10,
  "fixed": true}`, `{"expr": "B/(1+r)^t"}` (computed).
- A `{r}` inside a `math` tex is LIVE: paused, the viewer drags or types it
  and everything reading it follows. Inside `\frac{}`/`^{}` braces double:
  `\\frac{{B}}{(1+{r})^{{t}}}`.

## Freehand figures

- Build a THING: parts as elements in a `group` (`members`); act on the group
  id. Place ONE part, the rest relative: `at: {"ref": "nucleus", "side":
  "right", "gap": 20}` (outside, on that side), `at: {"ref": "wall", "anchor":
  "top"}` (on a named point); the element's own `anchor` says which of ITS
  points lands there. Page-level things: `at: {"place": "top_right"}` (center,
  top, bottom, left, right, corners). No position at all → placed for you.
- List the parts and what each hangs off BEFORE writing JSON; ≤ ~30
  elements, ≤ ~20 beats; name the six parts that matter.
- Boxes (flowchart, chain, compared pair, cycle, peers): a group with
  `layout: row | column | grid` (grid without `columns` picks the largest
  arrangement), `gap` (40), `align`; groups nest (a column inside a row =
  a branch). Slots are reserved up front — members may be drawn on later
  beats. Four+ peers → `grid`, not `row`; past ~9 split across pages.
- Peers explained ONE AT A TIME: `"walk": true` on their group (drawing the
  next fades the explained ones; naming several brings them back — never
  hand-write those fades); `"walk": "zoom"` also frames each;
  `"walk": "replace"` for alternatives in one place.
- `fit: "left" | "right" | "top" | "bottom" | "full" | {x, y, w, h}` on the
  group scales and places the whole thing. Build at any size; let fit place it.
- Organic outline: `path` with `smooth` + `closed`. People (an epidemic, a
  trial arm, a risk): `population` (`count`, `states` — first is the rest —,
  `order: "cluster"`, `fit`); `bind` `states.sick` to a var and animate;
  `town_sick` names the sick, `{town.sick}` writes the count.
- Formula: `math` with `tex` (write `\frac`, not `\dfrac`; leave `size` out;
  a headline formula may take 34); a curve's own equation is a `label` with
  `tex`. `"colors": {"x": "#2f6b8f"}` colours a TeX snippet everywhere.
- At most ONE `image`: `of: "<Wikimedia Commons title>"`, or a picture the
  user gave (`url`, `look: "screen"`, `regions` — see references/pictures.md).
- A `seed` group (from the request) is a shape to take apart; for a thing the
  figure only points at, an `icon`.
- **Anti-patterns:** coordinates per element instead of `at` + `fit`; x/y
  for a row of boxes; `text` by coordinates where a label fits; two images;
  a formula typed as text; an icon as the whole figure.

## Colour and text

- Colour by ROLE, consistent: ink `#3d3833`; two contrasted things `#b5482e`
  (red) / `#2f6b8f` (blue); derived red `#d0865f`; third voice `#8a5fa8`;
  guides `#8f887c`; fills gain `#f2c14e` / neutral `#87a878` / loss
  `#c96567`. A label naming a coloured thing takes its colour. Templates
  colour themselves.
- Canvas words are CUES: a word or three; a key number may stand beside its
  label. Sizes are automatic; a top-level `text` block (`font_size` 16–48,
  `font_family`, `font_weight`, `math_font`, `math_hand`) only when asked.

## The storyboard (`commands`)

- ONE verb per command, optionally with `speak` ON it (voice and ink start
  together; the command ends when both finish). Standalone `speak` is rare.
- `speak`: one short sentence for the ear. Foreign word: `[de:ich]`,
  `[norwegian:koselig]`, other languages as a locale `[cs-CZ:ahoj]` — the
  word only, never a loanword.
- `draw`: ids in order; `"parallel": true` for peers. A template's named SET
  draws all its members (each still has its own id). Long draws pace
  themselves — never split them to speed up.
- Scaffolding (axes, grids, boards) drawn plain and brisk, no speak — except
  the opening line may ride it. `speak`+`draw` marks what matters.
- Unmentioned elements draw at the end; mention everything in order.
- Opening: a `card` heading (few words or no speak), then the first real ink
  within seconds with the opening line ON it, saying what question the
  drawcast answers. No standalone speak before the first drawing. The spec's
  `title` is shown under the player, not on the canvas; leave a template's
  own `title` param unset.
- Never more than two speak-only commands in a row. A narrated draw, then
  `{"pause": 0.3}` (0.5–1 after a key reveal). One idea per beat.
- `cue` (0 = first word … 1 = last) times the action to a moment inside the
  sentence; `"cue_end": true` makes the cue where it FINISHES. Start-cue for
  point/highlight/flow, end-cue for a reveal; only where timing is teaching.
- A change is announced by one sentence, then made under a sentence that
  names it; never animate under words the motion contradicts; `ghost` the old
  state when comparing.
- A calculation the conclusion rests on is shown in a `scratch` card, line by
  line as it is said, then parked small (`move` with `scale`) or erased.
- One main figure, drawn large; at most one supporting piece at a time.
- No signposting ("Notice that", "Here we see"); emphasis only where the
  meaning is — about one narrated gesture per two or three beats.
- Currency: $ unless the request uses another.
- End on one line naming the insight; a `quiz` after it when there is an
  honest check.

## Verbs

Attention (nothing changes):
- `highlight`: `{"highlight": {"target": [..]}}` — held for the sentence;
  default glow suits the target; `effect`: `circle`, `underline`, `pulse`,
  `box`; `part` narrows it to a TeX term or phrase. On a picture: a soft
  light; several places = stops in one sentence; `"lift": true` starts fresh.
  ONE element talked about → highlight.
- `point`: `{"point": {"at": {"ref": "eq"}, "gesture": "circle|tap|underline"}}`
  — the laser travels; a DISTANCE or relation → point. On a picture it draws
  an arrow (`"gesture": "glow"`).
- One sentence, several gestures: standalone `speak` with `"blocking": false`,
  then point/highlight/focus/pause/flow/animate run under it (draw/show/erase
  still wait).
- `focus`: dims everything else for the sentence (or `duration`); regions,
  a dense figure walked part by part.
- `fade`: `{"fade": {"target": [..], "to": 0.25}}` persistent (`to: 1`
  restores). `hide` removes.
- `camera`: `{"center": {"ref": ..}, "zoom": 2}`, `{"on": [ids]}` frames them,
  `{"reset": true}`.
- `flow`: `{"flow": {"along": [strokes]}}` dots stream (money, current,
  blood, infection); `reverse`, `speed`.

Change the figure:
- `move`: `target`, `by: [dx, dy]`, `duration`, `easing`, `path`; `rotate`
  (degrees ccw) about `pivot` (`{"anchor": "vertex_2"}` or `{"ref": ..}`);
  `to` sends the element's `anchor` to a point; `scale`; `"ghost": true`
  leaves a faded copy; `"trail": true` leaves `<id>_trail`. A move's offset
  persists until undone — take a what-if back.
- Name points instead of computing them: `{ref, anchor}` — center/top/
  bottom/left/right/corners; vertex_k, side_k, centroid; apex, arc; tail,
  tip; start, end, point_k.
- Labels follow their element. Definitions hold (intersection, point on a
  curve, region between curves, arrow between things, angle, measure);
  placement (`at` another) does not.
- A curve with `expr` is not moved but re-expressed: put a var in the expr
  (`"80 + s - x"`) and `animate` it; everything recomputes. Two curves
  discussed side by side = two curves.
- `arrange`: `target`, `layout` (`row`, `zipper`, `fan` with `at`/`start`,
  `grid`, `ring`, `hex`, `stack`, `unroll`), `at`, `duration`.
- `flip`: across a `line` `{from, to}` or `axis: vertical|horizontal`.
- `morph`: outline to another's (`to: {"ref": ..}`), to points, or
  `stretch: [2, 1]`; a `math` morphs to a new formula
  (`{"morph": {"target": "eq", "tex": "2x = 8"}}`). A shape circle does not.
- `step`: a derivation — `math` with `"steps": ["2x = 8", {"tex": "x = 4",
  "note": "halve both sides"}]`, then one `{"step": "eq", "speak": …}` per
  line (`eq_2`, `eq_3`, notes `eq_3_note`); `in_place: true` rewrites.
- `copy` (`as`), `keep`/ghost (`<id>_ghost`; also `"ghost": true` on move,
  arrange, flip, morph, animate).
- `animate`: numeric params or vars, smoothly, with the speak:
  `{"animate": {"demand_shift.amount": 25}, "duration": 3}` — the whole
  figure recomputes. Always write the starting value in params. Single array
  entries (`values.2`), a data template's `stage`. `"easing": "linear"` for
  long runs. One or two per figure, after the elements are drawn. `trail`
  as on move. On supply/demand, slope is `elasticity`, not `steepness`.

Appear and leave:
- `show` / `hide` (instant), `erase` (reverse hand-drawn).
- `clear: {"keep": [..]}` — only for a real act change; `keep` must list
  EVERYTHING still needed.
- `scratch` element: `work: ["words", {"tex": ".."}]`; left middle by
  default, x/y = its CENTRE, or `at: {"place": "top_right"}`; `font_size`
  (default 24); expands to `<id>_box`, `<id>_line_1…`;
  draw box + line 1, then a line per beat; park or erase after.
- `card`: `{"card": {"title": ".."}}` the opening heading (stays);
  `"style": "center"` with `subtitle` for a long lecture.

Steer:
- `label` (a named position), `if` (`var` + one of gt/lt/gte/lte/eq/ne +
  `goto`; backward jumps must cross a quiz/ask), `wait: "click"` ONLY when
  the request asks for click pacing.
- `explore`: `{"explore": {"params": ["n"]}, "speak": ..}` stops for the
  viewer — `params` OPENS THE TRAY with those sliders (avoid when the figure
  itself can be played on) (`code`, or nothing on a playable figure, or `activity` + `store`);
  on a controls script it first demos the knobs (`play`).
- `run`: `{"run": {"code": "sim", "values": {"beta": {"from": 0.1, "to":
  0.9, "steps": 5}}}}` walks a script's knobs under the speak (≤ 20 steps;
  `smooth: false` for jumps).

Ask:
- `quiz`: `question`, 2–4 short `choices`, `correct` (1-based), `right` (the
  answer AND reason, never praise), `wrong` (a hint, spoken before the
  reveal, never the answer; omit if nothing to add), `intro` (never a
  separate speak), `wrong_goto`/`right_goto`, `store`, `required` only on
  request. After the reveal, never before the ink exists. `{score}`,
  `{score_total}`, `{_answers.N}` (`.ok`, `.secs`), `{_answers.last}`.
- `ask`: typed `answer` (+ `retry`, `reveal`), or `store` + REQUIRED
  `default` to collect; `widget: "click"` (answer = element id), `"piano"`
  (sharp notation), `"chess"` (`h5f7`), `"connect"` (sky_map constellation
  id), or the template's own widget.
- `ask` + `on` — a GUESS on the figure before the reveal: `on: bar_2` (drag
  a bar), `line_1` + `from` (draw the rest), `slice_1` (pie edge),
  `crowd_sick` (population count), a `scale` element's id (click the line;
  `{type: scale, min, max, value, unit, log}`), or `"all"`. Never `answer`:
  the truth is the figure's number. The guessed part is NOT drawn before
  the ask. `store: g` → `{g}`, `{g.true}`, `{g.off}`, `{g.pct}`; `right`
  within tolerance (default 10 % of the axis; `relative: true` → of the
  truth), else `wrong`. `default` = the movie's demo guess. Letting go
  answers one part (`release: false` adds an Answer button).
  `on` a `cards` element = rank (`items` in TRUE order, `ends`) or sort
  (`bins` + items `{text, bin}`); draw the cards (shuffled) first. Also:
  `along: <scale>` + `{text, value}` = place on a line; `{text, match}` =
  match; `compare` + `{text, value}` = higher or lower; `options`
  `[{text, goto, best?}]` + `then` = decide (branches are labels ahead).
- Guess extras: `predict: true` before an `animate` (it plays from the
  guess); `reveal: false` + later `revise: "<store>"` = guess, evidence,
  guess again; `budget` + `judge: false` on `on: all` = split a budget. `#interactive`
  asks for these about once a minute, varied.
- Fill the tree (`decision_tree`, `rollback: true`; draw it whole first,
  each blank shows "?" until its ask): `blanks: ["value_treat"]` (also
  `branchlabel_<p>_<c>`, `effect_`/`cost_<node>`), `{e.true}`, `{e.work}` =
  the working line; then always `pick: "<decision>"` (its reveal draws
  best/prune; don't draw them yourself) → `{c.true}`, `{c.diff}`.
- Fill the formula: `\blank{r^2}` in a `math` tex, then ask `on` it with
  `others: ["2r", "r"]` (the right one is always a tile; others = plausible
  wrong ones), or no `others` = typed number or expression (`pi r^2`, `2r`,
  `sqrt(x)`, checked by value; `form: "exact"` to simplify).
- Move the curve (`supply_demand`; tax/shift at `amount: 0` in params from
  the start): `on: supply_curve` or `demand_curve` (one per question),
  `predict: true`, `check` left out (shape), `size` when the amount is
  named, `direction` only for a vague change; right before the animate that
  moves it; "Not quite. {t.why}" explains a miss.

## Elements with more than the schema

- `portrait` (`of`: a person's name; `"cameo": true` on the beat that FIRST
  names them, erased after a beat or two; one or two per drawcast; the name
  caption is automatic; never invent a url; `reveal`: develop/iris/drift/fade).
- `source` (`of`: a work's title — preferred; `doi`/`isbn`/`archive`/`url`
  only when the request supplied them; `page`; `quote` VERBATIM, draw
  `<id>_quote` on its own beat; a YouTube url plays embedded). One per figure.
- `inset` (`of`: another page's title / number / "previous"): no position;
  bring forward with `move` scale then back; only for referring back.
- `icon` (`of`: keyword, `size`): a handful at most, one per category, reuse.
- `link` on any element: `["https://…"]` only when the request supplied it.
- `sources` (top level: `id`, `title`, `authors`, `year`, `finding`,
  `doi`/`url` only when certain) and `cites: [id]` on the element that shows
  the finding.
- `annotation` (`target` list, `kind: box | circle | strike | cross`):
  permanent, declared after its target, drawn at the moment of insight;
  at most 1–2.

## Sound and code

The full prompt adds a Sound section and, for a request that wants code, a
code section. When the request involves either, read those parts of
`dev-casts/_prompt-<slug>.md` (search for "Sound" / the code rules) in full.

These are defaults, not laws; only a valid spec is absolute.
