# The prompt's weight, and the three things it cannot say

Status: DESIGNED 2026-09-22, not implemented. Plan:
`docs/superpowers/plans/2026-09-22-prompt-weight-and-coverage.md`.

Written after Hans asked whether the prompts had kept up with the features, and
whether dropping templates would shorten them. Every number below was measured
in the repo on 2026-09-22 at `fa1b4fd`, not recalled. Where a measurement
contradicted the question's premise, the premise is corrected here rather than
quietly worked around.

## 1. What was measured

Default packs enabled (games / maps / widgets off, per `DEFAULT_OFF_PACKS`),
88 ready templates, the two-level catalog regime.

| Block of the cached prefix | chars |
|---|---|
| `compiler-v1.md` prose | 47,007 |
| schema (`apiSchema()`, minified) | 81,898 |
| catalog — one-line index of all 88 | 24,815 |
| catalog — the three pinned core templates in full | 26,890 |
| catalog — pack-availability lines + escalation prose | 690 |
| fewshots (11) | 22,658 |
| **system prompt, no code/sound block** | **203,909** |

Plus a per-request tail outside the cached prefix: 0–14 k of router/keyword
shortlist, 0–11.5 k of exemplars, and the style block.

Six sample requests measured end to end: 207,747 – 239,322 chars. At the
`chars/4` rule of thumb that is ~52–60 k tokens, but the repo's own
`count_tokens` measurement (`src/llm/prompt.ts`, 2026-09-18: the minified
schema at 29,838 tokens) puts minified JSON nearer **2.5 chars/token**, so the
schema alone is ~30 k tokens and the true figure is **≈ 60 k tokens a
request**.

Growth over three weeks, measured from git:

| file | 2026-09-01 | 2026-09-21 | |
|---|---|---|---|
| `src/spec/schema.ts` | 46,664 | 119,594 | ×2.6 |
| `compiler-v1.md` | 24,410 | 47,422 | ×1.9 |
| `fewshots.json` | 9,573 | 27,387 | ×2.9 |

`ROADMAP.md:217` already named this: *"the fixed prompt parts (compiler prompt
41k chars, schema 39k, fewshots 14k ≈ 26k tokens) are now the bigger half of
every request — the next slimming target."* That note was written when the
schema was 39 k. It has since more than doubled. This design is that round.

## 2. The premise that was wrong: dropping templates

Hans asked whether taking specialised templates out (chess, and anything else
large) would shorten the prompt. Measured: **no, and by two orders of
magnitude.**

The two-level catalog already solved this in the router round (2026-09-07).
A template that is not shortlisted costs exactly its **one index line**. Per
pack, with every pack on:

| pack | templates | index cost |
|---|---|---|
| medicine | 8 | 3,015 ch |
| mathlogic | 11 | 2,558 ch |
| biology | 8 | 2,309 ch |
| … | | |
| **games (chess)** | **1** | **351 ch** |
| maps | 1 | 208 ch |

Chess costs 351 characters — and with default settings the games pack is not
registered at all, so it reaches the model as a single 133-char *"Pack
available but not enabled"* line. Deleting the index line of every template in
all eighteen packs would save 25,382 chars and cost the entire library.

**Ruling: no template is removed for weight. The lever is the three that are
pinned open, not the eighty-five that are folded shut.**

## 3. Where the weight actually is

### 3.1 The core pin — 26,890 chars on every request

`CORE_IDS = ["supply_demand", "decision_tree", "qaly_profiles"]`
(`src/scenes/catalog.ts:31`) are expanded in full into the *stable* half of the
catalog, which is the cached prefix. A chess request pays for `qaly_profiles`;
a vaccine request pays for `supply_demand`.

- `supply_demand` 14,070 ch — now the **largest single entry in the catalog**.
  The welfare round grew its manifest 11,014 → 16,660 chars (+51 %) on
  2026-09-21 alone, and the per-entry ceiling in
  `tests/pack-defaults.test.ts` (16,000) now has 12 % headroom left.
- `qaly_profiles` 10,009 ch
- `decision_tree` 2,811 ch

The pin predates the router. It existed because, before a shortlist existed, a
health-economics request had to find these by keyword overlap or not at all.
The router now scores **97.9 % top-5 recall** joined with the keyword selector
(measured over 338 known requests, `ROADMAP.md:131`), so it shortlists exactly
these three for the requests that want them.

**Ruling: unpin.** The three move from *every* request's prefix to the
requests that actually use them. `npm run selector:eval --router --gate 0.95`
is the bench that says whether that was true.

The cost is honest and must be stated: on a request that *does* want
`supply_demand`, its 14 k now rides in the uncached tail instead of the cached
prefix, so that request pays more. The trade is ~5 % of requests paying full
price for one entry against ~95 % no longer paying a cache write for three.

### 3.2 The schema's duplicated shapes — 8,545 chars

`pointRefSchema(what)` and `ghostSchema(what)` (`src/spec/schema.ts:74`, `:87`)
are factories: each call site gets its own full copy of the structure *and* of
the 330-char `ANCHOR_NAMES` tail. Measured repetition across the whole schema:

| shape | copies | now | recoverable |
|---|---|---|---|
| `pointRefSchema` body | 8 | 6,823 ch | 1,517 |
| `ghostSchema` body | 5 | 3,073 ch | 835 |
| endpoint `{ref,x,y,anchor}` | 4 | 2,716 ch | 1,678 |
| its inner properties bag | 4 | 2,192 ch | 1,464 |
| `[x,y]` pair | 18 | 1,392 ch | 450 |
| easing enum | 6 | 951 ch | 194 |
| … and 10 more | | | |
| **total** | | | **8,545 ch (10.4 %)** |

**CORRECTED 2026-09-22, after implementation.** The estimate above the line is
wrong and is kept only so the error is legible. The real saving from Strategy A
is **2,588 chars (3.2 %)**, measured as a before/after diff of
`JSON.stringify(apiSchema()).length`: 81,898 → 79,310. The 8,545 figure came
from a walk that summed `JSON.stringify(node).length` for every repeated node
*including nodes nested inside other counted nodes*, so a shape like
`point_ref` — whose `oneOf` contains an array schema and an object schema that
are themselves repeated elsewhere — was counted at three levels at once. The
per-shape table above inherits the same over-count and should be read as
*relative* weight only. Ground truth is the diff, not the walk.

Two strategies were estimated. **Strategy A** puts the *structure* in `$defs`
and keeps every per-site description via an `allOf` wrapper: nothing the model
reads changes. **Strategy B** also shares the long description tail, and would
save more, but each site then reads `"To — see $defs/point_ref"` instead of the
anchor vocabulary it needs at that exact moment. Both strategies' estimates were
produced by the same flawed walk; only Strategy A's true figure is now known.

**Ruling: Strategy A only.** The extra 6 k of Strategy B is bought by making
the schema worse to read at the point of use, which is the one thing the
schema is for. Revisit only if a live eval shows no quality cost.

Verified, not assumed:

- `$defs` + `$ref` **is** supported by Anthropic structured outputs
  (JSON Schema support list: *"`enum`, `const`, `anyOf`, `allOf`,
  `$ref`/`$def`"*). Recursive schemas are not, and none of these are.
- Ajv (draft-07, `strict: false`, `src/spec/schema.ts:1106`) resolves
  `#/$defs/...` by JSON pointer regardless of the draft's keyword name, honours
  `allOf` + a sibling `description`, and keeps resolving after
  `documentSchema`'s `{ ...specSchema, properties: {...} }` spread. Confirmed
  with a throwaway compile of exactly that shape.

The spread is the trap: `$defs` must live on `specSchema` so that it is spread
into `documentSchema` too, and both roots must answer `#/$defs/...`. A test
pins it.

### 3.3 The code/sound gate stops at the prose — ~10,000 chars

`{{CODE}}` (17,502 ch) and `{{SOUND}}` (1,424 ch) are correctly withheld from
requests that do not want them (`wantsCode` / `wantsSound`,
`src/llm/prompt.ts`). The schema is not: every request, code or not, carries

- the `code` element and its props — `code`, `language`, `controls`,
  `autorun`, `pane`, `code_result`, `code_src`, `game`, `figures` ≈ **8,076 ch**
- the `play` command and its props — `play`, `instrument`, `tempo`, `press`,
  `reveal` ≈ **1,983 ch**

So a request the prompt has already decided is not about code is still told,
in the schema, exactly how to write a code element — and is *constrained* to a
schema that permits one.

This costs nothing in cache variants: `{{CODE}}` and `{{SOUND}}` sit **before**
`{{EXEMPLARS}}`, so the cached prefix already forks four ways on these two
booleans. Gating the schema on the same booleans adds no fifth entry.

**Ruling: gate the schema on the same two booleans, at the same two call
sites.** The trap to pin with a test: `compile.ts` calls `apiSchema()` twice —
once for the prompt's `{{SCHEMA}}` and once for the structured-output
constraint. If those two disagree the model is shown one contract and held to
another. `revise.ts` already computes the right booleans
(`wantsCode(instruction) || /\btype:\s*['"]?code\b/.test(docText)`) and must
pass them through, or a revision of a document containing a code element would
be validated against a schema with no `code` element in it.

### 3.4 The index's own verbosity — ~11,000 chars

24,815 chars for 88 lines: median 276, p90 407, longest 497 (`note_sheet`).
`firstSentence()` takes whatever the description's first sentence is, and
several open with a parenthetical list of presets.

This is safe to cap because **the router reads a different index**:
`routerIndexText()` (52,597 ch, first sentence + the "Choose this for…"
sentence + two example requests) is built for routing and is untouched. The
compiler's copy has two jobs only — know what exists, and name an id for the
`need_template` escalation. A 140-char cap serves both.

**Ruling: cap at 140 chars on a word boundary, with an ellipsis.** Watch the
`need_template` escalation rate afterwards; if it climbs, the cap was too
tight.

## 4. What the prompts cannot say

A sweep of every command key, element type and element property in the schema
against **four** teaching channels — `compiler-v1.md`, its code/sound
fragments, `src/llm/tags.ts`, and the 291 bundled example specs.

The sweep's first pass flagged `voice: "a"/"b"` and `delivery` as untaught.
**Both flags were wrong**, and the correction is the useful finding:
`src/llm/tags.ts` is a third teaching channel, and it carries them —
`#qa`/`#dialogue` teach two-speaker `voice` in detail (`tags.ts:100–109`), and
a tone tag teaches `grave`/`brisk` (`tags.ts:221`). Both are tag-gated on
purpose, so an ordinary request pays nothing for them. That is good design,
and it means any future sweep must read `tags.ts` as a prompt.

What survived the correction:

### 4.1 `blocking` — a capability with no way in

Taught **nowhere**: not `compiler-v1.md`, not the fragments, not `tags.ts`.
Used in **0 of 291** example specs. Yet the schema's own `point` description
advertises it — *"Combine with speak blocking:false to talk while pointing"* —
while the prompt's `point` bullet does not. One clause fixes it.

### 4.2 `author-v1.md` is two rounds behind

Last touched 2026-09-15. `attached` landed 09-19 (46e5a0d), `groups` 09-20
(4901ab0). The prompt states the layout body *"must `return { drawables,
labels, anchors, order }`"* — a closed four-key list. `groups`, `attached` and
`curveSamples` are absent, and neither exemplar (`cell_diagram`,
`violin_anatomy`) uses them.

Hand-written templates have adopted both freely — **82 occurrences of
`attached` across 8 packs**, `groups` in medicine and games. The AI author is
the only template writer in the repo that cannot use the last two rounds'
features. It is also the only writer whose output is saved unconditionally to
My templates (the on-demand path, `src/llm/on-demand.ts`).

Second, smaller gap in the same file: nothing tells the author to *document*
group names in `element_ids`. That is the compiler's only channel for learning
them — `games.yaml:81-84` documents `position`, `pieces`, `squares`, `board` by
hand, and a template that does not is a template whose groups the compiler can
never name.

### 4.3 `revise-v1.md` does not cover the notation it round-trips

Written 2026-09-21 and good, but it is the only prompt that teaches the script
notation, and four constructs are missing from it:

| construct | where it comes from |
|---|---|
| `(@ verb … @)` inline action spans | inline-timing round, 2026-09-19 (`lines.ts` `liftActions`) |
| `A:` / `B:` dialogue lines | `DIALOGUE_RE`, `lines.ts:88` |
| `@label` goto lines | `GOTO_RE`, `lines.ts:87` |
| page settings `voice:`, `record:`, `canvas:`, `zoom_from:` | `SETTING_KEYS`, `lines.ts:81` |

The card lists `lang`, `use`, `with`, `vars`, `text`, `level` and stops. A
revision handed a document that uses any of the four is being asked to return
notation it was never taught, under an instruction that says *"every id and
every number comes back exactly as it went in."*

## 5. Deferred, with the reason

**`zoom_from` is not a prompt gap — it is a pipeline gap.** Taught nowhere,
used in 0 of 291 specs (the two bundled playlists that use it were written by
hand). The obvious fix — teach it in `buildPartRequest` — cannot work:
`src/llm/multi.ts:262` generates every part **in parallel** under a gate, so
when part *i+1* is written, part *i*'s element ids do not exist yet. Any id the
model wrote would be invented. The only honest seam is the assembly loop
(`multi.ts:276–291`), which holds every finished spec and could set `zoom_from`
in a cheap post-pass. That is a round of its own; teaching it here would ship a
feature that silently produces dangling ids.

**The fewshots (22,658 ch, ×2.9 since 1 Sep) are not pruned here.** They
overlap with the three request-matched exemplars drawn from 251 usable bundled
specs, and #9 and #11 are both dice/`bar_chart`. But which of the eleven is
load-bearing is not knowable by reading them — it needs a live eval over real
generations. Guessing would trade measured chars for unmeasured quality.

**Strategy B on the schema descriptions** (§3.2) — same reason.

**The exemplar selector goes silent on Norwegian topic words.** *"Forklar
hvorfor renter påvirker inflasjonen"* picks **0 of 251** usable bundled
exemplars and renders `(none yet)`. `STOPWORDS` in `src/llm/prompt.ts` was
widened for Norwegian question openers on 2026-09-07, but the pool itself has
no Norwegian-topic entry to match. A quality issue, not a weight one, and it
belongs to whoever next touches the exemplar pool.

## 6. What this round is worth

Revised 2026-09-22 as each task landed. **Measured** means a before/after diff
was taken on the finished code; **estimated** means it has not been implemented
yet and the figure may move the way §3.2's did.

| change | chars off every request | status |
|---|---|---|
| unpin `CORE_IDS` | 26,896 | measured (stable 52,409 → 25,513) |
| `$defs`, Strategy A | 2,588 | measured (schema 81,898 → 79,310) |
| gate the code/sound half of the schema | ~10,600 (code-less request) | estimated — summed the gated properties' own serialized bytes, which does not nest, so this one should hold |
| cap the index line at 140 | ~11,000 | estimated |
| **total** | **≈ 51,000 ch** | ~29,500 measured, ~21,600 estimated |

Against a 203,909-char prefix, that is **25 %**, with no feature removed and no
template deleted. The headline was ≈ 56,000 before §3.2's correction; the honest
number is whatever the close-out measures, and the close-out reports it whatever
it turns out to be.

The economics, stated honestly: the prefix is cached
(`cache_control: ephemeral`, 5-minute TTL, with the leader/follower warm-up in
`client.ts:209–238`), so a cache **hit** bills these tokens at ~0.1×. The
saving lands on cache **writes** at 1.25× — the first call of each burst, times
the four code/sound prefix variants — and on latency and context headroom,
which are not billed at 0.1× of anything.

## 7. One thing the ratchet cannot see

`tests/prompt-size.test.ts`'s `system()` helper builds its prompt from
`catalogParts({}).stable` **without loading any pack** — 13 bundled templates,
below `TEMPLATE_FULL_THRESHOLD`, so every template is expanded and the
two-level regime never runs. Its `BASELINE_SYSTEM_CHARS = 210,880` was
reproduced exactly in that configuration.

So the existing ratchet is a *relative* guard on the prose and the schema, and
it is structurally blind to §3.1 and §3.4 — unpinning `CORE_IDS` will not move
it by one character. The two-level numbers belong in
`tests/pack-defaults.test.ts`, which already loads the default packs in a
`beforeAll`. The plan adds the guard there, and tells the implementer to
**measure** every constant rather than copy one from this document.
