# Explanation styles design

2026-08-26. Status: approved direction, not yet implemented.

## Problem

Every drawcast follows the same rhetorical skeleton baked into the compiler
prompt: announce the goal, ground in an example, narrate draws step by step,
synthesize. The result is correct but monotonous — one lecturer, one register,
one shape. The interesting material (controversy, history) is welded into
`#verylong`, so color is only available by buying length.

## Design principles

1. **Screen-first.** Something must happen on the canvas within seconds, and
   keep happening. Speech rides on action; the viewer watches a drawing being
   made, they do not listen to a podcast with occasional pictures. This rule
   outranks every style: a hook, a dialogue exchange, or a story beat that
   parks the canvas is wrong regardless of how engaging the words are.
2. **The aha mandate (untagged, universal).** Every drawcast identifies the one
   insight — the sentence the viewer could not have said before watching —
   builds so everything converges on that reveal, and ends by naming what the
   viewer can now see. This lives in the base prompt for all drawcasts.
3. **Choose, don't stuff.** The model picks at most ONE enrichment ingredient
   that genuinely fits the topic (two for `#long`/`#verylong`), and skips them
   all if none earns its place. Tags exist to force a particular choice, not to
   enable the behavior.
4. **Truthfulness guardrail.** Ingredients that reference reality (controversy,
   history, people, numbers) carry one shared brief line: only include claims,
   people, and numbers you are confident are real; if unsure, choose a
   different ingredient. Never manufacture a controversy or a statistic.

## Four orthogonal dials

- **Form** (who is talking) — exclusive group `style` (renamed from
  `teaching`): lecture (default, no tag), `#socratic` (exists, joins the
  group), `#qa`, `#podcast`, `#story`.
- **Hook** (how it opens) — exclusive group `hook`: announce (default),
  `#question`, `#debate`, `#provoke`.
- **Ingredients** (extra content) — composable, one group each: `#why`,
  `#controversy`, `#history`, `#facts`, `#proscons`.
- **Tone** (how it sounds) — exclusive group `tone`: neutral-warm (default),
  `#fun`, `#dry`, `#pun`.

Separate from the dials: **voice tags** (`#male` / `#female`, exclusive group
`voice`) select the narrator's voice rather than shaping the writing — see
Phase 2.

All single-token; surfaced by the existing autosuggest popup and chips.

### Tone briefs (Phase 1)

Humor is opt-in (taste varies; default stays neutral but warm) and every tone
brief carries the same restraint clause: **at most 1–2 light touches per
drawcast, never forced — exaggerated humor bores fast — and the explanation
stays rigorous.** Humor must never delay the ink: a joke rides on a narrated
action like any other sentence (screen-first outranks tone).

- `#fun` — allow a slightly playful register, and — the best mechanism — let
  the CONCRETE EXAMPLE itself be quirky or gently absurd, tongue-in-cheek
  (supply and demand of umbrella rentals in a rainstorm; a zombie outbreak for
  SIR). The numbers stay real and the reasoning stays exact; only the setting
  winks.
- `#dry` — deadpan understatement: one or two dry asides delivered straight,
  no exclamation marks, the joke never announced.
- `#pun` — one, at most two puns, placed at reveals where the pun lands on
  something now visible on the canvas; never in the opening line.

## Phase 1 — prompt + tags + lint (no schema change)

### Base prompt changes (compiler-v1.md)

- **Screen-first opening.** Replace the current "the FIRST command is a
  standalone speak" rule: the opening line rides ON the first draw command —
  voice and ink start together. At most one short standalone speak line before
  the first ink, and only when the figure gives it a reason. Keep the spirit of
  "never a teaser question over a blank canvas" but reframe: hooks are welcome
  *while drawing*, forbidden *instead of* drawing.
- **Talky-stretch cap.** Never more than two consecutive speak-only commands
  anywhere; between sentences something happens (draw, point, highlight,
  animate, erase, camera). Prefer attaching speech to actions throughout.
- **Aha mandate** (principle 2) as a short "Make it land" section.
- **Ingredient choice** (principle 3): the default behavior when no ingredient
  tag is present.

### Tag changes (tags.ts)

- Rename group `teaching` → `style`; `#socratic` unchanged otherwise.
- New `hook` group, each brief written draw-under:
  - `#question` — pose a real puzzle while drawing the setup; the figure
    answers it.
  - `#debate` — voice two claims while drawing both candidate pictures; resolve
    by drawing the truth and striking the loser (annotation `strike`). Works in
    single-voice lecture ("Economists said X. Farmers swore Y. The picture
    shows who was right.").
  - `#provoke` — state the common belief while drawing the naive picture, then
    correct the picture visibly (erase / redraw / animate). Only for beliefs
    people actually hold (guardrail applies).
- New ingredient tags, one group each so they stack: `#why` (stakes),
  `#controversy`, `#history` (people and origin), `#facts` (real numbers /
  empirical evidence), `#proscons`. Briefs say "within the length budget" so
  short formats stay short. `#controversy`/`#history`/`#facts`/`#provoke`
  share the guardrail sentence (principle 4).
- New `tone` group: `#fun`, `#dry`, `#pun` with the briefs above (restraint
  clause shared, quirky-example mechanism in `#fun`).
- **`#verylong` refactor:** remove the hard-coded controversy/history clauses;
  length buys lines and raises the ingredient allowance to two, ingredients
  decide the content.

### Lint (new command-level checks, feeding the existing revise loop)

- `slow-start` (warn): more than one speak-only command before the first draw.
- `talky-stretch` (warn): more than two consecutive speak-only commands.

Both surface in the lint report the revise loop already feeds back to the
model, so violations self-correct.

### Tests

Tag parsing and group exclusivity, brief content (guardrail present, verylong
no longer mentions controversy), the two lint rules, prompt-assembly snapshots.

## Phase 2 — dialogue forms + two voices

### Spec

Optional `voice?: "a" | "b"` on any command that carries `speak`. Absent =
today's single voice; old specs unaffected. Schema description tells the model
the field only means something with `speak`.

### Voices

- **Cloud TTS (video export):** `VOICES` becomes a pair per language —
  en: `en-US-Neural2-F` (a) + a male Neural2 (b); nb: `nb-NO-Wavenet-E` (a) +
  a male Wavenet (b). Synthesis cache keys on (text, voice). Same 400-fallback
  as today if a name drifts.
- **Browser playback:** a second scored voice per language. nb already has the
  pair in the GOOD list (Nora = a, Henrik = b); en gets a small known-name
  gender heuristic on top of the existing scoring. If only one decent voice
  exists, both speakers share it — dialogue still plays, just less vividly.

### Voice tags: `#male` / `#female`

`#male` / `#female` pick the narrator's gender — for a single-voice drawcast
the narrator, for dialogue forms the lead teacher (B in `#qa`), with the other
speaker getting the contrasting voice. No tag = today's defaults.

These tags contribute no brief. Instead the parser stamps the choice
deterministically into the spec as `meta.voice` ("male" | "female"), and both
speech backends read it when selecting voices. This amends the rule in
tags.ts's header ("a tag changes what the AI writes — never how the app
plays"): the honest rule is **a tag changes what lands in the SPEC — commands
or meta — never Settings.** The voice is part of the authored work, so a saved
or exported drawcast replays with the voice it was made with; Settings keeps
owning device-level playback (rate, explicit voice override, which wins over
meta.voice when set).

### Style tags (form group)

Every dialogue brief carries the whiteboard rule: **two people at a
whiteboard, not two people at microphones** — lines attach to draw / point /
highlight / animate wherever possible, and the talky-stretch cap holds.

- `#qa` — A asks and reacts, B answers and draws. A is not a question machine:
  A also mis-guesses, says "oh — so the gap IS the loss?", and summarizes; A's
  wrong-guess-then-correction is where the aha lands. A's reactions can ride on
  gestures (point at the thing being asked about). Scales with length: short
  qa = one question, one drawn answer, one reaction.
- `#podcast` — two peers, informal; either may draw and narrate; interruptions
  and finished-by-the-other sentences welcome, but always over a moving canvas.
- `#story` — explain through a historical episode or running character, drawn
  as it is told (timeline, data points, schematic appearing beat by beat). The
  natural home for people-behind-the-concept material. Single voice by
  default; may combine with nothing in the hook group (a story IS the hook).

### Fewshot

One dialogue few-shot in `fewshots.json` showing the `voice` mechanics
concretely — the lecture-style exemplars would otherwise drown the
instruction.

### Tests

Schema/extract round-trip of `voice`, player passes voice to the speech
manager, browser pair selection (nb pair, en heuristic, single-voice
fallback), cloud request carries the right voice name, cache keyed per voice,
dialogue brief content, `#male`/`#female` → `meta.voice` stamping and voice
pick in both backends (and Settings override winning).

## Out of scope / later

- **`#old` / `#young`:** deferred. Neither Google Cloud TTS nor browser voice
  catalogs have an age axis, so the honest implementations are a crude pitch /
  rate shift (sounds gimmicky fast) or a persona brief that shades the writing
  (an old professor's register, a young enthusiast's). The persona-brief
  variant may return as tone-adjacent tags once the tone group has proven
  itself; a pure playback fake does not.
- Visual speaker indicator (captions, name chips) in the player.
- Voice choice UI in Settings for the second speaker.
- Autosuggest popup group headers (revisit when the vocabulary passes ~20).
- Making any dialogue form the default; lecture stays the default.

## Risks

- Exemplar pull: user-library exemplars are lecture-style; briefs override
  explicitly and the Phase 2 fewshot anchors the dialogue mechanics.
- Fabrication: guardrail sentence (principle 4) on every reality-referencing
  ingredient.
- Dialogue in `#veryshort`: briefs scale the exchange down rather than
  forbidding the combination.
