# Notes for the quiz republish (after engine-layout merges)

Collected while the engine changed; fix these when re-framing each cast.

## New warnings from the number-line change (W3)
- first-text-message: "limit" text against ticks 1980/1990.
- birthday-paradox: "253 pairs" against "75%".
- hottest-peppers: "shu_l" against "100 000".
- first-hard-drive: duplicate "kg" (engine draws the unit now).

## Workarounds that can go now
- first-hard-drive: `kg_l` (unit drawn by the scale).
- rubiks-cube: hidden tick numbers + hand-drawn `n_*` names → draw `pos` with word ticks.
- cleopatra-closer: `bc` / `ad` labels (ticks read "3000 BC").
- hottest-peppers: `shu_l` → scale `unit`.
- rice-on-a-chessboard: `grains_l` (unit "years" drawn).
- ants-on-earth: unit label; consider value 2e16 so ticks/voice say "20 quadrillion".
- Spoken `{g}`/`{g.true}` on scales now say words ("43 quintillion").

## Engine features to adopt
- true-or-myth, body-myths, misnamed-things: on-canvas answer buttons (W8) instead of the quiz modal.
- Card casts: adaptive size (W2) — drop hand-placed labels that were placed at computed slots (eleven-oscars).
- Posters: regenerated automatically (poster = before the first question).

## After the engine deploy (not before)
- Re-push the microdata course (hmelberg/dcast/microdata) with the new tooling so its end pages read Norwegian ("Neste: …"), then re-bake that line; the m2py_runtime package ships with the deploy (merge runs in the browser).
- Republish the 50 quizzes (library/quiz) with the new engine; re-bake changed lines (within the TTS budget).
