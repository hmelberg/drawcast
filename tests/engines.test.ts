import { beforeEach, describe, expect, test } from "vitest";
import { ENGINE_DEFS, KNOWN_ENGINES, ensureEngines, enginesLoaded, getLoadedEngines, ensureEnginesForTemplate, type SmilesEngine } from "../src/scenes/engines";
import { validateTemplateDoc } from "../src/scenes/doc";
import { registerTemplateDoc, scenes } from "../src/scenes/registry";
import type { TemplateDoc } from "../src/scenes/doc";

describe("engine registry mechanics (fake engine)", () => {
  beforeEach(() => {
    delete (ENGINE_DEFS as Record<string, unknown>).fake;
    delete (ENGINE_DEFS as Record<string, unknown>).fake2;
  });

  test("ensureEngines loads once and caches; getLoadedEngines returns the value", async () => {
    let loads = 0;
    (ENGINE_DEFS as Record<string, { load: () => Promise<unknown> }>).fake = { load: async () => (loads++, { hello: "world" }) };
    expect(enginesLoaded(["fake"])).toBe(false);
    expect(() => getLoadedEngines(["fake"])).toThrow(/not loaded/);
    await ensureEngines(["fake"]);
    await ensureEngines(["fake"]);
    expect(loads).toBe(1);
    expect(enginesLoaded(["fake"])).toBe(true);
    expect((getLoadedEngines(["fake"]).fake as { hello: string }).hello).toBe("world");
  });

  test("unknown engine name rejects", async () => {
    await expect(ensureEngines(["nope"])).rejects.toThrow(/unknown engine/);
  });

  test("a compiled template body receives loaded engines and degrades when unloaded", async () => {
    // Uses a distinct key ("fake2") from the "loads once and caches" test above —
    // the engine cache is keyed by name and persists for the module's lifetime
    // (by design: an already-loaded engine must stay usable), so reusing "fake"
    // here would find it already cached from that earlier test and skip the
    // "not loaded" assertion below.
    (ENGINE_DEFS as Record<string, { load: () => Promise<unknown> }>).fake2 = { load: async () => ({ n: 7 }) };
    const doc: TemplateDoc = {
      template: "engine_probe", version: 1, kit: 1, status: "ready", description: "d",
      params: {}, element_ids: {}, examples: [{ request: "r", params: {} }],
      engines: ["fake2"],
      layout: `const n = engines.fake2.n; return { drawables: [kit.stroke("dot", [[500, 400 + n]], { shapeHint: { type: "circle", c: [500, 400 + n], r: 5 } })], labels: [], anchors: {}, order: ["dot"] };`,
    };
    expect(registerTemplateDoc(doc).ok).toBe(true);
    expect(() => scenes.engine_probe.layout!({})).toThrow(/not loaded/);   // before load: throws → layoutSpec fall-through
    await ensureEngines(["fake2"]);
    const r = scenes.engine_probe.layout!({});
    expect(r.drawables[0].id).toBe("dot");
    delete scenes.engine_probe;
  });
});

describe("doc validation with engines", () => {
  const base = (engines: string[]): Record<string, unknown> => ({
    template: "e_t", version: 1, kit: 1, status: "ready", description: "d",
    params: {}, element_ids: {}, examples: [], engines,
    layout: "return { drawables: [], labels: [], anchors: {}, order: [] };",
  });

  test("known engine accepted; manifest carries it", () => {
    const v = validateTemplateDoc(base(["smilesdrawer"]));
    expect(v.errors).toEqual([]);
    expect(v.doc?.engines).toEqual(["smilesdrawer"]);
  });

  test("unknown engine rejected by name", () => {
    const v = validateTemplateDoc(base(["rdkit"]));
    expect(v.errors[0]).toMatch(/unknown engine "rdkit"/);
  });
});

describe("ensureEnginesForTemplate", () => {
  test("no-op for templates without engines and for unknown ids", async () => {
    await expect(ensureEnginesForTemplate("supply_demand")).resolves.toBeUndefined();
    await expect(ensureEnginesForTemplate("does_not_exist")).resolves.toBeUndefined();
  });
});

describe("smilesdrawer engine (real load — node, no DOM)", () => {
  test("layoutSmiles(phenol) yields a normalized 7-atom graph with one ring and the O atom", async () => {
    await ensureEngines(["smilesdrawer"]);
    const eng = getLoadedEngines(["smilesdrawer"]).smilesdrawer as SmilesEngine;
    const mol = eng.layoutSmiles("c1ccc(O)cc1");
    expect(mol.atoms).toHaveLength(7);
    expect(mol.bonds).toHaveLength(7);
    expect(mol.rings).toHaveLength(1);
    expect(mol.rings[0]).toHaveLength(6);
    expect(mol.atoms.some((a) => a.element === "O")).toBe(true);
    // normalized: centered, max dimension 1
    const xs = mol.atoms.map((a) => a.x), ys = mol.atoms.map((a) => a.y);
    const w = Math.max(...xs) - Math.min(...xs), h = Math.max(...ys) - Math.min(...ys);
    expect(Math.max(w, h)).toBeCloseTo(1, 3);
    expect(Math.abs((Math.max(...xs) + Math.min(...xs)) / 2)).toBeLessThan(1e-6);
    // determinism
    expect(JSON.stringify(eng.layoutSmiles("c1ccc(O)cc1"))).toBe(JSON.stringify(mol));
  });

  test("double bond order survives (C=C)", async () => {
    await ensureEngines(["smilesdrawer"]);
    const eng = getLoadedEngines(["smilesdrawer"]).smilesdrawer as SmilesEngine;
    const mol = eng.layoutSmiles("C=C");
    expect(mol.bonds[0].order).toBe(2);
  });

  test("bad SMILES throws a parse error", async () => {
    await ensureEngines(["smilesdrawer"]);
    const eng = getLoadedEngines(["smilesdrawer"]).smilesdrawer as SmilesEngine;
    expect(() => eng.layoutSmiles("this is not smiles ((")).toThrow(/parse/i);
  });

  test("cyclohexane (saturated ring) is not aromatic", async () => {
    await ensureEngines(["smilesdrawer"]);
    const eng = getLoadedEngines(["smilesdrawer"]).smilesdrawer as SmilesEngine;
    const mol = eng.layoutSmiles("C1CCCCC1");
    expect(mol.bonds).toHaveLength(6);
    expect(mol.bonds.every((b) => b.aromatic === false)).toBe(true);
    expect(mol.rings).toHaveLength(1);
    expect(mol.rings[0]).toHaveLength(6);
  });

  test("benzene (aromatic ring) has every ring bond aromatic", async () => {
    await ensureEngines(["smilesdrawer"]);
    const eng = getLoadedEngines(["smilesdrawer"]).smilesdrawer as SmilesEngine;
    const mol = eng.layoutSmiles("c1ccccc1");
    expect(mol.bonds).toHaveLength(6);
    expect(mol.bonds.every((b) => b.aromatic === true)).toBe(true);
  });
});

test("KNOWN_ENGINES lists smilesdrawer", () => {
  expect(KNOWN_ENGINES).toContain("smilesdrawer");
});
