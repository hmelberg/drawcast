// Coverage for the freehand exemplars (design spec §6.2): the three targets
// of this round — a THING with named parts, a FORMULA beside a curve, and an
// ILLUSTRATED explanation with one Commons photo — each have to be shown to
// the model twice over, once as a few-shot (always in the prompt) and once as
// a bundled example (the Examples list, and the {{EXEMPLARS}} slots a fresh
// library leaves empty). The other gates check that an exemplar renders;
// this one checks that the set still covers all three targets, and that the
// bundled requests are still phrased as questions (STYLE, 2026-09-07).
import { describe, expect, test } from "vitest";
import examples from "../src/examples.json";
import fewshots from "../src/llm/prompts/fewshots.json";

type Ex = { request: string; spec?: { template?: string; elements?: { type: string; at?: { ref?: string }; fit?: unknown; tex?: unknown }[] } };
const uses = (ex: Ex, pred: (e: NonNullable<NonNullable<Ex["spec"]>["elements"]>[number]) => boolean) => !!ex.spec?.elements?.some(pred);

describe("freehand exemplars (spec §6.2)", () => {
  test("three few-shots cover a thing, a formula and an image, all freehand", () => {
    const fh = (fewshots as Ex[]).filter((e) => !e.spec?.template);
    expect(fh.some((e) => uses(e, (x) => x.type === "group" && x.fit !== undefined))).toBe(true);
    expect(fh.some((e) => uses(e, (x) => x.type === "math"))).toBe(true);
    expect(fh.some((e) => uses(e, (x) => x.type === "image"))).toBe(true);
    expect((fewshots as Ex[]).find((e) => e.request.startsWith("Show a client"))!.spec!.elements!.some((x) => x.at?.ref)).toBe(true);
  });
  test("six bundled examples, question-shaped, two per target", () => {
    const fh = (examples as Ex[]).filter((e) => e.spec && !e.spec.template);
    const things = fh.filter((e) => uses(e, (x) => x.type === "group"));
    const maths = fh.filter((e) => uses(e, (x) => x.type === "math"));
    const images = fh.filter((e) => uses(e, (x) => x.type === "image"));
    expect(things.length).toBeGreaterThanOrEqual(2);
    expect(maths.length).toBeGreaterThanOrEqual(2);
    expect(images.length).toBeGreaterThanOrEqual(2);
    for (const e of [...things, ...maths, ...images]) expect(e.request).toMatch(/\?|why|how|hvorfor|hvordan/i);
  });
});
