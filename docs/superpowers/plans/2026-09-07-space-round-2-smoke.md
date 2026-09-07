# Space, round 2 — `sky_map` smoke checklist

This repo does not depend on Playwright, so this is a document to follow by
hand on the dev server, not a script — Hans's standing preference is to limit
browser automation, and the Chrome at his machine is visible and audible.
Run `npm run dev` in the `space` worktree and drive it in that Chrome. Keep
to the steps below and delete any screenshot from the worktree root
(`rm -f *.png`) before anyone commits or merges.

Every step names the sidebar Examples list item by the text actually printed
on its button (`ex.spec.title`), not the natural-language request that
produced it — the five `sky_map` examples are titled **"The sky turns
because we do,"** **"Half a year, the other half of the sky,"** **"The shape
that never sets,"** **"Tjue stjerner, men bare sju kjente,"** and **"A point
twinkles, a disc does not."**

## 1. The chart reads as a sky, not a dot pattern

Load **"The sky turns because we do."** Let it play through the first two
beats (the rim and compass, then the star field with Saturn labelled).

Expect: the dome fills the page; the star field sketches in over about two
seconds rather than dot by dot; the dots are visibly different sizes — a
handful of bright discs among many small points, not a uniform scatter.

## 2. The colours read on paper, not just in the data

Load **"Half a year, the other half of the sky"** and let it reach the beat
where Orion is drawn (`con_ori`).

Expect: Betelgeuse (Orion's shoulder) reads warm — amber to orange — against
the warm cream ground, and Rigel (the opposite corner, the foot) reads cool
— white to pale blue. Not a field of identical grey dots; two stars in the
same small figure should look like different temperatures of light.

## 3. The animation turns the sky, not the star

Stay on **"The sky turns because we do"** and let the fourth beat run
(`animate hours 0 → 6`, 8 seconds, linear).

Expect: the whole sky sweeps around one point — Polaris — which does not
move. Nothing snaps or jumps at the start or the end of the sweep.

## 4. The Moon's phase, and which way it points

Load **"Half a year, the other half of the sky."** This example never
restricts `show`, so the Moon is one of the template's default bodies even
though the authored beats never name it. Open the ⊕ tray (the player bar's
"Explore this figure" button) and step the **Date** pill through its three
choices (today, +30 days, +182 days) until the Moon shows a visible crescent
rather than a near-full or near-new disc.

Expect: the crescent's points aim away from the side of the chart the Sun
is on — the bright limb faces the Sun, so the horns point the opposite way.
Check this in BOTH styles: switch the style dropdown ("Clean lines" /
"Hand-drawn") and confirm the same crescent shape and orientation survive —
the phase must read as a real crescent under hachures, not degrade into a
smudge or an ink-outlined circle.

## 5. The ⊕ Sky section: star, constellation, planet

Open the ⊕ tray on **"Tjue stjerner, men bare sju kjente"** (the Ursa Major
portrait). Confirm the tray opens a **Sky** section (hint text, Hour/Date/
Place pills, a card), not the Solar system section a `solar_system` figure
would show.

- Click a bright star. Expect: the card names it, gives its magnitude,
  colour, and how high it is right now; the Wikipedia summary arrives within
  a second or two, or the card stands on the table's own facts alone if the
  fetch fails or is slow.
- Click the constellation's own lines (not empty sky). Expect: the card
  gives all three names — Latin, English and Norwegian ("Ursa Major," "The
  Great Bear," "Store bjørn").
- Click a planet, if one is on the page (switch to an example with `show`
  including a planet, e.g. **"A point twinkles, a disc does not"**, if this
  portrait has none in frame). Expect: the card names the planet and gives
  its facts — this used to do nothing and was fixed before this round
  shipped, so confirm it still works.

## 6. The pills reshape the figure; Continue restores it

On any sky_map figure's ⊕ tray, step the **Place** pill through Oslo,
Bergen, Tromsø and the equator.

Expect: each choice repaints the whole sky, not just a label — Tromsø raises
Polaris noticeably higher above the horizon than Oslo does, and the equator
drops it to sit almost on the rim. Press **Continue**: the authored figure
returns exactly as it was authored (same date, same place, same marks).

## 7. The click question grades the right thing

Load **"A point twinkles, a disc does not"** and let it play to the ask
("Click the one that is not a star").

Expect: clicking Jupiter (the steady point) is right and glows, with the
reveal line spoken. Clicking Sirius or Capella (marked but not the answer)
is wrong. Clicking empty sky does nothing rather than grading a miss.

## 8. Dark mode

Toggle the app to dark mode (or reload with the OS/browser set to prefer
dark) and reload any sky_map example.

Expect: the chart stays legible — the horizon, compass letters, star field
and any drawn figure all read clearly against the dark ground, and the
warm/cool star tints do not wash out or vanish into it.

---

If any step's visible text differs from what is written here (a reworded
example, a renamed pill), that is more likely this document going stale
than a regression — check the actual example in `src/examples.json` and the
pack manifest in `src/scenes/packs/space.yaml` before concluding something
broke.
