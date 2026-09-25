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
