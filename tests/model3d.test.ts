import { afterEach, describe, expect, test, vi } from "vitest";
import {
  ensure3dmol,
  MODEL3D_DEF,
  openModel3d,
  PRESET_XYZ,
  qualifiesFor3d,
  resetModel3dCacheForTests,
  resolveModel3dNamespace,
  setModel3dLabels,
  xyzFromPreset,
  type Model3dNamespace,
  type Model3dViewer,
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
    resetModel3dCacheForTests(); // order-independence: don't inherit another test's cached value
    let loads = 0;
    const fakeNs: Model3dNamespace = { createViewer: () => ({ addModel: () => undefined, setStyle: () => undefined, zoomTo: () => undefined, spin: () => undefined, render: () => undefined, clear: () => undefined, addPropertyLabels: () => undefined, removeAllLabels: () => undefined }) };
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

// openModel3d's abort/guard-path — the fix for the stale-continuation bug: a
// still-in-flight call (slow chunk load or PubChem fetch) that resolves AFTER
// it's been superseded (dialog closed, or reopened for a different item) must
// never mutate a `container` a newer call may already own. Exercised entirely
// against plain object stubs (no real HTMLElement/HTMLDialogElement) because
// this repo's test environment has no DOM (vite.config.ts: environment
// "node", no jsdom) — openModel3d's guard logic itself has no DOM dependency
// beyond calling `container.replaceChildren`, which is exactly what's stubbed.
describe("openModel3d: abort/guard path (no DOM)", () => {
  const stubContainer = () => ({ replaceChildren: vi.fn() }) as unknown as HTMLElement;
  const stubHost = (open = true) => ({ open }) as unknown as HTMLDialogElement;

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test("pre-aborted signal: resolves without ever touching the container or reaching the viewer factory", async () => {
    const container = stubContainer();
    const host = stubHost(true);
    const ac = new AbortController();
    ac.abort();
    // Deliberately NOT stubbing MODEL3D_DEF.load/fetch — a correct
    // implementation must bail before ever needing them.
    const destroy = await openModel3d(host, container, { kind: "molecule", input: { xyz: xyzFromPreset("methane")! } }, ac.signal);
    expect(container.replaceChildren).not.toHaveBeenCalled();
    expect(() => destroy()).not.toThrow(); // tearing down a viewer that was never created must be a safe no-op
  });

  test("signal aborts after the PubChem fetch resolves but before the pre-mount check: no mount, no second container write", async () => {
    resetModel3dCacheForTests();
    const container = stubContainer();
    const host = stubHost(true);
    const ac = new AbortController();
    const createViewer = vi.fn();
    MODEL3D_DEF.load = async () => ({ createViewer });
    // The abort fires INSIDE the fetch stub's own resolution — i.e. exactly
    // "abort after the stubbed fetch resolves, before awaiting openModel3d's
    // promise": openModel3d is still suspended awaiting this same promise, so
    // by the time it resumes and reaches `if (signal.aborted ...)`, the abort
    // has already landed. Mirrors ESC (or a reopen for another item) racing a
    // slow PubChem response.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        ac.abort();
        return { ok: true, text: async () => "fake sdf body" } as unknown as Response;
      }),
    );
    const destroy = await openModel3d(host, container, { kind: "molecule", input: { smiles: "c1ccccc1" } }, ac.signal);
    expect(createViewer).not.toHaveBeenCalled();
    // Only the initial "Loading…" write — never the pre-mount clear, never an error write.
    expect(container.replaceChildren).toHaveBeenCalledTimes(1);
    expect(container.replaceChildren).toHaveBeenCalledWith("Loading 3D viewer…");
    expect(() => destroy()).not.toThrow();
  });

  test("the abort actually cancels the outstanding PubChem fetch (not just ignored on resolution)", async () => {
    resetModel3dCacheForTests();
    const container = stubContainer();
    const host = stubHost(true);
    const ac = new AbortController();
    MODEL3D_DEF.load = async () => ({ createViewer: vi.fn() });
    let sawSignal: AbortSignal | undefined;
    const fetchMock = vi.fn((_url: string, init?: RequestInit) => {
      sawSignal = init?.signal ?? undefined;
      return new Promise<Response>((_resolve, reject) => {
        // Mirrors real fetch()'s contract: an already-aborted signal rejects
        // immediately; otherwise reject when "abort" eventually fires.
        if (sawSignal?.aborted) {
          reject(new DOMException("Aborted", "AbortError"));
          return;
        }
        sawSignal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    const openPromise = openModel3d(host, container, { kind: "molecule", input: { smiles: "c1ccccc1" } }, ac.signal);
    // Let the pending microtasks (ensure3dmol resolving, fetchPubchemSdf
    // running up to its `await fetch(...)`) actually drain before aborting —
    // a macrotask boundary guarantees that, since microtasks always finish
    // before the next macrotask runs. Otherwise this would abort before the
    // request even started, which the "aborts after the fetch resolves"
    // test above already covers.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(fetchMock).toHaveBeenCalled();
    ac.abort();
    const destroy = await openPromise;
    expect(sawSignal?.aborted).toBe(true); // the request-level signal was actually aborted, not left dangling
    expect(container.replaceChildren).toHaveBeenCalledTimes(1); // just "Loading…" — no mount, no error write
    expect(() => destroy()).not.toThrow();
  });

  test("control case (no abort): mounts normally through the same stub wiring, destroy tears the viewer down", async () => {
    resetModel3dCacheForTests();
    const container = stubContainer();
    const host = stubHost(true);
    const ac = new AbortController();
    const viewerMethods = { addModel: vi.fn(), setStyle: vi.fn(), zoomTo: vi.fn(), spin: vi.fn(), render: vi.fn(), clear: vi.fn() };
    const createViewer = vi.fn(() => viewerMethods);
    MODEL3D_DEF.load = async () => ({ createViewer });
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, text: async () => "fake sdf body" }) as unknown as Response));
    const destroy = await openModel3d(host, container, { kind: "molecule", input: { smiles: "c1ccccc1" } }, ac.signal);
    expect(createViewer).toHaveBeenCalledTimes(1);
    expect(viewerMethods.spin).toHaveBeenCalledWith(true);
    destroy();
    expect(viewerMethods.spin).toHaveBeenCalledWith(false);
    expect(viewerMethods.clear).toHaveBeenCalledTimes(1);
  });

  test("onMounted delivers the viewer after a successful mount", async () => {
    resetModel3dCacheForTests();
    const container = stubContainer();
    const host = stubHost(true);
    const ac = new AbortController();
    const calls: string[] = [];
    const fakeViewer = {
      addModel: () => calls.push("addModel"),
      setStyle: () => calls.push("setStyle"),
      zoomTo: () => calls.push("zoomTo"),
      render: () => calls.push("render"),
      spin: (on: boolean | string) => calls.push(`spin:${on}`),
      clear: () => calls.push("clear"),
      addPropertyLabels: (prop: string) => calls.push(`addPropertyLabels:${prop}`),
      removeAllLabels: () => calls.push("removeAllLabels"),
    };
    MODEL3D_DEF.load = async () => ({ createViewer: () => fakeViewer });
    let mounted: unknown = null;
    await openModel3d(host, container, { kind: "molecule", input: { xyz: xyzFromPreset("methane")! } }, ac.signal, {
      onMounted: (v) => {
        mounted = v;
      },
    });
    expect(mounted).toBe(fakeViewer);
    expect(calls).toContain("spin:true");
  });

  test("onMounted is NOT called when the open was already superseded", async () => {
    resetModel3dCacheForTests();
    const container = stubContainer();
    const host = stubHost(true);
    const ac = new AbortController();
    ac.abort();
    // Deliberately NOT stubbing MODEL3D_DEF.load — a correct implementation
    // must bail before ever reaching the viewer factory.
    let mounted = false;
    await openModel3d(host, container, { kind: "molecule", input: { xyz: xyzFromPreset("methane")! } }, ac.signal, {
      onMounted: () => {
        mounted = true;
      },
    });
    expect(mounted).toBe(false);
  });
});

// Atom labels in the modal are toggled through setModel3dLabels; a re-apply
// must REPLACE (clear-then-add), never stack a second label per atom.
describe("setModel3dLabels", () => {
  const labelStubViewer = (calls: string[]) =>
    ({
      addPropertyLabels: (prop: string) => calls.push(`addPropertyLabels:${prop}`),
      removeAllLabels: () => calls.push("removeAllLabels"),
      render: () => calls.push("render"),
    }) as unknown as Model3dViewer;

  test("on: clears existing labels, adds per-element labels, re-renders — in that order", () => {
    const calls: string[] = [];
    setModel3dLabels(labelStubViewer(calls), true);
    expect(calls).toEqual(["removeAllLabels", "addPropertyLabels:elem", "render"]);
  });

  test("off: clears labels and re-renders without adding any", () => {
    const calls: string[] = [];
    setModel3dLabels(labelStubViewer(calls), false);
    expect(calls).toEqual(["removeAllLabels", "render"]);
  });

  test("a successful mount shows element labels by default", async () => {
    resetModel3dCacheForTests();
    const container = { replaceChildren: vi.fn() } as unknown as HTMLElement;
    const host = { open: true } as unknown as HTMLDialogElement;
    const calls: string[] = [];
    const fakeViewer = {
      addModel: () => calls.push("addModel"),
      setStyle: () => calls.push("setStyle"),
      zoomTo: () => calls.push("zoomTo"),
      render: () => calls.push("render"),
      spin: (on: boolean | string) => calls.push(`spin:${on}`),
      clear: () => calls.push("clear"),
      addPropertyLabels: (prop: string) => calls.push(`addPropertyLabels:${prop}`),
      removeAllLabels: () => calls.push("removeAllLabels"),
    };
    MODEL3D_DEF.load = async () => ({ createViewer: () => fakeViewer });
    await openModel3d(host, container, { kind: "molecule", input: { xyz: xyzFromPreset("methane")! } }, new AbortController().signal);
    expect(calls).toContain("addPropertyLabels:elem");
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
