# SDD ledger — the screen by default, editable by default, one tray

Spec: `docs/superpowers/specs/2026-09-03-code-panel-screen-editing-design.md` §11
(the amendment written after this work, from Hans's asks). Branch: main, same
pre-authorization as M1–M3. Base at start: da8fcfd (M3 pushed).

Bounded round, brainstormed in chat and approved before any code: four asks —
the screen as the default look, the screen as an interactive object by default,
an example with the output above the code, and an answer to "what happens when
a figure has more than one interaction?".

## Rulings

**A. Screen everywhere, `none` as the way out.** Asked whether output-only
panels (ten bundled examples where a script draws a chart and the code never
shows) should also become monitors; Hans: "screen everywhere, but it should be
possible to have an argument to say none also (no screen, no laptop, no visuals
around the object)". `frame: "none"` already meant exactly that, so the round is
a default flip plus wording — one rule, no hardcoded exception for the
output-only shape.

**B. The ⊕ shows everything at once.** The alternative — a picker, or today's
code-XOR-sliders — makes the ⊕'s meaning depend on what else the figure
happens to have. §7.2 of the interactivity spec already promised "the full menu
of the scene's interactions", so the exclusivity was the outlier, not the fix.
Folding a script behind its own line when sliders share the tray keeps the strip
short without hiding the capability.

**C. An authored explore stays narrow.** The same tray, two meanings, split by
who opened it: the viewer's ⊕ is a workbench, the beat's `explore` is an
invitation to one thing. Written as a pure function (`trayPlan`) so the rule is
testable without a DOM and cannot drift into the rendering code.

**D. The screen click is element scope, so the info card yields.** `targetAt`
in `ui/infocard.ts` now stands aside on editable code ids exactly as it does on
the piano keys and the chessboard. Both handlers are capture-phase on the stage;
the card's runs first and declines, so there is no ordering dependency to keep
in mind later.

**E. One preview state.** Found while wiring B: `previewParams` and
`previewSpec` each repaint from the honest boundary and forget the other, so a
slider drag after a Run would have silently discarded the viewer's script. The
tray now holds overrides + per-element patches and repaints through one call.
Not a refactor for its own sake — B is impossible without it.

## Progress

- 765a553: `frame ?? "screen"` in `layout/code.ts`, schema wording, prompt
  clause; tests for the default, for `frame: "none"` drawing nothing, and for a
  data-only element growing no chrome.
- 13a51df: `trayPlan` + 7 node tests; the tray renders sections instead of an
  either/or; the paused stage click and the `cs-editable` caret; the info card's
  standing-aside; styles for the fold.
- 927e3ec: the "Five hundred flips" example; `white-space: pre` for mono text.

## Smoke (Playwright vs dev :5178, the REAL app UI)

The new example, played through: the bezel and stand are drawn without the spec
asking; stdout ("after 10: 0.7 after 500: 0.52") and the matplotlib plot sit
ABOVE the code; the six-line window has scrolled to lines 5–10; the explore beat
opens the editor prefilled. Screenshot compared before/after for the
indentation fix — the loop body is indented on the screen now.

`bar_chart` + Brython script (example 152), the multi-control case, in order:

| Step | Seen |
|---|---|
| the authored `explore: {code}` gate | editor expanded, **0 sliders** — exactly what the beat named |
| the viewer's own ⊕ | **1 slider AND the folded script** — the combined tray |
| edit `rates` to (0.05, 0.11), Run | panel shows the edit; bars recompute to 100…1147 |
| then drag the stage slider | the edit **survives**; bars follow to 100…18456 (Ruling E) |
| Continue | authored script and stage-0 bars back — nothing persisted |
| pause, click the screen | the tray opens with that editor expanded |

An existing output-only example (110, primes) re-checked by screenshot: the
chart now sits on a monitor and still fits its budget.

Not exercised: an R or MicroPython edit through the combined tray (same facade
call, verified per runtime in their own rounds); two code elements in one figure
(the labelled-per-element path is code-read only); touch long-press.

## Final verification

`npm test` 4008 green, `tsc` clean, `vite build` clean.

## Notes

- Clicking play at the END of a drawcast replays from step 0, so a preview taken
  right after that paints an empty boundary — correct behaviour, and a trap for
  the next person writing a smoke script against the "done" state.
- The ⊕ now appears on any figure with a visible script, sliders or not; that is
  the intended consequence of "the screen is interactive by default".
