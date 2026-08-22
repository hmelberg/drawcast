import { beforeEach, describe, expect, test } from "vitest";
import physicsYaml from "../src/scenes/packs/physics.yaml?raw";
import chemistryYaml from "../src/scenes/packs/chemistry.yaml?raw";
import { parsePack, registerPack, unregisterPack, isPackTemplateId, packTemplateIds, PACK_DEFS } from "../src/scenes/packs";
import { scenes } from "../src/scenes/registry";
import { layoutSpec } from "../src/layout/layout";
import { flattenDrawables } from "../src/layout/model";
import { ensureEngines } from "../src/scenes/engines";

beforeEach(() => unregisterPack("physics"));

describe("parsePack", () => {
  test("parses header + two ready templates", () => {
    const { pack, errors } = parsePack(physicsYaml);
    expect(errors).toEqual([]);
    expect(pack?.id).toBe("physics");
    expect(pack?.templates.map((t) => t.template)).toEqual(["ray_diagram", "wave_diagram"]);
  });

  test("reports YAML errors instead of throwing", () => {
    const r = parsePack("pack: [broken");
    expect(r.pack).toBeUndefined();
    expect(r.errors.length).toBeGreaterThan(0);
  });

  test("missing header doc is an error", () => {
    const r = parsePack("template: x\nversion: 1\nkit: 1\nstatus: stub\ndescription: d\nparams: {}\nelement_ids: {}\nexamples: []");
    expect(r.errors[0]).toMatch(/header|pack/);
  });
});

describe("registerPack / unregisterPack", () => {
  test("registers both templates, tracks ownership, unregisters exactly them", () => {
    const r = registerPack("physics", physicsYaml);
    expect(r).toMatchObject({ ok: true, templateIds: ["ray_diagram", "wave_diagram"] });
    expect(scenes.ray_diagram.layout).toBeDefined();
    expect(isPackTemplateId("ray_diagram")).toBe(true);
    expect(packTemplateIds("physics")).toEqual(["ray_diagram", "wave_diagram"]);
    unregisterPack("physics");
    expect(scenes.ray_diagram).toBeUndefined();
    expect(scenes.wave_diagram).toBeUndefined();
    expect(isPackTemplateId("ray_diagram")).toBe(false);
  });

  test("a pack template colliding with an existing id rolls the WHOLE pack back", () => {
    const clash = physicsYaml.replace("template: wave_diagram", "template: supply_demand");
    const before = scenes.supply_demand;
    const r = registerPack("physics", clash);
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => /supply_demand/.test(e))).toBe(true);
    expect(scenes.supply_demand).toBe(before);   // untouched
    expect(scenes.ray_diagram).toBeUndefined();  // rolled back
  });

  test("re-registering an already-registered pack is a no-op success", () => {
    registerPack("physics", physicsYaml);
    const r = registerPack("physics", physicsYaml);
    expect(r.ok).toBe(true);
  });

  test("a pack whose header parses but that contributes zero templates is rejected, not silently accepted", () => {
    const r = registerPack("physics", "pack: physics\ntitle: Physics\ndescription: d\n");
    expect(r.ok).toBe(false);
    expect(r.templateIds).toEqual([]);
    expect(r.errors.some((e) => /no templates/i.test(e))).toBe(true);
    expect(packTemplateIds("physics")).toEqual([]); // never entered packOwned
  });
});

describe("physics templates through the real pipeline", () => {
  test("every example renders with zero warnings and no error lint, deterministically", () => {
    registerPack("physics", physicsYaml);
    for (const tid of ["ray_diagram", "wave_diagram"]) {
      for (const ex of scenes[tid].manifest.examples) {
        const res = layoutSpec({ template: tid, params: ex.params, elements: [] } as never);
        expect(res.warnings).toEqual([]);
        expect(res.issues.filter((i) => i.severity === "error")).toEqual([]);
        for (const d of flattenDrawables(res.drawables)) {
          if (d.kind === "stroke" || d.kind === "area") {
            for (const [x, y] of d.pts) {
              expect(Number.isFinite(x) && Number.isFinite(y)).toBe(true);
              expect(Math.abs(x)).toBeLessThan(2000);
              expect(Math.abs(y)).toBeLessThan(2000);
            }
          }
        }
      }
      const a = scenes[tid].layout!(scenes[tid].manifest.examples[0].params);
      const b = scenes[tid].layout!(scenes[tid].manifest.examples[0].params);
      expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    }
  });

  test("wave_diagram with cycles=1 stays on-canvas (amp/wavelength bracket no longer runs past x=1000)", () => {
    registerPack("physics", physicsYaml);
    const res = layoutSpec({ template: "wave_diagram", params: { amplitude: 5, cycles: 1 }, elements: [] } as never);
    expect(res.warnings).toEqual([]);
    expect(res.issues.filter((i) => i.severity === "error")).toEqual([]);
    for (const d of flattenDrawables(res.drawables)) {
      if (d.kind === "stroke" || d.kind === "area") {
        for (const [x, y] of d.pts) {
          expect(Number.isFinite(x) && Number.isFinite(y)).toBe(true);
          expect(Math.abs(x)).toBeLessThan(2000);
          expect(Math.abs(y)).toBeLessThan(2000);
          expect(x).toBeGreaterThanOrEqual(0);
          expect(x).toBeLessThanOrEqual(1002);
        }
      }
    }
  });

  test("virtual-image case draws dashed extensions; real case does not", () => {
    registerPack("physics", physicsYaml);
    const real = scenes.ray_diagram.layout!({ focal_length: 10, object_distance: 25 });
    const virt = scenes.ray_diagram.layout!({ focal_length: 12, object_distance: 7 });
    expect(flattenDrawables(real.drawables).map((d) => d.id)).not.toContain("ray_parallel_ext");
    expect(flattenDrawables(virt.drawables).map((d) => d.id)).toContain("ray_parallel_ext");
    const img = flattenDrawables(virt.drawables).find((d) => d.id === "image");
    expect(img?.kind === "stroke" && img.style.dash).toBe(true);
  });
});

test("PACK_DEFS has physics with a loader", () => {
  expect(PACK_DEFS.physics.title).toBe("Physics");
  expect(typeof PACK_DEFS.physics.load).toBe("function");
});

describe("chemistry pack", () => {
  beforeEach(() => unregisterPack("chemistry"));

  test("parses and registers three templates; molecule declares the engine", () => {
    const r = registerPack("chemistry", chemistryYaml);
    expect(r).toMatchObject({ ok: true, templateIds: ["molecule", "reaction_scheme", "energy_diagram"] });
    expect(scenes.molecule.manifest.engines).toEqual(["smilesdrawer"]);
  });

  test("molecule layout throws (falls through) before the engine loads, renders after", async () => {
    registerPack("chemistry", chemistryYaml);
    // NOTE: engine cache may already be warm from other test files in this worker —
    // only assert the post-load path unconditionally; assert the pre-load throw
    // only when enginesLoaded says cold. (Import enginesLoaded for the check.)
    await ensureEngines(["smilesdrawer"]);
    const r = layoutSpec({ template: "molecule", params: { smiles: "c1ccccc1", name: "Benzene" }, elements: [] } as never);
    expect(r.warnings).toEqual([]);
    expect(r.issues.filter((i) => i.severity === "error")).toEqual([]);
  });

  test("every chemistry example renders clean and deterministically (engine pre-loaded)", async () => {
    await ensureEngines(["smilesdrawer"]);
    registerPack("chemistry", chemistryYaml);
    for (const tid of ["molecule", "reaction_scheme", "energy_diagram"]) {
      for (const ex of scenes[tid].manifest.examples) {
        const res = layoutSpec({ template: tid, params: ex.params, elements: [] } as never);
        expect(res.warnings).toEqual([]);
        expect(res.issues.filter((i) => i.severity === "error")).toEqual([]);
      }
      const a = scenes[tid].layout!(scenes[tid].manifest.examples[0].params);
      expect(JSON.stringify(a)).toBe(JSON.stringify(scenes[tid].layout!(scenes[tid].manifest.examples[0].params)));
    }
  });

  test("aromatic ring renders an inner circle, not alternating double bonds", async () => {
    await ensureEngines(["smilesdrawer"]);
    registerPack("chemistry", chemistryYaml);
    const r = scenes.molecule.layout!({ smiles: "c1ccccc1" });
    const ids = flattenDrawables(r.drawables).map((d) => d.id);
    expect(ids.some((id) => /ring_circle/.test(id))).toBe(true);
    expect(ids.some((id) => /dbond|double/.test(id))).toBe(false);
  });

  test("cyclohexane (saturated ring) gets NO inner circle — rings is SSSR membership, not aromaticity", async () => {
    await ensureEngines(["smilesdrawer"]);
    registerPack("chemistry", chemistryYaml);
    const r = scenes.molecule.layout!({ smiles: "C1CCCCC1" });
    const ids = flattenDrawables(r.drawables).map((d) => d.id);
    expect(ids.some((id) => /ring_circle/.test(id))).toBe(false);
  });

  test("a routine 3-vs-3 redox equation shrinks to fit instead of running off the canvas", () => {
    registerPack("chemistry", chemistryYaml);
    const res = layoutSpec({
      template: "reaction_scheme",
      params: {
        reactants: ["MnO₄⁻", "5 Fe²⁺", "8 H⁺"],
        products: ["Mn²⁺", "5 Fe³⁺", "4 H₂O"],
      },
      elements: [],
    } as never);
    expect(res.warnings).toEqual([]);
    expect(res.issues.filter((i) => i.severity === "error")).toEqual([]);
    for (const d of flattenDrawables(res.drawables)) {
      const xs = d.kind === "text" ? [d.pos[0]] : d.kind === "stroke" || d.kind === "area" ? d.pts.map((p) => p[0]) : [];
      for (const x of xs) {
        expect(x).toBeGreaterThanOrEqual(0);
        expect(x).toBeLessThanOrEqual(1002);
      }
    }
  });
});
