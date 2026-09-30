# Retired experiments and features

Options that lost a comparison, or were superseded, and were taken out of the
app. Each is kept two ways:

- **the text here**, readable and searchable (prompts don't rot the way code does);
- **the exact code at a git tag**, restorable one file at a time:
  `git checkout <tag> -- <path>`.

## 2026-09-30 — tag `archive/pipeline-experiments-2026-09-30`

| What | Why it went | Here |
|---|---|---|
| Treatment v1 — the first story-first sheet, the teacher also placing things on the page | Superseded by v2, then v3 (the storyline) | `treatment-v1.md`, `treatment-staging-v1-v2.md` |
| Treatment v2 — the lab's arm C "plan" sheet, and the developer-mode Pipeline select that forced it | v3 (the storyline) won; the app's default since 2026-09-28 | `treatment-v2.md`, `treatment-staging-v1-v2.md`, `2026-09-27-A-vs-C.md` one level up |
| Storyboard v1 — the multi-part/course storyboard prompt of 2026-09-19 to 2026-09-28, and the developer-mode Storyboard select | v2 won the blind comparison on 2026-09-28 | `storyboard-v1.md` (the prompt is built in code; its source is kept) |

To run one again: restore its files from the tag onto a branch and add it back
as an arm in `scripts/prompt-lab.mjs`.

## 2026-09-30 — tag `archive/micropython-2026-09-30`

| What | Why it went | Here |
|---|---|---|
| The MicroPython runtime (`language: "micropython"`): `src/code/micropython.ts`, its pandas/plotly stand-ins in `public/pylib/2026-09-03/micropython/` (~9,250 lines), its prompt sentence and schema clause | A second light tier beside Brython, which runs the same scripts with far wider library cover; it saved about a second of first load and cost a duplicate set of stand-ins plus a dict-order trap the AI had to be taught | Nothing here — it is code, so the tag is the archive |

A cast that names `micropython` still plays: `currentLanguage` in
`src/code/languages.ts` maps it to `brython` (in `normalizeSpec` and in
`runCode`). The shared runner (`drawcast_runner.py`) and the Brython stand-ins
keep their MicroPython-safe code, so bringing it back is: restore
`src/code/micropython.ts` and `public/pylib/2026-09-03/micropython/` from the
tag, put `"micropython"` back in `LANGUAGES` (and its label, version, cache tag
and `RUNTIMES` entry), drop it from `RETIRED_LANGUAGES`, and restore the prompt
sentence and schema clause.
