import { afterEach, describe, expect, test } from "vitest";
import {
  ensure3dmol,
  MODEL3D_DEF,
  PRESET_XYZ,
  qualifiesFor3d,
  resolveModel3dNamespace,
  xyzFromPreset,
  type Model3dNamespace,
} from "../src/ui/model3d";
import { validateTemplateDoc, docToManifest } from "../src/scenes/doc";
import { scenes } from "../src/scenes/registry";
import { registerPack, unregisterPack } from "../src/scenes/packs";
import chemistryYaml from "../src/scenes/packs/chemistry.yaml?raw";

describe("xyzFromPreset", () => {
  test("methane: count line 5, 1 carbon + 4 hydrogens", () => {
    const xyz = xyzFromPreset("methane")!;
    expect(xyz).not.toBeNull();
    const lines = xyz.split("\n");
    expect(lines[0]).toBe("5");
    const atomLines = lines.slice(2);
    expect(atomLines).toHaveLength(5);
    expect(atomLines[0].startsWith("C ")).toBe(true);
    expect(atomLines.slice(1).every((l) => l.startsWith("H "))).toBe(true);
  });

  test("a coordinate row has 3 numeric fields after the element symbol", () => {
    const xyz = xyzFromPreset("water")!;
    const row = xyz.split("\n")[2].split(/\s+/);
    expect(row[0]).toBe("O");
    expect(row.slice(1).map(Number).every((n) => Number.isFinite(n))).toBe(true);
  });

  test("unknown preset name returns null", () => {
    expect(xyzFromPreset("not-a-molecule")).toBeNull();
  });
});

// Keeps PRESET_XYZ (duplicated here because molecule_3d/template.yaml's
// `layout:` body is a plain YAML string, not an importable module) honest
// against the real molecule_3d template's own rendered output.
describe("PRESET_XYZ cross-check against molecule_3d's own layout", () => {
  for (const name of Object.keys(PRESET_XYZ)) {
    test(`${name}: atom count and element-symbol order match`, () => {
      const layout = scenes.molecule_3d.layout!({ molecule: name });
      const atomIds = layout.drawables.map((d) => d.id).filter((id) => /^atom_\d+$/.test(id));
      expect(atomIds).toHaveLength(PRESET_XYZ[name].length);

      const xyz = xyzFromPreset(name)!;
      expect(xyz.split("\n")[0]).toBe(String(PRESET_XYZ[name].length));

      PRESET_XYZ[name].forEach((atom, i) => {
        const label = layout.drawables.find((d) => d.id === `label_${i}`);
        expect(label?.kind).toBe("text");
        if (label?.kind === "text") expect(label.text).toBe(atom.sym);
      });
    });
  }
});

describe("qualifiesFor3d", () => {
  test("null for a template with no model3d manifest", () => {
    expect(qualifiesFor3d({ template: "supply_demand", params: {} })).toBeNull();
  });

  test("null for no template at all", () => {
    expect(qualifiesFor3d({})).toBeNull();
  });

  test("null for an unregistered template id", () => {
    expect(qualifiesFor3d({ template: "does_not_exist", params: {} })).toBeNull();
  });

  test("molecule_3d preset: builds {xyz} matching xyzFromPreset for the given molecule", () => {
    const q = qualifiesFor3d({ template: "molecule_3d", params: { molecule: "water" } });
    expect(q).toEqual({ kind: "molecule", input: { xyz: xyzFromPreset("water") } });
  });

  test("molecule_3d preset: no molecule param defaults to methane, same as the template's own layout default", () => {
    const q = qualifiesFor3d({ template: "molecule_3d", params: {} });
    expect(q).toEqual({ kind: "molecule", input: { xyz: xyzFromPreset("methane") } });
  });

  describe("chemistry pack's molecule (smiles source)", () => {
    afterEach(() => unregisterPack("chemistry"));

    test("smiles param present: builds {smiles}", () => {
      registerPack("chemistry", chemistryYaml);
      const q = qualifiesFor3d({ template: "molecule", params: { smiles: "c1ccccc1" } });
      expect(q).toEqual({ kind: "molecule", input: { smiles: "c1ccccc1" } });
    });

    test("smiles missing: null", () => {
      registerPack("chemistry", chemistryYaml);
      expect(qualifiesFor3d({ template: "molecule", params: {} })).toBeNull();
    });

    test("smiles blank: null", () => {
      registerPack("chemistry", chemistryYaml);
      expect(qualifiesFor3d({ template: "molecule", params: { smiles: "   " } })).toBeNull();
    });
  });
});

describe("resolveModel3dNamespace (module-shape interop)", () => {
  test("namespace with createViewer directly on the module object", () => {
    const fakeViewer = () => ({});
    const mod = { createViewer: fakeViewer };
    expect(resolveModel3dNamespace(mod)).toBe(mod);
  });

  test("namespace nested under .default (CJS-under-ESM interop)", () => {
    const inner = { createViewer: () => ({}) };
    const mod = { default: inner };
    expect(resolveModel3dNamespace(mod)).toBe(inner);
  });

  test("neither shape has createViewer: undefined", () => {
    expect(resolveModel3dNamespace({})).toBeUndefined();
    expect(resolveModel3dNamespace({ default: {} })).toBeUndefined();
  });
});

describe("ensure3dmol", () => {
  test("loads once and caches; returns the resolved namespace", async () => {
    let loads = 0;
    const fakeNs: Model3dNamespace = { createViewer: () => ({ addModel: () => undefined, setStyle: () => undefined, zoomTo: () => undefined, spin: () => undefined, render: () => undefined, clear: () => undefined }) };
    MODEL3D_DEF.load = async () => {
      loads++;
      return { default: fakeNs };
    };
    const a = await ensure3dmol();
    const b = await ensure3dmol();
    expect(a).toBe(fakeNs);
    expect(b).toBe(fakeNs);
    expect(loads).toBe(1);
  });
});

describe("doc validation with model3d", () => {
  const base = (model3d?: unknown): Record<string, unknown> => ({
    template: "m3_t",
    version: 1,
    kit: 1,
    status: "ready",
    description: "d",
    params: {},
    element_ids: {},
    examples: [],
    layout: "return { drawables: [], labels: [], anchors: {}, order: [] };",
    ...(model3d !== undefined ? { model3d } : {}),
  });

  test("valid shape accepted; carried through to the manifest", () => {
    const v = validateTemplateDoc(base({ kind: "molecule", source: "preset" }));
    expect(v.errors).toEqual([]);
    expect(v.doc?.model3d).toEqual({ kind: "molecule", source: "preset" });
    expect(docToManifest(v.doc!).model3d).toEqual({ kind: "molecule", source: "preset" });
  });

  test("smiles source also accepted", () => {
    const v = validateTemplateDoc(base({ kind: "molecule", source: "smiles" }));
    expect(v.errors).toEqual([]);
  });

  test("unknown kind rejected", () => {
    const v = validateTemplateDoc(base({ kind: "protein", source: "preset" }));
    expect(v.errors[0]).toMatch(/model3d\.kind/);
  });

  test("unknown source rejected", () => {
    const v = validateTemplateDoc(base({ kind: "molecule", source: "cif" }));
    expect(v.errors[0]).toMatch(/model3d\.source/);
  });

  test("non-object model3d rejected", () => {
    const v = validateTemplateDoc(base("nope"));
    expect(v.errors[0]).toMatch(/model3d/);
  });

  test("omitted model3d is fine — untouched manifest", () => {
    const v = validateTemplateDoc(base());
    expect(v.errors).toEqual([]);
    expect(v.doc?.model3d).toBeUndefined();
    expect(docToManifest(v.doc!).model3d).toBeUndefined();
  });
});

describe("bundled templates carry model3d", () => {
  test("molecule_3d: preset source", () => {
    expect(scenes.molecule_3d.manifest.model3d).toEqual({ kind: "molecule", source: "preset" });
  });

  test("chemistry pack's molecule: smiles source", () => {
    registerPack("chemistry", chemistryYaml);
    expect(scenes.molecule.manifest.model3d).toEqual({ kind: "molecule", source: "smiles" });
    unregisterPack("chemistry");
  });
});
