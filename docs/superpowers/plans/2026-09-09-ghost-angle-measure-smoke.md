# Ghosts, angle, measure, more cuts (round 3) — smoke checklist

As in the earlier rounds, this is a document to follow by hand on the dev
server (`npm run dev` in the worktree, then the sidebar's Examples list),
not a script: the repo has no Playwright dependency and Hans's standing
preference is to keep browser automation light. Each step names the
Examples-list item by the text printed on its button (the spec's `title`).
Node tests cover the geometry, the plans and the player's step boundaries;
these steps cover the runtime seams no node test reaches — a ghost drawn
behind moving pieces, a measure's number changing mid-tween, an unroll
mid-morph — plus the seven examples end to end.

## 1. Hvorfor er arealet av en sirkel πr²? — the ghost

Load **"Hvorfor er arealet av en sirkel πr²?"** and let the zipper beat run
(four seconds).

Expect: as the sectors turn and slide into the zipper, a faded copy of the
divided circle (about 30 % opacity) stays where the circle was, behind the
moving pieces, and is still there when the zipper is complete. It appears
the moment the beat starts, not at its end. Scrub back before the beat: the
ghost is gone. Step forward again: it is back, complete, with no redraw
flicker of the pieces.

## 2. Sirkelen som ringer — rings unrolling with a ghost

Load **"Sirkelen som ringer"**.

Expect: eight concentric rings; on the unroll beat each ring straightens
into a horizontal strip of its own circumference, the strips stacking into
a staircase whose top edge is a straight slope, while the faded ring nest
stays behind. The radius is measured from the centre to the top of the
outer ring: the dimension line stands to the left of the nest, outside the
rings, and its label `r = 100` sits beside it without touching it. After
the unroll the longest strip's width is measured below it; its number is
589, the circumference at the outer ring's middle radius (2 π · 93.75).

## 3. Sekskanten som trekanter — the fan and the apothem

Load **"Sekskanten som trekanter"**.

Expect: the hexagon splits into six triangles from the centre; the apothem
is measured (`a = …`, about 121 for a radius of 140) beside its dimension
line, off the triangles' edges. On the zipper beat the triangles fold into
a parallelogram of height a, and the ghost hexagon remains behind.

## 4. Halvparten av resten — halving

Load **"Halvparten av resten"**.

Expect: a square halved again and again — left half, then top half of what
remains, then left again — each piece highlighted in turn with the running
sum in the narration, and the last small remainder highlighted at the end.
No piece overlaps another; every cut line coincides with an edge of the
previous piece.

## 5. Dobbel side, firedobbelt areal — the measure under scale

Load **"Dobbel side, firedobbelt areal"**.

Expect: a square with its side and its area measured. On the scale beat
the square doubles about its bottom-left corner while the faded original
stays inside it. During the tween the side's number climbs (200 → 400) and
the area's number climbs four times as fast (40 000 → 160 000); the side's
dimension line stretches with the square and its label slides with the
line, never crossing it. Scrub back: the numbers return to 200 and 40 000
exactly.

## 6. Ytre vinkel — angles that move

Load **"Ytre vinkel"**.

Expect: a triangle with its three angles drawn as arcs with degree labels
that sum to 180. On the move beats two of the angles travel to the vertex
of the exterior angle and fill it exactly, their ghosts left at the source
corners; the labels travel with the arcs. The exterior angle's own label
equals the sum of the two.

## 7. Ellipsen: to brennpunkter — the string

Load **"Ellipsen: to brennpunkter"**.

Expect: an ellipse with its two foci marked as points on the major axis
and a point at the bottom of the curve joined to both foci by two measured
segments, 300 and 300. On the move beat the point travels in a straight
line to the right end of the major axis; both segments and their numbers
follow it every frame, and they end at 540 and 60 — the sum is 600 (twice
the semi-major axis) at both ends. Scrub back: 300 and 300 again.

## 8. Console

At the end of every example: no red lines in the browser console, and the
status line shows the example's beat count with no warning badge.
