import { describe, expect, test } from "vitest";
import { validateTemplateDoc, docToManifest, type TemplateDoc } from "../src/scenes/doc";
import { compileTemplateDoc } from "../src/scenes/compile";
import { registerTemplateDoc, scenes } from "../src/scenes/registry";

const base = {
  template: "tap_pad",
  version: 1,
  kit: 9,
  status: "ready",
  description: "A pad to tap.",
  params: { type: "object", properties: { count: { type: "integer" } } },
  element_ids: { pad: "the pad" },
  examples: [{ request: "A pad", params: {} }],
  layout: `const drawables = [kit.stroke("pad", [[0,0],[10,0],[10,10],[0,10]], { closed: true })];
    return { drawables, labels: [], anchors: {}, order: ["pad"] };`,
};

const WIDGET = `
  const init = () => ({ n: 0 });
  const on = (ev, st) => ev.id === "pad" ? { state: { n: st.n + 1 }, effects: [{ patch: { count: st.n + 1 } }] } : { state: st, effects: [] };
  return { init, on };
`;

describe("widget body — document", () => {
  test("a widget body is accepted and reaches the manifest", () => {
    const v = validateTemplateDoc({ ...base, widget: WIDGET });
    expect(v.errors).toEqual([]);
    expect(docToManifest(v.doc!).widget).toBe(true);
    expect(docToManifest(validateTemplateDoc(base).doc!).widget).toBeUndefined();
  });

  test("a non-string widget is rejected", () => {
    const v = validateTemplateDoc({ ...base, widget: 42 });
    expect(v.errors.some((e) => /widget must be a string/.test(e))).toBe(true);
  });

  test("compile turns the body into a factory of fresh bodies", () => {
    const { module, errors } = compileTemplateDoc({ ...base, widget: WIDGET } as TemplateDoc);
    expect(errors).toEqual([]);
    expect(typeof module!.widget).toBe("function");
    const a = module!.widget!();
    const b = module!.widget!();
    expect(a).not.toBe(b);
    expect(typeof a.init).toBe("function");
    expect(typeof a.on).toBe("function");
  });

  test("a body without init or on is a document error", () => {
    const { module, errors } = compileTemplateDoc({ ...base, widget: "return { init: () => 0 };" } as TemplateDoc);
    expect(module).toBeUndefined();
    expect(errors[0]).toMatch(/widget body must return \{ init, on \}/);
  });

  test("a body that does not parse is a document error", () => {
    const { module, errors } = compileTemplateDoc({ ...base, widget: "return {" } as TemplateDoc);
    expect(module).toBeUndefined();
    expect(errors[0]).toMatch(/widget body failed to compile/);
  });

  test("a body that throws on load is a document error", () => {
    const { module, errors } = compileTemplateDoc({ ...base, widget: `throw new Error("boom");` } as TemplateDoc);
    expect(module).toBeUndefined();
    expect(errors[0]).toMatch(/widget body threw on load/);
  });

  test("a body may declare keys; a non-array keys is a document error", () => {
    const ok = compileTemplateDoc({ ...base, widget: `return { init: () => 0, on: (e, s) => ({ state: s, effects: [] }), keys: [" ", "Enter"] };` } as TemplateDoc);
    expect(ok.errors).toEqual([]);
    expect(ok.module!.widget!().keys).toEqual([" ", "Enter"]);
    const bad = compileTemplateDoc({ ...base, widget: `return { init: () => 0, on: (e, s) => ({ state: s, effects: [] }), keys: "space" };` } as TemplateDoc);
    expect(bad.module).toBeUndefined();
    expect(bad.errors[0]).toMatch(/keys must be an array of strings/);
  });

  test("a stub document keeps no widget", () => {
    const { module } = compileTemplateDoc({ ...base, status: "stub", layout: undefined, widget: WIDGET } as TemplateDoc);
    expect(module!.widget).toBeUndefined();
    expect(module!.manifest.widget).toBeUndefined();
  });

  test("a ready document without a layout body keeps no widget either", () => {
    const { module } = compileTemplateDoc({ ...base, layout: undefined, widget: WIDGET } as TemplateDoc);
    expect(module!.widget).toBeUndefined();
    expect(module!.manifest.widget).toBeUndefined();
  });

  // The degraded path: a READY document whose layout will not compile still
  // reaches the catalog, as a stub — and a stub cannot be worked, so the flag
  // must not survive the demotion either.
  test("a document that fails to compile registers as a stub with no widget flag", () => {
    const r = registerTemplateDoc({ ...base, template: "tap_pad_broken", layout: "return {", widget: WIDGET } as TemplateDoc);
    expect(r.ok).toBe(false);
    expect(scenes["tap_pad_broken"].manifest.status).toBe("stub");
    expect(scenes["tap_pad_broken"].manifest.widget).toBeUndefined();
    expect(scenes["tap_pad_broken"].widget).toBeUndefined();
  });
});
