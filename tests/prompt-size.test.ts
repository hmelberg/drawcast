import { describe, expect, test } from "vitest";
import { apiSchema, fewshotsText, promptVariants, CODE_PROMPT_SOURCE, SOUND_PROMPT_SOURCE } from "../src/llm/compile";
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
// Re-pinned 2026-09-16 for the hand-drawn round: the code element's `chart`
// description now says the default FOLLOWS THE DRAWING (hand-drawn → xkcd in
// the app's own handwriting, clean → seaborn) and that xkcd/seaborn/plain
// force one — +107 chars on the schema (117746 → 117853), which is embedded
// verbatim in the system prompt, so the same +107 lands there (233635 →
// 233742). The same round's rewritten `"chart"` sentence in
// compiler-v1-code.md is behind the {{CODE}} conditional fragment and costs
// an ordinary request nothing, so it is not part of these pins.
const BASELINE_SYSTEM_CHARS = 233742;
const BASELINE_SCHEMA_CHARS = 117853;

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
    expect(JSON.stringify(apiSchema(), null, 2).length).toBeLessThanOrEqual(BASELINE_SCHEMA_CHARS);
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
});

describe("template box in the prompt (spec 2026-09-15-template-box §10)", () => {
  test("the compiler learns params.box by its region names, in the main prompt, the code prompt and the schema", () => {
    expect(system(false)).toContain('"box": "right"');
    expect(system(true)).toContain('"box": "left"` puts the figure on the left');
    expect(JSON.stringify(apiSchema())).toContain('Any template also takes \\"box\\"');
  });
});
