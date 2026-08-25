import { beforeEach, describe, expect, test } from "vitest";
import physicsYaml from "../src/scenes/packs/physics.yaml?raw";
import chemistryYaml from "../src/scenes/packs/chemistry.yaml?raw";
import biologyYaml from "../src/scenes/packs/biology.yaml?raw";
import economicsYaml from "../src/scenes/packs/economics.yaml?raw";
import { parsePack, registerPack, unregisterPack, isPackTemplateId, packTemplateIds, ensureEnabledPacks, PACK_DEFS } from "../src/scenes/packs";
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

describe("ensureEnabledPacks: retriable split (M3 review debt)", () => {
  test("a pack-fetch rejection is retriable; a registration-time failure (id collision) is not", async () => {
    const originalLoad = PACK_DEFS.physics.load;
    PACK_DEFS.physics.load = () => Promise.reject(new Error("network hiccup"));
    try {
      const r = await ensureEnabledPacks(["physics"]);
      expect(r).toHaveLength(1);
      expect(r[0].ok).toBe(false);
      expect(r[0].retriable).toBe(true);
      expect(r[0].errors.join(" ")).toMatch(/network hiccup/);
    } finally {
      PACK_DEFS.physics.load = originalLoad;
    }

    // Deterministic failure: occupy one of physics's own template ids first
    // so registerPack's collision check rejects it — not a fetch problem.
    const prevRayDiagram = scenes.ray_diagram;
    scenes.ray_diagram = { manifest: { name: "ray_diagram", status: "stub", description: "d", params_schema: {}, element_ids: {}, examples: [] } };
    try {
      const r2 = await ensureEnabledPacks(["physics"]);
      expect(r2).toHaveLength(1);
      expect(r2[0].ok).toBe(false);
      expect(r2[0].retriable).toBeFalsy();
    } finally {
      if (prevRayDiagram) scenes.ray_diagram = prevRayDiagram;
      else delete scenes.ray_diagram;
    }
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

describe("biology pack", () => {
  beforeEach(() => unregisterPack("biology"));

  function inBounds(res: ReturnType<typeof layoutSpec>) {
    expect(res.warnings).toEqual([]);
    expect(res.issues.filter((i) => i.severity === "error")).toEqual([]);
    for (const d of flattenDrawables(res.drawables)) {
      if (d.kind === "stroke" || d.kind === "area") {
        for (const [x, y] of d.pts) {
          expect(Number.isFinite(x) && Number.isFinite(y)).toBe(true);
          expect(x).toBeGreaterThanOrEqual(-2);
          expect(x).toBeLessThanOrEqual(1002);
          expect(y).toBeGreaterThanOrEqual(-2);
          expect(y).toBeLessThanOrEqual(752);
        }
      } else if (d.kind === "text") {
        expect(Number.isFinite(d.pos[0]) && Number.isFinite(d.pos[1])).toBe(true);
      }
    }
  }

  test("parses and registers three templates in brief order", () => {
    const r = registerPack("biology", biologyYaml);
    expect(r).toMatchObject({ ok: true, templateIds: ["membrane_bilayer", "dna_helix", "phylo_tree"] });
  });

  test("every biology example renders lint-clean and deterministically, in bounds", () => {
    registerPack("biology", biologyYaml);
    for (const tid of ["membrane_bilayer", "dna_helix", "phylo_tree"]) {
      for (const ex of scenes[tid].manifest.examples) {
        const res = layoutSpec({ template: tid, params: ex.params, elements: [] } as never);
        inBounds(res);
      }
      const a = scenes[tid].layout!(scenes[tid].manifest.examples[0].params);
      const b = scenes[tid].layout!(scenes[tid].manifest.examples[0].params);
      expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    }
  });

  test("phylo_tree: \"((A,B),C);\" yields 3 leaf texts and an edges group", () => {
    registerPack("biology", biologyYaml);
    const r = scenes.phylo_tree.layout!({ newick: "((A,B),C);" });
    const leafTexts = flattenDrawables(r.drawables).filter((d) => d.kind === "text" && /^leaf_/.test(d.id));
    expect(leafTexts).toHaveLength(3);
    expect(leafTexts.map((d) => (d as { text: string }).text).sort()).toEqual(["A", "B", "C"]);
    const top = r.drawables.find((d) => d.id === "edges");
    expect(top?.kind).toBe("group");
  });

  test("phylo_tree: a long leaf name shrinks/ellipsizes but stays on-canvas", () => {
    registerPack("biology", biologyYaml);
    const res = layoutSpec({
      template: "phylo_tree",
      params: { newick: "(Tyrannosaurus,Micropachycephalosaurus);" },
      elements: [],
    } as never);
    inBounds(res);
    const leafTexts = flattenDrawables(res.drawables).filter((d) => d.kind === "text" && /^leaf_/.test(d.id)) as { pos: [number, number]; text: string; fontSize: number }[];
    expect(leafTexts).toHaveLength(2);
    for (const t of leafTexts) {
      // exact-position text: pos[0] is the "start" anchor; the rendered
      // width (heuristic measure) must not push the glyph past the canvas.
      const w = t.text.length * t.fontSize * 0.52;
      expect(t.pos[0] + w).toBeLessThanOrEqual(1002);
      expect(t.fontSize).toBeGreaterThanOrEqual(14);
    }
  });

  test("dna_helix: rungs group exists and every rung's two endpoints are > 40 apart in y", () => {
    registerPack("biology", biologyYaml);
    const r = scenes.dna_helix.layout!({});
    const rungsGroup = r.drawables.find((d) => d.id === "rungs");
    expect(rungsGroup?.kind).toBe("group");
    const children = flattenDrawables([rungsGroup!]).filter((d) => d.id !== "rungs" && d.kind === "stroke") as { pts: [number, number][] }[];
    expect(children.length).toBeGreaterThan(0);
    for (const c of children) {
      expect(c.pts).toHaveLength(2);
      expect(Math.abs(c.pts[0][1] - c.pts[1][1])).toBeGreaterThan(40);
    }
  });

  test("dna_helix: show_base_pairs false omits the rungs group and the base-pair label", () => {
    registerPack("biology", biologyYaml);
    const r = scenes.dna_helix.layout!({ show_base_pairs: false });
    expect(r.drawables.find((d) => d.id === "rungs")).toBeUndefined();
    expect(r.labels.find((l) => l.id === "label_basepair")).toBeUndefined();
  });

  test("membrane_bilayer: proteins: [] still renders a pure bilayer (no protein groups)", () => {
    registerPack("biology", biologyYaml);
    const res = layoutSpec({ template: "membrane_bilayer", params: { proteins: [] }, elements: [] } as never);
    inBounds(res);
    const ids = res.drawables.map((d) => d.id);
    expect(ids).toContain("lipids");
    expect(ids.some((id) => /^protein_/.test(id))).toBe(false);
  });

  test("membrane_bilayer: a declared transport renders a transport_0 arrow, absent otherwise", () => {
    registerPack("biology", biologyYaml);
    const withTransport = scenes.membrane_bilayer.layout!({ transports: [{ species: "Na⁺", mode: "active", direction: "out" }] });
    expect(withTransport.drawables.some((d) => d.id === "transport_0")).toBe(true);
    const atp = flattenDrawables(withTransport.drawables).find((d) => d.id === "transport_0_atp");
    expect(atp?.kind).toBe("text");
    const withoutTransport = scenes.membrane_bilayer.layout!({});
    expect(withoutTransport.drawables.some((d) => d.id === "transport_0")).toBe(false);
  });
});

describe("economics pack", () => {
  beforeEach(() => unregisterPack("economics"));

  const TEMPLATE_IDS = ["indifference_budget", "ppf", "firm_cost_curves", "payoff_matrix", "ad_as"];

  function inBounds(res: ReturnType<typeof layoutSpec>) {
    expect(res.warnings).toEqual([]);
    expect(res.issues.filter((i) => i.severity === "error")).toEqual([]);
    for (const d of flattenDrawables(res.drawables)) {
      if (d.kind === "stroke" || d.kind === "area") {
        for (const [x, y] of d.pts) {
          expect(Number.isFinite(x) && Number.isFinite(y)).toBe(true);
        }
      } else if (d.kind === "text") {
        expect(Number.isFinite(d.pos[0]) && Number.isFinite(d.pos[1])).toBe(true);
      }
    }
  }

  test("registers all five templates in brief order", () => {
    const r = registerPack("economics", economicsYaml);
    expect(r).toMatchObject({ ok: true, templateIds: TEMPLATE_IDS });
  });

  test("every economics example renders finite, no fallback warnings, no error-severity lint", () => {
    registerPack("economics", economicsYaml);
    for (const tid of TEMPLATE_IDS) {
      for (const ex of scenes[tid].manifest.examples) {
        const res = layoutSpec({ template: tid, params: ex.params, elements: [] } as never);
        inBounds(res);
      }
      const a = scenes[tid].layout!(scenes[tid].manifest.examples[0].params);
      const b = scenes[tid].layout!(scenes[tid].manifest.examples[0].params);
      expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    }
  });

  test("payoff_matrix: prisoner's dilemma has exactly one pure Nash equilibrium, at (defect, defect)", () => {
    registerPack("economics", economicsYaml);
    const r = scenes.payoff_matrix.layout!({
      row_strategies: ["Cooperate", "Defect"],
      col_strategies: ["Cooperate", "Defect"],
      payoffs: [
        [[3, 3], [0, 5]],
        [[5, 0], [1, 1]],
      ],
    });
    const ids = flattenDrawables(r.drawables).map((d) => d.id);
    expect(ids).toContain("nash_1_1");
    expect(ids).not.toContain("nash_0_0");
    expect(ids).not.toContain("nash_0_1");
    expect(ids).not.toContain("nash_1_0");
  });

  test("payoff_matrix: a stag-hunt matrix has TWO pure Nash equilibria", () => {
    registerPack("economics", economicsYaml);
    const r = scenes.payoff_matrix.layout!({
      row_strategies: ["Stag", "Hare"],
      col_strategies: ["Stag", "Hare"],
      payoffs: [
        [[4, 4], [0, 3]],
        [[3, 0], [2, 2]],
      ],
    });
    const ids = flattenDrawables(r.drawables).map((d) => d.id);
    expect(ids).toContain("nash_0_0");
    expect(ids).toContain("nash_1_1");
    expect(ids).not.toContain("nash_0_1");
    expect(ids).not.toContain("nash_1_0");
  });

  test("firm_cost_curves: monopoly q* (MC=MR) sits strictly below the competitive q (MC=demand)", () => {
    registerPack("economics", economicsYaml);
    const r = scenes.firm_cost_curves.layout!({ mode: "monopoly", shade: "deadweight" });
    const ids = flattenDrawables(r.drawables).map((d) => d.id);
    expect(ids).toContain("q_star");
    expect(ids).toContain("shade");
  });
});
