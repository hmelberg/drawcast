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

type Ex = { request: string; spec?: { template?: string; elements?: { type: string; at?: { ref?: string }; fit?: unknown; tex?: unknown; closed?: boolean; style?: { fill?: string }; strokes?: string; credit?: string }[] } };
const uses = (ex: Ex, pred: (e: NonNullable<NonNullable<Ex["spec"]>["elements"]>[number]) => boolean) => !!ex.spec?.elements?.some(pred);

describe("freehand exemplars (spec §6.2)", () => {
  test("three few-shots cover a thing, a formula and an image, all freehand", () => {
    const fh = (fewshots as Ex[]).filter((e) => !e.spec?.template);
    expect(fh.some((e) => uses(e, (x) => x.type === "group" && x.fit !== undefined))).toBe(true);
    expect(fh.some((e) => uses(e, (x) => x.type === "math"))).toBe(true);
    expect(fh.some((e) => uses(e, (x) => x.type === "image"))).toBe(true);
    // `at` is the freehand assembly rule, so it is pinned on a FREEHAND
    // few-shot (the bicycle pump) — the client-server one places its notes
    // with label + attach_to, which is what the prompt tells the model to do
    // for text that names an element (anti-pattern 2, compiler-v1.md).
    expect((fewshots as Ex[]).find((e) => e.request.startsWith("How does a bicycle pump"))!.spec!.elements!.some((x) => x.at?.ref)).toBe(true);
    expect((fewshots as Ex[]).find((e) => e.request.startsWith("Show a client"))!.spec!.elements!.every((x) => x.at === undefined)).toBe(true);
  });
  test("a bundled example fills a closed path, so the gate renders filledOutline for paths (D2)", () => {
    const filled = (examples as Ex[]).filter((e) => e.spec && !e.spec.template && uses(e, (x) => x.type === "path" && x.closed === true && !!x.style?.fill));
    expect(filled.length).toBeGreaterThanOrEqual(1);
  });

  // The `icon` STAMP (compiler-v1.md, "Freehand figures" rule 7) needs its own
  // worked examples: an icon element whose keyword has already been resolved
  // — rings in `strokes`, the set in `set`, the attribution in `credit` — so
  // the Examples list draws it offline and the credits collector has a line to
  // collect. Two, so the pair covers both languages the bundle teaches in.
  test("two bundled examples stamp resolved icons, credit and all", () => {
    const stamped = (examples as Ex[]).filter((e) =>
      uses(e, (x) => x.type === "icon" && typeof x.strokes === "string" && x.strokes.length > 0 && typeof x.credit === "string" && x.credit.length > 0),
    );
    expect(stamped.length).toBeGreaterThanOrEqual(2);
    // An icon is a stamp beside the drawing, never the drawing: each of these
    // places its icons with `at`, against a part that is already there.
    for (const e of stamped) for (const el of e.spec!.elements!.filter((x) => x.type === "icon")) expect(el.at?.ref, e.request).toBeTruthy();
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
