# Revising the bundled examples — lessons (2026-09-25)

The 96 bundled examples untouched since August were written under older
prompts. They are also the default exemplars in the compiler prompt
(`src/llm/exemplars.ts`), so a dated example teaches the model the old style.
Revised by hand in the codebase, not regenerated through the API. Each
revision passes `tests/examples.test.ts`.

The file before any revision is kept as
`docs/example-revisions/2026-09-25-before.json` (HEAD at 1a6939d), so the
effect of the prompt and process changes can be measured against it later.

## The checklist each revision is held to

Taken from the compiler prompt and STYLE.md, the current advice on how to
explain, not only how to draw:

1. **Situate**: the stakes or the puzzle, riding the first ink. Why would
   anyone want this?
2. **A concrete case with numbers**, carried through the figure.
3. **Answer the silent question**: the step a viewer would not follow
   ("what IS completing the square?") is shown, not named.
4. **Contrast**: the simpler or wrong alternative drawn (and usually erased)
   so the real shape has a reason.
5. **One insight**, preferably the non-obvious one; every beat converges.
6. **Conclude from a new angle**: what the viewer can now see, not the
   opening again.
7. **One interesting true thing**, of a kind that varies between examples.
8. **A quiz that uses the insight**, ideally aimed at a likely
   misconception.
9. **Enough beats**: cap the sentence, never the number of ideas. A short
   example that leaves the problem unclear is the more common failure.

This ledger records what the revisions taught us, in four groups: the engine,
the prompt/manifests, the drawcasts themselves, and general approach.

## Revised — the pilot (8 of the 96)

Files: `docs/example-revisions/2026-09-25-{before,after,pairs}.json`. The old
versions are also in `dev-casts/old-<index>.json` (gitignored), so both can
be opened in the frame harness: `frames.html?cast=/dev-casts/old-37.json`
against `frames.html?index=37`.

| # | Old request | New request | Form | What changed |
|---|---|---|---|---|
| 37 | Show the quadratic formula. | Where does the quadratic formula come from? | equation_steps → freehand | a puzzle (x² + 6x = 16) solved on al-Khwarizmi's literal square, line by line with copy/morph; then the same with letters gives the formula; ± and the root lit as the ±5 and the 25; quiz on the discriminant |
| 38 | Explain E = mc^2. | Why does a tiny bit of mass hold so much energy? | equation_steps | the Sun's 4 Mt/s as the stakes; "does mass really disappear?" answered (fission); one gram worked through; closing line; quiz on "m is not squared" |
| 39 | Show Euler's identity. | Why does e to the i pi equal minus one? | equation_steps → freehand | the idea drawn: i as a quarter turn, e^{iθ} as a turn on the unit circle, animated to π; Feynman aside; quiz on e^{2iπ} |
| 40 | Explain Bayes' theorem. | What does Bayes' theorem actually do? | equation_steps | a spam filter worked through (not a third diagnostic-test case); the flip (50% vs 71%) as the insight; prior and denominator lit; quiz on the prior |
| 3 | Show methane in 3D so the tetrahedral shape is clear. | Why isn't methane flat? | 3-page playlist → one page | contrast with the flat textbook cross; one animate replaces the three pages; van 't Hoff; the link to water and ammonia; quiz |
| 53 | Explain logistic growth: the equation and its S-curve. | Why does so much growth follow an S-curve? | 2-page playlist → freehand | exponential drawn then erased as the contrast; the reason (room left) lit in dP/dt; Verhulst; quiz |
| 54 | Explain exponential decay and half-life: … | What does a half-life actually mean? | 2-page playlist → freehand | a drug; straight line (same amount) vs curve (same fraction) as the contrast; carbon-14; quiz |
| 55 | Explain the inverse-square law: … | Why does light fade so fast as you move away from it? | 2-page playlist → freehand | "half as bright?" as the contrast; the sphere's area as the reason; quiz |

All pass `tests/examples.test.ts` and the frame harness's browser lint, and
each was looked at in the harness (silently: the harness plays no sound).

## Revised — batch 2 (8 more)

Same checklist, plus Hans's two rules from the pilot: the first line says
what the drawcast is about, and one narrated line after a quiz answer.

| # | Old request | New request | Form | What changed |
|---|---|---|---|---|
| 0 | Show the forces on a crate resting on a ramp. | Why doesn't a crate slide down a ramp? | free_body | gravity split into its two dashed parts, each balanced by one force; what a steeper ramp does; Amontons; quiz on the normal force |
| 1 | Draw a benzene ring. | Why is benzene so stable? | ring_molecule | the alternating-bond sketch shown, then contradicted (all six bonds equal); the shared electrons circled; the missing heat of hydrogenation; Kekulé |
| 18 | Draw a production function with diminishing returns. | Why does each extra worker add less than the one before? | generic_axes_diagram → freehand | a bakery with one oven: each baker's gain drawn as a step (+26 … +8), the straight line of equal gains drawn and erased; why (the fixed oven); Ricardo/Malthus 1815; quiz: a bigger oven |
| 31 | Draw a Venn diagram of two sets and shade their intersection. | What do 'and' and 'or' mean in a Venn diagram? | venn_diagram | coffee and tea drinkers with counts; and = the middle, or = any of the three; why the overlap is subtracted once; Venn 1880; quiz on inclusion-exclusion |
| 33 | Show the solution to x is greater than 1 on a number line. | Why is x > 1 drawn with an open circle? | number_line | the hole explained: there is no first number above 1; camera zooms onto the hole; ≥ as the contrast; Harriot's symbols |
| 48 | Draw the Lewis structure of water. | Why is a water molecule bent? | lewis_dot | electron count → four pairs → tetrahedron → bent; CO₂ as the straight contrast; why the bend matters (polarity); camera zooms onto the molecule |
| 41 | Show the saddle surface …, and walk around it in 3D. | What is a saddle point? | plot3d | flat in every direction yet neither top nor bottom, shown by walking round it; why it matters (optimisation stalls) |
| 42 | Draw a 3D helix. | What is a helix? | plot3d | a circle plus a climb: seen from above a circle, from the side a wave (elevation animated); 3 turns instead of 12 so both views read; Franklin's photo 51 |

## Revised — round 3 (12, by three parallel agents in worktrees)

| # | New request | Template kept | Core of the explanation |
|---|---|---|---|
| 2 | Why do proteins fold into helices and sheets? | protein_secondary + freehand | backbone H-bonds (i→i+4) drawn as beads; any sequence can form them; Pauling 1951 |
| 8 | What do mitochondria actually do? | cell_diagram | 2 ATP without oxygen vs ~30 with; the proton dam and spinning ATP synthase; oxygen ends as water |
| 11 | Why does DNA pair A with T and C with G? | dna_helix + letter rows | big-with-small keeps every rung one width; unzip and rebuild; Chargaff-style quiz |
| 13 | How much oxygen does burning methane use, and what comes out? | reaction_scheme + math | balancing by morph; mass tallies; 1 kg gas → 2.75 kg CO₂ |
| 5 | What happens to price and quantity when demand shifts right? | supply_demand | Valentine's roses; only half the extra demand is served; steep supply makes it all price |
| 22 | How do you get the most out of a fixed budget? | indifference_budget | $60, coffee and sandwiches; the tangency; a price rise slides the mix |
| 24 | What does a monopoly cost, beyond high prices? | firm_cost_curves | the only ferry; MR worked in numbers; transfer vs the deadweight triangle |
| 25 | When a whole economy spends more, why doesn't it just produce more? | ad_as | the naive "all output" guess; half output, half prices; long run buys prices |
| 6 | How does a decision tree choose between surgery and medication? | decision_tree | best vs worst case disagree; fold-back 8.1 vs 7.4 QALYs; switch point p ≈ 0.27 |
| 7 | What does 'QALYs gained' by a treatment actually measure? | qaly_profiles | exact areas; better years vs extra years; Zeckhauser & Shepard 1976 |
| 19 | How does a Markov model follow patients through the years? | markov_model | a cohort of 1000 traced with var-bound counts; no memory; discounting |
| 20 | How do you read a cost-effectiveness plane? | cost_effectiveness_plane | ICER as slope; threshold animated; judge against the next best, not doing nothing |

All twelve are lint-clean in the browser harness (not only in the Node gate).

## Revised — round 4 (19, four parallel agents)

Physics: #9 magnifier (the image is 4× taller AND 4× farther; what magnifies
is focusing close), #10 catalyst (a lower pass both ways, so equilibrium
stays), #12 wavelength and amplitude (freehand with vars: louder changes
only amplitude; the octave halves λ), #43 series circuit (the current is not
used up; two bulbs 0.15 A each), #44 45° (a var-driven arc sweeps 70°→20°
and the range visibly peaks). Biology: #14 membrane (K⁺ leaks, the Na⁺/K⁺
pump charges a battery — the old one sent O₂ through a channel), #15 tree
of life (the tree corrected; forks rotate; no tip is "more primitive"), #45
growth signal (EGFR→RAS→RAF→MEK→ERK, NF1 off switch, stuck-on KRAS — the
old one put p53 in the MAPK cascade), #46 CF carriers (2 of 3 healthy
children carry; each child starts fresh), #47 kelp forest (otters, urchins,
orcas: a trophic cascade). Statistics: #16 sensitivity/specificity (read
down a column vs across a row; prevalence changes PPV), #26 survival and
HR (censoring; HR 0.5 is not "half die"), #27 forest plot (four
inconclusive trials pool to a clear answer; weight = 1/SE²), #28 confounder
(smoking; strata RR 1; over-adjusting a mediator), #30 p < 0.05 (P(data|H0)
≠ P(H0|data); Fisher 1925). Maths and logic: #32 sine beyond 90° (sin 30° =
½ from the equilateral mirror), #34 Thales (the two isosceles triangles),
#35 (A∧B)∨¬A = "if A then B", #36 modus ponens vs affirming the consequent.

## Engine

1. **`equation_steps` glyphs carried no TeX chain**, so `highlight.part` on a
   step silently lit the whole step (lint warned, but only the examples gate
   would ever see it). Fixed: the template sets `glyph.tex = o.token.chain`
   like `layout/math.ts`. The formula template is where the model sends every
   formula request, so this was the main place `part` did not work.
2. **`part` matches only a whole MathJax subtree.** `bx`, `-1`,
   `9\times10^{13}` and `P(A)` inside `P(B\mid A)\,P(A)` all miss: they are
   runs of SIBLING tokens, not nodes. That is exactly what a person or an LLM
   writes. Workaround used here: brace the term in the tex (`{P(A)}`) and name
   it braced. Better: let `findPart` match a contiguous run of sibling glyphs
   whose concatenated TeX equals the part (and treat `{X}` and `X` as one).
   Then the prompt's "the TeX of a term as its tex writes it" is simply true.
   **Half fixed**: `termTex` (math-morph.ts) now drops braces that wrap a
   whole term, for `colors` and `part` alike, since MathJax keeps a group's
   braces in its chain (an exponent is `{t/t_{1/2}}`). Sibling runs still
   miss.
3. **A domain that does not start at 0 misbehaves.** With `domain.x: [10,
   100]`, a point `at: {x: 10, on: …}` did not resolve (no box) and its label
   drifted to mid-canvas. The old inverse-square example hid the same problem
   by remapping the curve (`10000/((10+0.9*x)^2)`). Workaround: domain from
   0, and `x_from: 10` on the curve.
4. **A label's `side` is ignored when the solver can't fit it**, and the
   solver's choice then lands on the y-axis stroke, which lint blames on the
   author ("move it to a different side"). Every side gave the same position.
   The solver should count axis strokes as obstacles, or lint should not
   report a placement the author did not choose.

5. **A colour key must match before AND after a morph.** Euler's
   `e^{i\theta}=…` morphing to `e^{i\pi}+1=0` fails the gate because the
   `\theta` colour "matches nothing" after the morph. A morph that
   substitutes a term is the whole point of a derivation, so a key that
   matched at some stage should not warn at a later one.
6. **The caption band covers the bottom ~15% while narration shows** (see
   NOTES 2026-09-20). Lint doesn't know, so an example can pass the gate with
   its punchline under the captions (the quadratic's general formula at
   y 110). Lint should warn when a meaningful element sits below about y 140.

## Feature ideas

1. **A derivation as a structure.** Each worked line costs three commands
   (`copy`, `move`, `morph`); the quadratic's four lines took twelve. A
   `math` element with `steps: [...]` (or `derive: true`), where each step is
   one beat and the next line lands below the last by itself, would make a
   derivation as easy to write as `walk: true` made a gallery. It would also
   remove the most error-prone arithmetic an LLM does here: the per-line
   offsets.
2. **The frame harness shows only first ink and the end** for a figure with
   no animate. The middle of a derivation, where layouts break, is never
   shown. It needs an option to show every draw beat.

3. **Axes that cross at the origin.** `axes` always sits at the plot box's
   bottom-left corner. With a domain that spans zero (the complex plane, the
   unit circle, any signed quantity) the axes miss the origin, and a circle
   centred on (0,0) floats beside them. The existing "Why do cos and sin draw
   a circle?" example has exactly this. Workaround in Euler: two arrows
   through the origin. Better: `axes` crosses at 0 on its own whenever the
   domain contains it (the maths convention), with `"at": "corner"` to
   opt out.

4. **The frame harness can show a stale example.** After `examples.json`
   changes, a plain reload of `frames.html?index=N` can serve the cached
   module. Add a cache-busting parameter (`&nocache=<time>`) or make the
   harness fetch the file itself.

5. **The question under the heading.** Hans asks for the opening to say
   what the drawcast is about, and "can even draw this". The default card
   is a heading only; a short `subtitle` under it (the question, in the
   hand, smaller) would make the topic visible for the whole cast, not just
   spoken once. (The `style: "center"` card already has a subtitle; the top
   heading does not.) Hans: not now, maybe later.
6. **`equation_steps` `size` (built, opt-in).** Default 30 is unchanged;
   `size: 40–48` for a derivation that is the whole figure, with notes and
   gaps scaled and all steps shifted left together when a wide step's note
   would otherwise be pushed onto the formula (it did at 44, and lint did
   not see it — glyph/text overlap inside a template goes unlinted).
   Awaiting Hans's call on whether the examples should use it.

7. **Zoom to the detail a sentence is about.** Batch 2 used `camera` zooms
   by hand (the hole on the number line, the lone pairs) because the
   template drew the detail too small. Like `walk: "zoom"`, a `highlight` on
   a target smaller than some fraction of the canvas could frame it on its
   own, so the author never writes the camera move.
8. **The frame harness only shows resting frames**, so camera zooms (and
   anything else between animates) are never seen. Showing every narrated
   beat would catch them. (Also: screenshots are written a moment after the
   tool returns, so read after a short pause, and use a new file name per
   shot.)

## Small fixes applied after batch 2

- `plot3d`: set ids `axes` and `surface` (no more 24-id draw lists); its
  element list now says one of surface / curve / points is drawn.
- `molecule_3d`: set id `molecule`; the playlist-for-a-second-angle advice
  removed; the model drawn 25 % larger and 60 higher; the caption is fixed
  text above the narration band (the label solver slid it into the band).
- `ring_molecule`: `ring_center` removed from the element list (it was an
  anchor no gesture could find); `ring` documents that its centre is the
  gesture target; ring and name moved up out of the band.
- `free_body`: arrow length proportional to magnitude (was 95 + 150·m, so a
  component looked nearly as big as its force); the incline 50 higher.
- A `colors` key is only checked against the element's own `tex`, not
  after a morph that substitutes the term (Euler's θ → π keeps its colour).
- Prompt pin +50 (the catalog's ring_molecule entry).

## Round 3 lessons (from the agents' reports and the screenshots)

- **The Node gate never linted the end state of an animated template param**
  (only `stage` and vars), so the old AD–AS example ended with its E label on
  the guides and passed. Fixed: a test lays out every param state an animate
  reaches and demands no lint issue at all. It found three more existing
  examples (#87 sampling_dist, #188 bicycle_drivetrain, #273 supply_demand),
  listed as pending in the test until their batch.
- **The browser lint and the Node lint disagree** (real vs heuristic text
  metrics): only the frames harness saw several collisions. The screenshot
  script flags any frame not "lint clean".
- **ad_as**: the shift arrow started AT the equilibrium (the curve's middle
  sample), leaving E's label nowhere to go but onto its guides. Fixed: the
  arrow starts 72 % along the curve; E's label sits above.
- **`attach_to` cannot name a template's group ids or group members**, and
  many template group members cannot be drawn on their own
  (reaction_scheme's `reactants_0`…). An LLM will reach for both.
- **An `annotation` on its own target linted as an overlap** (a cross over a
  formula). **Fixed**: an annotation and its targets count as one
  composition in layout.ts (tests/annotation.test.ts).
- **`point.at` takes an object, not `[x, y]`**, while the neighbouring point
  schema advertises `[x, y]`. **Fixed**: its own description says so.
- **Template gaps**: decision_tree has no expected value at chance nodes
  (the fold-back is its whole point; `rollback: true`), no payoff units, and
  a default layout into the caption band (**fixed**: margins 95/150);
  qaly_profiles has no x_min and no totals; cost_effectiveness_plane puts
  quadrant captions where a steep threshold exits, never shows the WTP
  amount, rescales axes when a point animates; supply_demand / ad_as shift
  arrows are not horizontal at the old price, labels P*′/Q*′ are fixed text,
  no ticks; firm_cost_curves has no competitive-outcome marker;
  indifference_budget strokes have no path anchors; protein_secondary and
  dna_helix cannot show their mechanism (bonds i→i+4; letters on rungs,
  unzip); cell_diagram fills the canvas to y ≈ 95.
- **Chart floors at y ≈ 95** (every axes template) put the x-axis and the
  lowest part of every curve in the caption band (NOTES 2026-09-20). A shared
  plot floor at ≈ 150 would end it — a major item.
- **A template `title` param and the card both draw a heading.** **Fixed**
  in the prompt's card rule (leave a template's title unset).
- **Parallel agents in worktrees work**: the symlinked node_modules needs a
  vitest config with `server.fs.allow` on the main repo; one shared browser
  cannot serve several agents, so the reviewer screenshots headlessly.

## Round 4 lessons

- **Templates taught wrong science through their own defaults and manifest
  examples** (which the catalog feeds to the model): `pathway` defaulted to
  "EGFR → RAS → ERK; p53 ⊣ cell cycle", `membrane_bilayer`'s example sent O₂
  through a channel, `phylo_tree` defaulted to an unresolved root. **All
  three fixed.** A sweep of every manifest example for truth is worth doing.
- **Two templates rescale to fit on every frame** (`projectile_motion`,
  `ray_diagram`), so an animate that should show "goes less far" shows the
  same width; the old projectile example narrated a shrinking range over a
  picture that did not shrink. Descriptions now say so; the real fix is a
  fixed-scale option, or exposing the template's world→canvas map as a
  `domain` so freehand overlays line up without hand-computed numbers.
- **`highlight.part` / `colors` were whitespace-sensitive** (`\sin 2\theta`
  vs MathJax's `\sin2\theta`). **Fixed**: `termTex` ignores whitespace.
- **The script format lost an element whose id is a side word** (`right`),
  caught by the round-trip test. **Fixed**: lint rule `id-keyword` (the
  "lint §11" sugar.ts promised) warns on side/place-word ids; it found #267's
  `left`/`right` insets, renamed. `circle`, `mark`, `grid` round-trip fine.
- **`measure` labels don't read vars**, and a label without `{value}` gets
  the number glued on silently ("amplitude116"); the scale must be computed
  by hand as logical units per domain unit.
- **No double-headed arrow** in the schema.
- **Small template fixes applied**: punnett_square's parent-1 label off the
  header row; food_web producers out of the caption band; truth_table's
  `true_row_<r>` and `var_headers` documented.
- **Template gaps**: circuit_diagram's switch is always open while current
  flows; energy_diagram's Eₐ label crosses the catalysed hump;
  geometry_figure's C is fixed at 130° (no animatable position, no centre
  or radii ids); unit_circle and truth_table reach the caption band;
  argument_map cannot swap a premise; causal_dag and forest_plot draw small;
  distribution_curve has no `observed` marker and its labels sit far from
  the tails; two_by_two_table has no box or totals; pathway nodes are fixed
  width; food_web names over 10 characters overflow.
- **Leaving a template element undrawn does not keep it off the canvas**
  (the implicit final draw sweeps it in); `hide` before the card works but
  delays first ink.

## Round 5 lessons (20 examples: medicine, empirics, macro/games/HTA)

- **Factual errors in the old examples, corrected**: a small ECG square is
  0.04 s (the old one said a fifth of a second); the P wave is the signal
  spreading across the atria; "everyone had a hole before birth" is true of
  the atrial foramen ovale, not of the ventricular hole the figure drew.
- **`kit.jitter` was a sampled sine**, so "random" template variation drifted
  smoothly — atrial fibrillation looked like a slowing rhythm. **Fixed**: a
  hash.
- **game_tree** legend sat in the heading strip and the lowest leaf in the
  caption band. **Fixed**.
- **`id-keyword` widened**: flags (`flat`, `thin`, `steep`…) and colour words
  break the script round trip too (#76's `flat`, #66's `thin`). The agents'
  gate now includes tests/script-roundtrip.test.ts.
- **`highlight.part` after a morph** was checked against the pre-morph tex,
  punishing the derivation idiom. **Fixed**: a part found in a formula the
  target was morphed into earlier is accepted.
- **Heading overlap is not linted**: #68's lungs ran through the card heading
  and every lint passed. Caught by eye; the template got a `box`. **Fixed**: lint
  rule `heading-intrusion` reports any leaf that rises above the top
  heading's underline within its width (tests/heading-intrusion.test.ts).
- **`params.box` is the general fix for a template that strays** into the
  band or heading (heart_circulation, screening_timeline, rd_plot) — but
  freehand overlays at fixed coordinates don't follow it.
- **Template gaps**: ecg_strip has no ids for single beats, PR or R–R spans
  (marks need hand-computed coordinates); heart_circulation has no atrial
  defect option; neuron's `myelinated` cannot animate and its synapse inset
  sits in the band; pv_loop's ESPVR caption and EDV tick collide under
  normal/raised values and the EDPVR stiffness is fixed; is_lm cannot animate
  a shift from 0 (labels collide at small shifts); tornado_diagram has no
  zero/threshold line; ceac curves are always 0→1 logistic (real asymptotes
  are P(ΔC<0) and P(ΔE>0)); solow_growth has no growth-over-time panel;
  event_study gives the reference period a whisker and pre_trend does not
  carry into the post period; did_trends has no non-parallel pre-trend knob;
  rd_plot has no density panel (the McCrary check); binscatter always draws
  20 bins and cannot show within-bin spread; lorenz_curve's curves can never
  cross (L = p^a) and it ignores `labels` without `compare_gini`.
- **The strike/cross overlap and the frames harness showing only resting
  frames** came up again in every group.


## Round 6 lessons (29 examples — the rest of August)

- **Fixed this round**: bayes_tree's punchline box (P(sick | positive)) sat
  in the caption band — rows tightened, box lifted to 152–230; #87's
  animate collision (n 4 → 8) and its PENDING entry removed; the frames
  harness no longer runs the draw-beat lint on posed frames (a label that a
  template drops at small h was reported although it was drawn while it
  existed — #211 was flagged for this).
- **Demonstration features kept**: #qa dialogue (#56), a two-quiz test with
  `wrong_goto` and `{score}` (#93), a click `ask` made a real choice with a
  decoy dot (#96), portrait cameos (#91, #92), a stored-name `ask` (#94),
  sound and the piano `ask` (#83, #97 — the third asked on a NEW root),
  links and YouTube sources (#104, #105, #107), a playlist with a portrait
  (#89).
- **Factual repairs**: Smith's pin figures (18 operations, "two or three"
  per man, under 20 pins alone); the prisoner's dilemma's escape via
  repetition (Axelrod); the SIR overshoot past herd immunity.
- **Engine**: a `text` in a laid-out group still needs x/y to validate
  (the prompt says unpositioned elements are placed); "present large, then
  `animate: {box}` to make room" is linted at the full-size state with the
  later elements present, so the idiom the prompt teaches fails the gate;
  arrows between stacked nodes cross the node text; a tier-2 `point` on a
  template page reads domain units where a `path` reads logical ones;
  labels on node outlines are not linted; an invalid label side ("top")
  crashes placeLabels instead of failing validation; curved edges' bulge
  side flips with from/to and their height cannot be set; `params.box`
  leaves freehand overlays unmoved (#87 needed a hand-measured transform —
  expose the fit transform); note_sheet's `sound: true` is silently
  switched off by any hand-written `play` with press/reveal.
- **Templates**: sampling_dist's ± label crosses the curve for most n, and
  it draws a perfect bell even at n = 1–2 (dishonest for #95's "pick your
  n"); ci_dance's width ignores `confidence` and its caption sits at y 62;
  galton_board's ball path is fixed by the jitter hash (undocumented);
  sir_compartments has no epidemic curve (waning, herd immunity and
  overshoot need I(t) — drawn by hand from a simulation); nephron draws
  small; wave_diagram has no sum curve; tangent_secant's text shrinks with
  `box`; note_sheet cannot mark a key persistently; ppf has no intercept
  units; payoff_matrix draws small and its best-reply marks have no ids;
  two_by_two_table has no derived column.
- **Prompt**: the source rule says "exactly ONE reference", but #101 carries
  `of` and `url` and works — the rule and the exemplar disagree.

## Round 7 lessons (September examples: anatomy, space, chess/puzzles, code-fed charts, bar charts)

- **Fixed this round**: anatomy's default frame (y 150–685); solar_system
  row labels reserve 12 % more width (the heuristic under-measures real
  glyphs, so neighbours overlapped only in the browser); lint ignores
  empty-text labels (tictactoe's blank cells); heading-intrusion only
  counts what is on screen with the heading.
- **Code-fed examples are never laid out by the Node gate** (token-fed
  params stay unresolved there), so their real charts — end-name
  collisions, the real y-range, overlap with the code panel — are only
  seen in the browser harness, which does run Pyodide/webR. A code mark
  fails when the panel wraps its line; the warning should say "wrapped".
- **A template's fixed geometry blocks `box`** when widgets depend on it:
  chess_board's 620-unit board puts ranks 1–2 under the captions, but the
  chess ask and free play click fixed squares (widgets.ts CH_X0/CH_Y0), so
  a fitted board would break clicking. Widgets should read the fitted
  geometry.
- **`params.box` scales the template but not the author's numbers**:
  `move.by` on template parts (Hanoi's disks) and overlays at fixed
  coordinates must be multiplied by the fit scale by hand. Exposing the
  fit transform (or template-coordinate `at`) is the fix — the third round
  running this came up.
- **Templates without an animatable state cannot show a worked solution**:
  tower_of_hanoi and tictactoe hold strings (`pegs`, `board`), so an
  optimal solution or a sample game is hand-placed moves or a second,
  freehand board. A `step`/`stage` param that plays the solution would make
  it one animate.
- **Group members advertised as ids are not addressable**: morse_key's
  `chart_<letter>` (and earlier reaction_scheme's members) report "unknown
  id" to highlight/focus. Either the engine resolves template group members
  or the manifests stop listing them.
- **Anatomy**: labels under `focus` go through the ordinary solver and
  collide (only the browser saw it); whole-body figures leave organs a speck
  (a "trunk" crop is needed); the spleen is drawn dashed with the
  retroperitoneal organs although it is intraperitoneal — examples correct
  it in narration; no ids for sub-parts (thumb, scaphoid, heart apex); a
  typed `ask` cannot accept alternative answers ("femur" / "os femoris").
- **Space**: sky_map's compass N reaches the heading; `mark` works only with
  constellation lines on; `place_label` shows local mean solar time (20:43
  for 22:00 CEST) — narration giving clock time contradicts it; bodies that
  rise during an animate pop in via the implicit final draw; solar_system
  cannot mark a zone (frost line, habitable zone) — `marks: [{at_au}]`.
- **Charts**: line_chart has no reference-line style (a threshold drawn as
  a data series) and no log scale; line_chart/scatter_plot have no
  per-point ids, so the peak or the Anscombe outlier cannot be pointed at.

## Round 8 lessons (42 examples: code in five runtimes, the C64, Norwegian school maths)

- **Fixed this round**: multi-figure code slides get an opaque ground, so a
  later figure covers the earlier one (transparent PNGs showed both sets of
  axes); the code-split figure band is y 160–640 (was 95–655: floor in the
  captions, y caption against the heading); the examples gate now also
  demands no layout WARNINGS at rest (tests/molecule3d.test.ts checked them
  and the gate did not — a code mark on a wrapped line passed one and
  failed the other); two marks shortened so they stay on one wrapped
  segment; #155 kept byte-identical with docs/demos/frames.yaml (a test
  enforces it — the brief now needs to say so).
- **Code panels grow with their output** (figures, long logs) to nearly the
  full canvas height, whatever width/y is given, and the Node gate never
  runs the script, so it sees a short panel: the grown panel covers the
  card heading and puts code lines under the captions, unlinted. A height
  cap, or heading-intrusion over code chrome at browser time, would fix it.
- **Runtime notes for the prompt**: Brython needs `plt.show()` per stage for
  multiple figures; `plt.hist(bins=…)` becomes plotly `nbinsx` (a maximum);
  MicroPython dicts do not keep order — suggest `pd.DataFrame(rows,
  columns=[…])`; `<id>_out` still holds stdout in figures mode but has no beat
  of its own; DataFrame headers are cut to the value width; the BASIC
  interpreter cannot mix immediate and numbered lines in one element.
- **Geometry engine**: an `angle` turned by `move.rotate` turns its degree
  text upside down (the prompt says text never rotates); labels and
  measures are linted at their pre-move/pre-morph positions for the whole
  cast (a later-moving label collides with things never on screen with
  it); a measure on a polygon misreads mid-morph; a measure scaled by
  `move.scale` scales its offset too; an area measure's label sits at the
  box centre (on a right triangle's hypotenuse); `copy` cannot copy a
  ghost, and copies lose polygon anchors; labels attached to sector pieces
  pile up after `arrange fan`; a label's own shape is not an obstacle, so
  `side: "above"` on a wide polygon lands inside it; `measure` prints a
  decimal point in Norwegian casts ("8.7" while the voice says "8,7") and
  defaults to one decimal; `pieces` share one fill (no alternating slices);
  `halving`'s rest piece cannot be styled as the hole; `animate.trail` does
  not work in the Node gate and is lost by the script round trip, and a
  nested group's members come back reordered.
- **A structural idiom worth teaching**: bind polygon vertices to a var
  (`bind: {"points.2.0": …}`) with a live `measure`, and the area stays
  fixed while the shape shears — #205 and #209 use it; the prompt could.
- **Topic overlap is a real risk in big batches**: several agents found
  neighbouring examples on the same idea (compounding ×4, shear ×2,
  doubling ×2) and gave each a different mechanism. A bundled set should
  not teach the same point twice.

## Round 9 lessons (37 examples: data charts, HTA/econ, sky maps, school physics and anatomy)

- **Fixed this round**: heatmap cut its widest row name ("Income" → "Inco…",
  "Blood pressu…") in a lane sized for exactly that name — floating-point
  arithmetic on the lane's edges left it a hair short; `fitText` now has half
  a unit of slack (tests/heatmap-names.test.ts). The top heading's push-in
  started at 1.8× whatever the title's length, so a 34-character title ran off
  both sides of the first frame; `headingZoom` now picks the zoom that keeps
  the words in view (13 bundled titles start wider). #273 left the
  PENDING_ANIMATE_LINT set, which is now empty: its elasticities were chosen
  so every animated state lints clean, and `label_wedge` is erased before the
  second animate.
- **Default template frames leave the free band** (the fifth round running):
  bicycle_drivetrain (ratio caption y 46), hydraulic_press (ground y 105,
  equations y 681), violin_anatomy, water_cycle, flower_anatomy and sky_map's
  focus portrait (y 80–700) all needed `params.box`; bar_race has no box at
  all, so a vertical race's axis caption sits in the heading and #143 dropped
  its `x_label`; forest_plot, ceac and survival_curve keep their axes at y ≈
  110–130, where the captions cover them. This is the "templates should fit
  y 150–690 by default" major item — `kit.plotArea` and the shared frames.
- **The Node gate lays out token-fed templates at placeholder values** (ceac
  midpoint 30, event_study effect +1, scatter y = 0): data-dependent ids are
  "not drawn" (survival_curve `median_line`), labels collide with a
  placeholder fit caption, and freehand overlays cannot sit next to the real
  geometry. Only the browser harness sees the real figure. The gate should
  resolve tokens (run the script in Node where it can) or skip checks that
  depend on data.
- **Templates that cannot draw the true data**: did_trends always puts the
  treated group above a rising control, so Card and Krueger's real numbers
  (New Jersey below Pennsylvania, Pennsylvania falling) needed a line_chart
  slope chart; ceac is always a logistic 0→1; forest_plot has one pooled
  diamond (fixed vs random effects needs a second, hand-placed);
  distribution_curve cannot mark a second cutoff; line_chart's slope columns
  cannot change label per stage; bar_race interpolates linearly, so an
  overtake between decade stages is drawn years early (narration must not
  date it).
- **sky_map**: focus portraits draw small figures small (zoomMax 6 — the W is
  a quarter of the frame; a camera zoom rescued it); unmentioned parts
  (planets in the crop, the chart's `stars`, constellation names) are swept
  in by the final implicit draw; the connect lint rejects "turn the sky, then
  ask" unless the figure is drawn again after the animate (honest, but the
  prompt should say it); a portrait "upright" on the chart is upside down to
  someone facing north.
- **Engine**: a `label` attached to a polygon lands inside it (a label's own
  shape is not an obstacle — third report); a `point` with `at: {x, y}` on a
  template page reads domain units; an `annotation` box round two lines of a
  boxed template overlaps the neighbour when box compresses line spacing;
  heatmap nulls pop at the end of a tween instead of fading.
- **Drawcasts**: a quiz question over ~12 words makes a three-line caption
  that covers low template text; card titles over ~30 characters are long
  for the heading even with the new zoom. Topic overlap again: four data
  examples used a scatter with a fit, three on the same hours-vs-score data,
  and each got a distinct reading (scale, spread vs effect, sampling noise
  in r, extrapolation, R²).
- **Process**: two tests pin examples by their text (`/five urns/`, a
  `label_top` example must say "name"/"label"), so renaming a request can fail
  an unrelated test; apply.cjs cannot follow a request renamed twice. Both go
  in the brief.

## Hans's feedback on the pilot (2026-09-25)

- Better. But openings still jump in without saying what the drawcast is
  about: fixed in all eight (the first line names the question), and in the
  prompt's opening rule.
- Both `wrong` and `right` were narrated after a wrong answer, and in the
  eight they were the same sentence: `wrong` removed from them, the player
  skips a `wrong` identical to the reveal, and the prompt's quiz rule says
  `wrong` is a hint, never the answer again.
- Size: shown E = mc² at 30 vs 44 (`size` param, opt-in); undecided.

## Template improvements

**The main finding of batch 2: several templates draw at a fixed small
scale.** `equation_steps` (size 30), `lewis_dot` (geometry hard-coded at about
±110 units), `number_line` (a thin strip, small numerals), `plot3d` (190 units
per reach, whatever the camera distance), `molecule_3d` and `ring_molecule`
all leave most of the canvas empty. The thing the explanation is about (a
lone pair, the hole at 1, the saddle) ends up a speck. The examples work
around it with camera zooms, which is a patch. One rule for all of them
would fix it: fit the figure to the free band (about y 150–690, clear of
the heading and the caption band), the way freehand `fit` already does.

- **Template docs promise ids that don't exist.** `ring_molecule` lists
  `ring_center` "for gestures", but it is a layout anchor, so `point` can't
  find it. `plot3d` lists `pt_<i>`, but draws only one of surface, curve or
  points ("surface wins"), which the element list doesn't say. An LLM reads
  these lists as a contract. Test idea: for each template, lay out its
  manifest examples and check that every documented id pattern appears in
  at least one of them.
- **plot3d**: allow points (and a curve) on top of a surface. Marking the
  saddle point or tracing a path over a surface is the natural teaching move,
  and today it's impossible.
- **venn_diagram**: the shading is "approximate": small blobs inside each
  region, not the region filled. "Or = everything shaded" can't be shown.
  Regions need exact shading (clip the circles).
- **free_body**: arrows have a minimum length (lowering `magnitude` below
  about 0.5 changes nothing), and the incline sits low, so a downward
  force's label (gravity's `mg`) lands in the caption band.
- **Built-in captions at the bottom** (`ring_molecule`'s `name`,
  `molecule_3d`'s caption) sit under the narration band for the whole cast.
  Either place them above the band or leave the caption to the cast.


- **equation_steps**: glyphs now carry their TeX (fixed). Still missing:
  (a) steps that *morph* from one to the next, since a derivation is where
  the formula-morph shines and this template only stacks lines; (b) more than
  4 steps; (c) a note can only restate, and there is no way to point from a
  note to the term it explains. With `math` + a derivation structure (feature
  idea 1) the template might not need to exist.
- **molecule_3d**: a set id (`molecule`) so `draw` needs no 16-id list; drop
  "a playlist can show a second angle" from the description now that
  `animate {azimuth}` exists; maybe `orbit: true` as an intrinsic slow
  turn while the narration runs.
- **molecule_3d (seen in the frames)**: the molecule fills perhaps a
  fifth of the canvas, and its own caption line sits at the very bottom,
  under the narration band for the whole cast. The caption belongs above the
  band (or it should become a label the cast draws where it wants), and the
  molecule should be fitted larger.
- **generic_axes_diagram**: the old inverse-square example remapped its
  curve (`10000/((10+0.9*x)^2)`) to fake an axis starting at 10. Axis ranges
  that don't start at zero should be a parameter, not arithmetic in the
  expression.
- **axes (element)**: cross at the origin when the domain spans zero
  (feature idea 3).

## Prompt and manifests

1. **`molecule_3d`'s description still offers "a playlist … from a second
   angle"** for a walk-around, beside the `animate {azimuth}` sentence. The
   bundled methane example taught the playlist way, with every bond half
   listed in three 20-id `draw` lists. One animate does it; the description
   should drop the playlist suggestion.
2. **Templates without a set id force long draw lists** (molecule_3d:
   `bond_1, bond_1__f, …`). The prompt already describes set ids ("a chess
   board's `position`"); templates whose parts are always drawn together
   should offer one.

## The drawcasts themselves

1. **The old openings announce instead of hooking**: "Let's derive…",
   "Let's unpack…", then a bare `draw: [title]` with its own sentence. Now a
   `card` (no speak) followed by the hook riding the first ink.
2. **Notes that restate the step** ("Solve for x.") add nothing; a note that
   says what the step MEANS ("A root has two signs.") earns its place.
3. **The end is a quiz that checks the insight**, and a good one targets a
   likely misconception (E = mc²: "four times as much?").

4. **A long line of narration becomes a four-line caption band** that
   hides the lower third of the figure (methane's animate line, about 40
   words). The lints count consecutive speak-only beats, not the length of
   one line. A per-line word cap in lint (about 30 words, the point where
   the caption reaches three lines) would catch it, and splitting the fact
   onto its own beat reads better anyway. Measured: 157 of the 1,775 spoken
   lines in single-page examples (in 75 examples) are over 30 words.

## General approach

1. **Structure over commands.** "Equation, then its plot" was split across
   two playlist pages, and "walk around the molecule" across three. Both are
   one page now: a formula beside its curve with a var, and one `animate`.
   Each time a feature made a property intrinsic (`walk`, animated params,
   set ids), an old example shrank. Old examples with long lists of
   near-identical commands are where to look for the next intrinsic
   property.
