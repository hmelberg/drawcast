# Round 3 smoke checklist — connect, and free play

Everything below is something **no test in this repo can see**. `vitest.config.ts`
runs in the `node` environment and not one file opts into a DOM, so a gate cannot
be mounted, clicked or looked at by any machine. Three separate times this round a
test turned out to be unable to fail; each was caught by a person reading, never by
the suite. This list is the part that stayed that way on purpose.

Start the app, open the compiler or load the two bundled examples by name:

- **"The shield and the club this atlas draws"** — Orion, 24 lines, English
- **"Fire streker som tegner en W"** — Kassiopeia, 4 lines, Norwegian

Take Cassiopeia first: four lines, and you will know in thirty seconds whether the
thing works at all.

## A. The question itself

1. **The figure is shown, then taken away.** The cast draws Cassiopeia's stars,
   then draws the W with a spoken line, and only then asks. When the question
   opens, the W's lines are gone and the stars remain. If the lines are still
   there, the exercise is tracing, not drawing.
2. **Press a star and drag to the next.** A line follows the pointer while you
   drag, and a segment stays when you release on another star. This is the path
   most people will use.
3. **Tap one star, then tap another.** A segment appears. This is the touch path,
   and it was broken twice during the round — once because it needed a movement
   under four pixels, and once because the branch that completes the pair had been
   removed while everything else about it looked right. If nothing appears when
   you tap two stars in turn, that is the bug, back again.
4. **Tap a star, then tap it again.** The armed highlight goes away.
5. **Tap a star, then tap empty sky, then tap a different star.** A line appears
   between the first and the last. This is deliberate — a tap that lands on
   nothing is far more often a miss at a small star than a change of mind — but
   see it once and tell me if it feels wrong in the hand.
6. **Click a line you drew.** It goes. Then click a star where several lines meet:
   the star wins, and no line disappears. This was proved on paper; see it once.
7. **The counter counts.** "3 / 4 lines" and so on, rising as you draw.
8. **The hint is there and it bobs.** It must say both halves — press and drag,
   and click a line to remove it. Its nudge animation was dead until the last
   round of fixes, killed by a more specific CSS rule while the comment above it
   claimed otherwise.

## B. What happens when you press Done

9. **A right drawing is called right.** Draw the W exactly and press Done. This
   is the single most important line on this list: the review proved that
   inverting the gate's two answers — so that every correct drawing is graded
   wrong — passed all twenty-one tests. That hole is now closed by a tested
   function, but only a person can confirm the wiring reaches it.
10. **A wrong drawing is called wrong, and shows you where.** Add one extra line,
    press Done. Grading is exact, so this must fail — your correct lines green,
    the stray red — and the true figure must appear.
11. **The verdict is readable before it disappears.** The card lingers 2.6
    seconds. A long `right` sentence may be cut short; if it reads as truncated,
    say so and I will lengthen the linger for this gate.
12. **The figure comes back.** After the question ends, however it ended, the
    constellation's lines are on the chart again. If the sky is missing its
    figure for the rest of the cast, the gate failed to put back what it hid.

## C. The ways out

13. **Skip.** The question ends, the figure returns, the cast goes on.
14. **Abort mid-drag** — pause, scrub the timeline, jump to another beat while a
    line is half-drawn. Nothing should be left hidden or stuck.
15. **Resize the window while the question stands.** The stars and your drawn
    lines must move with the chart. A stale position means you click one place and
    hit another.

## D. Free play — the other half

16. **Pause, then click a star.** A card opens naming it. An anonymous star reads
    as "HIP 27989"; a named one reads "Betelgeuse".
17. **Click a constellation's lines, and a planet.** Both name themselves.
18. **On the Norwegian example**, the names are Norwegian — Polaris comes up as
    "Polarstjernen".
19. **The ⊕ drawer still works** and still shows the fuller fact sheet. Free play
    is the quick look; the drawer is the reference.
20. **"Find the part" is still in the tray** on both space figures. Declaring the
    new interaction nearly took that drill away silently; a test now holds it, but
    confirm it with your eyes.

## E. Two things I know are imperfect

21. **Retry reveals the figure between attempts.** If a connect ask uses
    `retry: true`, the answer is shown before the second attempt. Left alone this
    round. Tell me if you want the retry path to keep the figure hidden.
22. **A refused question shows no gate.** A figure over 24 lines — only Eridanus
    (26) and Sagittarius (29) — cannot be asked for. Lint now reports that as an
    error so the compiler repairs it, but if one ever reaches a viewer, the
    question is skipped and its answer spoken.

## What to tell me

The number, and what you saw. A single "3 does nothing" is enough — that one has
been broken twice, and I would rather hear it from you than assume the third
attempt held.
