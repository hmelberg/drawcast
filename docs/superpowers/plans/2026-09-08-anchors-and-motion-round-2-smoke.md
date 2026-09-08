# Anchors and motion round 2 — smoke checklist

As in the space rounds, this is a document to follow by hand on the dev
server (`npm run dev` in the worktree, then the sidebar's Examples list),
not a script: the repo has no Playwright dependency and Hans's standing
preference is to keep browser automation light. Each step names the
Examples-list item by the text printed on its button (the spec's `title`).
Node tests cover the geometry and the plans; these steps cover the four
runtime seams no node test reaches — a flip mid-tween, a morph mid-tween,
the flow overlay, a trail under a rolling wheel — plus the two templates
under `animate`.

## 1. Sykloiden — the trail and the roll

Load **"Sykloiden"** and let the second beat run (four seconds, linear).

Expect: the wheel rolls to the right without swinging — its centre moves
on a straight line — and the spoke turns once. A red line grows behind the
red dot as it goes, in step with the dot (the pen tip is never ahead of or
behind the dot). The finished arch starts and ends on the floor line and
peaks at the wheel's diameter above it. On the third beat the arch glows
(the trail is an element `prikk_trail` — it traces the red dot's centre).

Scrub back to the start: the trail vanishes. Scrub to the end: the whole
arch is there, fully drawn.

## 2. Speiling — the flip

Load **"Speiling"** and let it reach the fourth beat (the flip).

Expect: the yellow triangle squashes flat onto the dashed axis and grows
back on the other side, mirrored — its apex, which pointed down-left,
now points down-right. The grey dashed ghost stays where the triangle was.
The next beat writes A, B and C at the mirrored corners (A furthest
right, B nearest the axis) and the laser circles the new B. The beat
after that flips the triangle about a horizontal line through its own
centre: it squashes to a horizontal line and re-opens upside down — and
the closing beat dims those three mirrored letters to 0.3, since the
triangle has left them behind.

Sketchy style: the flipped triangle keeps its hand-drawn look (no
unfilled or double-drawn outline).

## 3. Skjæring bevarer areal — the morph

Load **"Skjæring bevarer areal"** and let the third beat run.

Expect: the green parallelogram slides its top edge left over two seconds
and lands exactly on the dashed rectangle — no twist, no corner crossing.
The fourth beat stretches the rectangle to twice its width, anchored on
its left edge (the left edge does not move).

Scrub back before the morph: the parallelogram is back. Scrub past the
end: the wide rectangle is there. Sketchy style: the morphing outline
does not flicker between two roughenings.

## 4. Det økonomiske kretsløpet — the flow

Load **"Det økonomiske kretsløpet"** and let the fourth beat play.

Expect: blue dots stream along the upper arrow from Bedrifter to
Husholdninger and red dots along the lower arrow the other way, for as
long as the sentence lasts; they fade in and out rather than appearing
and vanishing. The fifth beat streams grey dots along the lower arrow
only, slowly. Nothing remains on the arrows after each beat.

Scrub while a flow runs: the dots disappear at once.

## 5. Vektorsum: hale mot spiss — anchors

Load **"Vektorsum: hale mot spiss"**.

Expect: on the third beat the blue arrow slides so its tail sits exactly
on the red arrow's tip; its label "b" travels with it. The violet sum
arrow drawn next ends exactly at the blue tip, and the laser circles that
tip.

## 6. Trekant = halvt parallellogram — a pivot by name

Load **"Trekant = halvt parallellogram"**.

Expect: the green copy turns half a turn about the midpoint of the
triangle's slanted right side and lands so the two triangles form the
red-outlined parallelogram exactly, no gap and no overlap.

## 7. The two templates under animate

Load **"Integralet: summen av tynne søyler"**. Expect: four blue bars
under the red curve on [2, 8]; on the animate beat they thin to forty
while the "Σ ≈" number climbs toward the "∫ ≈" number; the two texts
never overlap.

Load **"Den deriverte: stigningen i ett punkt"**. Expect: the secant
through A and B tips as B slides into A over four seconds; the "slope ≈"
number converges on the "f′(4) = 0.80" line; the Δx/Δy labels vanish once
the triangle is too small to carry them; the dashed tangent drawn next
lies along the settled secant.

## 8. Export

Export **"Sykloiden"** or **"Det økonomiske kretsløpet"** to video and
scrub the result: the trail (or the streaming dots) is in the movie.

Delete any screenshot from the worktree root (`rm -f *.png`) before a
commit or merge.
