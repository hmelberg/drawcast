# Course fix round — smoke checklist (Hans)

What changed: the model's output ceiling for course generation went from
16k to 64k tokens (a still-cut part retries once, "attempt 2"); partial
lectures are now stored and resumable instead of discarded; click gates
are stripped unless tagged `#click`; a click-line question now answers to
the exact drawn line; a shape rect's x/y is now its centre and a node's
width/height are honoured; code marks are centred on the row; the explore
beat for code opens the card, not the tray; output panes are always mono;
and the drawing library + logs moved from localStorage to IndexedDB.

1. [ ] **Generation ceiling.** Generate a course whose lectures used to
   fail with "The reply was cut off at the output limit" (or any long
   creative course). Expect far fewer such failures; any part still cut
   off shows "writing the spec, attempt 2" and then completes or fails
   cleanly — not silently truncated.
2. [ ] **Partial lecture — status and resume.** Find (or produce) a lecture
   missing some parts. Expect its status line to read
   `status: failed · id: … · missing: 1, 4 · error: … · <date>`, its row
   in the list to say "partial, missing 1, 4", and the run summary to say
   "N partial — press ⟳ to fill in the missing parts". Press ⟳: only
   parts 1 and 4 regenerate against the same outline and merge in order;
   the rest is untouched.
3. [ ] **⟳ on a done lecture / deleted row.** Press ⟳ on a fully DONE
   lecture: expect a full regeneration, as before. Delete the library row
   for a partial lecture, then press ⟳: expect it falls back to a full
   regeneration rather than erroring.
4. [ ] **Click gates stripped by default.** Open a freshly generated
   lecture with no `#click` tag. Expect no "Click to continue" stops
   anywhere in it. Add `#click` to the lecture and regenerate: the gates
   are back.
5. [ ] **Click question on a code line.** Open "Three lines that produce
   results", reach "Click the line that brought wage income into the
   dataset", and click that exact drawn line. Expect the click on the
   LINE answers it (not any click in the panel). Then open an anatomy
   figure's click question and click an organ: expect it still picks the
   organ under the cursor.
6. [ ] **Shapes: rect centre + node size.** Open "Why the first two lines"
   and find the "vault" figure. Expect BEFOLKNING_KJOENN, INNTEKT_WLONN
   and NUDB_BU to sit INSIDE the box, not straddling its edge. Open the
   sewing-machine and bicycle-pump examples: expect both look unchanged.
7. [ ] **Code marks centring.** Open the microdata lecture, find the code
   element marking `2022-01-01`. Expect the highlight band and strike
   centred on the row (not riding high or low) and the underline sitting
   just under the letters.
8. [ ] **Explore beat on code → card, not tray.** Open a lecture whose
   explore beat names only code (`{"explore": {"code": "<id>"}}`). Expect
   it opens the editor CARD on the drawn code pane with the tray shut.
   Check Continue, ✕, Esc and the bar's ▶ all resume; ⊕ still opens the
   tray (gated) with the card up; scrubbing closes the card cleanly; Run
   in the card previews on the pane. Then check a beat naming code AND
   params: still opens the tray. A script with `show: output`: still
   falls back to the tray.
9. [ ] **Output pane font + wrap.** Open any code element with printed
   output. Expect the output text is always in the mono/typewriter face,
   and long lines wrap at the mono width with no overflow.
10. [ ] **Storage moved to IndexedDB.** DevTools → Application →
    IndexedDB. Expect a `drawcast-store` database with keys `library` and
    `logs`, and the old localStorage keys `drawcast.library.v1` /
    `drawcast.logs.v1` gone (imported once, then removed). Check the
    library sidebar lists everything in the same order as before; save,
    delete and reload each persist correctly; a batch course generation
    produces no quota error; the console has no "could not persist"
    lines.
11. [ ] **Syntax coloring — only if deployed.** Open a lecture with a code
    pane. Expect keywords, strings, numbers, comments, commands,
    variables and paths in distinct colours. With `draw.mode: type`, the
    typed reveal types coloured text row by row with the cursor, and
    scrubbing back untypes cleanly. Marks and click-on-line still line up
    with the coloured text. Export the movie: colours carry through.

## Known limits

- Partial-lecture resume estimates its call budget from the document
  alone; if the library row is gone, the run spends more calls than
  estimated.
- A `wait` command's own speak line is removed together with the command
  when gates are stripped.
- The explore card shows no invitation text of its own — the invite is
  spoken through the caption, not printed on the card.
- A beat naming code and params stays on the tray, not the card.
