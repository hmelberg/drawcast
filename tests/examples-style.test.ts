// The bundled examples' TEACHING shape, as ratchets.
//
// tests/examples.test.ts holds the render gate: does every example validate,
// lay out, plan and lint cleanly. Nothing there has ever looked at what the
// examples teach — so STYLE.md's two open sweeps (errand-shaped requests,
// 2026-09-07; un-situated and speak-only openings, 2026-08-26) could sit in
// the candidates list for months without anything turning red.
//
// These are RATCHETS, not clean gates: the counts are pinned at what the file
// measures today, and a new example may not push them up. Each sweep that
// fixes existing examples lowers its pin, on purpose, with a note — the same
// idiom as BASELINE_SYSTEM_CHARS in tests/prompt-size.test.ts. The target for
// both is 0.

import { describe, expect, test } from "vitest";
import bundledExamples from "../src/examples.json";
import { isStandaloneSpeak } from "../src/lint/lint";
import { parsePlaylistText, itemsOf } from "../src/playlist/playlist";
import type { Spec } from "../src/spec/types";

interface BundledExample {
  request: string;
  spec?: Spec;
  playlist?: string;
}

const examples = bundledExamples as BundledExample[];

/**
 * A request phrased as an ERRAND — "Show me X", "Put the Ys in order" — as
 * opposed to a question, or something someone wants understood.
 *
 * Hans, 2026-09-07 (STYLE.md): «Generelt er det fint om eksemplene tar
 * utgangspunkt i et spørsmål eller noe de vil forklare.» The `request` line
 * is not a caption — it is the user input the model learns to recognise, and
 * an errand teaches it that the app draws things on command rather than
 * answering.
 *
 * The line runs between DRAWING verbs and TEACHING ones: "Show", "Draw",
 * "Vis", "Tegn" are errands; "Explain"/"Forklar" is a thing someone wants
 * understood and passes. Imperative forms only — a bare "vis" and not
 * "vise" — so a verb inside a sentence never trips it.
 */
export function isErrandShaped(request: string): boolean {
  return /^\s*(show|draw|illustrate|make|create|build|plot|display|list|put|give|sketch|vis|tegn|lag|sett|plasser|still)\b/i.test(request);
}

/** Every spec an example carries: a single spec, or each item of its playlist. */
function specsOf(ex: BundledExample): Spec[] {
  if (ex.spec) return [ex.spec];
  if (ex.playlist) return itemsOf(parsePlaylistText(ex.playlist)).map((i) => i.spec);
  return [];
}

describe("isErrandShaped", () => {
  test("flags an imperative drawing order, in either language", () => {
    expect(isErrandShaped("Show the forces on a crate resting on a ramp.")).toBe(true);
    expect(isErrandShaped("Draw a benzene ring.")).toBe(true);
    expect(isErrandShaped("Put the planets in order.")).toBe(true);
    expect(isErrandShaped("Vis at 2/4 er det samme som 1/2.")).toBe(true);
    expect(isErrandShaped("Tegn en celle med sine deler.")).toBe(true);
  });

  test("passes a question", () => {
    expect(isErrandShaped("How does a bicycle pump push air into a tyre?")).toBe(false);
    expect(isErrandShaped("Hvorfor er arealet av en sirkel πr²?")).toBe(false);
    expect(isErrandShaped("What does a wind turbine's gearbox actually do?")).toBe(false);
  });

  test("passes a thing someone wants understood — explaining is not an errand", () => {
    expect(isErrandShaped("Explain diminishing marginal utility.")).toBe(false);
    expect(isErrandShaped("Forklar hvordan en vaksine virker.")).toBe(false);
  });

  test("only fires on the imperative at the start, never on a verb inside the sentence", () => {
    expect(isErrandShaped("A pump that can show its own pressure")).toBe(false);
    expect(isErrandShaped("Visualise the spread of a rumour")).toBe(false); // "vis" is not a prefix match
    expect(isErrandShaped("Hvordan lages sement?")).toBe(false); // "lag" is not a prefix match
  });
});

describe("the bundled examples' teaching shape (ratchets — target 0)", () => {
  // Measured 2026-09-11 on 241 examples: 75 errands. STYLE.md's 2026-09-07
  // sweep lowers this — the `space` pack's two were rewritten the day the
  // ruling landed, the rest of the file was not.
  const ERRAND_BASELINE = 75;

  test("no NEW example asks for an errand instead of an answer", () => {
    const errands = examples.filter((ex) => isErrandShaped(ex.request)).map((ex) => ex.request);
    expect(errands.length, `errand-shaped requests:\n${errands.join("\n")}`).toBeLessThanOrEqual(ERRAND_BASELINE);
  });

  // Measured 2026-09-11 across every spec the examples carry (234 single
  // specs plus the playlists' parts): 74 open with a standalone speak. The
  // prompt allows at most one before ink and the lint enforces that ceiling —
  // this counts the ones that take the exception at all, because an exception
  // modelled by a third of the examples stops reading as an exception. The
  // preferred opening puts the line ON the first draw.
  const SPEAK_FIRST_BASELINE = 74;

  test("no NEW example opens by talking to a blank canvas", () => {
    const talkers = examples
      .flatMap((ex) => specsOf(ex).map((spec) => [ex.request, spec] as const))
      .filter(([, spec]) => {
        const first = spec.commands?.[0];
        return first !== undefined && isStandaloneSpeak(first);
      })
      .map(([request]) => request);
    expect(talkers.length, `speak-only openings:\n${talkers.join("\n")}`).toBeLessThanOrEqual(SPEAK_FIRST_BASELINE);
  });
});
