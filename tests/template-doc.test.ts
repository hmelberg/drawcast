import { describe, expect, test } from "vitest";
import { parseTemplateDoc, validateTemplateDoc, docToManifest } from "../src/scenes/doc";
import { registerTemplateDoc, registerTemplateYaml, scenes } from "../src/scenes/registry";

const GOOD = `
template: demo_ring
title: Demo ring
version: 1
kit: 1
status: ready
description: A demo.
params:
  type: object
  properties:
    n: { type: number }
element_ids:
  ring: the ring
examples:
  - request: "Draw a ring."
    params: { n: 6 }
layout: |
  return { drawables: [kit.stroke("ring", kit.polygon([500, 400], 100, params.n ?? 6), { closed: true })], labels: [], anchors: {}, order: ["ring"] };
`;

describe("parseTemplateDoc", () => {
  test("parses a good document", () => {
    const r = parseTemplateDoc(GOOD);
    expect(r.errors).toEqual([]);
    expect(r.doc?.template).toBe("demo_ring");
    expect(r.doc?.layout).toContain("kit.polygon");
  });

  test("reports YAML syntax errors instead of throwing", () => {
    const r = parseTemplateDoc("template: [unclosed");
    expect(r.doc).toBeUndefined();
    expect(r.errors.length).toBeGreaterThan(0);
  });
});

describe("validateTemplateDoc", () => {
  const base = () => parseTemplateDoc(GOOD).doc as unknown as Record<string, unknown>;

  test("rejects a bad template id", () => {
    const d = base();
    d.template = "Bad Name!";
    expect(validateTemplateDoc(d).errors[0]).toMatch(/template id/);
  });

  test("rejects ready without layout", () => {
    const d = base();
    delete d.layout;
    expect(validateTemplateDoc(d).errors[0]).toMatch(/layout/);
  });

  test("stub without layout is fine", () => {
    const d = base();
    d.status = "stub";
    delete d.layout;
    expect(validateTemplateDoc(d).errors).toEqual([]);
  });

  test("rejects kit newer than KIT_VERSION", () => {
    const d = base();
    d.kit = 99;
    expect(validateTemplateDoc(d).errors[0]).toMatch(/newer kit/);
  });

  test("rejects engines in M1", () => {
    const d = base();
    d.engines = ["smilesdrawer"];
    expect(validateTemplateDoc(d).errors[0]).toMatch(/M4/);
  });

  test("rejects malformed examples", () => {
    const d = base();
    d.examples = [{ params: {} }];
    expect(validateTemplateDoc(d).errors[0]).toMatch(/example/);
  });
});

test("docToManifest maps fields onto SceneManifest", () => {
  const doc = parseTemplateDoc(GOOD).doc!;
  const m = docToManifest(doc);
  expect(m.name).toBe("demo_ring");
  expect(m.status).toBe("ready");
  expect(m.params_schema).toEqual(doc.params);
  expect(m.element_ids.ring).toBe("the ring");
  expect(m.examples).toHaveLength(1);
});

describe("registerTemplateDoc", () => {
  test("registers a ready doc as a working scene", () => {
    const r = registerTemplateYaml(GOOD);
    expect(r.ok).toBe(true);
    expect(scenes.demo_ring.layout).toBeDefined();
    const layout = scenes.demo_ring.layout!({ n: 5 });
    expect(layout.drawables[0].id).toBe("ring");
    delete scenes.demo_ring; // keep the registry clean for other tests
  });

  test("a doc that fails to compile registers as a stub", () => {
    const doc = parseTemplateDoc(GOOD).doc!;
    const broken = { ...doc, template: "demo_broken", layout: "return {{{" };
    const r = registerTemplateDoc(broken);
    expect(r.ok).toBe(false);
    expect(r.errors[0]).toMatch(/compile/);
    expect(scenes.demo_broken.manifest.status).toBe("stub");
    expect(scenes.demo_broken.layout).toBeUndefined();
    delete scenes.demo_broken;
  });

  test("invalid yaml never registers", () => {
    const r = registerTemplateYaml("template: [nope");
    expect(r.ok).toBe(false);
  });
});
