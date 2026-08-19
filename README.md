# drawcast

Animated, narrated, hand-drawn explainer figures — "drawcasts" — that play like
short videos. Describe a diagram ("draw a demand and supply diagram"), an LLM
compiles it into a **structured drawing spec**, and deterministic code renders
it as a gradually drawn, spoken figure with a laser pointer, highlights, and
camera moves.

drawcast is the product graduation of [hmelberg/draw](https://github.com/hmelberg/draw)
(Concept Sketch), the experiment harness that compared spec formats and
rendering backends. The experiment picked its winner; drawcast keeps the engine
and drops the lab. `draw` remains as the frozen lab — fixes flow one way, into
this repo.

## Core principle (inherited, non-negotiable)

**The LLM writes semantics; deterministic code computes geometry.** The LLM
outputs a JSON spec (what exists, how elements relate); scales, tree layout,
label collision solving, and lint are all code. Logical canvas 1000×750,
Cartesian, y-up, origin bottom-left; the single y-flip lives in `toSvgY`.

## Two modes, one document

- **Player** (default): a YouTube-like watch page — video-sized stage with the
  title below it, poster, big play button, seekable progress bar, mute (keeps
  narration timing), playback mode and speed, theater (wide) and fullscreen
  toggles, and an ✎ switch into the editor right on the control bar. The
  chrome fades while playing.
- **Editor**: create drawcasts with AI (bring your own Anthropic API key) or by
  hand — load bundled examples, edit the spec directly (**YAML by default**,
  JSON one toggle away; parsing always accepts both), save to a local library,
  download/upload specs, rate results, promote good ones to few-shot
  exemplars, and manage a **prompt library**: copy a bundled compiler prompt,
  edit/rename/delete/share (.md) your own variants, pick the active one, and
  ask the model to **improve the prompt from your worst logged generations**
  (proposals are saved as new prompts, never overwriting — you promote).

A standalone share mode plays a spec straight from a link-shared Google Doc:
`…/#gdoc=<doc-id>` (optional `&style=sketchy &mode=silent &speed=1.5`). The doc
can hold the spec as YAML or JSON — the format is auto-detected, and
word-processor smart quotes are repaired. Internally the engine and the LLM
always speak JSON; YAML is a lossless human-facing conversion layer
(`src/spec/text.ts`).

## The command language

A spec is elements + a storyboard of commands. Narration: `speak` (with
`blocking:false` to talk while gesturing). Drawing: `draw`, `pause`. Gesture
verbs: `highlight` (pulse/circle/glow), `point` (laser pointer), `move`
(translate with easing/path), `show`/`hide`/`erase`, `clear`, `camera`
(zoom/pan). The planner precomputes scene state at every step boundary, so
step-back and seeking are exact.

## Architecture map

| Path | What |
|---|---|
| `src/spec/` | Spec types, JSON Schema (= API output constraint = prompt docs), sandboxed expression evaluator |
| `src/layout/` | Canvas/scales, layout IR, tier-2/3 element layout, label collision solver, orchestrator |
| `src/scenes/<name>/` | `manifest.json` (routing data) + `layout.ts` (geometry code) |
| `src/lint/` | Deterministic visual lint (feeds the repair round) |
| `src/render/` | Command planner (scene state per step), Player, gesture effects, speech, the SVG renderer (clean/sketchy style toggle) |
| `src/llm/` | BYOK Anthropic client, generation pipeline with capped repair rounds, prompts-as-data (`prompts/*.md`) |
| `src/ui/` | DOM helper + shared video-style player controls |
| `src/main.ts` | The two-mode app shell; `src/viewer.ts` the #gdoc share player |

Renderer boundary: `render(spec, container, options) → { timeline, update(diff), lint() }`
(`src/render/index.ts`) — framework-free, future `<drawcast>` web component.

## Development

```bash
npm install
npm test        # vitest — all core logic is covered
npm run dev     # vite dev server
npm run build   # tsc + vite build (deployed to GitHub Pages on push to main)
```

No API key? Everything except AI generation works — load the bundled examples.

See [ROADMAP.md](ROADMAP.md) for what's next (interactivity: waits, quizzes,
chapters, math). [BRIEF.md](BRIEF.md) is the founding document inherited from
the `draw` experiment, kept for the record.
