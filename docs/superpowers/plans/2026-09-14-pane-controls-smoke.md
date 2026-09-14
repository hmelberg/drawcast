# Pane controls and the movie rule — smoke checklist

As in the earlier rounds, this is a document to follow by hand on the dev
server (`npm run dev` in the worktree, then the sidebar's Examples list),
not a script: the repo has no Playwright dependency and Hans's standing
preference is to keep browser automation light. Each step names the
Examples-list item by its `request` text (the button label). Node tests
cover the geometry, the lint, the plan and the layout; these steps cover the
runtime seams no node test reaches — the in-place card actually mounting
over the drawn panel, a slide actually moving the drawn knob after a
re-run, the exported movie actually skipping the explore beat — plus the
four playlists end to end.

## 1. SIR — theory, then the knobs

Load **"Why does an epidemic peak and then fade, even when nobody was
immune at the start?"**.

Part 1 (title "Two rates behind an epidemic") draws three circles —
Susceptible, Infected, Recovered — left to right, then the S→I arrow
labelled β · S · I, then the I→R arrow labelled γ · I, narrating why a new
infection needs both S and I. Continue (or auto-advance) into part 2.

Part 2 draws the code pane's frame, then three knob rows in the left pane
— β, γ, days, one per beat, in that order, each named in the narration as
it is drawn — then the plot in the output pane on the right. The final
beat is the explore beat: playback stops, the card mounts in place over
the drawn rows (not the tray only), and its `speak` is the only line that
invites interaction ("Try it: lower the spread rate…").

Slide β down in the card: the corresponding drawn row's knob moves to its
new position on the track after the script re-runs (the same relayout a
code line already gets today), and the output plot updates. Click
Continue: the card closes and the lesson's own flow resumes.

## 2. SIR — the movie export

Export "Why does an epidemic peak and then fade…" (or use the export
preview) and watch it through. Expect: the three knob rows are drawn at
their SCRIPT defaults (β = 0.1's slider position, etc.) exactly as in the
app, no card ever appears, and the explore beat's line ("Try it: lower the
spread rate…") is never spoken — the beat is skipped whole, narration
included.

## 3. The Markov cohort — knobs

Load **"How does a Markov cohort model turn two yearly risks into a
picture of a whole population over time?"**.

Part 1 (the `markov_model` template, title "Two risks, three states")
draws Well/Sick/Dead, the two self-loops, the two transition arrows
(p_sick, p_dead), and glows Dead as absorbing. Part 2 draws the panel and
its three knob rows (p_sick, p_dead, years) one at a time, then the
stacked-area plot, then stops on the explore beat with the card live over
the rows. Raise p_sick in the card: the sick band in the plot bulges
earlier and the row's own knob moves. Continue restores play. Exporting
this example shows the three rows at their defaults and never speaks the
explore line.

## 4. The cost-effectiveness plane — theory, then the demonstration

Load **"Why do health economists draw a cloud of dots instead of one
number when they compare two treatments?"**.

Part 1 (the `cost_effectiveness_plane` template, title "One point on the
plane") draws the axes, the dashed willingness-to-pay line, and one
emphasised point just under it, narrating that a single point cannot show
how sure that roll of the dice was. Part 2 is the SAME code demonstration
this example has always shown (script lines, not a drawn knob panel — see
"Concerns" in the Task 4 report: the `wtp` slider's own
`label="Willingness to pay"` overflows the drawn panel's fixed label
column at any pane width, an unrelated pre-existing limit of
`code-controls-pane.ts`, so this one example keeps `pane: code`). Confirm
the explore beat still stops with the tray's controls group available (⊕
or the paused click opens the tray, not an in-place card, since the pane
is not `pane: controls` here), sliding the willingness to pay moves the
share-below-the-line number, and the movie export never speaks the
explore line.

## 5. Discounting — knobs

Load **"How much is a health gain worth today if it only arrives in twenty
years?"**.

Part 1 (freehand axes + curve, title "Why the future shrinks") draws the
axes, the 1/(1.04)^x curve labelled "4 % a year", and glows the curve while
narrating geometric shrinking. Part 2 draws the panel and its two knob rows
(rate, horizon), then the R plot, then stops on the explore beat. Set the
rate to zero in the card: the curve in the output plot goes flat and the
row's own knob slides to the left end of its track. Continue restores.
Exporting shows both rows at their defaults (rate = 0.04) and never speaks
the explore line.

## 6. Paused click opens the card; ✕ and Escape close it

On any of the three `pane: controls` panels above (SIR, the Markov cohort,
or discounting), pause playback BEFORE the explore beat and click directly
on the drawn panel (not the output pane). Expect: the same in-place card
mounts over the panel as the explore beat itself would open — same rows,
same current values. Click the card's ✕: it closes, the drawn panel is
left showing the values as last set. Reopen it (another paused click) and
press Escape: it closes the same way. Clicking OUTSIDE the panel while
paused does not open the card.

## 7. The tray stays in sync

With a card open in place (any of the three `pane: controls` examples),
open the ⊕ tray as well. Expect: the tray lists the SAME controls group
for that script (not a second, independent one), and moving a control in
EITHER the in-place card or the tray updates the other's shown value and
the drawn row together — one state, two views, exactly as the editor card
and the tray's own textarea already share one draft today.

## 8. Lint: an ordinary speak that invites

In the editor, take any example above and change one of the ordinary
(non-explore) `speak` lines to start with "Now slide the rate…" (or any
other line beginning with slide/drag/press/click/toggle/try it, or the
Norwegian dra/trykk/klikk/prøv/skyv). Expect: the lint panel shows the
`explore-invite` warning ("invites the viewer to interact… put the
invitation in an explore beat's speak"), and the SAME text placed as an
`explore` beat's own `speak` shows no such warning.
