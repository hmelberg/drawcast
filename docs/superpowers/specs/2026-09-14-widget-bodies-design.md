# Widget bodies: a template document that reacts to the viewer

**Status:** design agreed in chat 2026-09-14 (Hans + Claude), spec written
2026-09-14. Round 2 of "users extend drawcast themselves" (round 1 was code
controls, `2026-09-14-code-controls-design.md`, merged). Built on the
worktree `widgets` while the pane-controls round runs on its own worktree;
§8 lists the shared files and the merge rule.

## 1. The problem

Chess, the sounding keyboard and the drag and connect widgets each needed a
codebase round. Hans 2026-09-14: "The idea is that some of this could be
introduced by the users themselves if we have a widget system where they
can use js or python/brython/r to write code and allow this code to be
used. Maybe partly with some primitives in the codebase that makes it
easier." And: "It is not ONLY chess etc. We could also use it for
simulations we want to do (and show, and control, like a button that runs
something), or a visualization we want to introduce."

Code controls (round 1) now cover the simulation family: a script with
sliders and a Button that feeds a panel and a figure. What remains is
everything where the viewer acts on the figure itself — clicks on parts,
a sound on a press, state that accumulates across several actions, a
multi-step task, judging a sequence. Morse code, Tower of Hanoi, logic
gates, a fretboard, a tax game all sit there.

Measured on chess (875 lines), the host surface those widgets consume is
small — pure hit geometry, tone playback, param preview, glow and the
laser pointer, the ask gate — and the plumbing around it (394 lines) is
what the codebase should provide once.

## 2. Design

### 2.1 The extension unit is the template document

A template document (`src/scenes/doc.ts` `TemplateDoc`) gains one optional
body next to `layout`:

```yaml
template: morse_key
title: Morse code key
version: 1
kit: 10
status: ready
description: >-
  A telegraph key with a dot pad and a dash pad, the sent signal as a strip
  of dots and dashes, the decoded letters, and a small code chart. The
  viewer can tap the pads while paused; an ask can require a word.
params:
  type: object
  properties:
    word:    { type: string,  description: "Word the chart highlights, e.g. SOS" }
    chart:   { type: boolean, description: "Show the code chart (default true)" }
    signal:  { type: string,  description: "Sent signal so far (the widget sets this; leave empty)" }
    decoded: { type: string,  description: "Decoded letters so far (the widget sets this; leave empty)" }
element_ids:
  key_dot: the dot pad (tap to send ·)
  key_dash: the dash pad (tap to send −)
  key_gap: the gap pad (tap to end a letter)
  signal: the strip of sent dots and dashes
  decoded: the decoded letters
  chart: the code chart
layout: |
  const C = kit.COLORS;
  const drawables = [], labels = [], anchors = {}, order = [];
  const push = (d) => { drawables.push(d); order.push(d.id); };
  push(kit.pad("key_dot",  [300, 420], "·", { r: 40 }));
  push(kit.pad("key_dash", [420, 420], "−", { r: 40 }));
  push(kit.pad("key_gap",  [540, 420], "gap", { w: 90, h: 60 }));
  push(kit.text("signal",  [500, 300], params.signal ?? "",  { fontSize: 40 }));
  push(kit.text("decoded", [500, 230], params.decoded ?? "", { fontSize: 32 }));
  if (params.chart !== false) push(kit.group("chart", chartRows(kit, params.word)));
  anchors.key_dot = [300, 420];
  return { drawables, labels, anchors, order };
widget: |
  const CODE = kit.MORSE;
  const decode = (s) => Object.keys(CODE).find((k) => CODE[k] === s) ?? "?";
  const same = (state) => ({ state, effects: [] });

  const init = () => ({ signal: "", letter: "", text: "" });

  const on = (ev, st) => {
    if (ev.type !== "click") return same(st);
    if (ev.id === "key_dot" || ev.id === "key_dash") {
      const sym = ev.id === "key_dot" ? "." : "-";
      const next = { ...st, signal: st.signal + sym, letter: st.letter + sym };
      return { state: next, effects: [
        { sound: { hz: 700, ms: sym === "." ? 80 : 240 } },
        { patch: { signal: next.signal } },
      ]};
    }
    if (ev.id === "key_gap") {
      const next = { ...st, letter: "", text: st.text + decode(st.letter), signal: st.signal + " " };
      return { state: next, effects: [
        { patch: { signal: next.signal, decoded: next.text } },
        { answer: next.text },
      ]};
    }
    return same(st);
  };

  const demo = (scene, answer) => [...answer.toUpperCase()].flatMap((ch) =>
    [...(CODE[ch] ?? "")].map((sym) => ({ pointer: sym === "." ? "key_dot" : "key_dash",
                                          sound: { hz: 700, ms: sym === "." ? 80 : 240 } }))
      .concat([{ pointer: "key_gap" }]));

  const judge = (given, answer) => given.trim() === answer.trim().toUpperCase();

  return { init, on, demo, judge };
```

Everything above `widget:` is a template as it is today. A document with a
`widget` body is **playable while paused** by that fact alone; it declares
nothing in `interactions:` (the on-demand author prompt forbids that list,
and the body is the declaration). `docToManifest` sets `manifest.widget:
true`; `compileTemplateDoc` compiles the body once into
`module.widget: () => WidgetBody` — a factory, so every mount gets a fresh
closure.

**Where documents live.** In a pack (`src/scenes/packs/widgets.yaml`, §5),
in the user library, or inside a cast as `spec.templates[]` — the
on-demand round already stores template documents in the cast, so an
AI-authored or hand-written widget travels with the drawcast and needs no
library step. The author prompt (`src/llm/prompts/author-v1.md`) learns the
contract in §2.7.

### 2.2 The contract: a pure function

```js
// widget body — compiled like the layout body:
//   new Function("kit", `"use strict";\n${doc.widget}`)  → must return:
init(scene)                    -> state
on(event, state, scene)        -> { state, effects }
demo(scene, answer)            -> effects            // optional: the movie form
judge(given, answer)           -> boolean            // optional: for asks
```

- **State** is plain JSON data the host holds and passes back in. It is
  never global. The host discards it (§2.5) exactly when it discards the
  preview.
- **The body never touches the DOM, timers or the player.** It receives
  events and returns effects; the host performs them. This is what makes a
  widget node-testable, runtime-neutral and free of teardown registries —
  and what keeps trust where it is today: a widget body runs the way a
  layout body already does (`new Function` at authoring and playback),
  so this round opens no new door.
- **A widget never draws.** It changes params; the layout body draws them.
  This reuses the preview, scrub and Continue machinery unchanged and keeps
  one truth about what is on screen (the panel-view rule).
- `kit` is passed for its pure helpers (`parseNotes`, `MORSE`, geometry);
  drawables built inside a widget are ignored.

**Events (v1: one).**

| Event | Fields | When |
| --- | --- | --- |
| `click` | `id` (hit part id), `point` (logical, y-up), `domain` (spec-domain units when the spec has a domain, else `null`) | a paused click that lands on one of the widget's parts |

`key`, `tick`, press duration and `result` (running a code element from a
widget) are deliberately not in v1; each waits for a lesson that needs it.

**Effects (v1: six).** An effect is an object with one or more of these
keys; the keys of one object are performed together (so `demo` may pair
`pointer` and `sound`):

| Effect | Shape | Performed as |
| --- | --- | --- |
| `patch` | `{param: value, …}` | `Player.previewParams(overrides)` merged with the widget's earlier patches; unknown params (per `templateParamIssues`) are dropped with a console warning |
| `sound` | `{hz, ms}` or `{notes: "C4:q", tempo?}` | new `ToneLike.beep(hz, ms)`, or the existing `play([{notes}], tempo)` |
| `glow` | `id` or `[ids]`, optional `color` | the answer glow (`ANSWER_GLOW_MS`) on those parts, through a new public `Player.glow(ids, ms, color?)` |
| `pointer` | `id` | the laser taps the part's box (`pointerPath(…, "tap")` → `setPointer`), through a new public `Player.tapAt(box, ms)`; awaited in `demo` |
| `caption` | `text` | the caption band, through a new public `Player.caption(text)`; cleared with the preview |
| `answer` | `value` (string) | remembered as the widget's current answer; the ask gate reads it (§2.4) |

Unknown effect keys are ignored with a console warning; a body that throws
is caught, logged and the state left unchanged. Nothing a widget returns
can escape the host.

**`answer` means "done".** The ask gate judges the FIRST `answer` effect it
receives and settles (§2.4), so a widget emits `answer` only when the
viewer has finished — a solved tower, a lit bulb, a pressed send pad —
never a provisional value on every step (found in review 2026-09-15: the
first Morse draft answered at every letter gap and SOS was judged wrong
after the S; the fix was a send pad, not a lenient gate, because a gate
that swallowed wrong answers would mute the ask's `wrong` line).

**Scene** (`WidgetScene`, `src/scenes/widget-scene.ts`, pure): `ids` (the
widget's parts, §2.3), `boxes: Map<id, BBox>`, `rings: Map<id, Pt[][]>`,
`params` (the template params as painted, including the widget's own
patches), `vars`, `toDomain(p)` / `toLogical(p)` (from `domainMapping` and
a now-exported `inverseDomainMapping`). Anchors are not published in v1
(they never reach `LayoutResult`); `boxes` centres cover the examples.

### 2.3 The host

`src/ui/widget-host.ts`, attached from `attachPlayerControls`
(`src/ui/controls.ts` ~line 1013, beside `attachChessPlay`), no-op unless
`scenes[hd.spec.template]?.widget` exists.

- **Parts.** The widget's parts are the ids the template layout returned
  for the current params (`order` plus every group child) — template part
  ids are unprefixed in the layout, so this is exactly the template's
  drawing. A click elsewhere keeps today's meaning (resume, card).
- **Mount.** On the first paused click that hits a part: `state =
  init(scene)`. On every hit: `on({type: "click", id, point, domain},
  state, scene)` → perform effects → keep the new state.
- **Precedence.** The info card's `targetAt` stands aside for widget parts
  the way it does for chess and piano hit areas (`infocard.ts` ~224), so a
  pad never opens a card. Gates (`gateIsOpen`) win over free play as today,
  except the widget gate itself (§2.4), which routes through the same host.
- **Cursor.** The existing `cs-cardable` hover class is set over widget
  parts while paused, so a part reads as clickable; no new markers.
- **Playing stays clean.** No listener does anything while
  `hd.timeline.state === "playing"`.

### 2.4 Asks bind to a widget

A spec has one template (`spec.template`, `spec.params`), so the binding
names it:

```yaml
- ask:
    question: "Send SOS on the key."
    widget: morse_key        # the spec's template, which carries a widget body
    answer: SOS
    right: "Three short, three long, three short."
```

`AskArgs.widget` becomes `string`; the schema keeps the six built-in names
in its description and adds "or the name of the spec's template when that
template has a widget body". Semantic validation (`schema.ts`): a value
that is neither a built-in name nor `spec.template` is an error. A template
name whose document has no widget body is the lint rule `widget` (§2.6),
because cast templates register at runtime, after schema validation.

**The gate** (`widgetGateFor(stage, hd)` in `widget-host.ts`, dispatched
from `controls.ts` ~983 when `step.widget === hd.spec.template`): mounts the
host if needed, shows the figure gate's hint pill and Skip (the markup
`figureGateFor` uses), and resolves when the widget emits an `answer`
effect: `judge(given, answer)` when the body defines it, else
`answersMatch`. The gate keeps the contract every gate has — **it resolves
a string**: the step's `answer` on a correct judgement (so the player's
`answersMatch` agrees), the given string otherwise (so retry and feedback
work unchanged). `retry` and `required` behave as for `click`.

**The movie / auto path** (`player.ts` ~826, the branch for widget asks):
when the step's widget is the template, the player calls `demo(scene,
answer)` if defined and performs the effects in order, awaiting `pointer`
taps (900 ms each, the existing tap timing) and sounding `sound`; without
`demo`, the default is one laser tap on the template's box. `typed =
answer` afterwards, as today. The export bypass is unchanged (widget asks
never reach the export's typing card). The plan step carries
`widgetTemplate: true` so the player does not consult the registry to
decide the branch.

### 2.5 What persists: nothing

State and patches are preview state. The host resets (`state = undefined`,
patches dropped, caption cleared) on: play resumed, a step boundary
(`onStep`), a scrub (`jumpTo` → `onStep`), and Continue ▶ (the tray's
`restore` → `renderUpTo`, which repaints honest geometry; the host's
`onState`/`onStep` chain notices). An `ask` with `store` stays the only
persistence channel — a widget that wants a remembered answer emits
`answer` and lets the ask store it. This is the one-movie rule from round
1.

Known v1 limitation: the tray's own preview (sliders) and the widget's
patches both call `previewParams`; whichever moved last wins, and a tray
repaint drops widget patches. Documented, not solved — the lessons in §5
do not combine the two.

### 2.6 Validation, lint, errors

- `validateTemplateDoc`: `widget` must be a string when present.
- `compileTemplateDoc`: the body compiles and, called once, returns an
  object whose `init` and `on` are functions (`demo`, `judge` optional
  functions); anything else is a doc error like a bad layout.
- Lint rule `widget` (`src/lint/lint.ts`, in `lintCommands`): `ask.widget`
  names the spec's template but the registered document has no widget body
  → error. (An empty `answer` needs no rule: the schema already requires
  `answer` on every non-drag widget ask.)
- Runtime: effects validated at perform time as in §2.2; a throwing body is
  contained.

### 2.7 What the model sees

- `compiler-v1.md`, the `ask` bullet (~line 101): one clause — `widget` may
  also be the spec's template name when that template carries a widget
  body; the widget's `answer` is what the lesson compares.
- `schema.ts`: the `widget` description gains the same sentence; the
  property type becomes `string` (anyOf-free).
- `author-v1.md` (the on-demand template author): a paragraph with the
  contract of §2.2 (init/on/demo/judge, the click event, the six effects,
  "never draw — patch params") and the rule that a widget-bearing template
  declares the params its widget patches, with the Morse document as the
  example. Only the ask sentence touches the compiler prompt, so the
  prompt-size delta is one clause; both pins are re-pinned with a dated
  note (feedback rule 2026-09-10).

### 2.8 Primitives added for authors

- `kit.circle(c, r, n?)` → `Pt[]`, `kit.rect(x, y, w, h)` → `Pt[]`
  (point lists, like `ellipse` and `polygon`).
- `kit.pad(id, at, label, {r} | {w, h}, opts?)` → a group: a closed
  paper-filled outline (`<id>`) plus a centred label (`<id>__label`), so
  `elementRings` hit-tests the outline and the pad looks the same in every
  widget. `KIT_VERSION` → 10 (pins in `tests/scene-kit.test.ts` and
  `tests/kit-smooth-closed.test.ts`).
- `kit.MORSE`: the International Morse table (letters and digits), pure
  data, so Morse widgets and charts share one source.
- `ToneLike.beep(hz, ms, signal?)`: one oscillator with the existing
  envelope, in `WebAudioTones` and every fake.
- `Player.glow(ids, ms, color?)`, `Player.tapAt(box, ms)`,
  `Player.caption(text | null)`: public wrappers over the private
  `glowWhile`, `pointerPath` + `setPointer`, and `showCaption`.
- `inverseDomainMapping` exported from `src/layout/layout.ts`.
- `runWidget(module, params, events, opts?)` in `src/scenes/widget-run.ts`
  (pure): builds a scene from the layout at those params, feeds the events,
  returns `{states, effects, errors}`. The node test harness for authors,
  and what the examples gate uses (§3).

## 3. Testing and evidence

Pure modules first (no jsdom in this repo):

- `tests/widget-doc.test.ts`: `validateTemplateDoc` accepts/rejects
  `widget`; `compileTemplateDoc` returns a factory, rejects a body without
  `init`/`on`; `docToManifest` sets `widget: true`.
- `tests/widget-run.test.ts`: the harness on the Morse document — a click
  sequence for "SOS" yields the expected patches, sounds and final
  `answer`; `judge` accepts "SOS" and rejects "SOO"; `demo("SOS")` yields
  nine pad taps and three gap taps; a body that throws is reported in
  `errors`, not thrown.
- `tests/widget-effects.test.ts`: effect validation — unknown keys, bad
  shapes, unknown params dropped with a warning.
- `tests/widget-lint.test.ts`: every rule in §2.6, each with a spec that
  trips it and one that does not.
- `tests/scene-kit.test.ts` (extend): `circle`, `rect`, `pad` shapes and
  ids; `elementRings` finds a pad's outline. Version pins re-pinned.
- `tests/tones.test.ts` (extend): `beep` schedules one oscillator for `ms`.
- Schema test: `ask.widget` accepts the template name, rejects an unknown
  string.
- `tests/widget-host.test.ts`: a behaviour test on the host's DOM-free core
  (`widgetHostFor(hd)` against a fake handle: one click on a part → one
  beep, one `previewParams`, one glow, in order; an answer published; reset
  forgets everything) — the ghost-round lesson: behaviour, not only pins —
  plus source pins on the stage listener, the attach order in `controls.ts`,
  the reset hooks and the info card's stand-aside.
- Examples gate (`tests/examples.test.ts`): the three widget templates lint
  clean with zero warnings; additionally every ready template with a widget
  body runs `runWidget` with one click per part and must report no errors.

Evidence before "done": Hans' smoke checklist
(`docs/superpowers/plans/2026-09-14-widget-bodies-smoke.md`): tap the Morse
pads while paused and hear the tones and see the strip; the SOS ask judges
right and wrong; the movie demo taps the pads with sound; Continue restores;
Hanoi refuses an illegal move and glows on the solved tower; the gates
example lights the bulb.

## 4. Out of scope (this round)

- `run`/`result` (a widget executing a code element) — code controls cover
  simulations; add when a widget needs a real computation.
- `key`, `tick`, press duration, hover events.
- Anchors on the scene object (needs `LayoutResult.anchors`).
- A ⊕ pill or context-menu launcher for free play (touches `tray.ts`,
  which the pane-controls round owns; pause + click is the door for now).
- Python or R widget bodies (the envelope route) — JS only in v1.
- The tray/widget preview collision (§2.5).
- Persistence of widget state; branching.

## 5. Bundled examples (`src/scenes/packs/widgets.yaml`, pack `widgets`)

1. **Morse key** (`morse_key`, above, plus a fourth `key_send` pad): dot,
   dash, gap and send pads, signal strip, decoded text, code chart. Gap
   ends a letter; send closes an open letter and emits the `answer` (the
   "done" rule above). Example cast: "Teach Morse code" — the chart, the
   rhythm of SOS, then `ask … widget: morse_key, answer: SOS`. Exercises
   every effect and the ask binding.
2. **Tower of Hanoi** (`tower_of_hanoi`): params `disks` (3–5) and `pegs`
   (three stacks, widget-patched); state = pegs + selected peg; a click on
   a peg selects, a second click moves the top disk if legal (smaller on
   larger), an illegal move glows the target red, the solved tower glows
   green and emits `answer: "solved"`; `demo` performs the optimal
   solution. Example: "The Tower of Hanoi puzzle" with an ask
   `answer: solved`. Exercises state, multi-step input, glow, demo.
3. **Logic gates** (`logic_gates`): params `gate` (AND/OR/XOR/NAND),
   `a`, `b` (widget-patched booleans); drawn with the kit's `switch`,
   `bulb` and `battery` stamps; a click on a switch toggles it, the bulb
   lights per the gate's truth table, a caption reads the row. Example:
   "How an XOR gate works" with an ask `answer: "1,0"` ("find an input
   that lights the bulb"; `judge` accepts any lighting row). Exercises
   stamps, toggles, caption.

Each example is in `src/examples.json` with `packs: ["widgets"]` and
passes the gate in §3.

## 6. Build order

1. Doc, compile, manifest, module (`widget` body) + tests.
2. Kit primitives (`circle`, `rect`, `pad`, `MORSE`), `beep`, Player
   wrappers, `inverseDomainMapping` export + tests.
3. `widget-scene.ts`, effect validation, `widget-run.ts` harness + tests.
4. Host: attach, parts, mount, click routing, effects, resets; info-card
   stand-aside; cursor; mini-DOM test.
5. Ask binding: types, schema, validation, plan flag, gate, player demo
   path, lint rule, prompt clause, author paragraph, prompt-size re-pin +
   tests.
6. Pack `widgets.yaml` with the three documents, examples, examples-gate
   extension, help paragraph, ROADMAP entry, smoke checklist.
7. `npm test` + `npx tsc --noEmit` clean; merge main; re-measure the
   prompt-size pins after the merge (§8); push.

## 7. Authoring ergonomics (why this is easy enough)

An author writes one YAML document. Params, element ids and the layout are
what a template is today; the widget body is thirty lines of plain
functions. The harness in §2.8 lets them (or the on-demand author) test a
click sequence in node without a browser, the lint says what is missing,
and the three documents in §5 are the documentation the author prompt
copies from.

## 8. Working beside the pane-controls round

Shared files this round touches, kept to small localized edits:
`src/spec/types.ts` (AskArgs only), `src/spec/schema.ts` (the ask `widget`
property and its semantic check only), `src/lint/lint.ts` (one union member
+ one rule), `src/llm/prompts/compiler-v1.md` (the ask bullet only),
`tests/prompt-size.test.ts` (re-pin), `src/examples.json` (append),
`ROADMAP.md` and `public/help.html` (append). Not touched: the code element,
`src/ui/tray.ts`, `src/layout/code.ts`, `src/ui/tray-model.ts`. Merge rule:
merge `main` into `worktree-widgets` before the final verification; on a
pins conflict, re-measure both constants after the merge rather than
picking a side.
