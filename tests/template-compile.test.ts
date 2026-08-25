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

  // M1 review finding #3: a direct call (bypassing validateTemplateDoc) can
  // hand compileTemplateDoc a doc with status "ready" but no layout body.
  // The early-return branch must not advertise a "ready" manifest it can't
  // back with a working layout().
  test("a ready doc with no layout body compiles to a stub manifest, not a broken ready one", () => {
    const readyNoLayout = { ...doc(GOOD_BODY), layout: undefined };
    const { module, errors } = compileTemplateDoc(readyNoLayout);
    expect(errors).toEqual([]);
    expect(module?.manifest.status).toBe("stub");
    expect(module?.layout).toBeUndefined();
  });

  // M1 review finding #2: the guard's group branch used to dereference
  // `d.children.forEach` before validating that children was even an array
  // (via flattenDrawables), so a body returning children: null crashed with
  // an uncontrolled TypeError instead of throwing the intended validation
  // Error. These all go through module.layout() (the real guard boundary,
  // not validateSceneLayout in isolation) so they prove the crash is gone.
  describe("guard's group branch (finding #2)", () => {
    test("children: null on a group is a clean validation Error, not a TypeError", () => {
      const { module } = compileTemplateDoc(
        doc(`return { drawables: [{ id: "g", kind: "group", children: null }], labels: [], anchors: {}, order: [] };`),
      );
      let caught: unknown;
      try {
        module!.layout!({});
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeInstanceOf(Error);
      expect(caught).not.toBeInstanceOf(TypeError);
      expect((caught as Error).message).toMatch(/children/);
    });

    test("a null element inside a group's children is a clean validation Error, not a TypeError", () => {
      const { module } = compileTemplateDoc(
        doc(`return { drawables: [{ id: "g", kind: "group", children: [null] }], labels: [], anchors: {}, order: [] };`),
      );
      let caught: unknown;
      try {
        module!.layout!({});
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeInstanceOf(Error);
      expect(caught).not.toBeInstanceOf(TypeError);
    });

    test("an out-of-bounds point nested inside a group is caught, not just at the top level", () => {
      const { module } = compileTemplateDoc(
        doc(
          `return { drawables: [{ id: "g", kind: "group", children: [{ id: "inner", kind: "stroke", pts: [[99999, 0]] }] }], labels: [], anchors: {}, order: [] };`,
        ),
      );
      expect(() => module!.layout!({})).toThrow(/bounds/);
    });

    test("a duplicate id nested inside a group vs top-level is caught", () => {
      const { module } = compileTemplateDoc(
        doc(
          `return { drawables: [{ id: "dup", kind: "stroke", pts: [[0, 0]] }, { id: "g", kind: "group", children: [{ id: "dup", kind: "stroke", pts: [[1, 1]] }] }], labels: [], anchors: {}, order: [] };`,
        ),
      );
      expect(() => module!.layout!({})).toThrow(/duplicate/);
    });
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

  // M1 review finding #2: the guard itself must stay defensive — these call
  // validateSceneLayout directly (not through module.layout()) to prove the
  // function returns an error array rather than throwing on malformed input.
  test("a group with children: null does not crash the guard; it returns a clean error", () => {
    const errs = validateSceneLayout({
      drawables: [{ id: "g", kind: "group", children: null }],
      labels: [],
      anchors: {},
      order: [],
    });
    expect(errs[0]).toMatch(/children/);
  });

  test("a null element inside a group's children does not crash the guard; it returns a clean error", () => {
    const errs = validateSceneLayout({
      drawables: [{ id: "g", kind: "group", children: [null] }],
      labels: [],
      anchors: {},
      order: [],
    });
    expect(errs.length).toBeGreaterThan(0);
  });

  test("ids are checked for non-empty + uniqueness across the whole tree, not just top-level", () => {
    const dupNested = validateSceneLayout({
      drawables: [
        { id: "top", kind: "stroke", pts: [[0, 0]] },
        { id: "g", kind: "group", children: [{ id: "top", kind: "stroke", pts: [[1, 1]] }] },
      ],
      labels: [],
      anchors: {},
      order: [],
    });
    expect(dupNested[0]).toMatch(/duplicate/);

    const emptyNested = validateSceneLayout({
      drawables: [{ id: "g", kind: "group", children: [{ id: "", kind: "stroke", pts: [[1, 1]] }] }],
      labels: [],
      anchors: {},
      order: [],
    });
    expect(emptyNested[0]).toMatch(/non-empty/);
  });

  test("an area's holes carry coordinates too — they are bounds-checked like pts", () => {
    const ok = validateSceneLayout({
      drawables: [{ id: "a", kind: "area", pts: [[0, 0], [10, 0], [10, 10]], holes: [[[1, 1], [2, 1], [2, 2]]] }],
      labels: [],
      anchors: {},
      order: ["a"],
    });
    expect(ok).toEqual([]);

    const runaway = validateSceneLayout({
      drawables: [{ id: "a", kind: "area", pts: [[0, 0], [10, 0], [10, 10]], holes: [[[99999, 1], [2, 1], [2, 2]]] }],
      labels: [],
      anchors: {},
      order: ["a"],
    });
    expect(runaway[0]).toMatch(/bounds/);

    const notRings = validateSceneLayout({
      drawables: [{ id: "a", kind: "area", pts: [[0, 0], [10, 0], [10, 10]], holes: [[0, 0]] }],
      labels: [],
      anchors: {},
      order: ["a"],
    });
    expect(notRings.length).toBeGreaterThan(0);
  });

  test("an out-of-bounds point nested inside a group is caught", () => {
    const errs = validateSceneLayout({
      drawables: [{ id: "g", kind: "group", children: [{ id: "inner", kind: "stroke", pts: [[99999, 0]] }] }],
      labels: [],
      anchors: {},
      order: [],
    });
    expect(errs[0]).toMatch(/bounds/);
  });
});
