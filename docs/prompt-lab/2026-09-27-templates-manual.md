# Prompt lab, run 2: template requests, the app's pipeline answered by agents (2026-09-27)

> The `runs/…` files this report names (specs, plans, critiques, frames, every request and reply) are on branch `prompt-lab`, not on main.

**Why this run:** run 1's five requests happened to have no matching template,
so every figure was freehand. That left open whether the lessons hold where
the app is strongest.

**How it ran:** four requests that route to a template, each through the app's
own `generateSpec`:
- a ticket tax (`supply_demand`);
- aneurysm repair now or watch (`decision_tree`);
- "median survival up four months" (`survival_curve`);
- why a losing firm keeps producing (`firm_cost_curves`).

Only the model calls were handed to agents (manual mode, see
`answering-agent.md`). Routing, repairs, lint, adoption and the look pass
are the app's code. The router ran on the real API (Haiku) and picked the
right template every time. API cost: under $0.01.

**Arms:**
- **A:** today's pipeline.
- **D:** treatment v2, which now sees the shortlisted templates' full entries,
  then staging, then look and fix, at most twice.
- **C2:** D's spec before its first look, for "what the look pass added".

Files are in `runs/2026-09-27-templates-manual/`: `*-A/C2/D.json`, the
contact sheets (`*.jpg`), the treatments, the critiques (`*-D-critique.md`)
and every request and reply (`exchanges/`). Blind pages: `compare-A-D.html`
and `compare-C2-D.html`.

## What happened

| Case | A rounds | D rounds | Template kept |
|---|---|---|---|
| 1 tax | initial > pedagogy* | initial > lint-repair > look* > look* | yes, both |
| 2 decision | initial > lint-repair > pedagogy | initial > look (fix rejected) | yes, both |
| 3 survival | initial > pedagogy* | initial > look* > look | yes, both |
| 4 firm | initial > lint-repair > pedagogy* | initial > schema-repair ×2 > look* > look* | yes, both |

`*` = the round's revision was adopted.

## Reading

- **With a template, the page is already decent in A.** The template
  computes the geometry. The difference between the arms is smaller than in
  run 1, as expected.
- **The look pass still earns its keep, in a different way.** Here it
  mostly catches *what the template does not show*:
  - a $10 tax wedge too thin to see (D rescaled the price axis until it was
    large);
  - branch probabilities in the smallest text on the page (the two numbers
    the argument rests on);
  - a verdict box drawn through the tree;
  - a laser aimed at an anchor that doesn't exist;
  - a card shrunk until it could not be read.
  In the tax case, D is visibly better than A (the wedge, the readout inside
  the plot). Look fixes were adopted in 3 of 4 cases. The fourth was rejected
  for a card 10 units off the page (fixed since, see below).
- **The explanations are close.** With a template, A's stories are already
  good. The treatment step's advantage from run 1 is smaller here. Judge it
  on the blind pages.
- **The treatment plans within the template.** With the full entries it used
  real parameter names (`mode: competition`, `shade: profit`, `price_line`),
  and every D figure kept its template.
- **The pedagogy pass was adopted in 3 of 4 A runs here**, against 0 of 5
  through the API in run 1. That is more likely the agent answering
  differently from `claude-opus-5` than a real change. A known limit of
  manual mode.

## Findings about the app itself (surfaced by the agents and the critics)

These hold whatever the experiment decides. They are candidates for `main`:

1. **`survival_curve`:** the description doesn't say how an index in
   `survival` maps to time. It draws no tick numbers, and its captions are
   tiny with no size control. Two agents drew ticks by hand.
2. **`firm_cost_curves`:** the minima of AVC and ATC aren't exposed, so a
   price "between the two minima" is a guess. There is also no fixed-cost
   parameter to widen the ATC–AVC gap. Two critics asked for a min-AVC marker.
3. **`supply_demand`:** a tax that starts at 0 and animates up fails lint
   (the tax band "isn't drawn"). The prompt recommends exactly that pattern
   ("write the starting value, then animate").
4. **Decision tree:** no way to write the folded-back value on a chance node
   in the template's own label size.
5. **Emphasis is invisible in still frames**, again. Every critic reported
   that highlights and focus don't show. The frames harness should capture
   one frame in the middle of a gesture.

## Fixed in the lab after this run

- **Reply race:** the runner read a reply as soon as its file appeared, and
  two agents were still editing theirs. It now waits for a `NN-reply.done`
  marker. This affected decision A (a placeholder id got through) and firm D
  (one extra repair round).
- **Look fix → repair:** a look fix that breaks validation or adds a lint
  error now gets one ordinary repair round before it is judged, instead of
  being dropped.

## So, with templates too

- The **look pass** helps with templates as well. It is cheap relative to
  its catch, and most of what it catches is otherwise invisible
  (picture-vs-words, readability of the numbers that matter).
- The **treatment step** matters less when a template carries the figure. It
  may be worth it only for freehand figures. Since the router already knows
  whether a template fits (`none_fits`), that would be one line in
  `generateSpec`.
- The **template gaps** above are worth fixing on their own.
