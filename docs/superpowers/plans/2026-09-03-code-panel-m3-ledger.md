# SDD ledger — plan: docs/superpowers/plans/2026-09-03-code-panel-m3-editing.md

Spec: docs/superpowers/specs/2026-09-03-code-panel-screen-editing-design.md §7. Branch: main (same pre-authorization as M1/M2). Base at start: 0ef2587 (M2 pushed).

## Pre-flight scan (2026-09-03)

| Pair / task | Interface checked | Found |
|---|---|---|
| spec §7 ↔ tray | the explore gate, Continue, `settleParams`, the freeze-click guard all live in `attachParamsTray`; an overlay over the SVG pane would duplicate the gate and need `clientPointFor` scaling | **→ Ruling A** |
| tray ↔ tokens | `hd.spec` is the resolved clone: its params hold VALUES, the tokens are gone | `handle.authored` (the spec as passed to `render`) is new; the tray re-substitutes into it |
| player ↔ reprojector | `frame(params, visible, offsets, revealNew)` re-lays out with param overrides only; `layoutFor` closes over the spec | both gained an optional `elements` override; an override is never cached |
| tray attach condition | a figure with no sliders and no manifest interaction attached no tray, so the gate would never be set and `explore: { code }` silently skipped | a visible code element now counts as a capability |
| styles ↔ palette test | a literal light fallback next to `--ink` fails the dark-mode rule | the editor uses `--field`, the themed input background |

Ruling A: the editor lives IN the explore tray under the figure, not as a text area floated over the code pane. One gate, one Continue, no coordinate mapping, and the viewer watches the panel above re-run. The spec's "placed over the pane" wording is superseded; the behaviour it asked for (edit, Run in the same runtime, output and token-fed template update, Continue restores, movies skip) is all here.

Ruling B: with no slider to show, the ⊕ tray opens the editor for the first editable code element — the spec's deferred "click to edit while paused", delivered through the door the tray already has rather than a stage click.

## Progress

- 2968f3a: `explore.code` in types/schema/plan; `Reprojector.frame(…, elements)`; `Player.previewSpec(patch)`; `layoutFor(params, cache, elements)`; `handle.authored`; the tray's editor (`runEdited`: facade → patched elements → re-substituted authored params → `previewSpec`); styles; prompt clause; tests (schema + plan step).
- 3987cc8: bundled example "Change the rates yourself" (Brython script feeding `bar_chart`, an `explore: { code }` beat last).
- 5417604: Ruling B.

## Smoke (controller, Playwright vs dev :5178, the REAL app UI)

1. The gate: the example pasted into `textarea.spec-json`, silent mode, ▶. Playback reached the explore beat and the tray opened with the editor prefilled (`textarea.cs-tray-code`). Edited `rates = (0.02, 0.07)` → `(0.05, 0.10)`, Run: status "Ran ✓ — Continue restores the lesson", the panel's second line reads the edited text. Continue: the original line is back, the tray hidden.
2. The ⊕ while paused (Ruling B): editor opens without a gate; the same edit, Run, Continue cycle.
3. The data bridge through the editor, programmatically on the same example: the authored params' `{calc.frames}` path is harvested from the viewer's script (`[[100,163,…,1147],[100,259,…,11739]]`), substituted into the params handed to `previewSpec`, and the panel's line shows the edited script; `settleParams` restores. The bar geometry itself was not measured (the template's leaf ids were not probed); the params that drive it were.

Not exercised: an R or MicroPython edit through the tray (the facade is the same call the resolver makes, verified per runtime in their own rounds); a script error in the editor (the panel's error pane is the resolver's path, verified in M1 of the code element).

## Final verification

`npm test` 3990 green, `tsc` clean, both builds clean.

## Notes

- A viewer's edit that changes the number of code lines re-mints `_line_i` ids; `revealNew` shows the new ones, so the panel never shows a stale line count.
- `ylim` stays authored: a viewer's larger numbers clamp against the chart's axis (the template's own behaviour), which is honest — the lesson's frame stays.
