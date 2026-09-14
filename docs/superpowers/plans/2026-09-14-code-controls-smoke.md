# Code controls — smoke checklist (Hans)

Run `npm run dev`, open Examples.

1. **The law of large numbers, live** → play to the end; the explore beat
   opens the tray with "Draws" slider + "Draw again" button under the script.
   - [ ] The panel's third line reads `n = 200` (never the `Slider(...)` call).
   - [ ] Slide Draws to 20: the line reads `n = 20`, the histogram thins, the
         mean moves; slide back to 200: instant (cached), no "Running…".
   - [ ] Press Draw again three times: three different histograms, `seed = 1..3`.
   - [ ] Continue ▶ restores the lesson's frame; reopening ⊕ shows the defaults.
   - [ ] Export the movie: it shows the default run (n = 200, seed = 0).
2. **An epidemic peaks…** (function form)
   - [ ] beta/gamma/days sliders; `def sir(beta=0.55, …)` line updates.
   - [ ] beta → 0.1: the infected curve flattens; gamma → 0.5: it shrinks.
3. **One sample, resampled** (R)
   - [ ] "Sample size" slider (from `Slider(10, 500, default = 40, …)`),
         `reps` slider from `c(100, 2000)`, Resample button; R re-runs (a
         few seconds the first time), the ggplot histogram changes.
4. **One click from playback**: while example 1 plays, click the code panel
   once → it pauses AND the tray opens on the script's controls. Click the
   background once → it only pauses (as before).
5. **glow: true**: edit example 1's spec to add `"glow": true`; dragging the
   slider glows the panel; releasing clears it. Without the flag: no glow.
6. **Pop-out**: press ⧉ in the tray; drag it by its top edge; resize from the
   corner; reload → it comes back where it was; Esc or ⇤ docks it. On a phone
   width there is no ⧉.
7. **Taken over**: in the tray editor, change `bins=20` to `bins=5` and press
   Run ▶ → the control rows go quiet (faded); Continue ▶, reopen → live again.
8. **Lint**: in the editor, change `controls` to `["n", "zzz"]` → the lint
   names `zzz` with "no birthplace"; set `n = 5` on a later line → warning.
