import { describe, expect, test } from "vitest";
import { apiSchema, fewshotsText, promptVariants, CODE_PROMPT_SOURCE, SOUND_PROMPT_SOURCE } from "../src/llm/compile";
import { REVISE_PROMPT_SOURCE } from "../src/llm/revise";
import { catalogParts } from "../src/scenes/catalog";
import { buildSystemPrompt, wantsCode, wantsSound } from "../src/llm/prompt";
import bundledExamples from "../src/examples.json";
import fewshots from "../src/llm/prompts/fewshots.json";

// Measured on the merged main (4a04eb2) BEFORE the freehand round's prompt and
// schema edits — the size that round must not exceed for an ordinary request.
// Re-pinned 2026-09-10 for the vars round (vars, bind, point at.on, trail on
// animate — design 2026-09-10-vars-and-dependencies): the schema's four new
// descriptions are one sentence each (+1,521 chars on the system prompt) and
// the prompt gained three sentences — vars/bind/at.on in the tier-2 bullet,
// the var sweep and trail in the animate bullet, and the definitions rule in
// the move bullet, which replaced two older sentences (+1,197). The schema
// stays under the freehand ceiling. A later round that adds to the prompt
// re-pins here, on purpose, with a note like this one.
// Re-pinned again 2026-09-10 for the formula-morph round (Task 3): one new
// element property, `colors` (math: colour per term), one sentence — +296
// chars on the schema, which is embedded verbatim in the system prompt so
// the same +296 lands there too. The old +5,500 rolling schema allowance
// (a leftover slack from the freehand round) was dropped here: both anchors
// below are now exact ceilings at the measured post-change size, with zero
// slack, same as the system-prompt ceiling always was — a real ratchet, not
// a budget that quietly refills itself on every re-pin. A later round that
// adds to the schema or the prompt re-pins BOTH constants here, on purpose,
// to its own new measured size, with a note like this one.
// Re-pinned again 2026-09-10 for the formula-morph round (Task 5): the new
// `copy` command (schema property + verb-list entries) and `morph.tex` (a
// new morph property + one sentence in its description) grew the schema by
// +1,017 chars, which lands on the system prompt too (+1,026, the schema
// embedded verbatim plus the verb-list entry in the narration bullet).
// Re-pinned again 2026-09-10 for the formula-morph round (Task 7): the
// parametric curve fields — `x_expr`, `y_expr`, `t_from`, `t_to`, one
// sentence each — grew the schema by +672 chars, which lands on the system
// prompt too (the schema is embedded verbatim).
// Re-pinned again 2026-09-10 for the formula-morph round (Task 8): the four
// prompt sentences this round adds — the math-formula `morph.tex` sentence,
// the `copy` gesture-verb line (the derivation idiom), the `colors` sentence
// on freehand rule 5, and the parametric-curve clause on the tier-2 curve
// sentence — grew the system prompt by +822 chars; nothing here touches the
// schema (Tasks 3/5/7 already shipped it), so BASELINE_SCHEMA_CHARS is
// unchanged.
// Re-pinned 2026-09-10 (region edges by reference, then the prompt itself):
// x_from/x_to grew a type-or-object shape and one clause each, and the
// prompt gained the expr-curve rule in the move bullet (shift by a var, not
// by moving the stroke), the region edge in the tier-2 bullet and
// math_font in Text.
// Re-pinned 2026-09-10 after merging main (region edges by reference, the
// expr-curve rule, math_font) into the formula-morph branch: both measured again.
// Re-pinned DOWN 2026-09-12 (the verb-section round) — the first ratchet in
// this file that tightens rather than loosens. Two changes, opposite signs:
// the `play` verb moved into its own conditional fragment
// (compiler-v1-sound.md, filled into {{SOUND}} only for a request about sound
// or music — the same arrangement {{CODE}} has), which takes 1,424 chars off
// every ordinary request; and the narration section was restructured (the
// teaching rules made contiguous, one `## Verbs` catalogue, an `## Elements`
// section) with six sentences rewritten, which added back ~670. Net −411 on
// the measured prompt. The ceiling follows the measurement down, as this
// file's own rule requires: a ratchet, not a budget that refills itself.
// Re-pinned 2026-09-14 for the code-controls round (Task 4): three new
// code-element properties — `controls` (one description, the literal grammar
// in one sentence), `glow`, `autorun` — grew the schema by +1,291 chars on
// both (schema 108516 → 109807, system 222709 → 224000), the schema being
// embedded verbatim in the system prompt. The controls bullet itself lives
// in compiler-v1-code.md, which only a code request receives, so it costs an
// ordinary request nothing. glow removed the same day (Hans): −196 chars on
// both (schema 109807 → 109611, system 224000 → 223804).
// Re-pinned 2026-09-14 for the pane-controls round (Task 1): the `pane`
// schema description (schema 109611 → 110146, +535) is embedded verbatim in
// the system prompt, so it lands there too; the system prompt also gains the
// explore-verb clause in compiler-v1.md ("the ONLY place a line may tell the
// viewer to slide, press or try something…", +156, system-prompt only — it
// is not part of the schema). Total system-prompt growth: +691 (223804 →
// 224495). The `pane: controls` sentence in compiler-v1-code.md's controls
// bullet is behind the {{CODE}} conditional fragment and costs an ordinary
// request nothing, so it is not part of this pin.
// Re-pinned 2026-09-15 for the pane-controls final wave (item 1): one new
// code-element property, `code_src` (the render clone's stamp of the
// authored script before control defaults were written in — needed so a
// revise round can copy an existing one through, same reason `code_result`
// is in this schema), one short description sentence — +162 chars on the
// schema (110146 → 110308), embedded verbatim in the system prompt so the
// same +162 lands there too (224495 → 224657).
// Re-pinned 2026-09-14 for the widget-bodies round (Task 6): ask.widget lost
// its enum and gained one sentence (a template with a widget body may be the
// device), and the ask bullet in compiler-v1.md gained the same sentence —
// schema 109611 → 109612 (the dropped enum list very nearly paid for the
// sentence), system 223804 → 224068 (that +1 plus the prompt's own +263).
// The author prompt (author-v1.md, on-demand only) grew a section; it is not
// part of these pins.
// Re-pinned 2026-09-14 for the widget-bodies round (Task 7): the widgets
// pack (three widget-body templates — morse_key, tower_of_hanoi,
// logic_gates) — with no packs registered (this test's own config) it shows
// up in the catalog as one more "Pack available but not enabled: Widgets —
// …" line, +211 chars on the system prompt only; the schema is untouched
// (109612 stays 109612).
// Re-measured 2026-09-15 for the widget-bodies fix wave (F5): a template
// whose document carries a widget body now emits one marker line in its FULL
// catalog entry ("widget: the viewer can work this figure while paused; an
// ask may bind to it with widget: <name>", ~105 chars), which is what the ask
// bullet in compiler-v1.md has been telling the model to look for since Task
// 6 and which nothing emitted until now. Nothing else in the prompt or the
// schema changed. The three templates that carry the flag are all in the
// widgets pack, which is not registered in this test's configuration (and is
// an index line, not a full entry, in the two-level regime anyway) — so both
// measurements come back UNCHANGED at 224279 / 109612. Pinned to what was
// measured, as this file's rule requires, rather than nudged for a delta that
// an ordinary request never pays. (With the widgets pack enabled the system
// prompt measures 228539, the pack's own three index lines and hot-set
// entries; that regime has never been what these ceilings pin.)
// Re-measured 2026-09-15 at the merge of widget-bodies into main (after
// pane-controls): both rounds grew the schema/prompt independently; the pins
// below are the measured values after the merge.
// Re-pinned 2026-09-15 for the widget-keys round (Task 3): three more widget
// documents joined the widgets pack (xylophone, bubble_sort, tictactoe). The
// pack is still not registered in this test's configuration, so the templates
// themselves cost nothing — but the pack's one-line DESCRIPTION is what the
// "Pack available but not enabled" line carries, and naming the three new
// figures in it is +39 chars on the system prompt (225132 → 225171). The
// schema is untouched (110309 stays 110309).
// Re-pinned 2026-09-15 for the sweep round: `run` verb + `explore.play` in
// the schema (+6,479), the run bullet and the rewritten explore/controls
// sentences in the prompts (+615) — schema 110309 → 116788, system
// 225171 → 232265.
// Re-pinned 2026-09-15 for the sweep fix wave (item 2): three wordings that
// had gone stale or self-contradictory. compiler-v1.md's explore bullet said
// BOTH "App only: movies drop the whole beat INCLUDING its speak" and "the
// movie continues" — its middle is now one sentence, "Without a controls
// script the beat is app-only (movies drop it, speak included)" (−22 on the
// system prompt, prompt-only). The schema's `explore` description still
// opened on the stage-1 world where the beat opened the ⊕ tray; its opener is
// now "Hold the lesson for the viewer: on a `pane: controls` script the drawn
// knobs are live and the tray stays shut…" (+52 on the schema, which is
// embedded verbatim in the system prompt, so the same +52 lands there).
// Net: schema 116788 → 116840 (+52), system 232265 → 232295 (+30 = +52 − 22).
// (types.ts's `controls` docstring was fixed in the same item; a TS comment
// is in neither measurement.)
// Re-pinned 2026-09-15 for the template box round: one sentence on params.box
// in the schema (+322 on the schema, 110309 → 110631, which lands on the
// system prompt too since the schema is embedded verbatim), one sentence in
// compiler-v1.md's scene-template list item, and one clause in
// compiler-v1-code.md's data-from-code bullet (behind the {{CODE}}
// conditional, so it costs an ordinary request nothing) — net system-prompt
// growth 225171 → 225768 (+597). (This round was cut from main before the
// sweep round landed, so these deltas are against the pre-sweep baseline.)
// Re-measured 2026-09-15 after merging origin/main (the sweep round, b82e503)
// into the template-box branch: both rounds' changes are additive on the
// merged tree, so the two constants below are pinned to the values actually
// measured on the merge, not to a sum of the two rounds' deltas — schema
// 116840 → 117162, system 232295 → 232892.
// Re-measured 2026-09-15 for the final fix wave (item 4): the reworded
// side-by-side clause in compiler-v1-code.md ("this holds for a code, below
// or above panel — a side-by-side left/right panel needs the whole width…")
// lives behind the {{CODE}} conditional fragment, which system(false) never
// includes — so it costs an ordinary request nothing and BOTH constants stay
// exactly where they were (schema 117162, system 232892), measured, not
// assumed.
// Re-pinned 2026-09-15 for the smooth-sweeps round: `run.smooth` and
// `explore.play.smooth` — one description sentence, written twice because the
// two shapes carry their properties separately — grew the schema by +566
// (116840 → 117406), which is embedded verbatim in the system prompt, so the
// same +566 lands there; and compiler-v1.md's `run` bullet gained one
// sentence (ranges glide by default; steps 8–16 for a visible glide;
// smooth: false for the authored jumps), +140 on the system prompt alone.
// Total system: +706 (232295 → 233001). The same round's fixed-axes sentence
// in compiler-v1-code.md's controls bullet is behind the {{CODE}} conditional
// fragment and costs an ordinary request nothing, so it is not in these pins.
// Re-measured 2026-09-15 in the same round's review wave: the `run` bullet
// said BOTH "`{from, to, steps}` is linear" and "ranges glide by default" —
// the first is now "walks from one to the other" (+18), and the glide advice
// asks for `steps: 10–16` rather than 8–16 (+1), since anything under 10 is
// raised anyway. Prompt-only: system 233001 → 233020, schema unchanged.
// Re-measured again 2026-09-15: the SCHEMA's `run` description carried the
// same stale phrase the prompt bullet did ("{from, to, steps} is linear"),
// one line above its own `smooth` property saying ranges glide by default —
// now "walks from one to the other" there too, +18 on the schema, which is
// embedded verbatim in the system prompt, so the same +18 lands there.
// Schema 117406 → 117424, system 233020 → 233038.
// Re-measured 2026-09-15 on the merge of the smooth-sweeps round with the
// template-box round (both additive): pinned to the values measured on the
// merged tree: schema 117162 → 117746, system 232892 → 233635.
// Re-pinned 2026-09-15 animated-box round: one sentence in compiler-v1.md,
// +329 on the system prompt; schema untouched.
// Re-pinned 2026-09-16 for the stored-answers round (spec
// 2026-09-15-stored-answers-design.md): the schema gains `quiz.store` (one
// description sentence naming {name}, {name.ok}, {name.secs}) and the
// top-level `record` flag — +534 on the schema (117746 → 118280), embedded
// verbatim in the system prompt; the prompt itself gains the _answers
// namespace paragraph on the quiz bullet and one clause on the ask bullet,
// +568 — total system +1102 (233635 → 234737).
// Re-measured 2026-09-16 on the merge of the animated-box round with the
// stored-answers round (both additive): pinned to the values measured on the
// merged tree: schema 118280 (unchanged from stored-answers), system 234737 → 235066 (+329, the animated-box sentence).
// Re-pinned 2026-09-16 animated-box fix wave: the animate description learns
// box by name, +178 on the schema and the same +178 on the system prompt
// (the schema is embedded verbatim). Schema 118280 → 118458, system
// 235066 → 235244.
// Re-pinned 2026-09-16 for the hand-drawn round: the code element's `chart`
// description now says the default FOLLOWS THE DRAWING (hand-drawn → xkcd in
// the app's own handwriting, clean → seaborn) and that xkcd/seaborn/plain
// force one — +107 chars on the schema (117746 → 117853), which is embedded
// verbatim in the system prompt, so the same +107 lands there (233635 →
// 233742). The same round's rewritten `"chart"` sentence in
// compiler-v1-code.md is behind the {{CODE}} conditional fragment and costs
// an ordinary request nothing, so it is not part of these pins.
// Re-measured 2026-09-16, same round, after Hans' live check overruled the
// "follows the drawing" rule: the default is xkcd in BOTH drawing styles, so
// the description is one clause shorter ("THE DEFAULT IS xkcd … Force
// another: seaborn … or plain") — schema 117853 → 117837 (−16), system
// 233742 → 233726, the same −16 down the verbatim embedding.
// Re-measured 2026-09-16 on the merge of the hand-drawn-charts round with
// the rounds that landed on main meanwhile (all additive): pinned to the
// values measured on the merged tree: schema 118371, system 234828.
// Re-measured 2026-09-16 on the merge of the animated-box round with the
// code-hand round (both additive): pinned to the values measured on the
// merged tree: schema 118371 → 118549 (+178, the animate.box description), system 234828 → 235335 (+178 + 329, the prompt sentence).
// Re-pinned 2026-09-16 for the title-below-player round: the `card` verb
// (schema property with a three-sentence description + the verb-list entry)
// grew the schema by +836 (118549 → 119385), which lands on the system
// prompt verbatim; the prompt itself gained the `card` catalogue bullet and
// a rewritten "Start on the canvas" opening rule (the title is page
// furniture under the player; the canvas carries a heading only if drawn),
// net +377 — system 235335 → 236548.
// Re-pinned 2026-09-16 for the math-hand round, measured on the tree merged
// with the round above: `text.math_hand` (one description) and the rewritten
// `size` description (one size model for formulas and text) grew the schema
// by +151 (119385 → 119536), embedded verbatim in the system prompt; the
// prompt itself gained the display-style sentence on freehand rule 5 (\frac
// not \dfrac, leave size out) and the `math_hand` clause in Text (+375) —
// system 236548 → 237074. Then the hand became Patrick Hand glyphs rather
// than a wobble (Hans: the wobble was ugly): the `math_hand` schema
// description and the prompt clause were reworded — schema +7 (119536 →
// 119543), system +7 (237074 → 237081).
// Re-measured 2026-09-16 for the Greek-in-the-hand round: the `math_hand`
// description reworded once more (Greek and symbols now in the hand, only
// stretched glyphs stay in the math font) — schema −7 (119543 → 119536);
// the system prompt measured unchanged at 237081.
// Re-pinned 2026-09-17 for the inset round (spec
// 2026-09-17-inset-design.md): the schema gains "inset" in the type enum, a
// `crop` property, and one sentence each on `of`, `x`, `y`, `width` and
// `height` — +850 on the schema (119536 → 120386), embedded verbatim in the
// system prompt; compiler-v1.md gains the inset bullet, +1191 — total system
// +2041 (237081 → 239122).
// Re-pinned 2026-09-17, Task 9 fix round 2: the inset bullet's round-trip
// illustration combined `move` and `focus` in one command — a shape the
// schema itself rejects (one action verb per command), so a model shown the
// literal JSON would copy an invalid pattern. Split into two command
// objects (a plain `move`, then `focus` with the beat's `speak`) — prompt
// only, +8 chars (system 239122 → 239130); the schema is untouched.
// Re-pinned 2026-09-18 for the generation fix round (item 4, no click gates
// unless asked): the `wait` bullet in compiler-v1.md now says outright that
// without a request for click-gated pacing there must be NO wait commands —
// a lecture plays through on its own, a breath is `pause` — after the model
// wrote three gates per part into an untagged 10-lecture course. Prompt
// only, +140 chars (system 239130 → 239270); the schema is untouched.
// Re-pinned 2026-09-18 for the layout fix round (node width/height): the
// `shape` description gains one sentence — a node's width/height are honoured,
// centred on x/y, a circle's width is its diameter, and a shape rect's x/y is
// its LOWER-LEFT corner (the x/y description said "the centre", the code has
// always used the corner, and the bundled examples build on the corner) —
// and `width`/`height` each name `node` in their element list: +138 on the
// schema (120386 → 120524), embedded verbatim in the system prompt, so the
// same +138 lands there (239130 → 239268). Nothing in the prompt files changed.
// Re-pinned DOWN the same day: a shape rect's x/y became its centre (the
// corner convention was the bug — the model had read "the centre" in the
// x/y description and placed things inside a rect that was not there), so
// the corner clause went and the sentence is now the one rule for node and
// shape: −28 on the schema (120524 → 120496); the system prompt takes the
// same −28 plus +3 from the bicycle-pump fewshot, whose body rect was
// migrated from (0, 0) to its centre (45, 160): 239268 → 239243.
// Merged 2026-09-18 (integration of the two tracks above): prompt +140 and
// schema/fewshot +113 land together in the system prompt (239130 → 239383);
// the schema pin is the layout track's 120496.
// Re-pinned 2026-09-18 (the explore-card ruling): the `explore` bullet no
// longer says the beat "opens the app's explore tray" — `code` now opens the
// editor card on the script's drawn pane and only `params` opens the tray —
// +36 chars on the prompt; the schema's explore description says the same
// ("the ⊕ tray opens" → "opens exactly what it names"), +43 (120386 →
// 120429), embedded verbatim in the system prompt — total system +79
// (239130 → 239209).
// Merged 2026-09-18 (all three tracks of the fix round): the wait bullet, the
// explore bullet, the node/shape and explore schema sentences and the migrated
// fewshot land together — measured after the merge: schema 120539, system 239462.
// Re-pinned DOWN 2026-09-18 for the cost round: the schema is embedded
// minified now instead of pretty-printed with a 2-space indent (measured with
// Anthropic's count_tokens: 36,265 tokens pretty vs 29,838 minified on Opus
// 5 — the model reads minified JSON just as well, and the schema is the
// largest single block of the cached prefix). This is pure whitespace, so
// both anchors drop by exactly the same 41,862 chars: schema 120539 → 78677,
// system 239462 → 197600.
// Re-pinned 2026-09-19 (named places): `at.place` — a named spot on the
// canvas — costs a schema description (+575, embedded verbatim in the system
// prompt) and a sentence in the freehand placement bullet (+549). Both
// anchors move: schema 78677 → 79252, system 197600 → 198724.
// Re-pinned 2026-09-19 (a border around several things): the annotation
// `target` became a list, which costs its schema description (+178, embedded
// in the system prompt) and a sentence in the annotation bullet (+178).
// schema 79252 → 79430, system 198724 → 199080.
// Re-pinned 2026-09-19 (group layout): five fields on a group — layout, gap,
// columns, align, equalize — and the freehand bullet that teaches them, which
// is what stops the model writing x/y for a row of boxes (34% of corpus
// elements carry raw coordinates today). schema 79430 → 80476, system
// 199080 → 201143.
// Re-pinned 2026-09-19 (inline timing): `cue` — when in the sentence an
// action starts — costs its schema description (+356, embedded in the system
// prompt) and a sentence on the canonical-beat bullet (+442).
// schema 80476 → 80832, system 201143 → 201941.
// Re-pinned 2026-09-19 (an end-anchored cue): `cue_end` — the cue marks
// where the action has FINISHED, so a reveal lands on its word instead of
// starting there. schema 80832 → 81186, system 201941 → 202736.
// Re-pinned 2026-09-19 (emphasis holds): a narrated highlight throbs three
// times and then STAYS lit for the rest of the sentence rather than breathing
// through it, so both the verb's description and the effect names had to say
// what they now do. schema 81186 → 81370, system 202736 → 203007.
// Re-pinned 2026-09-20 (steepness stops overpromising): supply_demand's two
// `steepness` descriptions now say where the VISIBLE range actually ends —
// qualitativeShape clips the shape to the plot at k ≈ 1.05, so every value
// above that draws the same curve, `steep` (1.5) reads like `medium` (1), and
// an animate from 1 to 2.5 renders a still picture — plus the rule that an
// animated param needs a numeric start in the base params. The spec-level
// `curve` steepness carries the one-line version. Descriptions the model reads
// before choosing a value, so the cost lands in the cached prefix.
// schema 81370 → 81492, system 203007 → 203644.
// Re-pinned 2026-09-20 (pointing at a chess square): chess_board's own
// description and its sq_<square> entry now say that ALL 64 squares are
// elements — which is what lets a beat circle an EMPTY square — that a ply's
// arrow is drawn BEFORE the piece crosses, and that a glow belongs on a piece
// rather than a square. Plus one general `move` bullet on the what-if: ghost
// it out, take it back, and mind that an offset persists until you do. Catalog
// and prompt only; the schema is untouched (81492).
// system 203644 -> 204130.
// Re-pinned 2026-09-21 (a template may name a set of its own ids): the chess
// board's catalog entry gains `position`, `pieces` and `squares` beside its
// individual ids, and one sentence each in the `draw` bullet and the `draw`
// schema description says what naming a set does — every member drawn, every
// member still its own id. It PAYS for itself many times over in output: the
// three bundled chess casts lost 222 lines of draw list between them, and a
// board is one id rather than sixty in everything the model writes from here.
// schema 81492 -> 81722, system 204130 -> 204717.
// Re-pinned 2026-09-21 (deadweight loss joins `regions`): supply_demand's tax
// no longer self-shades its triangle; the bundled example that used to set
// `tax.show_deadweight_loss` now asks for it via `regions: ["deadweight_loss"]`
// instead, which needs the value in the manifest's `regions` enum. Schema is
// untouched (81722) — only the catalog-embedded manifest grew, by one enum
// string. This is a narrow, interim re-pin: Task 5 of this same round widens
// `regions` further (government_revenue, transfer) and adds a full set of new
// params, so this number moves again there.
// system 204717 -> 204741.
// Re-pinned 2026-09-21 (supply & demand welfare): supply_demand's manifest
// gains `elasticity` on both curves (the lever for tax incidence, where
// `steepness` saturates), `tax.amount/side/kind`, `level` on both price
// controls, two more `regions` members (government_revenue, transfer —
// deadweight_loss was already added, and re-pinned, by an earlier commit
// this same round), ten element ids and two examples. The scene's
// params_schema is embedded verbatim in the catalog (src/scenes/catalog.ts:69),
// so all of it lands on the system prompt; the spec-level schema is
// untouched (81722). One sentence in compiler-v1.md's animate bullet also
// changed — it promised that steepening demand shrinks a deadweight-loss
// triangle, which saturation means it does not (fixed again below: the
// first version of that sentence also had the elasticity direction
// backwards).
// system 204741 -> 210292.
// Fix round 1 on the above (2026-09-21): corrected the compiler-v1.md
// sentence's direction (animating `demand.elasticity` DOWN — not up — is
// what swings a tax's burden onto buyers and shrinks the triangle; verified
// against the bundled example, which animates down and narrates a shrink);
// gave the elasticity words their numbers inline (perfectly_inelastic 0.06 …
// perfectly_elastic 1.94), since the neighbouring `steepness` already does
// and the un-numbered list is exactly how the original direction mistake
// happened; softened "reaches genuinely vertical/horizontal" to
// "near-vertical/near-horizontal" (it's clamped to [0.06, 1.94], never 0 or
// 2); made `tax.amount`'s stated default correct for kind ad_valorem (36,
// not 18); stopped price_ceiling/price_floor's own descriptions from
// assuming binding, now that a non-binding `level` is a documented, legal
// figure; taught the acceptance example's "gap between the two lines" beat
// to draw `wedge_region`/`label_wedge` — the thing the sentence was
// describing — instead of asserting a second line that was never drawn
// (this needed a small layout.ts fix too: the wedge's default label anchor,
// dead-centre of a rectangle spanning the WHOLE traded quantity, collided
// with four other strokes once it shared the canvas with both curves, both
// guide sets and the DWL region; moved only the label's anchor into the
// wedge's upper band, not the polygon or the centroid other code reads);
// dropped a redundant `price_buyers_point` draw that duplicated
// `tax_equilibrium_point`'s dot; and trimmed ~700 chars of duplication per
// Hans's standing instruction — the 430-char elasticity paragraph no longer
// repeats verbatim on `supply` (one line points back to `demand`), and the
// "0-100 / equilibrium at 50" / "Numeric, so it animates" phrases each say
// once (on `tax.amount`) what they said three times (also on both
// `level`s). Also combined `tax_supply_curve`/`tax_demand_curve` and
// `price_buyers_point`/`price_sellers_point`'s element_ids entries in the
// file's own `ceiling_line / floor_line` idiom, marked the P_b/P_s dots
// "a tax only" (matching `wedge_region`/`transfer_region`'s notes), and
// added "subsidies" to the scene's own routing description, since a
// negative tax amount is a headline new capability that sentence never
// named. Net of the trim and the additions: system 210292 -> 209953 (the
// trim recovered more than the fixes above added back).
// Re-pinned UP 2026-09-21 for the foreign-word notation (`[de:ich]`,
// render/lang-spans.ts): one rule under the narration rules teaching the
// mark, the language name as well as the code, and the one thing the model
// gets wrong unprompted — marking the whole sentence, or marking a loanword
// its own readers say their own way. 209953 -> 210560, 607 chars for a
// feature whose absence is silent: an unmarked foreign word is simply
// mispronounced, and nothing in the output says a mark was available.
// Again the same day, 210560 -> 210880: the notation stopped being a closed
// list (Hans), so the rule now NAMES the 19 short names and says to write a
// full locale for anything else. Spelling the list out is what the 320 chars
// buy — without it a model has no way to know whether `[czech:…]` is a short
// name or needs `[cs-CZ:…]`, and guessing wrong is silent: the brackets
// simply stay in the narration and the word is read by the narrator.
// Re-pinned DOWN 2026-09-22 for the schema's $defs round (Task 2, design
// 2026-09-22 §3.2): the schema is embedded verbatim in the system prompt, so
// its own re-pin below (81898 -> 79310) lands here by the same delta:
// 210880 -> 208292.
// Re-pinned UP 2026-09-22 for one clause on the point bullet: `"blocking":
// false` was named by the SCHEMA's point description and by nothing the
// model reads as prose — 0 of 291 bundled specs used it (design 2026-09-22
// §4.1). 208292 -> 208483.
// Verified 2026-09-22 (final-review round, MINOR 8): the prior entry got here
// by SUBTRACTING the schema's own delta rather than measuring the system
// prompt directly — this repo's pins have carried slack from that shortcut
// before (BASELINE_REVISE_CHARS was 4520 against an actual 4500). Measured
// directly this time, via this test's own system(false).length: 208483,
// exactly the derived figure — no correction needed.
// Re-pinned UP 2026-09-22 for the icon-stamp move (Hans): the `icon` rule
// lived as Freehand rule 8, under a heading that scopes itself "when no
// template fits", so a template figure was told the whole section did not
// apply to it. Measured before the move: 2 of 280 bundled specs use an icon
// element and ZERO of those also use a template — a perfect correlation with
// where the prompt happened to file the rule. The stamp half moves to
// "Elements that need more than the schema" (which no heading scopes away)
// and says templates may use it; the seed half stays in freehand, where a
// thing you take apart belongs. Net +845 (208483 -> 209328): the new bullet
// costs more than the old rule 8 gave back, and buys a capability the schema
// has always carried and nothing reachable ever offered.
// Re-pinned UP 2026-09-23 for supply_demand's region element_ids: two of the
// five said nothing about needing their name in `regions` and a third was
// vague ("when regions is set"). A live Haiku cast drew `wedge_region` with a
// tax present, exactly as its entry described, and got nothing — the entry
// said "a tax only" and never mentioned `regions`. All five now name the
// value that creates them. 209328 -> 209730, +402 for a miss that was silent
// at every stage: it validated, it laid out, it rendered an empty beat.
// Re-pinned UP 2026-09-23 (review): `blocking: false` retaught as the player
// does it (gestures run under the voice, a draw waits), the curve variable
// named as `x` with `t`/`q` as aliases, and the `show` description's default
// for a script with controls. 209730 -> 210300.
// Re-pinned UP 2026-09-23 (knobs pane): the `pane` description and the code
// prompt say the drawn controls sit under the output by default. 210300 -> 210330.
// Re-pinned UP 2026-09-23 (galleries): a live Sonnet "overview of bridge
// designs" put five bridges in one `row` fitted to the full band — each at
// ~0.7×, two thirds of the page empty, four labels per bridge. Rule 3 now
// says a grid with no `columns` picks its own count, that four or more peers
// are a grid, and that a category every peer shares is a colour; the `fade`
// bullet teaches the list walk (fade the last one, restore before
// comparing). Schema: `columns` and the `group` layout sentence say it may
// be left out (+135, embedded verbatim). 210330 -> 211437.
// Re-pinned UP 2026-09-23 (walk): a live run still wrote the list walk's
// fades in only one gallery of two, so the walk became a field — `walk: true`
// on the group, expanded into those fades by spec/walk.ts. The schema gains
// its description (+297); the prompt's hand-written-fade instructions shrink
// to one sentence in rule 3 and a pointer in the fade bullet (−26).
// 211437 -> 211708.
// Re-pinned UP 2026-09-23 (walk modes, Hans: motion that follows from the
// structure): `walk` gains "zoom" (the camera frames each peer) and
// "replace" (alternatives erase each other — the 2026-09-12 contrast rule),
// and `camera.zoom` gains "fit". Schema +370 (walk's anyOf and description,
// zoom's), prompt +293 (one sentence each in rule 3). 211708 -> 212371.
// Re-pinned UP 2026-09-24 (explore on screen, Hans: opening the tray when a
// cast pauses to hand over is "visually ugly — do it only if it is
// necessary"): an explore beat naming nothing on a figure played ON leaves
// the figure live, tray shut. One clause in the prompt's explore bullet
// (+143) and in the schema's explore description (+104). 212371 -> 212618.
// Re-pinned UP 2026-09-24 (music round 1 + explore.activity, design
// 2026-09-24-music-notation-and-staff): the `music` element and its four
// properties, three instruments, `explore.activity`/`store`, and one clause
// in the explore bullet. This measure embeds the FULL schema; what an
// ordinary (non-music) request pays is less — the sound gate withholds the
// music element and the play keys: the gated schema went 78372 -> 78903
// (+531, the explore.activity/store descriptions, which serve chess and the
// periodic table too). 212618 -> 214190.
// Re-pinned UP 2026-09-24 (music round 2, the staff as an instrument):
// `explore.store`'s description now also says a note_sheet keeps the
// composed melody, played back with {"play": "{<store>}"}. +102 on the
// schema and so on this measure. 214190 -> 214292.
// Re-pinned UP 2026-09-24 (music round 3, activities): explore.activity's
// list names the four new drills (ear_key, staff_find, staff_name,
// ear_staff), and the ask device list gains `staff`. +180 on the
// schema, the same here. 214292 -> 214472.
// Re-pinned 2026-09-24 (the quick heading, Hans: the TV card "takes too
// much time for short drawcasts"): card's default is a top heading that
// zooms quickly into place and stays; the opening rule says so and asks for
// the first drawing on the next beat; card gains `style` (center = the old
// card). Schema +115, system +162. 214472 -> 214634.
// Re-pinned UP 2026-09-24 (emphasis as a highlighter, Hans: glow looked
// like "a cheap neon sign"; highlight "one character, or the whole
// equations, or a line, or part of a line"): glow is the default and the
// schema/prompt say what it does per target; highlight gains `part` and the
// `underline` effect. The glow rewording itself fit the old pin; part and
// underline are the growth. 214634 -> 214895.
// Re-pinned UP 2026-09-25 (example revisions, Hans: "you seem to narrate
// both things after a multiple choice question … only do one"): the quiz
// rule says `wrong` is spoken BEFORE the reveal, so it is a hint, never the
// answer again, and may be left out. +142. And the opening rule asks the
// first line to say what the drawcast is about before the hook ("a
// tendency … to jump into things without briefly saying what the specific
// drawcast is about"). +148. 214895 -> 215185.
// Re-pinned UP 2026-09-25 (example revisions, batch-2 fixes): the default
// catalog's ring_molecule entry says its centre is reached through `ring`
// (the documented `ring_center` was an anchor no gesture could find). +50.
// 215185 -> 215235.
// Re-pinned UP 2026-09-25 (example revisions, round 3): the card rule says
// to leave a template's own `title` unset — the card is the heading, and a
// template title drew a second one. +43. 215235 -> 215278.
// Re-pinned UP 2026-09-25 (axes cross at the origin): the axes `cross` field. +190. 215278 -> 215468.
const BASELINE_SYSTEM_CHARS = 215468;
// Re-pinned DOWN 2026-09-21: `soft` left the delivery enum and its clause
// left the enum's description (Hans — the confiding lean-in was the one
// delivery that dropped pitch and volume, and it read as mumbling):
// 81722 -> 81655. Then UP the same day, 81655 -> 81832, for the sentence on
// `speak` that says a foreign word may be marked `[de:ich]` — the schema
// description is the only place a model reading the API contract alone would
// learn it exists. 81832 -> 81898 when that sentence gained the locale form
// for languages outside the named list.
// Re-pinned DOWN 2026-09-22: the repeated sub-shapes (the point-ref bag ×8,
// the ghost option ×5, the arrow endpoint ×4) moved into specSchema.$defs
// and each call site became an allOf wrapper that keeps its own description
// unchanged (design 2026-09-22 §3.2). 81898 -> 79310. Nothing the model
// reads changed; only the number of times it reads the same braces. (The
// design doc's own §3.2 estimate for this move was 8,545 chars — that figure
// turned out to count the per-site descriptions too, which Strategy A
// deliberately keeps at every site; the structural saving alone, measured
// here, is 2,588.)
// Re-pinned UP 2026-09-23: `show` says a script with controls defaults to
// below (output on top, code under it). 79310 -> 79419.
// Re-pinned UP 2026-09-23 (knobs pane): `pane` says under the output by default. 79419 -> 79449.
// Re-pinned UP 2026-09-23 (galleries): `columns`, and the `group` layout
// sentence, say it may be left out. 79449 -> 79584.
// Re-pinned UP 2026-09-23 (walk): the group's `walk` field. 79584 -> 79881.
// Re-pinned UP 2026-09-23 (walk modes): walk "zoom"/"replace", camera zoom "fit". 79881 -> 80251.
// Re-pinned UP 2026-09-24 (explore on screen): the explore description's clause. 80251 -> 80355.
// Re-pinned UP 2026-09-24 (music round 1 + explore.activity): see the system note. 80355 -> 81775.
// Re-pinned UP 2026-09-24 (music round 2): explore.store names the composed melody. 81775 -> 81877.
// Re-pinned UP 2026-09-24 (music round 3): the new drills and the staff device. 81877 -> 82057.
// Re-pinned 2026-09-24 (the quick heading): card's description and its `style`. 82057 -> 82172.
// Re-pinned UP 2026-09-24 (emphasis as a highlighter): highlight `part` and `underline`. 82172 -> 82329.
// Re-pinned UP 2026-09-25: the axes `cross` field. 82329 -> 82481.
const BASELINE_SCHEMA_CHARS = 82481;

// Pinned 2026-09-21 with the revise notation card (llm/prompts/revise-v1.md):
// the one block a REVISION pays for that a generation does not. It rides in
// the uncached tail, so every revision pays it in full — cheap against the
// ~10k-token cached prefix, and it buys the thing the compiler prompt never
// said: what the author's own notation is, that a document may have pages,
// where the document settings live, and that "JSON only" is off for this
// turn. Same ratchet rule as the constants above: a round that adds to the
// card re-pins here, on purpose, with a note.
// Re-pinned UP 2026-09-22: four constructs the scanner accepts but the card
// never named — inline `(@ … @)` action spans, `A:`/`B:` dialogue lines,
// `@name` gotos, and the closed SETTING_KEYS list (design 2026-09-22 §4.3).
// 4520 -> 5246. A revision was being told to return every beat unchanged
// while being shown a notation missing four of its spellings.
// Re-pinned UP 2026-09-22 (final-review round, MINOR 7): the inline-span
// bullet's headline wrote the construct as `(@ … @)` with a space, but
// liftActions (src/spec/script/lines.ts) only opens a span when a LETTER
// follows `(@` immediately — a model copying the spaced form literally
// produces a span that is silently spoken aloud instead of firing. Added
// half a clause saying so; the bullet's own concrete example was already
// correct. 5246 -> 5372.
// Re-pinned UP 2026-09-24 (loading poster): `poster:` joined the document
// settings, and the card lists every one (tests/revise.test.ts) so a revise
// never writes it inside a page. 5372 -> 5383.
const BASELINE_REVISE_CHARS = 5383;

const system = (code: boolean, sound = false) =>
  buildSystemPrompt(promptVariants()[0].source, {
    schema: apiSchema(),
    catalog: catalogParts({}).stable,
    fewshots: fewshotsText(),
    exemplars: "",
    code: code ? CODE_PROMPT_SOURCE : "",
    sound: sound ? SOUND_PROMPT_SOURCE : "",
  });

describe("prompt budget (spec §6.3)", () => {
  test("the schema stays within the pinned size", () => {
    expect(JSON.stringify(apiSchema()).length).toBeLessThanOrEqual(BASELINE_SCHEMA_CHARS);
  });
  // Task 3 (design §3.3): the code/sound gate that already withholds
  // {{CODE}} and {{SOUND}} in prose now withholds the matching schema keys
  // too — the `code` element and its 14 properties, and the `play` verb with
  // its four play-only properties (tempo, instrument, reveal, press).
  // Measured 2026-09-22: full 79,310 -> both gates off 68,166, a withheld
  // 11,144 (9,161 of it the code half, 1,983 the sound half — measured
  // separately and additively, since the two gates touch disjoint parts of
  // the schema). This is the ordinary request: not about code, not about
  // sound, so it should be handed neither schema half.
  test("a request about neither code nor sound is not handed either schema half", () => {
    const full = JSON.stringify(apiSchema()).length;
    const bare = JSON.stringify(apiSchema({ code: false, sound: false })).length;
    expect(full - bare).toBeGreaterThan(9_000);
  });
  test("the revise card stays within the pinned size", () => {
    expect(REVISE_PROMPT_SOURCE.length).toBeLessThanOrEqual(BASELINE_REVISE_CHARS);
  });
  test("a non-code request gets a system prompt no larger than the pinned size", () => {
    expect(system(false).length).toBeLessThanOrEqual(BASELINE_SYSTEM_CHARS);
  });
  test("the code block is only sent when asked for, and is the 12k bullet", () => {
    expect(system(true).length - system(false).length).toBeGreaterThan(10_000);
    expect(system(false)).not.toContain("**code** runs a real script");
    expect(system(true)).toContain("**code** runs a real script");
  });
  // The same treatment as the code block, for the same reason: `play` is 1.4k
  // chars of note notation and ABC that only a figure genuinely about sound
  // or music may use — and the prompt already says so ("ONLY when the figure
  // is genuinely about sound or music"). A false negative costs nothing but
  // the sound, which is the default anyway; a false positive costs tokens.
  test("the sound block is only sent when the request is about sound", () => {
    expect(system(false, true).length - system(false).length).toBeGreaterThan(1_000);
    expect(system(false)).not.toContain("**play** sounds synthesized notes");
    expect(system(false, true)).toContain("**play** sounds synthesized notes");
  });

  // The gate's real contract, and the one a hand-written word list rots
  // against: EVERY figure we ship that sounds notes must be reachable from
  // its own request. A miss here is silent — the model simply never learns
  // the verb exists and writes the figure mute. Caught one on the first run
  // ("Play Twinkle Twinkle from ABC notation." — neither "play" nor "ABC"
  // was in the list), which is why this is data-driven rather than a list of
  // sentences I thought of.
  test("every bundled figure that plays is reachable by the gate", () => {
    const withPlay = [...(bundledExamples as { request: string; spec?: { commands?: Record<string, unknown>[] } }[]), ...(fewshots as { request: string; spec?: { commands?: Record<string, unknown>[] } }[])]
      .filter((e) => (e.spec?.commands ?? []).some((c) => "play" in c))
      .map((e) => e.request);
    expect(withPlay.length, "the examples still ship figures that play").toBeGreaterThan(0);
    expect(withPlay.filter((r) => !wantsSound(r))).toEqual([]);
  });

  test("wantsSound reads the request text — in Norwegian too", () => {
    expect(wantsSound("Show the C major scale on a staff")).toBe(true);
    expect(wantsSound("What makes a minor chord sound sad?")).toBe(true);
    expect(wantsSound("Hvordan høres en kvint ut?")).toBe(true);
    expect(wantsSound("Forklar hvorfor en oktav er en dobling av frekvensen")).toBe(true);
    expect(wantsSound("Vis en melodi på pianotangentene")).toBe(true);
    // Ordinary explanations pay nothing for it.
    expect(wantsSound("Explain a demand curve")).toBe(false);
    expect(wantsSound("Hvorfor er himmelen blå?")).toBe(false);
    expect(wantsSound("Draw a neuron and show how the signal travels")).toBe(false);
  });

  test("wantsCode reads the request text — in Norwegian too", () => {
    expect(wantsCode("Explain a demand curve")).toBe(false);
    expect(wantsCode("Simulate 500 coin flips in Python")).toBe(true);
    expect(wantsCode("Show the C64 booting")).toBe(true);
    // Norwegian stems: half the requests this app sees are written in it.
    expect(wantsCode("Simuler 500 myntkast i Python")).toBe(true);
    expect(wantsCode("Skriv et skript som regner ut renters rente")).toBe(true);
    expect(wantsCode("Lag et program som simulerer terningkast")).toBe(true);
    expect(wantsCode("Beregn nåverdien og vis koden")).toBe(true);
    // Ordinary explanations still pay nothing for the code block.
    expect(wantsCode("Hvorfor er himmelen blå?")).toBe(false);
    expect(wantsCode("Forklar inflasjon for en nybegynner")).toBe(false);
  });

  // A command key the schema advertises must be reachable from the prose.
  // `blocking` was in neither the prompt nor tags.ts nor any of 291 bundled
  // specs, while the schema's `point` description told the model to combine
  // it with speak. Design §4.1.
  test("the prompt names blocking where the schema says to use it", () => {
    expect(system(false)).toContain('"blocking": false');
  });
});

describe("template box in the prompt (spec 2026-09-15-template-box §10)", () => {
  test("the compiler learns params.box by its region names, in the main prompt, the code prompt and the schema", () => {
    expect(system(false)).toContain('"box": "right"');
    expect(system(true)).toContain('"box": "left"` puts the figure on the left');
    expect(JSON.stringify(apiSchema())).toContain('Any template also takes \\"box\\"');
  });

  test("the compiler learns the present-then-shrink pattern by names", () => {
    expect(system(false)).toContain('{"animate": {"box": "right"}');
  });

  test('the schema\'s animate description learns "box" may be a region name', () => {
    expect(JSON.stringify(apiSchema())).toContain('{\\"animate\\": {\\"box\\": \\"right\\"}}');
  });
});

describe("inset in the prompt (spec 2026-09-17-inset §8)", () => {
  test("the schema and the prompt teach the inset", () => {
    const schema = JSON.stringify(apiSchema());
    expect(schema).toContain('"inset"');
    expect(schema).toContain("fits the whole 1000×750 canvas");
    const sys = system(false);
    expect(sys).toContain("**inset** is a small picture of ANOTHER page");
    expect(sys).toContain('"of": "The Markov model"');
  });
});
