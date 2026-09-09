# Freehand figures — smoke checklist

As in the earlier rounds, this is a document to follow by hand on the dev
server (`npm run dev` in the worktree, then the sidebar's Examples list),
not a script — the repo has no Playwright dependency. Node tests cover the
layout, planner and lint of every new verb; these steps cover what only a
browser shows: a thing's parts actually reading as one figure, a formula
sitting next to a curve as handwriting, a real photo fading in with its
credit, the freehand-first offer on a fresh request, and the visual repair
round. The sidebar's Examples list merges the prompt's few-shots with the
bundled examples (`src/main.ts`'s `examples` array), so the two few-shot
titles below are loadable buttons exactly like the bundled ones.

Each step names the Examples-list item by the text printed on its button
(the spec's `title`, or the few-shot's `spec.title` when it has no
top-level one) and gives an explicit "Expect:" paragraph.

## 1. "Inside a bicycle pump" — a thing as named parts

Load **"Inside a bicycle pump"** (a few-shot, request "How does a bicycle
pump push air into a tyre?") and let it run.

Expect: the cylinder (`body`) and the whole plunger — piston, rod, handle,
grouped as one — sit together as ONE thing occupying the left half of the
canvas (the outer group `pumpe` has `fit: "left"`), with a smooth hose
curving down-right to a small valve circle. The opening beat draws the
whole thing plus three labels — "Cylinder", "Piston", "One-way valve" —
before anything moves. Next the piston glows (`highlight`). Then the
plunger — piston, rod and handle together, not the piston alone — slides
down to the cylinder's centre as a single rigid move (nothing shears or
detaches). The valve is circled, then pulses. Nothing in the figure was
placed by hand-computed coordinates: only `body` has absolute geometry: the
piston sits on the body's `top` anchor, the rod on the piston's `top`, the
handle on the rod's `top`, the hose off the body's `bottom_right`, the valve
off the hose's `end`.

## 2. Same figure — the "Find the part" drill (⊕)

With "Inside a bicycle pump" still open (paused, after it has drawn),
open the **⊕** tray ("Explore this figure").

Expect: a **"🎯 Find the part"** pill (the generic identify drill — this
figure declares no bespoke interaction, so it falls through to the parts
drill because it has named parts). Start it: the three labelled parts —
Cylinder, Piston, One-way valve — hide their printed names, and you are
asked three questions, one per part ("Click: Cylinder", etc. — three, not
the usual five, because the figure has exactly three named parts, the
drill's own minimum). `rod` and `handle` are drawn but never asked for —
they carry no label, so they are not named parts. Clicking the right shape
answers correctly even with its label hidden; clicking the wrong one does
not.

## 3. "How far a dropped ball has fallen" — a formula beside the curve

Load **"How far a dropped ball has fallen"** (a few-shot, request "Why does
a dropped ball speed up? Show the equations with the curve.") and let it
run to the end.

Expect: after the falling curve is drawn and the dashed steady-speed line
erased, a point and a dashed tangent line appear on the curve, together
with a small handwritten `v = gt` (`label.tex`, attached to the point,
below-right of it) — the equation for the CURVE, sitting on it rather than
off in a corner. The next beat draws a larger handwritten `s = \tfrac{1}{2}
g t^2` (a `math` element, `at`-placed above-left of that same point) — the
formula lives where the derivation happened, not at a fixed offset from the
canvas edge. Both render as MathJax handwriting (the sketchy hand-drawn
look), not typeset text.

## 4. "The wind curve" — a real photo, its credit, and export

Load **"The wind curve"** (bundled, request "Why is the Eiffel Tower shaped
like that?") and let it run to the photo beat.

Expect: the tower's two curved legs and three decks are drawn and fitted
into the left half of the canvas (`group tarn`, `fit: "left"`) before the
photo appears; the photo (a real embedded Commons thumbnail, not a
placeholder) then fades in on the right, and underneath it a small credit
line reads **"Benh LIEU SONG · Public domain"** — drawn under the photo,
not just recorded in the spec. Pause and open the **⋯** overflow menu on
the player bar: a **Credits** item is present (folded there because no
compact icon fits a multi-line attribution list). Export this drawcast to
video: alongside the video file, a `<name>.credits.txt` downloads
containing that same credit line.

## 5. "Symaskinen: to tråder, én knute" — `group.fit`

Load **"Symaskinen: to tråder, én knute"** (bundled, request "Hva er
delene i en symaskin, og hva gjør de?").

Expect: six parts (bord/søyle/arm/trykkfot/spole/håndhjul) plus the needle
and thread paths draw at their own hand-authored sizes, then the whole
`maskin` group is scaled and centred to sit inside the LEFT half of the
canvas as one occupant — not spilling into the right half, not shrunk to a
sliver. Four labels — Nål, Trykkfot, Spole, Håndhjul — sit beside their
(now scaled-down) parts, at full, readable size, not shrunk with the
geometry. (This example's labels are attached via `attach_to`, not listed
as `group` members — no bundled example puts a label INSIDE a fit group
yet, so it cannot show Task 8's separate ruling that a label/annotation
MEMBER of a fitted group also keeps its authored font size; that ruling is
covered by a node test only, not by this checklist.)

## 6. A fresh request — freehand-first and Templates on demand

There is no Settings control for this. In the editor, open the **"…"**
choices row next to Generate and find the checkbox labelled **"Author
templates when none fits"** ("Templates on demand" is only the summary
that shows in the "…" button's tooltip, not a label anywhere in the UI).
Whether this checkbox is on or off makes NO difference to what follows —
it only gates course/multi-part runs (`src/llm/multi.ts:241`), and a single
figure never reads it. Leave it either way and generate a fresh request:
`hvordan virker en sykkelpumpe`.

Expect: no scene template exists for a bicycle pump, so the figure is
drawn freehand and generation does not wait ~4 minutes. The status area
shows **"No scene template draws this figure, so it was drawn freehand."**
with an action button **"Author a template and redraw (~4 min)"** — offered,
never taken automatically, because a single freehand figure never
auto-authors (that only fires when a second freehand part in the same
course lands on the same on-demand brief) and, again, regardless of the
"Author templates when none fits" checkbox above. Do NOT click the button
for this check.

Icon seeding is automatic (no separate toggle) — every generation tries to
resolve the request's subject to an Iconify icon and, when it succeeds, the
round's status text gains a `" · seeded from <set>"` suffix (`main.ts`
line ~3216). This used to be invisible for exactly this case — a figure
that is BOTH seeded AND freehand-worthy, which is the common case, since a
seed only matters when there is no template to fall back on — because the
suffix and the "drawn freehand" message were written to the same status
line one right after the other with no render in between. FIXED in the
final fix wave (B4): the suffix is built once and appended to BOTH lines.

So expect, when the pump seeds successfully: **"No scene template draws
this figure, so it was drawn freehand. · seeded from <set>"** with the
Author-a-template button beside it. A seed can legitimately fail to
resolve (no icon matches, or the only match is share-alike, which is never
picked unattended) — then there is no suffix, and that is not a failure
either. `logOutcome` now records `seeded` on the log entry as well.

## 7. Settings → Advanced → Visual repair

Open **Settings → Advanced**, turn on **Visual repair**, and regenerate any
request (a fresh one, or one from the steps above).

Expect: one extra round beyond the usual ones, and the figure is not worse
than without it (no lint newly broken, nothing missing). While that round
runs, the status line should read **"looking at the drawing"** — the
"visual" case landed in the final fix wave (B5); before it, the round was
misreported as "repair N".

## 8. «Vegg er voks» — the credits file after an export

Load **«Vegg er voks»** (bundled, request "Hvorfor har en bikube
sekskanter? Vis et ekte bilde og skissen.") and export it to video
(**Share → Video → Export**).

Expect: three files download — `<name>.webm`, `<name>.vtt`, and
`<name>.credits.txt`. Open the credits file: it must contain the
honeycomb photo's Commons credit line (photographer · licence), the same
line drawn under the photo on the canvas. Before the final fix wave this
file was EMPTY (or absent) for a freshly generated figure, because the
credits were read off the unresolved document rather than the resolved
export (A3) — an empty or missing credits file is a failure of this step.

No bundled example uses an `icon` element yet, so the icon credit line
cannot be shown here; the same collector handles it (see
`tests/credits.test.ts`). If you generate a figure that seeds from an
Iconify set, its `based on …` line belongs in this file too — worth a
glance if you happen to have one open.

---

Eval-promoted examples (Part C, Hans's 2026-09-09 ruling — up to three of
the eval's generated specs promoted into `src/examples.json` after
hand-fixing; strike whichever of the steps above they make redundant):

| Example (list title) | Request | Source run |
| --- | --- | --- |
| **Fasaden er salen sett utenfra** (#223) | Hvordan ser Stortinget ut, og hvorfor er det bygget slik? | after-eval **seed OFF**, case 12 (image) |
| **Årene står i eksponenten** (#224) | Hvorfor blir renters rente så stor? Vis formelen ved kurven. | after-eval **seed ON**, case 6 (math) |
| **Vegg er voks** (#225) | Hvorfor har en bikube sekskanter? Vis et ekte bilde og skissen. | after-eval **seed OFF**, case 10 (image) |

**#200 (old beehive) vs #225 «Vegg er voks»: keep one — your call.** Both
answer "why hexagons in a beehive"; #200 proves the tiling, #225 shows a
real photo beside the sketch. Nothing in the code needs both.

Delete any screenshot or downloaded `.webm`/`.credits.txt` from the
worktree root before a commit or merge.
