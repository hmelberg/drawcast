import { describe, expect, test } from "vitest";
import { compileTemplateDoc, validateSceneLayout } from "../src/scenes/compile";
import type { TemplateDoc } from "../src/scenes/doc";

function doc(layout: string): TemplateDoc {
  return {
    template: "t_demo",
    version: 1,
    kit: 1,
    status: "ready",
    description: "d",
    params: {},
    element_ids: {},
    examples: [{ request: "r", params: {} }],
    layout,
  };
}

const GOOD_BODY = `
const pts = kit.polygon([500, 400], 100, params.n ?? 6);
return { drawables: [kit.stroke("ring", pts, { closed: true })], labels: [], anchors: { ring_center: [500, 400] }, order: ["ring"] };
`;

describe("compileTemplateDoc", () => {
  test("a good body compiles and runs deterministically", () => {
    const { module, errors } = compileTemplateDoc(doc(GOOD_BODY));
    expect(errors).toEqual([]);
    const a = module!.layout!({ n: 5 });
    expect(a.drawables[0].id).toBe("ring");
    expect(JSON.stringify(a)).toBe(JSON.stringify(module!.layout!({ n: 5 })));
  });

  test("a syntax error is a compile error, not a throw", () => {
    const { module, errors } = compileTemplateDoc(doc("return {{{"));
    expect(module).toBeUndefined();
    expect(errors[0]).toMatch(/compile/);
  });

  test("a body that throws at runtime propagates (layoutSpec catches it)", () => {
    const { module } = compileTemplateDoc(doc(`throw new Error("boom");`));
    expect(() => module!.layout!({})).toThrow(/boom/);
  });

  test("garbage output throws with a validation message", () => {
    const { module } = compileTemplateDoc(doc(`return { nope: true };`));
    expect(() => module!.layout!({})).toThrow(/drawables/);
  });

  test("NaN coordinates are rejected", () => {
    const { module } = compileTemplateDoc(doc(`return { drawables: [kit.stroke("a", [[0, NaN]])], labels: [], anchors: {}, order: ["a"] };`));
    expect(() => module!.layout!({})).toThrow(/finite/);
  });

  test("imports are impossible from a body", () => {
    const { module, errors } = compileTemplateDoc(doc(`import x from "y"; return null;`));
    // import is a syntax error inside a function body
    expect(module).toBeUndefined();
    expect(errors.length).toBeGreaterThan(0);
  });
});

describe("validateSceneLayout", () => {
  test("accepts a minimal valid layout", () => {
    expect(validateSceneLayout({ drawables: [], labels: [], anchors: {}, order: [] })).toEqual([]);
  });

  test("rejects duplicate top-level drawable ids", () => {
    const d = { id: "x", kind: "stroke", pts: [[0, 0]], z: 1, style: { color: "#000", strokeWidth: 1, roughness: 1, opacity: 1 }, drawOpts: { mode: "instant", duration: 0 } };
    const errs = validateSceneLayout({ drawables: [d, { ...d }], labels: [], anchors: {}, order: ["x"] });
    expect(errs[0]).toMatch(/duplicate/);
  });

  test("rejects order entries that name nothing", () => {
    const errs = validateSceneLayout({ drawables: [], labels: [], anchors: {}, order: ["ghost"] });
    expect(errs[0]).toMatch(/order/);
  });

  test("rejects coordinates far outside the canvas", () => {
    const errs = validateSceneLayout({
      drawables: [{ id: "a", kind: "stroke", pts: [[99999, 0]], z: 1, style: { color: "#000", strokeWidth: 1, roughness: 1, opacity: 1 }, drawOpts: { mode: "instant", duration: 0 } }],
      labels: [],
      anchors: {},
      order: ["a"],
    });
    expect(errs[0]).toMatch(/bounds/);
  });
});
