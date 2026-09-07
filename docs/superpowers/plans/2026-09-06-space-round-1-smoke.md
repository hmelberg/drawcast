# Space, round 1 — smoke checklist

This repo does not depend on Playwright, so this is a document to follow by
hand on the dev server, not a script. Run `npm run dev` in the `space`
worktree (Vite prints the URL, normally `http://localhost:5173/`) and drive
it in the visible Chrome. It plays sound — keep to the five steps below and
take at most two screenshots; delete any you save
(`rm -f *.png` in the worktree root) before anyone merges.

Every step names the sidebar Examples list item by the text that is
actually printed on its button (`ex.spec.title`), not the natural-language
request that produced it — the two differ for these examples (hovering the
button shows the request as a tooltip, if you want to cross-check).

## 1. "Find Mars" — the click-ask, and the engine's own chunk

Open the app. In the sidebar Examples list, click **"Find Mars"** and let it
play.

Expect: the Sun sketches as a shaded amber disc; eight dashed orbits appear;
the four rocky planets, then the four giants, appear as shaded discs — every
body at its real angle for 2026-09-06. The ask card then asks **"Which one is
Mars?"**. Click the fourth planet out from the Sun (Mars, on the orbit just
outside Earth's) — it glows and the reveal line is spoken.

Before clicking play, open DevTools' Network panel and filter to JS. When
the figure renders, a chunk whose filename starts with `engine-` (about
110 KB — confirmed by `npm run build`: `engine-<hash>.js`, 110.07 kB) should
load. It must NOT be present in the page's initial load — that is the whole
point of the lazy engine: astronomy-engine (about 116 KB unpacked) only pays
its cost when a space figure actually renders.

## 2. "Jupiter and its moons" — the explore beat, crumbs, pills, the card

Click **"Jupiter and its moons"** and let it play to the explore beat (after
the four moons are named).

Expect: the tray opens with a Space section under the `days` slider — the
hint line, crumbs **"Solar system › Jupiter"**, three pill rows (Scale /
Names / Date), and a card headed **"Jupiter"** with "Radius 69 911 km" …
"Mass 1.90 × 10^27 kg". Within a second or two, Wikipedia's first paragraph
appears with a thumbnail and the line "Wikipedia, CC BY-SA · Jupiter".

On the **Date** pill row, confirm **"Today"** is shown selected (highlighted)
from the moment the section opens, before you touch any pill — this is the
Task 10 fix: the row now falls back through the figure's effective params
the same way Scale and Names already did, instead of only ever matching an
explicit override.

Click **Io** on the figure. Expect: the figure redraws with Io alone and
large; crumbs read **"Solar system › Jupiter › Io"**; the card heads **"Io"**
with **"Moon of Jupiter"**. Click the **Jupiter** crumb — back to Jupiter
with its four moons.

Press **Norsk**. Expect: the labels read **"Io, Europa, Ganymedes,
Callisto"**; the card's field labels and the summary switch to Norwegian.

Press **Sizes**. Expect: the moons shrink to true scale against Jupiter.

Press **Continue**. Expect: the authored figure returns (English, schematic)
and the quiz appears ("Which of the four is the largest?" → Ganymede).

## 3. "The inner planets, moving" — true distances, real motion

Click **"The inner planets, moving"** and let it play.

Expect: four orbits with true relative spacing, four named dots (Mercury,
Venus, Earth, Mars) at their positions for 2026-10-09, then — over eight
seconds — Mars goes round its orbit once while Earth, on the inside track,
goes round almost twice and laps it.

## 4. Eyeball: Saturn's ring vs. a moon's orbit, in the same portrait

There is no bundled Saturn example this round. Type a request into the
compile box such as **"Show me Saturn and its rings, with its moons"** (the
pack's own manifest documents this exact scenario — "Saturn's rings" — as a
`focus` figure, the way "Jupiter and its moons" is). Let it render.

Look closely at the disc: **Saturn's ring should read as a squashed
ellipse** — part of it passing visibly behind the disc, part in front —
because a focus portrait leans the camera and draws the ring at Saturn's
real tilt. Then look at **any moon's orbit line** (Titan's, say): in the
default (non-tilted) view it is drawn as a **full, un-squashed circle**,
even though physically a moon near Saturn's equatorial plane shares
essentially the same plane as the ring. This mismatch — flattened ring,
circular orbit, same picture — is a known, deliberate simplification (the
ring's ellipse is hand-drawn at a fixed 0.38 squash to look right; orbits
are drawn through the same flat projection the whole-system top view uses).
Confirm it reads as an acceptable stylisation, not as something visually
broken — this is the eyeball judgement two earlier reviews specifically
asked be repeated on real Chrome, not inferred from the code.

## 5. Live click-to-focus pass on tightly packed inner planets

Go back to **"Find Mars"** (or leave it loaded after step 1) with the whole
system on screen at schematic scale — eight evenly spaced orbits 33 units
apart, Mercury drawn as a roughly 2.5-unit dot, the smallest disc in the
figure. Click the **⊕** button in the player bar ("Explore this figure") to
open the tray if it is not already open; the Space section is there for any
`solar_system` figure, authored `explore` beat or not.

Click directly on Mercury's tiny disc (innermost orbit). Expect: the figure
focuses to Mercury specifically — crumbs read "Solar system › Mercury", the
card heads "Mercury" — not Venus, not "nothing happens". Try a click a few
pixels off the disc, still within its orbit ring's local neighbourhood, and
confirm it still resolves to the nearest of the tightly spaced targets
rather than the wrong neighbour. This is the 18px hit radius
(`hitElement(..., 18, ...)` in `space-explore.ts`) doing its job against the
worst-case spacing this pack draws — the schematic view's 33-unit gaps are
the tightest the layout ever produces.

---

If any step's visible text differs from what is written here (a reworded
example, a renamed pill), that is more likely this document going stale
than a regression — check the actual example in `src/examples.json` and the
pack manifest in `src/scenes/packs/space.yaml` before concluding something
broke.
