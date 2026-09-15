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
9. The ⊕ tray opened by hand: no hand-drawn border, no scrollbar; its rows still work; while it is open the drawn panel ignores presses.
10. `?perf` in the URL, cache cleared (DevTools → Application → IndexedDB → delete): the console shows the boot/install/run timings (Task 7).
