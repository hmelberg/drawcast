# The prompt lab

How to test a change to how drawcasts are generated — a prompt, a pipeline, a
model — before it reaches everyone. Every experiment runs the app's OWN code
(`generateSpec`: routing, repairs, lint, the look pass), so what is measured
is what ships.

## The routine

1. **Hypothesis.** One line in `LEDGER.md`: what should get better, and how
   we will see it.
2. **Build it as an option**, never as a replacement: a prompt variant (the
   app's prompt editor, developer mode), a pipeline (`GenerateConfig`, and the
   Pipeline choice in developer mode), or a model (the lab models in
   developer mode).
3. **Run it free on the machine** — manual mode, agents answer the model
   calls (below). A fixed case set, both arms, frames rendered.
4. **Blind review.** Anonymise the versions per question (W/X/Y/Z), and give
   each question's set to one reviewer agent with the frame tiles and the
   narration (scripts/prompt-lab-sheet.mjs builds the blind pages; the
   2026-09-27 reviewer brief is in `2026-09-27-final-eval.md`).
5. **Confirm through the API** on 2–4 cases if it looks promising — the
   machine is an optimistic lab (agents think longer and always land their
   fixes; `2026-09-27-final-eval.md`).
6. **Hans watches the playlist** (every page's heading names its arm) and
   decides. Write the outcome in `LEDGER.md`.

## The tools

- `node scripts/prompt-lab.mjs` — the runner (see its header): case sets,
  arms `standard` and `plan`, `--manual`, `--model`, `--no-look`, `--frames`.
  Needs a dev server for the look pass: `npm run dev -- --port 5199 --strictPort`.
- `answering-agent.md` — the brief for the agents that answer manual-mode
  requests. One agent per pipeline run; the runner waits for `NN-reply.done`.
- `node scripts/prompt-lab-sheet.mjs <run> <armX> <armY>` — a blind
  comparison page per arm pair.
- `node scripts/cast.mjs` — check, frames and open for any single cast (the
  local author's toolbox).
- In the app, developer mode: Pipeline (Standard / Plan first) and the lab
  models beside Opus 5.5.

## What is here

- `LEDGER.md` — every experiment, its result and the decision.
- The 2026-09-27 reports: `2026-09-27-A-vs-C.md` (runs 1 and 1b),
  `2026-09-27-templates-manual.md` (run 2), `2026-09-27-final-eval.md`
  (run 3, the fair comparison, blind-reviewed), and
  `../2026-09-27-prompt-rule-audit.md` (the rule audit that started it).
- The raw runs of that day (specs, plans, critiques, every request and
  reply, ~30 MB) stay on branch `prompt-lab`; `runs/` here holds only keys.
  All sixteen run-3 figures play from `../examples/2026-09-27-prompt-lab-16.yaml`.
