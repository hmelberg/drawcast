# Live drawn controls — smoke (Hans)

App, SIR example (pane: controls), light then dark mode:

1. Play. Mid-playback, press on the beta track. The cast pauses on that press and the knob is already under the pointer; drag — the knob follows; on release the curve re-runs (Python debounce).
2. Let the explore beat arrive. The lesson stops with the panel live and the tray SHUT; the bar shows ▶. Drag a knob: the drawn knob and the curve follow. Press ▶ (or click the figure outside the panel): the lesson continues from the beat.
3. While paused (not at the beat): a click on the figure resumes; a click on the panel does not — it moves a knob.
4. Markov cohort: the `days` number box — click, type 40, Enter; the box shows 40 and the run follows. Escape on a fresh click cancels.
5. A choice chip and a toggle: one click each, the fill/knob moves at once.
6. `autorun: false` (edit an example's YAML): the drawn Run ▶ row runs.
7. Export the movie: the panel is drawn at its defaults, no invitation, no gate.
8. Mobile (or DevTools touch): a slider drag does not scroll the page.
9. The ⊕ tray opened by hand on a `pane: controls` figure: no hand-drawn border, no scrollbar; the tray shows the script's code cell only — no knob rows, since the knobs are drawn — and the drawn panel stays live while the tray is open (drag a knob with the tray up: it moves and the run follows). A `show: output` script's knobs are still tray rows, and they still work.
10. `?perf` in the URL, cache cleared (DevTools → Application → IndexedDB → delete): the console shows the boot/install/run timings (Task 7).

## Measured 2026-09-15

Controller measurement (Playwright on a fresh profile, `?perf`, SIR example
opened from the library, no IndexedDB cache). Opening the cast emitted NO
runtime span — the baked `code_result` satisfies the ensure phase. Pressing
▶ emitted, before any knob was touched:

| span | ms |
| --- | --- |
| runtime import python | 10.9 |
| pyodide boot | 1595.0 |
| (matplotlib + deps package load, between boot and exec) | ≈2960 |
| python exec | 34.3 |
| run python (total) | 4602.7 |

Reading: the first Python run costs ≈4.6 s, of which the script itself is
34 ms; the package load, not the boot, is the bulk. It fires at play start on
its own (the player resolves the code element as the run reaches it), so a
`warmRuntimes` call at play start would start the same work a few hundred
milliseconds earlier at best. **Warm-up not warranted in this stage.** If a
stall is still felt at the panel, stage 2's step precompute (which also runs
during narration) is the lever, and the package load is what to hide.

Also verified live in the same session: the explore beat on the SIR script
held with the tray shut, the centred ▶ hidden (`cs-gated`), and a click on
the figure outside the panel released the gate into playback.
