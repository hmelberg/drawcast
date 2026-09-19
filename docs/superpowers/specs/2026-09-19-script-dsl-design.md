# Script — a drawcast written the way it is performed

Status: IMPLEMENTED 2026-09-19, both phases. §7 (named places and
auto-placement): plan docs/superpowers/plans/2026-09-19-named-places.md.
§3-§6 and §8-§10 (the script format): plan
docs/superpowers/plans/2026-09-19-script-format.md — 8686 tests, tsc+build
green, and the round-trip gate (tests/script-roundtrip.test.ts) holds all
258 bundled examples and every scene pack's params. §6's sugar (aliases,
`->`, colour words, quiz choice lists) and §11's two lint rules are phase
3, deliberately not built. Brainstormed with Hans in four decisions (§2).

Deviation from §12's task list, found while implementing: `text` and `math`
each carried their own copy of the rule "needs x and y, or at.ref", which
would have refused an element placed with `at.place`. Both now read one
`placedByAt` helper in src/spec/schema.ts, and a place counts as a position.

## 1. What this is

A third text format for a drawcast, alongside YAML and JSON, called
**script**. It is what the editor shows and what a person writes. The
spec object is unchanged; script is a *projection* of it — parsed into a
Spec on the way in, printed from a Spec on the way out.

The problem it solves is measurable. The economic-circuit example
(`examples.json`, "Det økonomiske kretsløpet") is two boxes and two
arrows. In YAML it is 68 lines, every id written twice, in two lists you
must scroll between:

```yaml
elements:
  - id: hush
    type: node
    shape: rect
    text: Husholdninger
    x: 220
    'y': 375
  ...
commands:
  - draw: [hush, bedr]
    speak: 'To slags aktører: husholdninger som eier arbeidskraften, og bedrifter som lager varene.'
```

The same cast in script is 14 lines and contains no coordinates and no
repeated ids:

```
# Det økonomiske kretsløpet

To slags aktører: husholdninger som eier arbeidskraften, og bedrifter som lager varene.
    box hush "Husholdninger"  left
    box bedr "Bedrifter"      right

Bedriftene betaler lønn. Pengene går fra bedriftene til husholdningene.
    arrow lonn  bedr -> hush  curved #2f6b8f
    label lonn  below "Lønn og inntekt"

Husholdningene bruker pengene på varer. Da går de tilbake til bedriftene.
    arrow kjop  hush -> bedr  curved #b5482e
    label kjop  above "Kjøp av varer"

Pengene sirkulerer. Det én bruker, er det en annen tjener.
    flow lonn kjop
```

Two goals pull against each other and both are kept: **simple** — a
teacher writes the lesson as a script, and the geometry is optional;
**rich** — every element type, every verb, every field of the spec stays
reachable, because the grammar has a generic form that covers all of
them by construction (§5.4).

## 2. The four decisions taken

1. **Script is the editor's one text format**, not a one-way front end.
   It parses *and* prints, so an AI-written cast is shown as script and
   can be hand-edited in the same language it was written in. This makes
   lossless round-trip a hard requirement (§9).
2. **Prose-first shape.** Indentation alone separates the voice from the
   machine (§3). Rejected: sigil-marked spoken lines (`> …`), and a
   cast-list-then-script layout that would have kept ids written twice.
3. **The spec gains named places and auto-placement** (§7) so a script
   need not contain a single coordinate, and the words survive the round
   trip because the spec now stores them.
4. **The model keeps emitting JSON.** Teaching it to emit script is a
   separate round with its own A/B on cost and quality; the printer built
   here is what makes that experiment cheap.

## 3. The whole language is three indentation rules

```
Column 0, plain text     a spoken line — it opens a beat
Indented                 a stage direction, in the beat above it
Indented deeper          details of the direction above it
Blank line               ends the beat
```

Flush-left is the voice; indented is the machine. Everything else in
this document is vocabulary.

- Two spoken lines in a row are two beats, the first with no directions.
- A direction block with no spoken line above it is a **silent beat**.
- Indentation is relative, not a fixed column count: "deeper than the
  line it belongs to". Tabs count as one level.

Line kinds at column 0:

| Line | Meaning |
|---|---|
| `# Cast title` | the document's title (§8.1) |
| `## Page title` | starts a new playlist item |
| `key: value` | a setting, where `key` is a known setting name (§4) |
| `@name` | a jump label, attached to the beat that follows |
| `A:` / `B:` prefix | dialogue — that line is read by voice a / voice b |
| `// …` | a comment |
| anything else | a spoken line |

The collision risk is a spoken line that begins with a known setting name
and a colon ("Kort sagt: …"). The set of setting names is closed and
small, and none of them is a Norwegian or English sentence opener, so the
rule is: `word:` at column 0 is a setting **only if `word` is in the
list in §4**. Lint warns when a spoken line looks like a mistyped
setting or direction (§11).

## 4. Settings

`key: value` at column 0. Before the first `##` they belong to the
playlist; after one, to that page.

Page settings map to spec fields of the same name: `lang`, `voice`,
`level`, `record`, `canvas`, `domain`, `vars`, `text`, `zoom_from`,
`template` (spelled `use:`) and `params` (spelled `with:`). A
`chapter:` line written *before* a `##` emits a playlist chapter entry
ahead of that page — chapters are entries of their own, not fields of a
page. Playlist settings: `subtitle`,
`advance`, `gap`, `transitions`, `next`, `enroll`, `prompt`.

Values use the value grammar of §5.3, so these are all valid:

```
lang: nb
domain: x 0..10, y 0..1000
vars: beta 0.3, gamma 0.1
use: sir_model
with: beta 0.3, gamma 0.1, box right
```

A setting whose value is deep (a template's `params` with a list of
force objects) takes an indented block underneath, which is read with the
same key/value grammar, `-` starting a list item:

```
use: free_body
    body box
    incline_deg 30
    forces:
        - gravity "F_g = mg" angle 270 mag 0.8 red
        - normal "N" angle 120 mag 0.8
```

## 5. Directions

### 5.1 One shape for everything

```
<head> [id] [shorthands…] [key value]… ["text"]
    key value            # deeper indent: more of the same direction
```

`<head>` is either an **element type** (or one of its aliases) — which
declares the element *and* draws it in this beat — or a **verb**, which
acts on elements that already exist.

**One direction line is one command.** The beat's spoken line rides on
the first command of the beat; the rest follow it, silently, in order.
This is exactly how the corpus is already written: of 896 commands in
`examples.json`, **none** carries more than one verb. Where genuine
simultaneity is wanted (one Command object holding `draw` *and*
`camera`), a verb written as a *continuation* — indented deeper than the
direction above it — merges into that same command instead of starting a
new one.

### 5.2 Ids you rarely write

- A bare word before the quoted text is the id: `box hush "Husholdninger"`.
- With no bare word, **the quoted text gives the id**: `box "Husholdninger"`
  → `husholdninger` (slugged, deduped with `_2`).
- With neither, the id is `<type>_<n>`.
- For a text-less element the first bare token is the id unless it is in
  the shorthand vocabulary: `curve growth rising convex` → id `growth`;
  `curve rising convex` → id `curve_1`.

The first bare word does not mean "id" for every head. Four heads
spend it on the thing they are about, and take their own id from the
text (or an explicit `id foo`):

| Head | First bare word |
|---|---|
| `label` | `attach_to` — `label lonn below "Lønn og inntekt"` |
| `annotation` (`box`/`circle`/`strike`/`cross` marks) | `target` |
| `measure` | `of` |
| `inset` | `of` |
| everything else | the id |

A connector spends it on geometry when there is nowhere else for it to
go: with three bare words around the arrow (`arrow lonn bedr -> hush`)
the first is the id; with two (`arrow bedr -> hush`) they are `from` and
`to` and the id is generated.

That the shorthand vocabulary is closed is what keeps this unambiguous.
An element named after a shorthand (`box left "…"`) is a lint warning
with a clear message, not a silent misread.

### 5.3 Values

| Written | Parsed |
|---|---|
| `blue`, `rect` | string |
| `"Lønn og inntekt"` | string, quotes stripped |
| `30`, `-1.5` | number |
| `3s` | seconds → `duration: 3` |
| `0..10` | `[0, 10]` |
| `220,375` | `[220, 375]` |
| `a, b, c` | `["a", "b", "c"]` |
| `[{"id": "g", "angle_deg": 270}]` | inline JSON, verbatim |
| `true` / `false` | boolean |

### 5.4 Coverage is total by construction

Any field of any element or verb can be written as `key value`, and any
nested field as a dotted path — `style.color blue`, `draw.mode type`,
`at.gap 20`, `params.beta 0.3`. Combined with inline JSON for the
awkward tail (`points [[0,0],[10,5]]`), this reaches every one of the 37
element types and ~30 verbs on day one, with no per-verb work. Nothing
in the spec can become unprintable, which is what makes the round-trip
promise in §9 keepable.

The sugar in §6 is an alias layer over this generic form, and nothing
else. A ```` ```yaml ```` fence (§8.4) is the last-resort escape for
anything a future spec field invents before the sugar catches up.

## 6. The sugar layer

**Element aliases.** `box` / `circle` / `person` / `decision` / `chance`
/ `terminal` → `node` with that `shape`. `dot` → type `point` — which
frees the word `point` for the laser verb, which is what a teacher means
by it. `note` → `text`.

**Positional shorthands**, resolved per head (the same word fills
different fields depending on what it modifies — on a `label` a side word
is `side`, on a `box` it is `at`):

| Shorthand | Field |
|---|---|
| `blue`, `#2f6b8f` | `style.color` |
| `dashed`, `thick`, `thin` | `style.dash`, `style.stroke_width` |
| `curved`, `smooth`, `closed` | `curved`, `smooth`, `closed` |
| `rising` / `falling` / `flat` | `direction` |
| `convex` / `concave` / `linear` | `curvature` |
| `gentle` / `medium` / `steep` | `steepness` |
| `left`, `right`, `above`, `below`, `center`, `top-right`, … | `side` or `at` (§7) |
| `typed`, `instant` | `draw.mode` |
| `hidden` | declare without drawing |
| `parallel` | `parallel: true` on a draw |
| `3s` | `duration` |
| `a -> b` | `from` / `to` |
| `row`, `grid`, `ring`, `stack`, `fan`, `hex`, `zipper` | `arrange` with that `layout` |

A side word **followed by a bare id** is relative placement —
`above bedr gap 20` is `at: {side: above, ref: bedr, gap: 20}`. A side
word alone is `side` on a label and a canvas place on anything else
(§7).

**Quoted text on a connector** creates the attached label:
`arrow bedr -> hush "Lønn"` is the arrow plus a `label` with
`attach_to`. The printer folds a label back into its connector only when
the label carries nothing but `attach_to`, `text`, `side` and a style
matching its host — so the fold is reversible, which the corpus test
proves.

## 7. Places instead of coordinates

`at:` gains named values, and elements without a position get one.

```
    box "Husholdninger"                  # no position: placed for you
    box "Husholdninger" left
    label above bedr gap 20 "Produserer varene"
    note top-right "BNP = summen"
    row hush bedr stat gap 60            # arrange these three
```

Two changes in the engine, both in the layout, neither visible to the
model unless it chooses to use them:

1. **Named places.** `at` accepts `left`, `right`, `top`, `bottom`,
   `center`, and the four corners, resolved against the canvas (and
   against the template's free space when a template is in play). The
   existing relative form (`{ref, side, gap, anchor, offset}`) already
   covers "above bedr"; the DSL spells it in words.
2. **Auto-placement.** An element with no position is placed rather than
   defaulting to (0,0) or the canvas centre. Free `node`s already do
   this — `src/layout/tier2.ts:274` rings them deterministically — and
   the same treatment extends to boxes, text and shapes, with `row`,
   `stack` and `grid` as explicit hints.

Because the spec now stores the word, the printer prints the word back:
placement survives the round trip, and a hand-written cast stays
readable after the AI revises it. The model gets the vocabulary for free
and its casts get better placement without any prompt change.

## 8. The set-pieces

### 8.1 Pages and titles

`# X` titles the document — the playlist title when the file has `##`
pages, otherwise the single spec's `title`. Each `## Y` starts a page and
titles it. This replaces the `---` document separator.

### 8.2 Dialogue, labels and jumps

```
A: Hvorfor faller kurven til slutt?
B: Fordi det er færre igjen å smitte.

@spor
Hva skjer med toppen hvis vi halverer kontakten?
```

`A:`/`B:` set `voice`; a bare `A:` prefix is printed only when the spec
carries `voice: "a"` explicitly, so the round trip is exact. `@name`
sets `label` on the first command of the beat that follows.

### 8.3 Questions

```
    quiz "Hva skjer med toppen?"
        * Den blir høyere
        + Den blir lavere og senere
        * Ingenting skjer
        right "Nettopp — kurven flates ut."
        wrong_goto spor

    ask "Hvor mange blir syke?" answer 400
        widget click
        right "Riktig — toppen ligger rundt 400."
```

`*` is a choice, `+` is the correct one (→ `choices` + `correct`). Every
other field of `QuizArgs`/`AskArgs` is a continuation line, by the
generic rule.

### 8.4 Fenced blocks

A fenced block inside a beat whose info string is a known language is a
`code` element, and the fence language *is* its `language` field:

```
    ```python  right  lines 6  frame window
    import numpy as np
    beta = (0.1, 0.6)
    ```
```

A fence's content is dedented by the fence line's own indentation, and
its closing fence must sit at that same indentation.

Three reserved info strings: `yaml` (a raw spec fragment — the escape
hatch), `tex` (a `math` element's body), and `assets` (the base64
payloads, printed last, at column 0, so the readable part of the file
stays on top — the same ordering rule `specForDump`
(`src/spec/assets.ts`) already applies to YAML).

### 8.5 Beat modifiers

`pause 2` and `wait` are directions in their own right — they are their
own commands today and stay so. `delivery`, `blocking` and an explicit
`voice` modify the beat's first command instead of creating one; they
are rare, and the rule is stated in the reference rather than inferred.

## 9. The round-trip contract

**`parse(print(spec))` deep-equals `spec`**, for every spec in
`examples.json` (270), every scene pack under `src/scenes/packs/`, and
every fixture in `tests/`. Plus stability: `print(parse(print(spec)))`
is byte-identical to `print(spec)`.

The one structural risk is element *order*: the printer declares each
element at its first mention, which can reorder `elements`. Order is
not provably inert (drawing order, label collision), so it is preserved
instead:

- Measured: **92 of 121** specs with elements (76%) already have
  `elements` in first-mention order, so they inline cleanly.
- For the rest, the printer walks `elements` in array order and inlines
  an element only while that keeps the array order intact; an element
  that would have to move backwards is declared in a **props block** at
  the top of the page instead. Per element, not per page — so a spec
  with one stray element loses one line to the block, not its whole
  readable form.
- The 6% of elements that are never drawn or targeted (30 of 499) go in
  the props block by definition, or inline with `hidden` when their
  position in the array allows it.

## 10. Where it lands in the code

The integration surface is four functions, because everything already
goes through them.

| File | Change |
|---|---|
| `src/spec/script.ts` | **new** — `parseScript` / `printScript`, the grammar of §3–§8 |
| `src/spec/text.ts:10` | `SpecFormat` gains `"script"`; `parseSpecText` detects it; `formatSpec` routes to it |
| `src/playlist/playlist.ts:168,311` | `parsePlaylistText` splits on `##` for script; `formatPlaylist` prints pages |
| `src/layout/place.ts`, `tier2.ts` | named places + auto-placement (§7) |
| `src/main.ts` (~8 sites) | editor default format, blank-cast template |
| `src/ui/insert.ts` | the insert palette emits script snippets |
| `src/ui/lint-chip.ts`, `src/lint/lint.ts` | parse errors and the new lint rules (§11) |
| `src/llm/revise.ts`, `hoist.ts`, `src/course/load.ts` | format constant follows the editor |
| `src/ui/share.ts` | YAML and JSON stay as download formats |

**Format detection.** A stored document is YAML if it parses as YAML
into a mapping with a known top-level key (`title`, `elements`,
`commands`, `template`, `playlist`); otherwise it is script. The
discriminator is needed because a spoken line containing a colon —
"To slags aktører: husholdninger" — is itself valid YAML, so "try YAML
first" would silently misread a script file. Saved documents also gain
an explicit `format` field; the discriminator is the fallback for
everything already saved.

## 11. Errors and lint

Parse errors carry a line and column and name the fix, in the register
of the existing lint chip: *"line 14: `bx` is not a kind of thing — did
you mean `box`?"*, *"line 22: two `draw` lines in one beat; put a blank
line between them if they are separate beats"*.

Two new lint rules, both aimed at the one real trap of a prose-first
language:

1. A spoken line whose first word is a known head and that has no
   sentence punctuation — *"this line looks like a direction but sits at
   column 0, so it will be read aloud"*.
2. An id that shadows a shorthand word (§5.2).

## 12. Order of work

1. **Places** (Hans, 2026-09-19: places before the parser). Named places
   and auto-placement in the layout (§7). It ships as a spec feature on
   its own — a YAML cast and the model's output both get it the day it
   lands — and it must therefore be taught in the same round, per the
   standing rule: `src/llm/prompts/compiler-v1.md`, the schema
   description, and a prompt-size re-pin. Ordering it first means the
   script never has a stage where it prints a coordinate it cannot
   round-trip back into a word.
2. **Core.** Grammar, parser, printer, generic key/value fallback, props
   block, format detection. Round-trip green on the whole corpus. The
   editor switches to script; YAML and JSON stay as exports. No sugar
   beyond what the round trip needs.
3. **Sugar.** Aliases, shorthands, `->`, connector labels, fences, quiz
   choice lists, dialogue, `@labels`, and the two lint rules of §11. Each
   addition is guarded by the same corpus test, so sugar can never cost
   fidelity.
4. **Separate round, separate decision.** Teach the compiler to emit
   script instead of JSON, and A/B token cost and output quality. Phase 1
   is what makes this cheap to try; it is not part of this spec.

## 13. Accepted costs

- **Comments and hand formatting do not survive an AI revision.**
  `revise.ts` reprints from the spec, so a cast the model rewrites comes
  back in canonical form. Preserving authored text through a model round
  trip is a much larger problem (surgical edits, not reprints) and is not
  attempted here.
- **A third format to keep correct.** Mitigated by the corpus test,
  which is cheap to run and hard to fool.
- **Phase 1 pays off before the language exists.** Named places and
  auto-placement land with no script to spell them in, so the only
  visible win that round is better placement from the model and shorter
  YAML. Accepted: it is the order that spares the script a stage of
  printing numbers it cannot turn back into words.
- **The name.** `format: "script"`, files `.cast`, the editor tab says
  Script (Hans, 2026-09-19). It is the one thing here that is expensive
  to change later.

## 14. What this deliberately does not do

- No new rendering capability. Script expresses today's spec; §7 is the
  only engine change, and it is placement, not new ink.
- No visual/block editor. This is a text format for people who write.
- No change to the compiler prompt, the schema, or the fewshots (that is
  phase 4, and its own decision).
- No migration. Old YAML documents keep loading through the
  discriminator in §10; nothing is rewritten in place.
