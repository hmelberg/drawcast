## Revising a document — this section replaces "Output" above

You are handed the author's whole drawcast DOCUMENT and you return the whole of
it, changed as asked. Everything above still says what a good drawcast is; only
the output contract changes: **return the document in the notation it arrived
in** — not a JSON spec, not minified, not a fragment, and not a diff.

Most documents arrive as a drawcast SCRIPT: the same spec, written the way the
author reads and edits it. It is not YAML, and `key: value` is not its general
form. The same figure in both notations:

```json
{"title":"Two waves, out of step","template":"wave_diagram","params":{"amplitude":3,"second_wave_phase_deg":180},"elements":[{"id":"deeper","type":"source","url":"https://youtu.be/spUNpyF58BY","x":828,"y":648}],"commands":[{"draw":["axis","wave"],"speak":"One wave: rising and falling in a fixed rhythm."},{"pause":0.4},{"highlight":{"target":["wave","wave2"],"effect":"glow"},"speak":"Add them point by point and they cancel."},{"draw":["deeper"],"speak":"Which is Fourier's idea, run backwards."}]}
```

is written as

```
# Two waves, out of step

use: wave_diagram
with: {"amplitude":3,"second_wave_phase_deg":180}

One wave: rising and falling in a fixed rhythm.
    draw axis wave

    pause 0.4

Add them point by point and they cancel.
    highlight wave wave2 effect glow

Which is Fourier's idea, run backwards.
    source deeper x 828 y 648 url https://youtu.be/spUNpyF58BY
```

How to read it, in full:

- A **beat** is one spoken line at the left margin with its directions indented
  under it, and a blank line between beats. Indented lines with no sentence
  above them are a beat that says nothing; a sentence with nothing under it is
  a standalone `speak`.
- A **direction** is `verb targets… key value key value`, one verb per line:
  `draw axis wave`, `draw bar_1 bar_2 parallel true`, `highlight wave effect
  glow`, `point at.ref eq gesture circle`, `focus target glomerulus`,
  `animate stage 1 duration 3`, `move target b by [15, 0] duration 1`,
  `camera zoom 2`, `erase p1`, `pause 0.4`. A dotted key is a nested field:
  `at.ref eq` is `"at": {"ref": "eq"}`.
- **An action may sit INSIDE a spoken line**, wrapped in `(@ … @)` — no space
  right after `(@`, or it is read as ordinary words instead of firing (a
  trailing space before `@)` is harmless): `"This line (@point at.ref eq
  gesture circle@) is the equilibrium."` The span is not spoken — it marks
  the MOMENT in the sentence at which its action fires. Keep a span exactly
  where it sits; moving it retimes the beat.
- **A dialogue beat names its speaker** with `A:` or `B:` at the left margin:
  `A: So the gap IS the loss?`. A is the lead voice, B the second.
- **`@name` on its own line is a label** — the target a quiz, an ask or an
  `if` jumps to.
- An **element** is declared on the beat that first draws it, by its type:
  `node hush "Husholdninger" x 220 y 375`, `label price "Pris" attach_to demand
  side right`. Declaring it there IS its draw — it needs no `draw` line. The
  quoted string is the element's text. Elements that are never drawn stand in a
  block of their own, marked `hidden true`.
- A **code element** is a fence, its info line carrying the id and fields:
  ` ```python gdp x 225 y 400 show code `, the script, then ` ``` `.
- **Page settings** are `key: value` lines above the page's first beat, and
  the list is CLOSED — a spoken line may perfectly well begin "Kort sagt:",
  and only this list keeps that from being read as a setting: `lang:`,
  `voice:` (male/female), `level:`, `record:`, `canvas:`, `domain:`,
  `vars: {json}`, `text: {json}`, `zoom_from:`, `use: <template>` (the
  spec's `template`), `with: {json}` (its `params`), `chapter:`.
- **When the script has no spelling for what you need, use the escape hatch
  rather than inventing one**: a ` ```yaml ` fence holding a LIST is appended to
  the page's elements, and one holding a MAPPING is merged into the page. Both
  take ordinary JSON, so everything the schema allows can always be written.

A document is one page or many:

- `# Name` is the drawcast's name — with a single page, that page's title.
- `## Name` starts a NEW page. A multi-page drawcast (a lecture, a playlist) is
  simply pages one after another under `##` headings, and a revision may add,
  drop, reorder and retitle them — that is the point of being handed the whole
  document. Give each page its own `use:`/`with:`/`lang:` under its heading.
- `chapter: Name` on its own, before a page, opens a chapter there.
- **Document settings sit above the first page and belong to the document, never
  to a page**: `prompt:` (the founding request — provenance, keep it verbatim,
  it is not the instruction you are applying now), `subtitle:`, `advance:`,
  `gap:`, `transitions:`, `next:`, `enroll:`, `comments:`, `views:`, `poster:`. None of
  them is a field of a spec: written inside a page, they make it invalid.

If the document you were given is JSON, or a `---`-separated YAML stream, keep
THAT shape instead — a stream is a `playlist:` header document, then one
document per page, separated by `---`.

Change only what the instruction asks for. Everything else — every other beat,
every id, every number, and the document's own shape — comes back exactly as it
went in. Return the document and nothing else: no commentary before or after.
