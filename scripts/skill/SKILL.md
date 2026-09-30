---
name: drawcast
description: Use when someone asks for a drawcast, or for a narrated whiteboard explainer, a hand-drawn animated figure or a short teaching animation of a concept ("explain X with a drawing", "animate how Y works", "make a drawcast about Z"). You write the drawcast as a YAML spec and give back a drawcast.app link that plays it — drawn by hand on screen while a voice narrates, with a closing quiz and figures the viewer can play with.
---
{{HEADER}}

# Make a drawcast

A **drawcast** is a short (one to two minutes), video-like teaching figure: a
figure is drawn by hand on a 4:3 page while a voice narrates it, line by line.
Viewers can pause, click parts, play with the figure and answer a quiz. You
write it as a **YAML spec** — what exists on the page (a ready-made template
or your own elements) and a storyboard of `commands` (one verb each, with the
spoken line on it). The player at drawcast.app lays everything out, draws it
and speaks it; you never compute pixel geometry.

You deliver a **link** that plays it: `https://drawcast.app/#cast=<data>`.

## Which file to read when

| When | Read |
|---|---|
| Every drawcast, before writing the storyline | `references/storyline.md` (the storyline rules and how to stage them) |
| Every drawcast, before writing YAML | `references/rule-card.md` (every rule the renderer depends on, short) |
| Choosing a figure | `references/templates/index.md` ({{TEMPLATE_COUNT}} ready templates, one line each); then the chosen one's `references/templates/<id>.md` (its params and element ids) |
| Seeing a whole drawcast | one or two of `references/examples/*.yaml` closest in kind (table below) |
| An exact field of an element or command | `references/schema.json` (search it for the field or type name) |
| A verb's full behaviour, an edge case | `references/compiler.md` (the long form of the rule card) |
| The request mentions a tag (`#short`, `#for=nurses`, `#qa` …) | `references/brief.md` |
| Music or sound | `references/sound.md` |
| A running script, a simulation, code on the page | `references/code.md` |
| Your self-check | `references/look.md` |

Examples:

{{EXAMPLES}}

## 1. The brief

Settle four things before anything else. The request wins where it says
something (in words — "for nurses", "keep it short" — or as a tag); otherwise
use these defaults and **name the defaults you used** when you deliver, so the
user can change them.

{{BRIEF}}
- **Language:** the language the request is written in (narration AND canvas words).

Set the spec's `level` field only for `basic` or `advanced`. Ask the user a
question only when the topic itself is unclear — otherwise just make it.

## 2. Storyline first

Before any YAML, write the storyline by `references/storyline.md`: the
question as asked, the naive answer, ONE insight named at the end, a concrete
example with correct numbers, one change at a time (with a ghost of the old
state), key numbers on the canvas, a figure budget (one main figure, at most
one temporary supporting piece at a time), a template's real interactions in
an explore beat, a transfer quiz with a `wrong` hint, short sentences for the
ear. Pick the figure here: scan `references/templates/index.md` — a template
that tells THIS story beats a freehand drawing; a freehand drawing that tells
the right story beats a template that tells another. Keep the storyline in
your working notes (show it only if the user wants to see the plan).

## 3. Check the facts

List every claim a viewer could look up — each number, study, date, named
person, rule. If you have web search, check each one now and fix the
storyline. A claim you cannot confirm is cut, or turned into the worked
example's own made-up numbers, said as such ("say a drug costs…"). **Never
invent a study, a quote, a statistic, a DOI or a URL.** A study, report or
dataset the narration relies on goes in the top-level `sources` (`id`,
`title`, `authors`, `year`, `finding`; `doi`/`url` only when you saw it
yourself), and the element that shows its number carries `cites: [<id>]`.
Textbook facts and illustrative numbers need no `sources`.

## 4. Write the YAML

Read `references/rule-card.md` in full first, then the template's own file
(if any) and an example close in kind. Stage the storyline: its lines are
sacred (one `speak` per beat, in order), the ink is yours.

The shape (this one is valid — copy its form, not its content):

```yaml
{{SKELETON}}
```

YAML traps the player will reject or misread:

- One YAML document, a mapping at the top: `title`, then `template` +
  `params` OR `elements` (or both), `commands`, optionally `domain`, `vars`,
  `sources`. No other top-level keys (the schema lists them all). No
  surrounding prose, no `---` lines.
- **Quote every string** that holds `:`, `#`, `{`, `[`, a leading `*`, `&`,
  `!`, `%`, `@` or a backtick — simplest: double-quote every `speak`, `text`,
  `question`, `right` and `wrong`.
- **TeX in single quotes** (`tex: '\frac{a}{b}'`): inside double quotes
  every backslash would have to be doubled.
- Colours are strings: `color: "#2f6b8f"` (unquoted, `#` starts a comment).
- Element ids: lowercase letters, digits, `_`; each command names only ids
  that exist (yours, or the template's listed ones).
- Every field must be in `references/schema.json` for that element or
  command — an unknown field makes the whole drawcast fail to open.

## 5. Check it yourself

You cannot see the frames, so read your YAML beat by beat and picture each
page as it will look while that line is spoken. Fix what fails:

1. **Valid:** every field in the schema; every id referenced exists; template
   params per the template's file; quiz `correct` is 1-based and in range.
2. **Opening:** a `card` heading, then the first real ink with the first
   spoken line on it, saying the question. No talking over a blank page.
3. **Sync:** each spoken line rides a command that draws, moves, highlights
   or animates what the line is about. Never more than two speak-only beats
   in a row.
4. **Canvas words are cues:** a word or three per label; the voice says the
   sentence. Formulas are `math`, never typed text.
5. **Figure budget:** one main figure, drawn large; at most one supporting
   piece (scratch card, readout, inset) at a time — erase it once it has
   served. Count the texts on the busiest page: more than about a dozen is
   crowded.
6. **Truth:** every number correct, arithmetic checked; illustrative numbers
   said to be illustrative; no invented sources.
7. **Length:** the number of `speak` lines matches the brief.
8. **Close:** a last line that names the insight in plain words, then a
   `quiz` that applies it to a NEW case, with a `wrong` hint that nudges
   without giving the answer.

`references/look.md` has the full visual and teaching checklists.

## 6. Give the link

With code execution (a Python or Node tool): save the YAML to a file and run
the bundled script — both print the same link:

```
python3 scripts/make_link.py cast.yaml      # or: node scripts/make_link.mjs cast.yaml
```

(The link is `https://drawcast.app/#cast=` + base64url, without `=` padding,
of the raw DEFLATE — no zlib or gzip header — of the UTF-8 YAML; any language
can make it.) **Never write a link by hand or guess one**: a single wrong
character breaks it.

Without code execution: give the YAML in one ```yaml block and tell the user
to open **https://drawcast.app/#paste** and paste it there.

When you deliver: the link (or the YAML + paste link), one line on what the
figure shows, and the brief's defaults you chose. Keep the YAML at hand — you
will need it for fixes.

## 7. When the player shows Problems

If the drawcast will not open, or opens with a **Problems** box, ask the user
to press **Copy for your AI** in that box and paste the text back to you. Fix
every problem it lists (usually a field the schema does not have, a missing
id, or a template param), then give a new link. Fix causes, not symptoms: a
crowded page wants fewer or shorter things, not nudged coordinates.

## What good looks like

- The first spoken line says the question while the first ink goes down; then
  why it matters.
- One insight; mechanism, not just result; a concrete example with numbers.
- Something happens on the canvas while each line is spoken; emphasis only
  where the meaning is; calm, few colours, each with one role.
- Explain in passing — no "note that", "here we see".
- Pitch every sentence at the brief's audience; short sentences for the ear.
