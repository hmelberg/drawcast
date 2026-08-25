import { describe, expect, test } from "vitest";
import { buildAuthorUserContent, processAuthorDoc, templateDocToYaml, TEMPLATE_DOC_API_SCHEMA } from "../src/llm/author";
import { parseTemplateDoc, type TemplateDoc } from "../src/scenes/doc";
import { scenes } from "../src/scenes/registry";
import { ensureEngines } from "../src/scenes/engines";

function goodDoc(): TemplateDoc {
  return {
    template: "author_test_ring",
    title: "Test ring",
    version: 1,
    kit: 1,
    status: "ready",
    description: "A test ring figure.",
    params: { type: "object", properties: { n: { type: "number" } } },
    element_ids: { ring: "the ring" },
    examples: [{ request: "Draw a ring.", params: { n: 6 } }],
    layout: `return { drawables: [kit.stroke("ring", kit.polygon([500, 400], 120, params.n ?? 6), { closed: true })], labels: [], anchors: { ring_center: [500, 400] }, order: ["ring"] };`,
  };
}

describe("buildAuthorUserContent", () => {
  test("text only", () => {
    expect(buildAuthorUserContent("a cell", null)).toBe("a cell");
  });

  test("image + text becomes a content-block array with the image first", () => {
    const c = buildAuthorUserContent("like this", { mediaType: "image/png", dataBase64: "AAAA" });
    expect(Array.isArray(c)).toBe(true);
    const blocks = c as { type: string }[];
    expect(blocks[0].type).toBe("image");
    expect(blocks[1]).toMatchObject({ type: "text", text: "like this" });
  });

  test("improve mode appends the current yaml", () => {
    const c = buildAuthorUserContent("make it rounder", null, "template: x\n");
    expect(c).toContain("make it rounder");
    expect(c).toContain("template: x");
  });
});

describe("processAuthorDoc", () => {
  test("a good doc validates, compiles, runs and lints clean; registry is untouched after", () => {
    const before = Object.keys(scenes).length;
    const r = processAuthorDoc(goodDoc());
    expect(r.errors).toEqual([]);
    expect(r.doc?.template).toBe("author_test_ring");
    expect(Object.keys(scenes).length).toBe(before);
    expect(scenes.author_test_ring).toBeUndefined();
  });

  test("id colliding with a built-in is an error", () => {
    const d = { ...goodDoc(), template: "supply_demand" };
    const r = processAuthorDoc(d);
    expect(r.errors.some((e) => /different template id|built-in/.test(e))).toBe(true);
  });

  test("invalid doc shape reports validation errors", () => {
    const r = processAuthorDoc({ template: "x" });
    expect(r.doc).toBeNull();
    expect(r.errors.length).toBeGreaterThan(0);
  });

  test("a layout that throws at runtime reports the error", () => {
    const d = { ...goodDoc(), layout: `throw new Error("boom");` };
    const r = processAuthorDoc(d);
    expect(r.errors.some((e) => /boom/.test(e))).toBe(true);
  });

  test("a layout with invalid output reports the guard's message", () => {
    const d = { ...goodDoc(), layout: `return { nope: true };` };
    const r = processAuthorDoc(d);
    expect(r.errors.some((e) => /drawables/.test(e))).toBe(true);
  });
});

function goodDocWithEngine(): TemplateDoc {
  return {
    template: "author_test_molecule",
    title: "Test molecule",
    version: 1,
    kit: 1,
    status: "ready",
    description: "A test molecule figure using the smilesdrawer engine.",
    params: { type: "object", properties: { smiles: { type: "string" } } },
    element_ids: { bond_0: "the first bond" },
    examples: [{ request: "Draw a test molecule.", params: { smiles: "C=C" } }],
    engines: ["smilesdrawer"],
    layout:
      `const mol = engines.smilesdrawer.layoutSmiles(params.smiles ?? "C=C");\n` +
      `return { drawables: [kit.stroke("bond_0", [[500, 400], [500 + mol.atoms.length, 400]], {})], labels: [], anchors: {}, order: ["bond_0"] };`,
  };
}

describe("engines support (M5 Task 2 — authoring side)", () => {
  test("TEMPLATE_DOC_API_SCHEMA declares a closed engines enum", () => {
    expect(TEMPLATE_DOC_API_SCHEMA.properties.engines).toEqual({
      type: "array",
      items: { type: "string", enum: ["smilesdrawer", "mathjax", "chess"] },
    });
  });

  test("a doc declaring engines:[smilesdrawer] passes processAuthorDoc once the engine is pre-loaded", async () => {
    await ensureEngines(["smilesdrawer"]);
    const r = processAuthorDoc(goodDocWithEngine());
    expect(r.errors).toEqual([]);
    expect(r.doc?.engines).toEqual(["smilesdrawer"]);
    expect(scenes.author_test_molecule).toBeUndefined(); // registry untouched after preview
  });

  test("its yaml round-trips through parseTemplateDoc with engines intact", () => {
    const { yaml, error } = templateDocToYaml(goodDocWithEngine());
    expect(error).toBeUndefined();
    const back = parseTemplateDoc(yaml!);
    expect(back.errors).toEqual([]);
    expect(back.doc?.engines).toEqual(["smilesdrawer"]);
  });
});

describe("templateDocToYaml", () => {
  test("round-trips through parseTemplateDoc with the layout intact", () => {
    const { yaml, error } = templateDocToYaml(goodDoc());
    expect(error).toBeUndefined();
    const back = parseTemplateDoc(yaml!);
    expect(back.errors).toEqual([]);
    expect(back.doc?.layout).toContain("kit.polygon");
    expect(back.doc?.template).toBe("author_test_ring");
  });
});
