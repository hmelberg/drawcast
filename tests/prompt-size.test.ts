import { describe, expect, test } from "vitest";
import { apiSchema, fewshotsText, promptVariants, CODE_PROMPT_SOURCE } from "../src/llm/compile";
import { catalogParts } from "../src/scenes/catalog";
import { buildSystemPrompt, wantsCode } from "../src/llm/prompt";

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
const BASELINE_SYSTEM_CHARS = 221961;
const BASELINE_SCHEMA_CHARS = 108068;

const system = (code: boolean) => buildSystemPrompt(promptVariants()[0].source, { schema: apiSchema(), catalog: catalogParts({}).stable, fewshots: fewshotsText(), exemplars: "", code: code ? CODE_PROMPT_SOURCE : "" });

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
