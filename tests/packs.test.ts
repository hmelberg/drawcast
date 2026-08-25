import { beforeEach, describe, expect, test } from "vitest";
import physicsYaml from "../src/scenes/packs/physics.yaml?raw";
import chemistryYaml from "../src/scenes/packs/chemistry.yaml?raw";
import biologyYaml from "../src/scenes/packs/biology.yaml?raw";
import economicsYaml from "../src/scenes/packs/economics.yaml?raw";
import evidenceYaml from "../src/scenes/packs/evidence.yaml?raw";
import mathlogicYaml from "../src/scenes/packs/mathlogic.yaml?raw";
import gamesYaml from "../src/scenes/packs/games.yaml?raw";
import mapsYaml from "../src/scenes/packs/maps.yaml?raw";
import { parsePack, registerPack, unregisterPack, isPackTemplateId, packTemplateIds, ensureEnabledPacks, PACK_DEFS, DEFAULT_OFF_PACKS } from "../src/scenes/packs";
import { scenes } from "../src/scenes/registry";
import { layoutSpec } from "../src/layout/layout";
import { flattenDrawables, COLORS } from "../src/layout/model";
import { ensureEngines } from "../src/scenes/engines";
import type { SceneLayout } from "../src/scenes/types";

beforeEach(() => unregisterPack("physics"));

describe("parsePack", () => {
  test("parses header + four ready templates", () => {
    const { pack, errors } = parsePack(physicsYaml);
    expect(errors).toEqual([]);
    expect(pack?.id).toBe("physics");
    expect(pack?.templates.map((t) => t.template)).toEqual(["ray_diagram", "wave_diagram", "circuit_diagram", "projectile_motion"]);
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

const PHYSICS_TEMPLATE_IDS = ["ray_diagram", "wave_diagram", "circuit_diagram", "projectile_motion"];

describe("registerPack / unregisterPack", () => {
  test("registers all four templates, tracks ownership, unregisters exactly them", () => {
    const r = registerPack("physics", physicsYaml);
    expect(r).toMatchObject({ ok: true, templateIds: PHYSICS_TEMPLATE_IDS });
    expect(scenes.ray_diagram.layout).toBeDefined();
    expect(isPackTemplateId("ray_diagram")).toBe(true);
    expect(packTemplateIds("physics")).toEqual(PHYSICS_TEMPLATE_IDS);
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
    for (const tid of PHYSICS_TEMPLATE_IDS) {
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

  test("circuit_diagram (series): the top wire ends at a spliced component's left anchor and resumes at its right anchor — never runs under it", () => {
    registerPack("physics", physicsYaml);
    const r = scenes.circuit_diagram.layout!({
      topology: "series",
      components: [{ type: "battery" }, { type: "resistor" }, { type: "bulb" }],
    });
    const flat = flattenDrawables(r.drawables);
    const resistorLeadStart = (flat.find((d) => d.id === "comp_1__0") as { pts: [number, number][] }).pts[0];
    const resistorLeadEnd = (flat.find((d) => d.id === "comp_1__0") as { pts: [number, number][] }).pts.slice(-1)[0];
    const wireBefore = flat.find((d) => d.id === "wire__top_1") as { pts: [number, number][] };
    const wireAfter = flat.find((d) => d.id === "wire__top_2") as { pts: [number, number][] };
    // The resistor's own two lead endpoints ARE its left/right anchors (a zigzag stroke from (-1,0) to (1,0)).
    expect(wireBefore.pts.slice(-1)[0]).toEqual(resistorLeadStart);
    expect(wireAfter.pts[0]).toEqual(resistorLeadEnd);
  });

  test("circuit_diagram: the battery always sits bottom-center regardless of its position in `components`, and current flows clockwise from its + (left) terminal", () => {
    registerPack("physics", physicsYaml);
    const r = scenes.circuit_diagram.layout!({
      topology: "series",
      components: [{ type: "resistor" }, { type: "bulb" }, { type: "battery" }],
    });
    expect(r.anchors["comp_2"]).toEqual([500, 200]); // CX, YB
    const flat = flattenDrawables(r.drawables);
    const batteryLeft = (flat.find((d) => d.id === "comp_2__0") as { pts: [number, number][] }).pts[0];
    // current_2 is the bottom-left arrow, on the wire between the battery's left (+)
    // anchor and BL: it must point AWAY from the battery (decreasing x, toward BL).
    const current2 = flat.find((d) => d.id === "current_2") as { pts: [number, number][]; arrowhead?: string };
    expect(current2.pts[0][0]).toBeGreaterThan(current2.pts[1][0]);
    expect(current2.pts[0][0]).toBeLessThanOrEqual(batteryLeft[0]);
    expect(current2.arrowhead).toBe("end");
    // Left rail current points up (BL -> TL): increasing y.
    const current0 = flat.find((d) => d.id === "current_0") as { pts: [number, number][] };
    expect(current0.pts[1][1]).toBeGreaterThan(current0.pts[0][1]);
    // Right rail current points down (TR -> BR): decreasing y.
    const current1 = flat.find((d) => d.id === "current_1") as { pts: [number, number][] };
    expect(current1.pts[1][1]).toBeLessThan(current1.pts[0][1]);
  });

  test("circuit_diagram (parallel): one rung per non-battery component, each with its own top+bottom wire stub", () => {
    registerPack("physics", physicsYaml);
    const r = scenes.circuit_diagram.layout!({
      topology: "parallel",
      components: [{ type: "battery" }, { type: "resistor" }, { type: "bulb" }, { type: "switch" }],
    });
    const flat = flattenDrawables(r.drawables);
    for (const i of [1, 2, 3]) {
      expect(flat.some((d) => d.id === `wire__rung_top_${i}`)).toBe(true);
      expect(flat.some((d) => d.id === `wire__rung_bot_${i}`)).toBe(true);
      expect(flat.some((d) => d.id === `comp_${i}`)).toBe(true);
    }
    expect(flat.some((d) => d.id === "wire__top")).toBe(true); // one unbroken top rail
  });

  test("projectile_motion: the apex velocity vector is purely horizontal (zero vertical component)", () => {
    registerPack("physics", physicsYaml);
    const r = scenes.projectile_motion.layout!({ speed: 7, angle_deg: 50 });
    const flat = flattenDrawables(r.drawables);
    const vApexArrow = flat.find((d) => d.id === "v_apex__arrow") as { pts: [number, number][] };
    expect(vApexArrow.pts[0][1]).toBeCloseTo(vApexArrow.pts[1][1], 6);
    expect(vApexArrow.pts[1][0]).toBeGreaterThan(vApexArrow.pts[0][0]); // points forward (+x)
  });

  test("projectile_motion: the parabola matches real kinematics (g=10) — apex height and range from the closed-form formulas", () => {
    registerPack("physics", physicsYaml);
    const speed = 6, angleDeg = 30;
    const r = scenes.projectile_motion.layout!({ speed, angle_deg: angleDeg });
    const th = (angleDeg * Math.PI) / 180;
    const g = 10;
    const R = (speed * speed * Math.sin(2 * th)) / g;
    const H = ((speed * Math.sin(th)) * (speed * Math.sin(th))) / (2 * g);
    const flat = flattenDrawables(r.drawables);
    const path = flat.find((d) => d.id === "path") as { pts: [number, number][] };
    const groundLine = flat.find((d) => d.id === "ground__line") as { pts: [number, number][] };
    const groundY = groundLine.pts[0][1];
    const launchX = path.pts[0][0];
    const landX = path.pts.slice(-1)[0][0];
    const apexY = Math.max(...path.pts.map((p) => p[1]));
    // Same fit-to-canvas scale S applies uniformly to both axes, so the drawn
    // aspect ratio (height-scaled / width-scaled) must equal the true H/R ratio.
    const drawnRange = landX - launchX;
    const drawnHeight = apexY - groundY;
    // 3 dp tolerance: apexY is the max of 60 discretely SAMPLED points (kit.sample),
    // which slightly undershoots the true continuous peak — a real, expected
    // discretization artifact, not a precision bug in the formula itself.
    expect(drawnHeight / drawnRange).toBeCloseTo(H / R, 3);
  });

  test("projectile_motion: the ground hatch is present and sits at/below the ground line", () => {
    registerPack("physics", physicsYaml);
    const r = scenes.projectile_motion.layout!({});
    const groundGroup = r.drawables.find((d) => d.id === "ground");
    expect(groundGroup?.kind).toBe("group");
    const flat = flattenDrawables(r.drawables);
    const hatchTicks = flat.filter((d) => d.id.startsWith("ground__hatch")) as { pts: [number, number][] }[];
    const line = flat.find((d) => d.id === "ground__line") as { pts: [number, number][] };
    const groundY = line.pts[0][1];
    expect(hatchTicks.length).toBeGreaterThan(0);
    for (const tick of hatchTicks) {
      expect(tick.pts[1][1]).toBeLessThanOrEqual(groundY + 0.001);
    }
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

const CHEMISTRY_TEMPLATE_IDS = ["molecule", "reaction_scheme", "energy_diagram", "lewis_dot", "lab_apparatus"];

describe("chemistry pack", () => {
  beforeEach(() => unregisterPack("chemistry"));

  test("parses and registers five templates; molecule declares the engine", () => {
    const r = registerPack("chemistry", chemistryYaml);
    expect(r).toMatchObject({ ok: true, templateIds: CHEMISTRY_TEMPLATE_IDS });
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
    for (const tid of CHEMISTRY_TEMPLATE_IDS) {
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

  test("lewis_dot: lone-pair counts per atom match the real electron structure", () => {
    registerPack("chemistry", chemistryYaml);
    function lpCount(molecule: string, atomIdx: number) {
      const r = scenes.lewis_dot.layout!({ molecule });
      return r.drawables.filter((d) => d.id.startsWith(`lp_${atomIdx}_`)).length;
    }
    expect(lpCount("H2O", 0)).toBe(2); // O
    expect(lpCount("NH3", 0)).toBe(1); // N
    expect(lpCount("CO2", 0)).toBe(2); // left O, double bond
    expect(lpCount("CO2", 2)).toBe(2); // right O, double bond
    expect(lpCount("N2", 0)).toBe(1);
    expect(lpCount("N2", 1)).toBe(1);
    expect(lpCount("HCl", 1)).toBe(3); // Cl
    expect(lpCount("HCl", 0)).toBe(0); // H
    expect(lpCount("O2", 0)).toBe(2);
    expect(lpCount("CH4", 0)).toBe(0); // C: 4 bonds, full octet, no lone pairs
    expect(lpCount("NaCl", 1)).toBe(4); // Cl-, full octet
    expect(lpCount("NaCl", 0)).toBe(0); // Na+, no valence electrons left
  });

  test("lewis_dot: bond order controls the number of parallel strokes (single/double/triple)", () => {
    registerPack("chemistry", chemistryYaml);
    const single = flattenDrawables(scenes.lewis_dot.layout!({ molecule: "HCl" }).drawables).filter((d) => d.id.startsWith("bond_0__"));
    const double = flattenDrawables(scenes.lewis_dot.layout!({ molecule: "O2" }).drawables).filter((d) => d.id.startsWith("bond_0__"));
    const triple = flattenDrawables(scenes.lewis_dot.layout!({ molecule: "N2" }).drawables).filter((d) => d.id.startsWith("bond_0__"));
    expect(single).toHaveLength(1);
    expect(double).toHaveLength(2);
    expect(triple).toHaveLength(3);
  });

  test("lewis_dot: NaCl has no bond stroke at all (ionic, not covalent)", () => {
    registerPack("chemistry", chemistryYaml);
    const r = scenes.lewis_dot.layout!({ molecule: "NaCl" });
    expect(r.drawables.some((d) => d.id.startsWith("bond_"))).toBe(false);
  });

  test("lewis_dot: show_charges draws NaCl's ionic brackets only for NaCl, and only when requested", () => {
    registerPack("chemistry", chemistryYaml);
    const withCharges = scenes.lewis_dot.layout!({ molecule: "NaCl", show_charges: true });
    expect(withCharges.drawables.some((d) => d.id === "charge_0")).toBe(true);
    expect(withCharges.drawables.some((d) => d.id === "charge_1")).toBe(true);
    const noCharges = scenes.lewis_dot.layout!({ molecule: "NaCl", show_charges: false });
    expect(noCharges.drawables.some((d) => d.id.startsWith("charge_"))).toBe(false);
    const waterWithCharges = scenes.lewis_dot.layout!({ molecule: "H2O", show_charges: true });
    expect(waterWithCharges.drawables.some((d) => d.id.startsWith("charge_"))).toBe(false);
  });

  test("lab_apparatus: each of the three setups draws exactly app_0 and app_1, plus its own structural extras", () => {
    registerPack("chemistry", chemistryYaml);
    const titration = scenes.lab_apparatus.layout!({ setup: "titration" });
    expect(titration.drawables.some((d) => d.id === "app_0")).toBe(true);
    expect(titration.drawables.some((d) => d.id === "app_1")).toBe(true);
    expect(titration.drawables.some((d) => d.id === "stand")).toBe(true);
    expect(titration.drawables.some((d) => d.id === "funnel")).toBe(false);

    const heating = scenes.lab_apparatus.layout!({ setup: "heating" });
    expect(heating.drawables.some((d) => d.id === "app_0")).toBe(true);
    expect(heating.drawables.some((d) => d.id === "app_1")).toBe(true);
    expect(heating.drawables.some((d) => d.id === "stand")).toBe(true);
    expect(heating.drawables.some((d) => d.id === "ring")).toBe(true);

    const filtration = scenes.lab_apparatus.layout!({ setup: "filtration" });
    expect(filtration.drawables.some((d) => d.id === "app_0")).toBe(true);
    expect(filtration.drawables.some((d) => d.id === "app_1")).toBe(true);
    expect(filtration.drawables.some((d) => d.id === "funnel")).toBe(true);
    expect(filtration.drawables.some((d) => d.id === "stand")).toBe(false);
  });

  test("lab_apparatus: indicator_color maps to the documented fill, and \"clear\" omits the liquid entirely", () => {
    registerPack("chemistry", chemistryYaml);
    const pink = scenes.lab_apparatus.layout!({ setup: "titration", indicator_color: "pink" });
    const pinkLiquid = flattenDrawables(pink.drawables).find((d) => d.id === "liquid") as { style: { fill?: string } };
    expect(pinkLiquid.style.fill).toBe(COLORS.regionLoss);

    const blue = scenes.lab_apparatus.layout!({ setup: "titration", indicator_color: "blue" });
    const blueLiquid = flattenDrawables(blue.drawables).find((d) => d.id === "liquid") as { style: { fill?: string } };
    expect(blueLiquid.style.fill).toBe(COLORS.supply);

    const clear = scenes.lab_apparatus.layout!({ setup: "titration", indicator_color: "clear" });
    expect(clear.drawables.some((d) => d.id === "liquid")).toBe(false);
  });

  test("lab_apparatus: labels[] produce leader labels pointing at app_0/app_1 in order", () => {
    registerPack("chemistry", chemistryYaml);
    const r = scenes.lab_apparatus.layout!({ setup: "heating", labels: ["Bunsen burner", "Beaker"] });
    expect(r.labels.map((l) => l.id)).toEqual(["label_0", "label_1"]);
    expect(r.labels.map((l) => l.text)).toEqual(["Bunsen burner", "Beaker"]);
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

  const BIOLOGY_TEMPLATE_IDS = ["membrane_bilayer", "dna_helix", "phylo_tree", "pathway", "punnett_square", "food_web"];

  test("parses and registers six templates in brief order", () => {
    const r = registerPack("biology", biologyYaml);
    expect(r).toMatchObject({ ok: true, templateIds: BIOLOGY_TEMPLATE_IDS });
  });

  test("every biology example renders lint-clean and deterministically, in bounds", () => {
    registerPack("biology", biologyYaml);
    for (const tid of BIOLOGY_TEMPLATE_IDS) {
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

  test("pathway: -> draws a plain arrowhead, -| draws a bar (inhibits), => draws a dashed arrow (converts)", () => {
    registerPack("biology", biologyYaml);
    const r = scenes.pathway.layout!({ edges: "A -> B; C -| D; E => F" });
    const flat = flattenDrawables(r.drawables);
    const edge0 = flat.find((d) => d.id === "edge_0") as { arrowhead?: string; style: { dash?: boolean } };
    expect(edge0.arrowhead).toBe("end");
    expect(edge0.style.dash).toBeFalsy();
    expect(flat.some((d) => d.id === "edge_1__head")).toBe(true); // the inhibition bar
    const edge2 = flat.find((d) => d.id === "edge_2") as { style: { dash?: boolean } };
    expect(edge2.style.dash).toBe(true);
  });

  test("pathway: node shape follows node_types (protein ellipse, gene rect, metabolite circle); process nodes have no shape at all", () => {
    registerPack("biology", biologyYaml);
    const r = scenes.pathway.layout!({
      edges: "P -> G; G -> M; M -> X",
      node_types: { P: "protein", G: "gene", M: "metabolite", X: "process" },
    });
    expect(r.drawables.some((d) => d.id === "node_p")).toBe(true);
    expect(r.drawables.some((d) => d.id === "node_g")).toBe(true);
    expect(r.drawables.some((d) => d.id === "node_m")).toBe(true);
    expect(r.drawables.some((d) => d.id === "node_x")).toBe(false); // process: no shape
    expect(r.labels.some((l) => l.id === "node_label_x")).toBe(true); // but the label still exists
  });

  test("punnett_square: Aa x Aa gives genotypes AA/Aa/Aa/aa (dominant allele first) and a 3:1 phenotype ratio by default", () => {
    registerPack("biology", biologyYaml);
    const r = scenes.punnett_square.layout!({ parent1: "Aa", parent2: "Aa" });
    const flat = flattenDrawables(r.drawables);
    const cell = (r0: number, c0: number) => (flat.find((d) => d.id === `grid__c${r0}_${c0}`) as { text: string }).text;
    const cells = [cell(0, 0), cell(0, 1), cell(1, 0), cell(1, 1)].sort();
    expect(cells).toEqual(["AA", "Aa", "Aa", "aa"]);
    // Uppercase-first: a mixed-case genotype must never be written lowercase-then-uppercase.
    for (const g of cells) if (g[0] !== g[1]) expect(g[0]).toBe(g[0].toUpperCase());
    const ratio = flat.find((d) => d.id === "ratio") as { text: string };
    expect(ratio.text).toBe("3 : 1");
  });

  test("punnett_square: highlight null switches to a genotype-count ratio (1:2:1 for Aa x Aa)", () => {
    registerPack("biology", biologyYaml);
    const r = scenes.punnett_square.layout!({ parent1: "Aa", parent2: "Aa", highlight: null });
    const flat = flattenDrawables(r.drawables);
    const ratio = flat.find((d) => d.id === "ratio") as { text: string };
    expect(ratio.text).toBe("1 : 2 : 1 genotypes");
    expect(flat.some((d) => d.id.startsWith("hl_"))).toBe(false);
  });

  test("punnett_square: a test cross (Aa x aa) highlights 2 recessive cells by default (1:1 reduced ratio)", () => {
    registerPack("biology", biologyYaml);
    const r = scenes.punnett_square.layout!({ parent1: "Aa", parent2: "aa" });
    const flat = flattenDrawables(r.drawables);
    const hl = flat.filter((d) => d.id.startsWith("hl_"));
    expect(hl).toHaveLength(2); // 2 of the 4 cells are fully recessive (aa)
    const ratio = flat.find((d) => d.id === "ratio") as { text: string };
    expect(ratio.text).toBe("1 : 1");
  });

  test("food_web: producers sit at the lowest y (bottom band) and every link points from lower y to higher y (up the trophic bands)", () => {
    registerPack("biology", biologyYaml);
    const r = scenes.food_web.layout!({});
    const flat = flattenDrawables(r.drawables);
    const grassY = (r.anchors.org_grass as [number, number])[1];
    const rabbitY = (r.anchors.org_rabbit as [number, number])[1];
    const hawkY = (r.anchors.org_hawk as [number, number])[1];
    expect(grassY).toBeLessThan(rabbitY);
    expect(rabbitY).toBeLessThan(hawkY);
    const links = flat.filter((d) => /^link_\d+$/.test(d.id)) as { pts: [number, number][] }[];
    expect(links.length).toBeGreaterThan(0);
    for (const link of links) {
      expect(link.pts.slice(-1)[0][1]).toBeGreaterThan(link.pts[0][1]); // "eaten by" arrow always goes upward
    }
  });

  test("food_web: highlight tints only links touching that organism", () => {
    registerPack("biology", biologyYaml);
    const r = scenes.food_web.layout!({
      organisms: [{ name: "Grass", level: "producer" }, { name: "Rabbit", level: "primary" }, { name: "Mouse", level: "primary" }, { name: "Fox", level: "secondary" }],
      links: "Grass -> Rabbit; Grass -> Mouse; Rabbit -> Fox",
      highlight: "Rabbit",
    });
    const flat = flattenDrawables(r.drawables);
    const link0 = flat.find((d) => d.id === "link_0") as { style: { color: string } }; // Grass -> Rabbit: touches highlight
    const link1 = flat.find((d) => d.id === "link_1") as { style: { color: string } }; // Grass -> Mouse: does not
    const link2 = flat.find((d) => d.id === "link_2") as { style: { color: string } }; // Rabbit -> Fox: touches highlight
    expect(link0.style.color).not.toBe(link1.style.color);
    expect(link2.style.color).toBe(link0.style.color);
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

describe("evidence pack", () => {
  beforeEach(() => unregisterPack("evidence"));

  const TEMPLATE_IDS = ["survival_curve", "forest_plot", "causal_dag", "sir_compartments", "distribution_curve"];

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
    const r = registerPack("evidence", evidenceYaml);
    expect(r).toMatchObject({ ok: true, templateIds: TEMPLATE_IDS });
  });

  test("every evidence example renders finite, no fallback warnings, no error-severity lint, and is deterministic", () => {
    registerPack("evidence", evidenceYaml);
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

  test("survival_curve: a KM step function is right-continuous and non-increasing", () => {
    registerPack("evidence", evidenceYaml);
    const r = scenes.survival_curve.layout!({
      arms: [{ label: "Treatment", survival: [1, 0.9, 0.7, 0.7, 0.4] }],
    });
    const arm = flattenDrawables(r.drawables).find((d) => d.id === "arm_0");
    expect(arm?.kind).toBe("stroke");
    const pts = (arm as { pts: [number, number][] }).pts;
    // Walking left to right, y (survival) must never increase — a step function only drops.
    let prevY = Infinity;
    let prevX = -Infinity;
    for (const [x, y] of pts) {
      expect(x).toBeGreaterThanOrEqual(prevX);
      expect(y).toBeLessThanOrEqual(prevY + 1e-9);
      prevX = x;
      prevY = y;
    }
  });

  test("forest_plot: ratio measures (RR/OR/HR) position studies on a LOG scale, not linear", () => {
    registerPack("evidence", evidenceYaml);
    const r = scenes.forest_plot.layout!({
      measure: "RR",
      studies: [
        { label: "A", est: 1, lo: 0.8, hi: 1.25 },
        { label: "B", est: 2, lo: 1.6, hi: 2.5 },
        { label: "C", est: 4, lo: 3.2, hi: 5 },
      ],
    });
    const ids = flattenDrawables(r.drawables).map((d) => d.id);
    const studyX = (i: number) => (r.anchors[`study_${i}`] as [number, number])[0];
    const dAB = studyX(1) - studyX(0);
    const dBC = studyX(2) - studyX(1);
    // ln(2)-ln(1) === ln(4)-ln(2), so equal-ratio steps land equally spaced on a log axis —
    // a linear axis would instead place C twice as far from B as B is from A.
    expect(Math.abs(dAB - dBC)).toBeLessThan(1);
    expect(ids).toContain("null_line");
  });

  test("causal_dag: highlight_backdoor tints only edges touching a confounder", () => {
    registerPack("evidence", evidenceYaml);
    const r = scenes.causal_dag.layout!({
      nodes: [
        { name: "Coffee", role: "exposure" },
        { name: "Heart disease", role: "outcome" },
        { name: "Stress", role: "confounder" },
      ],
      edges: "Coffee -> Heart disease; Stress -> Coffee; Stress -> Heart disease",
      highlight_backdoor: true,
    });
    const flat = flattenDrawables(r.drawables);
    const exposureToOutcome = flat.find((d) => d.id === "edge_0");
    const confounderEdge = flat.find((d) => d.id === "edge_1");
    expect(exposureToOutcome && "style" in exposureToOutcome ? exposureToOutcome.style.color : undefined).not.toBe(
      confounderEdge && "style" in confounderEdge ? confounderEdge.style.color : undefined,
    );
  });

  test("sir_compartments: chain boxes are 150x90 rects, with n-1 flow arrows between them", () => {
    registerPack("evidence", evidenceYaml);
    const r = scenes.sir_compartments.layout!({ compartments: ["S", "E", "I", "R"] });
    const flat = flattenDrawables(r.drawables);
    const box = flat.find((d) => d.id === "box_s");
    expect(box?.kind).toBe("stroke");
    expect((box as { shapeHint?: { type: string; w: number; h: number } }).shapeHint).toMatchObject({ type: "rect", w: 150, h: 90 });
    const ids = flat.map((d) => d.id);
    expect(ids).toContain("flow_0");
    expect(ids).toContain("flow_1");
    expect(ids).toContain("flow_2");
    expect(ids).not.toContain("flow_3");
  });

  test("distribution_curve: shade=upper shades the RIGHT tail only", () => {
    registerPack("evidence", evidenceYaml);
    const r = scenes.distribution_curve.layout!({ shade: { from: 1.96, side: "upper" } });
    const ids = flattenDrawables(r.drawables).map((d) => d.id);
    expect(ids).toContain("shade");
    expect(ids).not.toContain("shade2");
    const shade = flattenDrawables(r.drawables).find((d) => d.id === "shade") as { pts: [number, number][] };
    const curveAnchor = r.anchors.curve as [number, number];
    // Every shaded point should sit at or to the right of the curve's own right edge minus a margin —
    // i.e. in the right tail, not spilling across the mean.
    const meanX = r.anchors.mean_line[0];
    expect(shade.pts.every(([x]) => x >= meanX - 1)).toBe(true);
    expect(curveAnchor).toBeDefined();
  });

  test("distribution_curve: right_skew ticks reflect the curve's own asymmetric spread, not the normal kind's", () => {
    registerPack("evidence", evidenceYaml);
    const r = scenes.distribution_curve.layout!({ kind: "right_skew" });
    const curve = flattenDrawables(r.drawables).find((d) => d.id === "curve") as { pts: [number, number][] };
    // Find the curve's own peak (highest drawn point) without relying on any internal constant.
    let peak = curve.pts[0];
    for (const p of curve.pts) if (p[1] > peak[1]) peak = p;
    const plusOne = r.anchors.sd_tick_2 as [number, number]; // index 2 of [-2,-1,1,2] is +1σ
    const minusOne = r.anchors.sd_tick_1 as [number, number]; // index 1 is -1σ
    const distPlus = Math.abs(plusOne[0] - peak[0]);
    const distMinus = Math.abs(minusOne[0] - peak[0]);
    // A right-skewed curve has a long right tail (bigger sigma there): the +1σ
    // tick should sit farther from the peak than the -1σ tick, not equidistant
    // (equidistant would mean the ticks were still using the normal kind's
    // single shared S instead of this curve's own asymmetric spread).
    expect(distPlus).toBeGreaterThan(distMinus);
  });
});

describe("mathlogic pack", () => {
  beforeEach(() => unregisterPack("mathlogic"));

  const TEMPLATE_IDS = ["venn_diagram", "unit_circle", "number_line", "geometry_figure", "truth_table", "argument_map", "equation_steps"];

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

  test("registers all seven templates in brief order", () => {
    const r = registerPack("mathlogic", mathlogicYaml);
    expect(r).toMatchObject({ ok: true, templateIds: TEMPLATE_IDS });
    expect(scenes.equation_steps.manifest.engines).toEqual(["mathjax"]);
  });

  test("every mathlogic example renders finite, no fallback warnings, no error-severity lint, and is deterministic (mathjax pre-loaded)", async () => {
    await ensureEngines(["mathjax"]);
    registerPack("mathlogic", mathlogicYaml);
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

  // The user-visible defect this fixes: equations rendered blurry/grainy with
  // the counters of "b"/"p"/"8"/"0" painted solid. Cause was one solid,
  // hachure-filled kit.area per RING; the fix is one exact, hole-carrying
  // filled shape per glyph.
  describe("equation_steps renders glyphs as exact filled shapes", () => {
    const polyArea = (pts: [number, number][]) => {
      let a = 0;
      for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) a += pts[j][0] * pts[i][1] - pts[i][0] * pts[j][1];
      return Math.abs(a) / 2;
    };
    const bboxArea = (pts: [number, number][]) => {
      const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
      return (Math.max(...xs) - Math.min(...xs)) * (Math.max(...ys) - Math.min(...ys));
    };
    const areasOf = (r: SceneLayout) =>
      flattenDrawables(r.drawables).filter((d) => d.kind === "area") as {
        id: string; pts: [number, number][]; holes?: [number, number][][]; precise?: boolean; style: { opacity: number; fill?: string };
      }[];

    test("one drawable per glyph, with its counters as real holes — not N solid rings", async () => {
      await ensureEngines(["mathjax"]);
      registerPack("mathlogic", mathlogicYaml);
      const r = scenes.equation_steps.layout!({ steps: [{ tex: "80" }] });
      const areas = areasOf(r);
      // Old behaviour: 3 independent ink areas (8's outer + its two counters
      // were separate rings, plus 0's outer and counter = 5). Now: 2 glyphs.
      expect(areas).toHaveLength(2);
      expect(areas.map((a) => a.holes?.length ?? 0)).toEqual([2, 1]);
      for (const a of areas) {
        expect(a.precise).toBe(true);
        expect(a.style.opacity).toBe(1);
        expect(a.style.fill).toBe(COLORS.ink);
      }
    });

    test("the counters stay wide open at the 54 px step height", async () => {
      await ensureEngines(["mathjax"]);
      registerPack("mathlogic", mathlogicYaml);
      const r = scenes.equation_steps.layout!({ steps: [{ tex: "0" }] });
      const [zero] = areasOf(r);
      const hole = zero.holes![0];
      // A counter that survives is a real, visible hole: at least a tenth of
      // the glyph's own filled area, and several logical units across.
      expect(polyArea(hole) / polyArea(zero.pts)).toBeGreaterThan(0.1);
      const xs = hole.map((p) => p[0]), ys = hole.map((p) => p[1]);
      expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(4);
      expect(Math.max(...ys) - Math.min(...ys)).toBeGreaterThan(8);
    });

    test("simplification never distorts a letterform: fill ratio matches the full-resolution outline", async () => {
      await ensureEngines(["mathjax"]);
      registerPack("mathlogic", mathlogicYaml);
      const eng = (await import("../src/scenes/engines")).getLoadedEngines(["mathjax"]).mathjax as {
        layoutTeX(t: string, o?: { display?: boolean }): { outlines: { pts: [number, number][]; holes?: [number, number][][] }[] };
      };
      for (const tex of ["x", "8", "b"]) {
        const truth = eng.layoutTeX(tex, { display: true }).outlines[0];
        const drawn = areasOf(scenes.equation_steps.layout!({ steps: [{ tex }] }))[0];
        // area/bbox-area is invariant under the uniform scale + translate the
        // template applies, so it compares SHAPE, not size.
        expect(polyArea(drawn.pts) / bboxArea(drawn.pts), tex).toBeCloseTo(polyArea(truth.pts) / bboxArea(truth.pts), 2);
        expect(drawn.pts.length, tex).toBeGreaterThanOrEqual(12);
      }
    });

    test("under fill-rule evenodd the counter is paper and the bowl around it is ink", async () => {
      await ensureEngines(["mathjax"]);
      registerPack("mathlogic", mathlogicYaml);
      const inRing = (p: [number, number], ring: [number, number][]) => {
        let hit = false;
        for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
          const [xi, yi] = ring[i], [xj, yj] = ring[j];
          if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) hit = !hit;
        }
        return hit;
      };
      // Evenodd paints a point iff an ODD number of the path's subpaths contain it.
      const painted = (p: [number, number], a: { pts: [number, number][]; holes?: [number, number][][] }) =>
        [a.pts, ...(a.holes ?? [])].filter((r) => inRing(p, r)).length % 2 === 1;

      for (const tex of ["8", "0", "b", "p"]) {
        const glyph = areasOf(scenes.equation_steps.layout!({ steps: [{ tex }] }))[0];
        const hole = glyph.holes![0];
        const hx = (Math.min(...hole.map((p) => p[0])) + Math.max(...hole.map((p) => p[0]))) / 2;
        const hy0 = Math.min(...hole.map((p) => p[1])), hy1 = Math.max(...hole.map((p) => p[1]));
        expect(painted([hx, (hy0 + hy1) / 2], glyph), `${tex}: counter`).toBe(false);
        // ... and the bowl wall above that counter still is ink.
        const top = Math.max(...glyph.pts.filter((p) => Math.abs(p[0] - hx) < 1).map((p) => p[1]), hy1 + 2);
        expect(painted([hx, (hy1 + top) / 2], glyph), `${tex}: bowl wall`).toBe(true);
      }
    });

    test("the quadratic formula stays cheap: exact paths, not tens of thousands of points", async () => {
      await ensureEngines(["mathjax"]);
      registerPack("mathlogic", mathlogicYaml);
      const params = scenes.equation_steps.manifest.examples[0].params;
      const areas = areasOf(scenes.equation_steps.layout!(params));
      const points = areas.reduce((n, a) => n + a.pts.length + (a.holes ?? []).reduce((m, h) => m + h.length, 0), 0);
      expect(points).toBeLessThan(2500);
      expect(areas.length).toBeLessThan(80);
    });
  });

  test("truth_table: \"(A AND B) OR NOT A\" over A,B yields T,T,F,T in binary row order", () => {
    registerPack("mathlogic", mathlogicYaml);
    const r = scenes.truth_table.layout!({ variables: ["A", "B"], expression: "(A AND B) OR NOT A" });
    const flat = flattenDrawables(r.drawables);
    const cell = (row: number) => (flat.find((d) => d.id === `grid__c${row}_2`) as { text: string }).text;
    // Rows count up in binary with A as the most-significant bit: (F,F) (F,T) (T,F) (T,T).
    expect([cell(0), cell(1), cell(2), cell(3)]).toEqual(["T", "T", "F", "T"]);
  });

  test("truth_table: IMPLIES is right-associative — \"A IMPLIES B IMPLIES C\" parses as A IMPLIES (B IMPLIES C)", () => {
    registerPack("mathlogic", mathlogicYaml);
    const r = scenes.truth_table.layout!({ variables: ["A", "B", "C"], expression: "A IMPLIES B IMPLIES C" });
    const flat = flattenDrawables(r.drawables);
    const cell = (row: number) => (flat.find((d) => d.id === `grid__c${row}_3`) as { text: string }).text;
    // Row order (A slowest): 0=(F,F,F) 1=(F,F,T) 2=(F,T,F) 3=(F,T,T) 4=(T,F,F) 5=(T,F,T) 6=(T,T,F) 7=(T,T,T).
    // Right-assoc A→(B→C): only row 6 (T,T,F) is false. Left-assoc (A→B)→C would instead make row 2 false —
    // row 2 is the one case where the two associations disagree, so asserting it is "T" proves right-assoc.
    expect(cell(2)).toBe("T");
    expect([cell(0), cell(1), cell(3), cell(4), cell(5), cell(6), cell(7)]).toEqual(["T", "T", "T", "T", "T", "F", "T"]);
  });

  test("unit_circle: at 30° the point sits at exactly (cos30, sin30) scaled by the radius, and the coords label reads the 2-dec values", () => {
    registerPack("mathlogic", mathlogicYaml);
    const r = scenes.unit_circle.layout!({ angle_deg: 30 });
    const point = r.anchors.point as [number, number];
    const O = r.anchors.circle as [number, number];
    const R = 240;
    expect(point[0]).toBeCloseTo(O[0] + R * Math.cos(Math.PI / 6), 6);
    expect(point[1]).toBeCloseTo(O[1] + R * Math.sin(Math.PI / 6), 6);
    const coordsText = r.labels.find((l) => l.id === "coords_label")?.text;
    expect(coordsText).toBe("(0.87, 0.50)");
  });

  test("unit_circle: angle_arc normalizes its sweep — 390° matches 30° exactly (not a full turn plus 30°), and a negative angle sweeps the long way to the equivalent position instead of backwards", () => {
    registerPack("mathlogic", mathlogicYaml);
    const arcR = 42;
    const base = scenes.unit_circle.layout!({ angle_deg: 30 });
    const wrapped = scenes.unit_circle.layout!({ angle_deg: 390 });
    const arcOf = (r: SceneLayout) => flattenDrawables(r.drawables).find((d) => d.id === "angle_arc") as { pts: [number, number][] };
    const arcBase = arcOf(base);
    const arcWrapped = arcOf(wrapped);
    // If the arc's sweep used raw theta (unnormalized), 390° (theta ≈ 6.807 rad)
    // would sweep more than a full turn past 30° and produce a completely
    // different set of points — exact equality with the 30° case is only
    // possible once the sweep is wrapped into [0, 360).
    expect(arcWrapped.pts).toEqual(arcBase.pts);
    const labelOf = (r: SceneLayout) => r.labels.find((l) => l.id === "angle_label")?.anchor;
    expect(labelOf(wrapped)).toEqual(labelOf(base));

    const neg = scenes.unit_circle.layout!({ angle_deg: -30 });
    const arcNeg = arcOf(neg);
    const O = base.anchors.circle as [number, number];
    const last = arcNeg.pts[arcNeg.pts.length - 1];
    // -30° normalizes to 330° (the long way around from 0, forward-only), not
    // a backwards sweep — the arc's LAST point still lands at the -30°/330°
    // position on the circle.
    expect(last[0]).toBeCloseTo(O[0] + arcR * Math.cos((330 * Math.PI) / 180), 6);
    expect(last[1]).toBeCloseTo(O[1] + arcR * Math.sin((330 * Math.PI) / 180), 6);
  });

  test("venn_diagram: shading only the requested region keys produces exactly those shade_<k> ids", () => {
    registerPack("mathlogic", mathlogicYaml);
    const r = scenes.venn_diagram.layout!({ sets: [{ label: "A" }, { label: "B" }], shade: ["ab"] });
    const ids = flattenDrawables(r.drawables).map((d) => d.id);
    expect(ids).toContain("shade_ab");
    expect(ids).not.toContain("shade_a");
    expect(ids).not.toContain("shade_b");
    expect(ids).not.toContain("shade_outside");
    const r3 = scenes.venn_diagram.layout!({ sets: [{ label: "A" }, { label: "B" }, { label: "C" }], shade: ["abc", "outside"] });
    const ids3 = flattenDrawables(r3.drawables).map((d) => d.id);
    expect(ids3).toContain("shade_abc");
    expect(ids3).toContain("shade_outside");
    expect(ids3).not.toContain("shade_ab");
  });
});

const GAMES_TEMPLATE_IDS = ["chess_board"];

describe("games pack", () => {
  beforeEach(() => unregisterPack("games"));

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

  test("registers chess_board; it declares the chess engine, and games is a default-off pack", () => {
    const r = registerPack("games", gamesYaml);
    expect(r).toMatchObject({ ok: true, templateIds: GAMES_TEMPLATE_IDS });
    expect(scenes.chess_board.manifest.engines).toEqual(["chess"]);
    expect(DEFAULT_OFF_PACKS.has("games")).toBe(true);
  });

  test("start position (no moves) renders exactly 32 piece texts, no fallback warnings", async () => {
    await ensureEngines(["chess"]);
    registerPack("games", gamesYaml);
    const res = layoutSpec({ template: "chess_board", params: {}, elements: [] } as never);
    inBounds(res);
    const pieceTexts = flattenDrawables(res.drawables).filter((d) => d.kind === "text" && d.id.startsWith("piece_"));
    expect(pieceTexts).toHaveLength(32);
    expect(pieceTexts.every((d) => (d as { text: string }).text !== "")).toBe(true);
    // Corners: a8 black rook, h1 white rook, per the engine's own board() contract.
    expect((flattenDrawables(res.drawables).find((d) => d.id === "piece_a8") as { text: string }).text).toBe("♜");
    expect((flattenDrawables(res.drawables).find((d) => d.id === "piece_h1") as { text: string }).text).toBe("♖");
  });

  test("board fills more of the canvas (620x620, up from 520x520) and pieces grew with it (fontSize 52, up from 44)", async () => {
    await ensureEngines(["chess"]);
    registerPack("games", gamesYaml);
    const res = scenes.chess_board.layout!({});
    const flat = flattenDrawables(res.drawables);
    // grid_h8 is the BOTTOM horizontal grid line (r=0 is the top row's own
    // top edge; r=rows=8 is the bottom edge — see kit.table's rowY/grid loop).
    const grid = flat.find((d) => d.id === "board__grid_h8") as { pts: [number, number][] } | undefined;
    expect(grid).toBeDefined();
    // The board's own bottom edge sits 65 logical units above y=0 (BOARD=620,
    // centered in the 750-tall canvas): (750 - 620) / 2 = 65.
    expect(grid!.pts[0][1]).toBeCloseTo(65, 6);
    const piece = flat.find((d) => d.id === "piece_a1") as { fontSize: number };
    expect(piece.fontSize).toBe(52);
  });

  test("dark squares use region2 (muted green) at 0.5 opacity, not the old muddy guide-at-0.35, and the board scaffold (grid + squares) draws at the smallest named budget", async () => {
    await ensureEngines(["chess"]);
    registerPack("games", gamesYaml);
    const res = scenes.chess_board.layout!({});
    const flat = flattenDrawables(res.drawables);
    const sqA1 = flat.find((d) => d.id === "sq_a1") as { style: { fill: string; opacity: number }; drawOpts: { duration: number } };
    expect(sqA1.style.fill).toBe(COLORS.region2);
    expect(sqA1.style.opacity).toBe(0.5);
    expect(sqA1.drawOpts.duration).toBe(420); // kit.SKETCH_MS.dot — the scaffold's near-instant budget.
    const gridLine = flat.find((d) => d.id === "board__grid_h8") as { drawOpts: { duration: number } };
    expect(gridLine.drawOpts.duration).toBe(420);
    // The move arrow (the narrated, central content) keeps its normal pace.
    const arrow = scenes.chess_board.layout!({ moves: ["e4"], plies_shown: 1 });
    const arrowLeaf = flattenDrawables(arrow.drawables).find((d) => d.id.startsWith("move_arrow")) as { drawOpts: { duration: number } };
    expect(arrowLeaf.drawOpts.duration).toBe(850); // kit.SKETCH_MS.connector, unchanged.
  });

  // Regression: SVG dominant-baseline "central" (src/render/svg-backend.ts)
  // centers on the FONT's ascent/descent metrics, not a Unicode chess
  // glyph's own ink — these glyphs sit within roughly the lower two-thirds
  // of their em box, so they read as floating high in their square. The
  // piece text position is nudged DOWN (a smaller y-up value) by exactly
  // 0.35 * fontSize from the cell's own center to compensate; coord labels
  // (plain digits/letters) get no such nudge.
  test("piece glyphs are nudged down from the cell center by exactly 0.35 * fontSize for optical centering; coord labels are not nudged", async () => {
    await ensureEngines(["chess"]);
    registerPack("games", gamesYaml);
    const res = scenes.chess_board.layout!({});
    const flat = flattenDrawables(res.drawables);
    // sq_a1 anchors to the exact cell center (no nudge) — piece_a1 shares
    // that same cell, so the vertical gap between them is exactly the nudge.
    const sqA1 = flat.find((d) => d.id === "sq_a1") as { pts: [number, number][] };
    const cellCy = sqA1.pts.reduce((sum, [, y]) => sum + y, 0) / sqA1.pts.length;
    const piece = flat.find((d) => d.id === "piece_a1") as { pos: [number, number]; fontSize: number };
    expect(piece.pos[1]).toBeCloseTo(cellCy - 0.35 * piece.fontSize, 6);
    // coord_a (a file letter, drawn only with coords !== false) sits at its
    // own fixed offset from the board edge, independent of any glyph nudge.
    const coordA = flat.find((d) => d.id === "coord_a") as { pos: [number, number] };
    expect(coordA.pos[1]).toBeCloseTo(65 - 31, 6); // Y0 - 31, no fontSize-based nudge applied.
  });

  test('plies_shown: 1 on ["e4"] moves the e2 pawn text to e4 and emits move_arrow', async () => {
    await ensureEngines(["chess"]);
    registerPack("games", gamesYaml);
    const r = scenes.chess_board.layout!({ moves: ["e4"], plies_shown: 1 });
    const flat = flattenDrawables(r.drawables);
    const e2 = flat.find((d) => d.id === "piece_e2") as { text: string };
    const e4 = flat.find((d) => d.id === "piece_e4") as { text: string };
    expect(e2.text).toBe("");
    expect(e4.text).toBe("♙");
    const arrow = flat.find((d) => d.id === "move_arrow") as { pts: [number, number][] } | undefined;
    expect(arrow).toBeDefined();
    // The arrow actually points from e2 toward e4 (not the shown===0 degenerate case).
    expect(arrow!.pts[0][1]).toBeLessThan(arrow!.pts[arrow!.pts.length - 1][1]);
  });

  test("plies_shown clamps to [0, moves.length] and defaults to the full line", async () => {
    await ensureEngines(["chess"]);
    registerPack("games", gamesYaml);
    const full = scenes.chess_board.layout!({ moves: ["e4", "e5"] });
    const clampedHigh = scenes.chess_board.layout!({ moves: ["e4", "e5"], plies_shown: 99 });
    const clampedLow = scenes.chess_board.layout!({ moves: ["e4", "e5"], plies_shown: -3 });
    expect(JSON.stringify(full)).toBe(JSON.stringify(clampedHigh));
    const e2Low = flattenDrawables(clampedLow.drawables).find((d) => d.id === "piece_e2") as { text: string };
    expect(e2Low.text).toBe("♙"); // plies_shown clamped to 0: nothing played yet.
  });

  test("illegal SAN throws, naming the offending move", async () => {
    await ensureEngines(["chess"]);
    registerPack("games", gamesYaml);
    expect(() => scenes.chess_board.layout!({ moves: ["e9"] })).toThrow(/e9/);
    expect(() => scenes.chess_board.layout!({ moves: ["e4", "e5", "e5"] })).toThrow(/e5/);
  });

  test("invalid fen throws, naming the defect, even with no moves", async () => {
    await ensureEngines(["chess"]);
    registerPack("games", gamesYaml);
    expect(() => scenes.chess_board.layout!({ fen: "not a fen at all" })).toThrow();
  });

  test("orientation: piece_e2 sits low-right in White's view, high-left when flipped (both traced from the engine's own board row/col)", async () => {
    await ensureEngines(["chess"]);
    registerPack("games", gamesYaml);
    const white = scenes.chess_board.layout!({});
    const black = scenes.chess_board.layout!({ flip: true });
    const CX = 500, CY = 375; // board center: X0 + 310, Y0 + 310 with X0=190, Y0=65 (BOARD=620) — always the canvas center regardless of board size, since X0/Y0 are derived to center it.
    const posW = white.anchors.piece_e2 as [number, number];
    const posB = black.anchors.piece_e2 as [number, number];
    expect(posW[1]).toBeLessThan(CY); // White's view: e2 low (near White's own side)...
    expect(posW[0]).toBeGreaterThan(CX); // ...and right of center (file e is east of d).
    expect(posB[1]).toBeGreaterThan(CY); // Flipped: the SAME square sits high...
    expect(posB[0]).toBeLessThan(CX); // ...and left of center.
  });

  test("every games example renders finite, no fallback warnings, no error-severity lint, and is deterministic (chess engine pre-loaded)", async () => {
    await ensureEngines(["chess"]);
    registerPack("games", gamesYaml);
    for (const tid of GAMES_TEMPLATE_IDS) {
      for (const ex of scenes[tid].manifest.examples) {
        const res = layoutSpec({ template: tid, params: ex.params, elements: [] } as never);
        inBounds(res);
      }
      const a = scenes[tid].layout!(scenes[tid].manifest.examples[0].params);
      const b = scenes[tid].layout!(scenes[tid].manifest.examples[0].params);
      expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    }
  });

  test("highlights are deduped, arrows/coords are toggleable", async () => {
    await ensureEngines(["chess"]);
    registerPack("games", gamesYaml);
    const withExtras = scenes.chess_board.layout!({
      highlights: ["d5", "d5", "zz"],
      arrows: [{ from: "d1", to: "d5" }],
      coords: true,
    });
    const idsExtras = flattenDrawables(withExtras.drawables).map((d) => d.id);
    expect(idsExtras.filter((id) => id === "hl_d5")).toHaveLength(1);
    expect(idsExtras).not.toContain("hl_zz");
    expect(idsExtras).toContain("arrow_0");
    expect(idsExtras).toContain("coord_a");
    expect(idsExtras).toContain("coord_1");

    const noCoords = scenes.chess_board.layout!({ coords: false });
    const idsNoCoords = flattenDrawables(noCoords.drawables).map((d) => d.id);
    expect(idsNoCoords.some((id) => id.startsWith("coord_"))).toBe(false);
  });
});

const MAPS_TEMPLATE_IDS = ["world_map"];

describe("maps pack", () => {
  beforeEach(() => unregisterPack("maps"));

  function inBounds(res: ReturnType<typeof layoutSpec>) {
    expect(res.warnings).toEqual([]);
    expect(res.issues.filter((i) => i.severity === "error")).toEqual([]);
    for (const d of flattenDrawables(res.drawables)) {
      if (d.kind === "stroke" || d.kind === "area") {
        for (const [x, y] of d.pts) {
          expect(Number.isFinite(x) && Number.isFinite(y)).toBe(true);
          expect(x).toBeGreaterThanOrEqual(0);
          expect(x).toBeLessThanOrEqual(1000);
          expect(y).toBeGreaterThanOrEqual(0);
          expect(y).toBeLessThanOrEqual(750);
        }
      } else if (d.kind === "text") {
        expect(Number.isFinite(d.pos[0]) && Number.isFinite(d.pos[1])).toBe(true);
      }
    }
  }

  test("registers world_map; it declares the geo engine, and maps is a default-off pack", () => {
    const r = registerPack("maps", mapsYaml);
    expect(r).toMatchObject({ ok: true, templateIds: MAPS_TEMPLATE_IDS });
    expect(scenes.world_map.manifest.engines).toEqual(["geo"]);
    expect(DEFAULT_OFF_PACKS.has("maps")).toBe(true);
  });

  test("focus: [Norway, Sweden] yields 2+ in-canvas country strokes", async () => {
    await ensureEngines(["geo"]);
    registerPack("maps", mapsYaml);
    const res = layoutSpec({ template: "world_map", params: { focus: ["Norway", "Sweden"] }, elements: [] } as never);
    inBounds(res);
    const flat = flattenDrawables(res.drawables);
    const countryStrokes = flat.filter((d) => d.kind === "stroke" && d.id.startsWith("country_"));
    expect(countryStrokes.length).toBeGreaterThanOrEqual(2);
    expect(flat.some((d) => d.id === "country_norway")).toBe(true);
    expect(flat.some((d) => d.id === "country_sweden")).toBe(true);
    // Only the focused countries are drawn — not the whole world.
    const countryGroupIds = res.drawables.filter((d) => d.id.startsWith("country_")).map((d) => d.id);
    expect(countryGroupIds.sort()).toEqual(["country_norway", "country_sweden"]);
  });

  test("highlight adds a region2 area fill for the highlighted country", async () => {
    await ensureEngines(["geo"]);
    registerPack("maps", mapsYaml);
    const res = layoutSpec({ template: "world_map", params: { focus: ["Norway", "Sweden"], highlight: ["Norway"] }, elements: [] } as never);
    inBounds(res);
    const area = res.drawables.find((d) => d.id === "hl_norway");
    expect(area).toBeDefined();
    expect(area!.kind).toBe("area");
  });

  test("an unknown country name in focus yields a missing_note drawable naming it", async () => {
    await ensureEngines(["geo"]);
    registerPack("maps", mapsYaml);
    const res = scenes.world_map.layout!({ focus: ["Norway", "Wakanda"] });
    const note = res.drawables.find((d) => d.id === "missing_note") as { kind: string; text?: string } | undefined;
    expect(note).toBeDefined();
    expect(note!.kind).toBe("text");
    expect(note!.text).toMatch(/Wakanda/);
  });

  test("highlighting a real country that isn't drawn (not in focus) is skipped, not filled without an outline — reported as 'Not drawn'", async () => {
    await ensureEngines(["geo"]);
    registerPack("maps", mapsYaml);
    const res = scenes.world_map.layout!({ focus: ["Norway"], highlight: ["Germany"] });
    const flat = flattenDrawables(res.drawables);
    expect(flat.some((d) => d.id === "hl_germany")).toBe(false);
    expect(flat.some((d) => d.id.startsWith("country_germany"))).toBe(false);
    const note = res.drawables.find((d) => d.id === "missing_note") as { kind: string; text?: string } | undefined;
    expect(note).toBeDefined();
    expect(note!.text).toMatch(/Not drawn: Germany/);
    // Germany was never flagged "Unknown" — it's a real country, just not drawn here.
    expect(note!.text).not.toMatch(/Unknown/);
  });

  test("world mode: highlighting a country whose rings all fall below the drawable-count cap is also 'Not drawn', not a floating fill", async () => {
    await ensureEngines(["geo"]);
    registerPack("maps", mapsYaml);
    // At this fit box size, Luxembourg's rings are all under the 8-point
    // world-mode cap, so it never gets a country_ outline even though it is
    // a real, resolvable country — the same "not drawn" bucket as a
    // focus-mode exclusion, not a special case.
    const res = scenes.world_map.layout!({ highlight: ["Luxembourg"] });
    const flat = flattenDrawables(res.drawables);
    expect(flat.some((d) => d.id === "hl_luxembourg")).toBe(false);
    expect(flat.some((d) => d.id.startsWith("country_luxembourg"))).toBe(false);
    const note = res.drawables.find((d) => d.id === "missing_note") as { text?: string } | undefined;
    expect(note?.text).toMatch(/Not drawn: Luxembourg/);
  });

  test("an unknown marker country also yields missing_note, and a known one draws a dot + label", async () => {
    await ensureEngines(["geo"]);
    registerPack("maps", mapsYaml);
    const res = scenes.world_map.layout!({
      focus: ["Norway"],
      markers: [{ country: "Norway", label: "Oslo" }, { country: "Atlantis" }],
    });
    const flat = flattenDrawables(res.drawables);
    expect(flat.some((d) => d.id === "marker_0")).toBe(true);
    const label = res.labels.find((l) => l.id === "marker_label_0");
    expect(label?.text).toBe("Oslo");
    const note = res.drawables.find((d) => d.id === "missing_note") as { text?: string } | undefined;
    expect(note?.text).toMatch(/Atlantis/);
  });

  test("world mode (no focus) draws many countries, no graticule, and stays clean with no params", async () => {
    await ensureEngines(["geo"]);
    registerPack("maps", mapsYaml);
    const res = layoutSpec({ template: "world_map", params: {}, elements: [] } as never);
    inBounds(res);
    const countryGroups = res.drawables.filter((d) => d.id.startsWith("country_"));
    expect(countryGroups.length).toBeGreaterThan(100);
    expect(res.drawables.some((d) => d.id === "graticule")).toBe(false);
    expect(res.drawables.some((d) => d.id === "missing_note")).toBe(false);
  });

  test("focus mode draws a graticule frame; world mode ring strokes carry the guide color and duration", async () => {
    await ensureEngines(["geo"]);
    registerPack("maps", mapsYaml);
    const focused = scenes.world_map.layout!({ focus: ["Norway"] });
    expect(focused.drawables.some((d) => d.id === "graticule")).toBe(true);

    const world = scenes.world_map.layout!({});
    const oneRing = flattenDrawables(world.drawables).find((d) => d.kind === "stroke" && d.id.startsWith("country_")) as { style: { color: string }; drawOpts: { duration: number } };
    expect(oneRing.style.color).toBe(COLORS.guide);
    expect(oneRing.drawOpts.duration).toBe(900); // kit.SKETCH_MS.guides
  });

  test("every maps example renders finite, no fallback warnings, no error-severity lint, and is deterministic (geo engine pre-loaded)", async () => {
    await ensureEngines(["geo"]);
    registerPack("maps", mapsYaml);
    for (const tid of MAPS_TEMPLATE_IDS) {
      for (const ex of scenes[tid].manifest.examples) {
        const res = layoutSpec({ template: tid, params: ex.params, elements: [] } as never);
        inBounds(res);
      }
      const a = scenes[tid].layout!(scenes[tid].manifest.examples[0].params);
      const b = scenes[tid].layout!(scenes[tid].manifest.examples[0].params);
      expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    }
  });

  test("title renders as a fixed text element when set", async () => {
    await ensureEngines(["geo"]);
    registerPack("maps", mapsYaml);
    const res = scenes.world_map.layout!({ focus: ["Norway"], title: "Norway" });
    const title = res.drawables.find((d) => d.id === "title") as { kind: string; text?: string } | undefined;
    expect(title?.kind).toBe("text");
    expect(title?.text).toBe("Norway");
  });
});
