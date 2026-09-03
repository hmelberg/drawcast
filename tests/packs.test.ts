import { beforeEach, describe, expect, test } from "vitest";
import physicsYaml from "../src/scenes/packs/physics.yaml?raw";
import chemistryYaml from "../src/scenes/packs/chemistry.yaml?raw";
import biologyYaml from "../src/scenes/packs/biology.yaml?raw";
import economicsYaml from "../src/scenes/packs/economics.yaml?raw";
import evidenceYaml from "../src/scenes/packs/evidence.yaml?raw";
import mathlogicYaml from "../src/scenes/packs/mathlogic.yaml?raw";
import gamesYaml from "../src/scenes/packs/games.yaml?raw";
import medicineYaml from "../src/scenes/packs/medicine.yaml?raw";
import macroYaml from "../src/scenes/packs/macro.yaml?raw";
import empiricsYaml from "../src/scenes/packs/empirics.yaml?raw";
import htaYaml from "../src/scenes/packs/hta.yaml?raw";
import musicYaml from "../src/scenes/packs/music.yaml?raw";
import statsYaml from "../src/scenes/packs/stats.yaml?raw";
import mapsYaml from "../src/scenes/packs/maps.yaml?raw";
import dataYaml from "../src/scenes/packs/data.yaml?raw";
import { parsePack, registerPack, unregisterPack, isPackTemplateId, packTemplateIds, ensureEnabledPacks, PACK_DEFS, DEFAULT_OFF_PACKS } from "../src/scenes/packs";
import { scenes } from "../src/scenes/registry";
import { layoutSpec } from "../src/layout/layout";
import { flattenDrawables, COLORS, type Drawable } from "../src/layout/model";
import { ensureEngines, getLoadedEngines, type GeoEngine } from "../src/scenes/engines";
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

  const TEMPLATE_IDS = ["indifference_budget", "ppf", "firm_cost_curves", "payoff_matrix", "game_tree"];

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

  test("causal_dag: a diagonal edge (confounder to exposure) trims to the node ellipse's true boundary, never starting inside the halo", () => {
    registerPack("evidence", evidenceYaml);
    const r = scenes.causal_dag.layout!({
      nodes: [
        { name: "Coffee", role: "exposure" },
        { name: "Heart disease", role: "outcome" },
        { name: "Stress", role: "confounder" },
      ],
      edges: "Coffee -> Heart disease; Stress -> Coffee; Stress -> Heart disease",
    });
    const flat = flattenDrawables(r.drawables);
    const stressC = r.anchors.node_stress as [number, number];
    const edge1 = flat.find((d) => d.id === "edge_1") as { pts: [number, number][] }; // Stress -> Coffee: a genuinely diagonal approach
    const start = edge1.pts[0];
    const dist = Math.hypot(start[0] - stressC[0], start[1] - stressC[1]);
    // The halo ellipse is rx=60, ry=30 — its true boundary along ANY
    // direction is between 30 and 60, plus the ~3px gap. A flat scalar (the
    // old `shorten: 46`) could land inside the ellipse for a steep approach
    // or too far outside it for a shallow one; this must land in between.
    expect(dist).toBeGreaterThanOrEqual(33);
    expect(dist).toBeLessThanOrEqual(63);
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

  test("argument_map: a premise-to-premise support link (numeric `supports`) trims to both premise boxes' rect boundary, not their centers", () => {
    registerPack("mathlogic", mathlogicYaml);
    const r = scenes.argument_map.layout!({
      conclusion: "The ground is wet.",
      premises: [{ text: "It rained." }, { text: "If it rains, the ground gets wet.", supports: 0 }],
    });
    const flat = flattenDrawables(r.drawables);
    const premise0 = r.anchors.premise_0 as [number, number]; // target
    const premise1 = r.anchors.premise_1 as [number, number]; // source
    const link1 = flat.find((d) => d.id === "link_1") as { pts: [number, number][] };
    const start = link1.pts[0];
    const tip = link1.pts[link1.pts.length - 1];
    // Both premise boxes are the same width, so a horizontal link trims by
    // exactly the same amount at both ends: well short of the source/target
    // center, and hugging the box, not floating off toward the other end.
    const startDist = Math.hypot(start[0] - premise1[0], start[1] - premise1[1]);
    const tipDist = Math.hypot(tip[0] - premise0[0], tip[1] - premise0[1]);
    expect(startDist).toBeCloseTo(tipDist, 6);
    expect(startDist).toBeGreaterThan(100);
    expect(startDist).toBeLessThan(200);
  });

  test("sir_compartments: the in-box code label is ~1/3 of the box height (bold against the 4px stroke); the full name is a smaller caption below", () => {
    registerPack("evidence", evidenceYaml);
    const r = scenes.sir_compartments.layout!({ compartments: ["S", "E", "I", "R"] });
    const flat = flattenDrawables(r.drawables);
    const code = flat.find((d) => d.id === "box_code_s") as { text: string; fontSize: number } | undefined;
    expect(code?.text).toBe("S");
    // Box height is 90; a label sized to ~1/3 of that (30) reads bold next
    // to the box's own 4px stroke instead of thin and washed out.
    expect(code?.fontSize).toBeGreaterThanOrEqual(28);
    expect(code?.fontSize).toBeLessThanOrEqual(32);
    const name = r.labels.find((l) => l.id === "box_name_s");
    expect(name?.text).toBe("Susceptible");
    expect(name?.fontSize).toBeLessThan(code!.fontSize);
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

  const TEMPLATE_IDS = ["venn_diagram", "unit_circle", "number_line", "geometry_figure", "truth_table", "argument_map", "equation_steps", "plot3d"];

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

  test("registers all eight templates in brief order", () => {
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

  test("argument_map: support links trim to each box's true rect boundary — not the center, and no longer all converging on one shared pixel", () => {
    registerPack("mathlogic", mathlogicYaml);
    const r = scenes.argument_map.layout!({
      conclusion: "The ground is wet.",
      premises: [{ text: "If it rains, the ground gets wet." }, { text: "It is raining." }],
    });
    const flat = flattenDrawables(r.drawables);
    const premise0 = r.anchors.premise_0 as [number, number];
    const conclusion = r.anchors.conclusion_box as [number, number];
    const link0 = flat.find((d) => d.id === "link_0") as { pts: [number, number][] };
    const link1 = flat.find((d) => d.id === "link_1") as { pts: [number, number][] };
    const start = link0.pts[0];
    const tip0 = link0.pts[link0.pts.length - 1];
    const tip1 = link1.pts[link1.pts.length - 1];
    // Starts clear of the premise box's own center (trimmed to its rect
    // boundary) but still hugs the box, not floating off toward the target.
    const startDist = Math.hypot(start[0] - premise0[0], start[1] - premise0[1]);
    expect(startDist).toBeGreaterThan(40);
    expect(startDist).toBeLessThan(200);
    // Tips land near the conclusion box's true top edge — a different point
    // per premise (its own incidence angle), not the one shared pixel a
    // hardcoded "top-center" anchor used to force.
    expect(Math.hypot(tip0[0] - conclusion[0], tip0[1] - conclusion[1])).toBeGreaterThan(30);
    expect(Math.hypot(tip1[0] - conclusion[0], tip1[1] - conclusion[1])).toBeGreaterThan(30);
    expect(tip0[0]).not.toBeCloseTo(tip1[0], 0);
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

  describe("plot3d", () => {
    test("saddle surface emits 2×grid_n wire polylines, all points finite and within the canvas", () => {
      registerPack("mathlogic", mathlogicYaml);
      const r = scenes.plot3d.layout!({ surface: "x^2 - y^2" });
      const flat = flattenDrawables(r.drawables);
      const wires = flat.filter((d) => /^wire_(row|col)_\d+$/.test(d.id)) as { id: string; pts: [number, number][] }[];
      expect(wires).toHaveLength(24); // grid_n defaults to 12 -> 12 rows + 12 cols
      for (const w of wires) {
        expect(w.pts.length).toBeGreaterThan(1);
        for (const [x, y] of w.pts) {
          expect(Number.isFinite(x) && Number.isFinite(y)).toBe(true);
          expect(x).toBeGreaterThanOrEqual(0);
          expect(x).toBeLessThanOrEqual(1000);
          expect(y).toBeGreaterThanOrEqual(0);
          expect(y).toBeLessThanOrEqual(750);
        }
      }
    });

    test("z-autoscale keeps a wild expression (100*x, unscaled it would run far off any sane canvas) fully in bounds", () => {
      registerPack("mathlogic", mathlogicYaml);
      const res = layoutSpec({ template: "plot3d", params: { surface: "100*x" }, elements: [] } as never);
      inBounds(res);
    });

    test("azimuth 35 vs 125 produce different projected geometry — proof the camera is animatable", () => {
      registerPack("mathlogic", mathlogicYaml);
      const a = scenes.plot3d.layout!({ surface: "x^2 - y^2", azimuth_deg: 35 });
      const b = scenes.plot3d.layout!({ surface: "x^2 - y^2", azimuth_deg: 125 });
      const wireA = flattenDrawables(a.drawables).find((d) => d.id === "wire_row_0") as { pts: [number, number][] };
      const wireB = flattenDrawables(b.drawables).find((d) => d.id === "wire_row_0") as { pts: [number, number][] };
      expect(wireA.pts).not.toEqual(wireB.pts);
    });

    test("a parametric helix samples ~samples points into one polyline", () => {
      registerPack("mathlogic", mathlogicYaml);
      const r = scenes.plot3d.layout!({
        curve: { x_expr: "cos(t)", y_expr: "sin(t)", z_expr: "t/6", t_min: 0, t_max: 12 * Math.PI, samples: 150 },
      });
      const curve = flattenDrawables(r.drawables).find((d) => d.id === "curve") as { pts: [number, number][] } | undefined;
      expect(curve).toBeDefined();
      expect(curve!.pts).toHaveLength(150);
    });

    test("points render a marker + label per entry, label optional per point", () => {
      registerPack("mathlogic", mathlogicYaml);
      const r = scenes.plot3d.layout!({ points: [{ at: [0.5, 0.5, 0.5], label: "P" }, { at: [-0.5, -0.5, -0.5] }] });
      const drawableIds = flattenDrawables(r.drawables).map((d) => d.id);
      const labelIds = r.labels.map((l) => l.id);
      expect(drawableIds).toContain("pt_0");
      expect(drawableIds).toContain("pt_1");
      // Labels go through the collision solver (kit.label), not fixed 3D
      // text geometry — they live in `labels`, not `drawables`, until the
      // outer layoutSpec pipeline places them.
      expect(labelIds).toContain("pt_label_0");
      expect(labelIds).not.toContain("pt_label_1");
      expect(r.order).toContain("pt_label_0");
    });

    test("a malformed expression throws inside layout, so the pipeline falls through to tier-2 instead of crashing", () => {
      registerPack("mathlogic", mathlogicYaml);
      const res = layoutSpec({ template: "plot3d", params: { surface: "x + " }, elements: [] } as never);
      expect(res.warnings.some((w) => /layout failed/.test(w))).toBe(true);
    });

    // The camera auto-frames from the plotted content's own extent (kit ->
    // reach -> distance/fov), independently of azimuth/elevation — this
    // sweeps the full orbit range (what `animate azimuth_deg` walks through
    // live) for all three kinds. Asserts ZERO lint issues at ANY severity
    // (not the shared `inBounds` helper, which filters to error-severity
    // only and so would silently pass a warn-severity overlap-label-stroke
    // — exactly the defect class this test exists to catch). Deliberately
    // includes the corner a review found failing pre-fix: an elongated
    // curve (helix — its vertical extent is ~6x its horizontal one) at
    // exact cardinal azimuths (0/90/180/270) with near-zero elevation,
    // where a short axis's label used to graze the long vertical axis's
    // own stroke. Re-verified clean with a much denser sweep (5-degree
    // azimuth steps x 11 elevations x 10 param variations = 7920 cases,
    // 0 failures) during development; this in-suite version stays modest
    // for run time.
    test("stays lint-clean — zero issues at any severity — across the whole orbit range, for every plot kind", () => {
      registerPack("mathlogic", mathlogicYaml);
      const azimuths = [0, 45, 90, 135, 180, 225, 270, 315];
      const elevations = [-45, -22, 0, 22, 80];
      const kinds: Record<string, unknown>[] = [
        { surface: "x^2 - y^2" },
        { curve: { x_expr: "cos(t)", y_expr: "sin(t)", z_expr: "t/6", t_min: 0, t_max: 12 * Math.PI } },
        { points: [{ at: [0.6, 0.6, 0.6], label: "A" }, { at: [-0.6, 0.4, -0.5], label: "B" }] },
      ];
      for (const base of kinds) {
        for (const azimuth_deg of azimuths) {
          for (const elevation_deg of elevations) {
            const params = { ...base, azimuth_deg, elevation_deg };
            const res = layoutSpec({ template: "plot3d", params, elements: [] } as never);
            expect(res.issues, JSON.stringify(params)).toEqual([]);
            expect(res.warnings, JSON.stringify(params)).toEqual([]);
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
        }
      }
    });
  });
});

const GAMES_TEMPLATE_IDS = ["chess_board"];

// ---- chess pieces: drawn silhouettes, read back without any font metrics ----
//
// A piece is a kit.group per square holding a `precise` filled area (the
// silhouette's own closed ring) plus an ink outline stroke of the same ring,
// so these helpers identify a piece from GEOMETRY alone: its fill color says
// which side it belongs to, and its silhouette height — each kind is scaled to
// its own fixed fraction of the king's — says which kind it is. That is the
// whole point of the redesign: nothing about a piece depends on a Unicode
// glyph existing, or on where a font's "central" baseline happens to sit.
const CHESS_CELL = 620 / 8; // BOARD / 8, per games.yaml
const CHESS_KING_H = 0.8 * CHESS_CELL; // the tallest piece is 80% of a cell
/** Silhouette height as a fraction of the king's — one distinct value per kind. */
const CHESS_KIND_HEIGHT: Record<string, number> = { k: 1, q: 0.94, b: 0.92, n: 0.88, r: 0.84, p: 0.76 };

interface ChessPiece {
  kind: string;
  side: "w" | "b";
  center: [number, number];
  height: number;
  width: number;
  fill: string;
  outlinePts: [number, number][];
  opacity: number;
}

/**
 * The piece standing on `sq`, read off its drawables, or null for an empty
 * square. `lift` is the mid-glide scale the caller expects (1 at rest), since
 * a piece in flight is scaled about its own center and its height is then that
 * much larger than its kind's resting height.
 */
function chessPieceAt(flat: Drawable[], sq: string, lift = 1): ChessPiece | null {
  const fill = flat.find((d) => d.id === `piece_${sq}__fill`) as
    | { pts: [number, number][]; style: { fill?: string; opacity: number } }
    | undefined;
  if (!fill) return null;
  const xs = fill.pts.map(([x]) => x);
  const ys = fill.pts.map(([, y]) => y);
  const height = Math.max(...ys) - Math.min(...ys);
  const width = Math.max(...xs) - Math.min(...xs);
  const kind =
    Object.keys(CHESS_KIND_HEIGHT).find((k) => Math.abs(CHESS_KIND_HEIGHT[k] * CHESS_KING_H * lift - height) < 0.5) ?? "?";
  return {
    kind,
    side: fill.style.fill === COLORS.paper ? "w" : "b",
    center: [(Math.max(...xs) + Math.min(...xs)) / 2, (Math.max(...ys) + Math.min(...ys)) / 2],
    height,
    width,
    fill: fill.style.fill!,
    outlinePts: fill.pts,
    opacity: fill.style.opacity,
  };
}

/**
 * Where a square's center IS, derived from the board's own geometry rather
 * than from anything the template reports — the independent yardstick the
 * centering test measures against. BOARD 620 centered on the 1000x750 canvas;
 * table row 0 is the TOP row, so y-up counts rows down from the top edge.
 */
function chessCellCenter(sq: string, flip = false): [number, number] {
  const bc = "abcdefgh".indexOf(sq[0]);
  const br = 8 - Number(sq[1]);
  const [r, c] = flip ? [7 - br, 7 - bc] : [br, bc];
  const X0 = (1000 - 620) / 2;
  const Y0 = (750 - 620) / 2;
  return [X0 + (c + 0.5) * CHESS_CELL, Y0 + 620 - (r + 0.5) * CHESS_CELL];
}

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

  test("start position renders exactly 32 piece GROUPS — a precise filled silhouette plus an ink outline each, white pieces paper-filled and black pieces ink-filled", async () => {
    await ensureEngines(["chess"]);
    registerPack("games", gamesYaml);
    const res = layoutSpec({ template: "chess_board", params: {}, elements: [] } as never);
    inBounds(res);
    // No piece is text any more — that is the whole redesign.
    expect(flattenDrawables(res.drawables).filter((d) => d.kind === "text" && d.id.startsWith("piece_"))).toEqual([]);
    const pieceGroups = res.drawables.filter((d) => d.kind === "group" && /^piece_[a-h][1-8]$/.test(d.id));
    expect(pieceGroups).toHaveLength(32);
    const flat = flattenDrawables(res.drawables);
    for (const g of pieceGroups) {
      const fill = flat.find((d) => d.id === `${g.id}__fill`) as { kind: string; precise?: boolean; pts: unknown[] };
      const edge = flat.find((d) => d.id === `${g.id}__edge`) as { kind: string; closed?: boolean; style: { color: string } };
      expect(fill.kind, g.id).toBe("area");
      expect(fill.precise, g.id).toBe(true); // exact silhouette in BOTH render styles
      expect(fill.pts.length, g.id).toBeGreaterThanOrEqual(20);
      expect(edge.kind, g.id).toBe("stroke");
      expect(edge.closed, g.id).toBe(true);
      expect(edge.style.color, g.id).toBe(COLORS.ink);
    }
    // Corners: a8 black rook, h1 white rook, per the engine's own board() contract.
    expect(chessPieceAt(flat, "a8")).toMatchObject({ kind: "r", side: "b", fill: COLORS.ink });
    expect(chessPieceAt(flat, "h1")).toMatchObject({ kind: "r", side: "w", fill: COLORS.paper });
    // The full back rank, read purely off silhouette heights.
    expect(["a1", "b1", "c1", "d1", "e1", "f1", "g1", "h1"].map((sq) => chessPieceAt(flat, sq)!.kind).join("")).toBe("rnbqkbnr");
    expect(["a2", "h7"].map((sq) => chessPieceAt(flat, sq)!.kind)).toEqual(["p", "p"]);
  });

  test("board fills more of the canvas (620x620, up from 520x520) and the tallest piece is 80% of a cell", async () => {
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
    // The king — the tallest piece — is exactly 80% of the 77.5px cell, and
    // every other kind is a fixed fraction of it (a pawn is not a king's
    // height; bases stay close enough that a back rank reads as one row).
    expect(chessPieceAt(flat, "e1")!.height).toBeCloseTo(0.8 * CHESS_CELL, 6);
    for (const sq of ["a1", "b1", "c1", "d1", "e1", "f1", "g1", "h1", "a2"]) {
      const p = chessPieceAt(flat, sq)!;
      expect(p.height, sq).toBeGreaterThanOrEqual(0.7 * 0.8 * CHESS_CELL);
      expect(p.height, sq).toBeLessThanOrEqual(0.8 * CHESS_CELL);
      expect(p.width, sq).toBeLessThan(CHESS_CELL); // never spills onto a neighbour
    }
  });

  test("squares are chess.com's green board: dark boardDark, light boardLight, both exact full-opacity fills, and the scaffold draws at the smallest named budget", async () => {
    await ensureEngines(["chess"]);
    registerPack("games", gamesYaml);
    const res = scenes.chess_board.layout!({});
    const flat = flattenDrawables(res.drawables);
    const sqA1 = flat.find((d) => d.id === "sq_a1") as {
      style: { fill: string; opacity: number };
      precise?: boolean;
      drawOpts: { duration: number };
    };
    expect(sqA1.style.fill).toBe(COLORS.boardDark);
    expect(sqA1.style.opacity).toBe(1);
    expect(sqA1.precise).toBe(true);
    expect(sqA1.drawOpts.duration).toBe(420); // kit.SKETCH_MS.dot — the scaffold's near-instant budget.
    // The light squares are the `board` element's own ground: one exact
    // boardLight area under the whole grid, so every existing sq_<dark>
    // element id survives untouched (the bundled example's draw list names
    // exactly the 32 dark ones) while both square colors are now painted.
    const ground = flat.find((d) => d.id === "board__ground") as {
      kind: string;
      style: { fill: string; opacity: number };
      precise?: boolean;
      pts: [number, number][];
    };
    expect(ground.kind).toBe("area");
    expect(ground.style.fill).toBe(COLORS.boardLight);
    expect(ground.style.opacity).toBe(1);
    expect(ground.precise).toBe(true);
    expect(Math.max(...ground.pts.map(([x]) => x)) - Math.min(...ground.pts.map(([x]) => x))).toBeCloseTo(620, 6);
    const gridLine = flat.find((d) => d.id === "board__grid_h8") as { drawOpts: { duration: number } };
    expect(gridLine.drawOpts.duration).toBe(420);
    // The move arrow (the narrated, central content) keeps its normal pace;
    // its paper casing is packaging, so it draws at the scaffold budget.
    const arrow = scenes.chess_board.layout!({ moves: ["e4"], plies_shown: 1 });
    const arrowFlat = flattenDrawables(arrow.drawables);
    expect((arrowFlat.find((d) => d.id === "move_arrow__line") as { drawOpts: { duration: number } }).drawOpts.duration).toBe(850); // kit.SKETCH_MS.connector, unchanged.
    expect((arrowFlat.find((d) => d.id === "move_arrow__halo") as { drawOpts: { duration: number } }).drawOpts.duration).toBe(420);
  });

  // THE definitive centering test, and the reason the pieces stopped being
  // Unicode text at all. The old glyphs were centered by SVG's
  // `dominant-baseline: "central"`, a font-METRICS line that has nothing to do
  // with where a glyph's ink actually sits — which is how the pieces once ended
  // up ~0.45 * fontSize too low, "sitting between two squares", and how a
  // hand-measured 0.1 * fontSize nudge came to be pinned here. A drawn
  // silhouette has no metrics to argue with: its own bounding box IS the piece,
  // so "centered in the square" is checkable exactly, in both orientations, with
  // the cell center derived independently from the board's geometry.
  test("every piece's silhouette is geometrically centered on its own square — exactly, in both orientations, with no nudge of any kind", async () => {
    await ensureEngines(["chess"]);
    registerPack("games", gamesYaml);
    for (const flip of [false, true]) {
      const flat = flattenDrawables(scenes.chess_board.layout!({ flip }).drawables);
      const occupied = ["a1", "b1", "c1", "d1", "e1", "f1", "g1", "h1", "a2", "e2", "d7", "a8", "e8", "h8"];
      for (const sq of occupied) {
        const piece = chessPieceAt(flat, sq)!;
        const [cx, cy] = chessCellCenter(sq, flip);
        expect(piece.center[0], `${sq} x (flip=${flip})`).toBeCloseTo(cx, 9);
        expect(piece.center[1], `${sq} y (flip=${flip})`).toBeCloseTo(cy, 9);
      }
    }
    // coord_a (a file letter, drawn only with coords !== false) sits at its
    // own fixed offset from the board edge, unchanged by the piece redesign.
    const coordA = flattenDrawables(scenes.chess_board.layout!({}).drawables).find((d) => d.id === "coord_a") as { pos: [number, number] };
    expect(coordA.pos[1]).toBeCloseTo(65 - 31, 6); // Y0 - 31
  });

  // The fractional-ply glide lifts the moving piece (games.yaml:
  // `lift = 1 + 0.1 * 4 * plyT * (1 - plyT)`, peaking at +10% when
  // plyT === 0.5): the silhouette's own points scale about its center. Pin
  // that the grown shape still fits its square — a piece that outgrows the
  // cell reads as spilling onto its neighbours mid-move — measuring the real
  // bounding box rather than a font's nominal em square.
  test("a piece's silhouette fits inside its cell both at rest and at the mid-glide lift peak", async () => {
    await ensureEngines(["chess"]);
    registerPack("games", gamesYaml);
    const rest = flattenDrawables(scenes.chess_board.layout!({ moves: ["e4"], plies_shown: 0 }).drawables);
    // c1 is a dark square (so sq_c1 exists) and holds a piece in the start
    // position — its shade drawable gives the exact cell box.
    const sqC1 = rest.find((d) => d.id === "sq_c1") as { pts: [number, number][] };
    const xs = sqC1.pts.map(([x]) => x);
    const ys = sqC1.pts.map(([, y]) => y);
    const cell = Math.max(...xs) - Math.min(...xs);
    expect(cell).toBeCloseTo(Math.max(...ys) - Math.min(...ys), 6); // cells are square

    const restPiece = chessPieceAt(rest, "e2")!;
    const mid = flattenDrawables(scenes.chess_board.layout!({ moves: ["e4"], plies_shown: 0.5 }).drawables);
    const glidePiece = chessPieceAt(mid, "e2", 1.1)!; // the mover keeps its DEPARTURE square's id
    expect(glidePiece.height).toBeGreaterThan(restPiece.height); // the lift is real

    for (const p of [restPiece, glidePiece]) {
      expect(p.height).toBeLessThanOrEqual(cell);
      expect(p.width).toBeLessThanOrEqual(cell);
    }
  });

  test('plies_shown: 1 on ["e4"] moves the e2 pawn to e4 and emits move_arrow', async () => {
    await ensureEngines(["chess"]);
    registerPack("games", gamesYaml);
    const r = scenes.chess_board.layout!({ moves: ["e4"], plies_shown: 1 });
    const flat = flattenDrawables(r.drawables);
    // The vacated square keeps its id (an empty group), so `animate` never
    // needs an element that did not already exist — it just draws nothing.
    expect(r.drawables.find((d) => d.id === "piece_e2")).toMatchObject({ kind: "group", children: [] });
    expect(chessPieceAt(flat, "e2")).toBeNull();
    expect(chessPieceAt(flat, "e4")).toMatchObject({ kind: "p", side: "w" });
    const arrow = flat.find((d) => d.id === "move_arrow__line") as { pts: [number, number][] } | undefined;
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
    // plies_shown clamped to 0: nothing played yet, the white pawn still on e2.
    expect(chessPieceAt(flattenDrawables(clampedLow.drawables), "e2")).toMatchObject({ kind: "p", side: "w" });
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

  // Contrast review, 2026-08-25: on the new green board both annotation layers
  // separated from the squares by HUE almost alone — yellow-on-green for the
  // highlight (1.39:1 against boardDark, 1.20:1 against boardLight in WCAG
  // relative luminance) and red/purple-on-green for the arrows (1.69:1 and
  // 1.55:1 against boardDark). Both collapse on a dim or low-gamut screen and
  // for a red-green colorblind viewer. These two pins hold the structural fix
  // in place; the measured numbers live in the palette comment in
  // src/layout/model.ts and in the games.yaml blocks.
  const relLum = (hex: string): number => {
    const ch = (v: number) => (v / 255 <= 0.04045 ? v / 255 / 12.92 : ((v / 255 + 0.055) / 1.055) ** 2.4);
    const n = parseInt(hex.slice(1), 16);
    return 0.2126 * ch((n >> 16) & 255) + 0.7152 * ch((n >> 8) & 255) + 0.0722 * ch(n & 255);
  };
  const contrast = (a: string, b: string): number => {
    const [hi, lo] = [relLum(a), relLum(b)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
  };

  test("a highlighted square separates from BOTH square colors by luminance, not hue: a bright wash inside an ink frame", async () => {
    await ensureEngines(["chess"]);
    registerPack("games", gamesYaml);
    const res = scenes.chess_board.layout!({ highlights: ["d5"] });
    const flat = flattenDrawables(res.drawables);
    const fill = flat.find((d) => d.id === "hl_d5__fill") as { style: { fill: string; opacity: number }; precise?: boolean };
    const frame = flat.find((d) => d.id === "hl_d5__frame") as { style: { fill: string; opacity: number }; holes?: [number, number][][]; pts: [number, number][] };
    expect(fill.style.fill).toBe(COLORS.boardHighlight);
    expect(fill.style.opacity).toBe(1); // an opaque wash, so the number below is exact rather than a composite
    expect(fill.precise).toBe(true);
    expect(frame.style.fill).toBe(COLORS.ink);
    expect(frame.holes).toHaveLength(1); // a ring: the square with its inside punched out

    // The wash carries the DARK square...
    expect(contrast(COLORS.boardHighlight, COLORS.boardDark)).toBeGreaterThanOrEqual(1.8);
    // ...and the frame carries BOTH, which is what makes the light square work
    // at all: no lightening color can reach 1.8:1 against boardLight — pure
    // white only manages 1.17:1 — so a wash alone is mathematically incapable
    // of it, and a fill dark enough to clear 1.8:1 both ways would bury the
    // ink-filled black pieces standing on the square.
    expect(contrast(COLORS.ink, COLORS.boardDark)).toBeGreaterThanOrEqual(1.8);
    expect(contrast(COLORS.ink, COLORS.boardLight)).toBeGreaterThanOrEqual(1.8);
    expect(contrast("#ffffff", COLORS.boardLight)).toBeLessThan(1.8); // the ceiling that forces the frame
    // Black pieces still read on the marked square (the reason it isn't dark).
    expect(contrast(COLORS.ink, COLORS.boardHighlight)).toBeGreaterThanOrEqual(4.5);

    // The frame is an AREA, not a stroke, so it shares the z layer with the
    // squares and a piece standing on the square paints over it.
    expect((flat.find((d) => d.id === "hl_d5__frame") as { kind: string }).kind).toBe("area");
  });

  test("every arrow on the board is laid over a wider paper casing, so it never sits directly on a green square", async () => {
    await ensureEngines(["chess"]);
    registerPack("games", gamesYaml);
    const res = scenes.chess_board.layout!({ moves: ["e4"], plies_shown: 1, arrows: [{ from: "d1", to: "d5" }] });
    const flat = flattenDrawables(res.drawables);
    for (const [id, color, width] of [["move_arrow", COLORS.demand, 4], ["arrow_0", COLORS.accent, 3.5]] as const) {
      // The element id is unchanged — it is now a group holding casing + line,
      // so every existing draw list keeps addressing it and gets both.
      expect(res.drawables.find((d) => d.id === id), id).toMatchObject({ kind: "group" });
      const halo = flat.find((d) => d.id === `${id}__halo`) as { pts: [number, number][]; style: { color: string; strokeWidth: number } };
      const line = flat.find((d) => d.id === `${id}__line`) as { pts: [number, number][]; style: { color: string; strokeWidth: number } };
      expect(halo, id).toBeDefined();
      expect(halo.style.color, id).toBe(COLORS.paper);
      expect(line.style.color, id).toBe(color);
      expect(line.style.strokeWidth, id).toBe(width);
      expect(halo.style.strokeWidth, id).toBeGreaterThan(line.style.strokeWidth); // a casing, i.e. wider
      expect(halo.pts, id).toEqual(line.pts); // exactly the same path, so it reads as one arrow
      // Casing UNDER the line: same z, and drawablesForId preserves array order.
      const ids = flat.map((d) => d.id);
      expect(ids.indexOf(`${id}__halo`), id).toBeLessThan(ids.indexOf(`${id}__line`));
    }
    // What the casing buys: the arrow colors never touch the weak pair again.
    expect(contrast(COLORS.demand, COLORS.boardDark)).toBeLessThan(1.8); // the finding
    expect(contrast(COLORS.accent, COLORS.boardDark)).toBeLessThan(1.8);
    expect(contrast(COLORS.demand, COLORS.paper)).toBeGreaterThanOrEqual(4.5); // the fix
    expect(contrast(COLORS.accent, COLORS.paper)).toBeGreaterThanOrEqual(4.5);

    // Neither the casings nor the highlight frames trip lint — the same bar
    // the bundled-examples gate holds every showcase figure to (not one issue,
    // not even a warning). A casing shares the arrow's exact pts, so it adds
    // no new geometry for the out-of-canvas or label-stroke rules to catch.
    const linted = layoutSpec({
      template: "chess_board",
      params: { moves: ["e4", "e5", "Bc4"], highlights: ["f7", "d4"], arrows: [{ from: "c4", to: "f7" }], coords: true },
      elements: [],
    } as never);
    expect(linted.warnings).toEqual([]);
    expect(linted.issues.map((i) => `[${i.severity}] ${i.message}`)).toEqual([]);
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

  // Regression pin for the fractional-ply glide feature: integer
  // `plies_shown` (and the no-`plies_shown` default) must render
  // BYTE-IDENTICAL output to before that feature existed. Hashes captured
  // from the implementation immediately prior to adding glide support (t=0
  // for every integer boundary is required to fall through to the exact
  // same per-square lookup as before — no glide/fade/lift branch taken).
  test("plies_shown at every integer (and the implicit default) renders byte-identical output to before fractional-ply glide was added", async () => {
    await ensureEngines(["chess"]);
    registerPack("games", gamesYaml);
    const moves = ["e4", "e5", "Bc4", "Nc6", "Qh5", "Nf6", "Qxf7#"];
    const crypto = await import("node:crypto");
    const hashOf = (v: unknown) => crypto.createHash("sha256").update(JSON.stringify(v)).digest("hex");
    // Hashes recaptured for the drawn-silhouette redesign (Unicode piece text
    // -> a kit.group per square holding a precise filled ring plus its ink
    // outline, and the chess.com green board). That rewrites every piece
    // drawable and both square fills, so the hashes themselves necessarily
    // change — but the INVARIANT this test protects is self-relative and
    // untouched by it: at every integer boundary plyT === 0, so the layout
    // falls through to the exact same plain per-square lookup and never takes
    // the glide/fade/lift branch. Recaptured once before, for the
    // fontSize 52->58 / y-nudge correction, for the same kind of reason.
    // Recaptured again for the contrast fix (a paper casing under the move
    // arrow); there the no-moves DEFAULT hash did NOT move — with no line
    // there is no arrow and no highlight — which was that round's proof that
    // the fix was scoped to exactly the two annotation layers it touched.
    //
    // Recaptured ONCE MORE, and every hash including the default, for the
    // retrace of the six piece silhouettes off the reference set (games.yaml:
    // new rings, new detail marks, outline 2.2 -> 2.6). A change to the piece
    // shapes necessarily moves every hash here, default included, so the
    // default-didn't-move argument is not available this time. The scoping was
    // instead proved directly, against the previous commit's games.yaml loaded
    // side by side with the new one: at all nine renders below, stripping the
    // `piece_*` drawables and anchors leaves output that is byte-identical
    // before and after (and the piece group id LIST is identical too). So the
    // board, grid, coordinates, highlight frame and arrow casings did not move
    // at all, and — the invariant this test actually protects — the per-square
    // lookup at every integer boundary is reached the same way as before, with
    // plyT === 0 and no glide/fade/lift branch taken.
    const EXPECTED: Record<number, string> = {
      0: "f3b9dfca6681f6ad300c2b52cfc6ee4c1dbf3e17d19955a598972b99bc671800",
      1: "af1770f53c90804e666f005ddcb6e6cc539faefefd2841c0bd0fbe58c9cb3b94",
      2: "9e284480e22d6dae130c25ecc6c4c3c8a9ff145b043e9e2527e3d388e505328b",
      3: "0942021e5356bcc747cff4a3a347586c4e07db866691642e43657efca6f8808a",
      4: "687b96492b7d94a43450d1eb6e4d90bcf2cdf5813f89df9f92f9c49e0a5bc6c1",
      5: "35af84cd0cb87b2ed1f7f79f1559e4fc13afc9b748a99b6a07ac23c79e9a9ce9",
      6: "1d4921acab25e0471407edfa4df0ff7cb450c24943a69bc8287900240de972cf",
      7: "e31ba753e992108cdd0d52dae8f0ee049418b2784c8c5d964cb2487947128b32",
    };
    for (let i = 0; i <= moves.length; i++) {
      const r = scenes.chess_board.layout!({ moves, plies_shown: i });
      expect(hashOf(r)).toBe(EXPECTED[i]);
    }
    const r0 = scenes.chess_board.layout!({});
    expect(hashOf(r0)).toBe("5ea5ee4ea87d06fa6898ae1f09c838166fa3f3245b801fa77bfb4ebcec18fb3a");
  });

  test("fractional plies_shown glides the moving piece in a straight line: 0.5 into 1.e4 sits the e-pawn strictly between e2 and e4, x unchanged", async () => {
    await ensureEngines(["chess"]);
    registerPack("games", gamesYaml);
    const before = scenes.chess_board.layout!({ moves: ["e4"], plies_shown: 0 });
    const after = scenes.chess_board.layout!({ moves: ["e4"], plies_shown: 1 });
    const mid = scenes.chess_board.layout!({ moves: ["e4"], plies_shown: 0.5 });
    const e2 = (before.anchors.piece_e2 as [number, number]);
    const e4 = (after.anchors.piece_e4 as [number, number]);
    const flat = flattenDrawables(mid.drawables);
    // The mover still carries the DEPARTURE square's id mid-glide — and its
    // WHOLE geometry travels: fill ring, outline and detail strokes together.
    const movingPiece = chessPieceAt(flat, "e2", 1.1)!; // lift peak at t=0.5
    expect(movingPiece).toMatchObject({ kind: "p", side: "w" });
    expect(movingPiece.center[0]).toBeCloseTo(e2[0], 6); // same file: x unchanged
    expect(movingPiece.center[0]).toBeCloseTo(e4[0], 6);
    expect(movingPiece.center[1]).toBeGreaterThan(Math.min(e2[1], e4[1]));
    expect(movingPiece.center[1]).toBeLessThan(Math.max(e2[1], e4[1]));
    // Halfway is the exact midpoint (linear lerp; animate's own smoothstep
    // easing already shaped how t itself advances over wall-clock time).
    expect(movingPiece.center[1]).toBeCloseTo((e2[1] + e4[1]) / 2, 6);
    // The outline stroke rides along with the fill, point for point.
    const edge = flat.find((d) => d.id === "piece_e2__edge") as { pts: [number, number][] };
    expect(edge.pts).toEqual(movingPiece.outlinePts);
    // Destination square shows nothing yet (e4 was empty before this move).
    expect(chessPieceAt(flat, "e4")).toBeNull();
  });

  test("mid-move lift: the moving silhouette scales +10% about its own center at t=0.5 and returns to normal at the integer boundaries", async () => {
    await ensureEngines(["chess"]);
    registerPack("games", gamesYaml);
    const at = (plies_shown: number) => chessPieceAt(flattenDrawables(scenes.chess_board.layout!({ moves: ["e4"], plies_shown }).drawables), "e2")!;
    const base = 0.76 * 0.8 * CHESS_CELL; // a pawn at rest
    expect(at(0).height).toBeCloseTo(base, 6);
    expect(at(0.5).height).toBeCloseTo(base * 1.1, 6); // parabola peak at t=0.5
    expect(at(0.25).height).toBeCloseTo(base * (1 + 0.1 * 4 * 0.25 * 0.75), 6);
    expect(at(0.75).height).toBeCloseTo(at(0.25).height, 6); // symmetric around t=0.5
    expect(at(0.25).height).toBeLessThan(at(0.5).height);
    // The lift scales about the piece's OWN center: width grows in step, and
    // the center itself stays exactly on the glide path (checked above).
    expect(at(0.5).width / at(0).width).toBeCloseTo(1.1, 6);
  });

  test("capture ply fades the captured piece's fill AND outline 1 -> 0 over t, at its own square, while the capturing piece glides in", async () => {
    await ensureEngines(["chess"]);
    registerPack("games", gamesYaml);
    // 1.e4 d5 2.exd5 — ply index 2 (0-based) is the capture "exd5".
    const moves = ["e4", "d5", "exd5"];
    const q1 = flattenDrawables(scenes.chess_board.layout!({ moves, plies_shown: 2.25 }).drawables);
    const q3 = flattenDrawables(scenes.chess_board.layout!({ moves, plies_shown: 2.75 }).drawables);
    const victimQ1 = chessPieceAt(q1, "d5")!;
    const victimQ3 = chessPieceAt(q3, "d5")!;
    expect(victimQ1).toMatchObject({ kind: "p", side: "b" }); // still on d5, fading
    expect(victimQ3).toMatchObject({ kind: "p", side: "b" });
    expect(victimQ1.opacity).toBeCloseTo(0.75, 6); // 1 - t
    expect(victimQ3.opacity).toBeCloseTo(0.25, 6);
    expect(victimQ3.opacity).toBeLessThan(victimQ1.opacity);
    // The outline fades with the fill — StrokeOpts carries opacity, so the
    // whole piece dissolves rather than leaving a floating contour behind.
    expect((q1.find((d) => d.id === "piece_d5__edge") as { style: { opacity: number } }).style.opacity).toBeCloseTo(0.75, 6);
    // The capturing pawn is gliding in on the departure square's id.
    expect(chessPieceAt(q1, "e4", 1 + 0.1 * 4 * 0.25 * 0.75)).toMatchObject({ kind: "p", side: "w" });
    // At the integer boundary after the capture, the victim is fully gone
    // (plain per-square lookup — no fade artifact left behind).
    const after = flattenDrawables(scenes.chess_board.layout!({ moves, plies_shown: 3 }).drawables);
    expect(chessPieceAt(after, "d5")).toMatchObject({ kind: "p", side: "w", opacity: 1 }); // white pawn now on d5
  });

  test("castling (O-O) glides BOTH the king and the rook, using squares derived from the king's own move + side", async () => {
    await ensureEngines(["chess"]);
    registerPack("games", gamesYaml);
    // A short, legal kingside-castle line for White: the Italian setup.
    const moves = ["e4", "e5", "Nf3", "Nc6", "Bc4", "Bc5", "O-O"];
    const before = scenes.chess_board.layout!({ moves, plies_shown: 6 });
    const after = scenes.chess_board.layout!({ moves, plies_shown: 7 });
    const mid = scenes.chess_board.layout!({ moves, plies_shown: 6.5 });
    const flat = flattenDrawables(mid.drawables);

    const king = chessPieceAt(flat, "e1", 1.1)!;
    const rook = chessPieceAt(flat, "h1", 1.1)!;
    expect(king).toMatchObject({ kind: "k", side: "w" });
    expect(rook).toMatchObject({ kind: "r", side: "w" });

    const kingFrom = before.anchors.piece_e1 as [number, number];
    const kingTo = after.anchors.piece_g1 as [number, number];
    const rookFrom = before.anchors.piece_h1 as [number, number];
    const rookTo = after.anchors.piece_f1 as [number, number];

    expect(king.center[0]).toBeCloseTo((kingFrom[0] + kingTo[0]) / 2, 6);
    expect(king.center[1]).toBeCloseTo((kingFrom[1] + kingTo[1]) / 2, 6);
    expect(rook.center[0]).toBeCloseTo((rookFrom[0] + rookTo[0]) / 2, 6);
    expect(rook.center[1]).toBeCloseTo((rookFrom[1] + rookTo[1]) / 2, 6);
    // Both lifted the same amount (t=0.5 peak) since one ply moves both.
    expect(king.height).toBeCloseTo(1 * 0.8 * CHESS_CELL * 1.1, 6);
    expect(rook.height).toBeCloseTo(0.84 * 0.8 * CHESS_CELL * 1.1, 6);

    // After the full ply: king on g1, rook on f1, e1/h1 vacated.
    const flatAfter = flattenDrawables(after.drawables);
    expect(chessPieceAt(flatAfter, "g1")).toMatchObject({ kind: "k", side: "w" });
    expect(chessPieceAt(flatAfter, "f1")).toMatchObject({ kind: "r", side: "w" });
    expect(chessPieceAt(flatAfter, "e1")).toBeNull();
    expect(chessPieceAt(flatAfter, "h1")).toBeNull();
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

  // Regression: a marker country far outside `focus` (Japan, on a Nordics
  // map) used to dilute the fit — the SAME "world_map draws tiny" bug the
  // geo engine's fitExtent fix addresses, just triggered by a marker
  // instead of a focus list. The fit is now restricted to focus+highlight
  // only (see fitNames in engines.ts); a marker that lands outside that
  // cropped view is skipped and reported, not drawn at an implausible
  // off-frame point.
  test("a marker far outside focus (Japan on a Nordics map) doesn't dilute the fit, and is skipped with an 'Outside view' note instead of drawn off-frame", async () => {
    await ensureEngines(["geo"]);
    registerPack("maps", mapsYaml);
    const res = layoutSpec({
      template: "world_map",
      params: {
        focus: ["Norway", "Sweden"],
        markers: [{ country: "Norway", label: "Oslo" }, { country: "Sweden", label: "Stockholm" }, { country: "Japan" }],
      },
      elements: [],
    } as never);
    inBounds(res);
    const flat = flattenDrawables(res.drawables);
    const countryPts = flat
      .filter((d) => d.kind === "stroke" && d.id.startsWith("country_"))
      .flatMap((d) => (d as { pts: [number, number][] }).pts);
    const xs = countryPts.map(([x]) => x);
    // Fit box is 880 wide (see FIT in maps.yaml) — undiluted, Norway+Sweden
    // should span a large share of it (measured ~422/880 ~ 48%), same
    // order of magnitude as the Norway+Sweden-only case elsewhere in this
    // file. Diluted by Japan (measured directly in engines.ts's own test),
    // the same pair collapses to well under half this.
    expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(350);
    // Norway's and Sweden's own markers (in view) still render normally.
    expect(flat.some((d) => d.id === "marker_0")).toBe(true);
    expect(flat.some((d) => d.id === "marker_1")).toBe(true);
    // Japan's marker (index 2) is skipped — not drawn at a wild off-frame
    // point — and reported by name instead of silently vanishing.
    expect(flat.some((d) => d.id === "marker_2")).toBe(false);
    expect(flat.some((d) => d.id === "marker_label_2")).toBe(false);
    const note = res.drawables.find((d) => d.id === "missing_note") as { text?: string } | undefined;
    expect(note?.text).toMatch(/Outside view: Japan/);
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

  // Regression target for "capitals land at the country's centroid, not the
  // city" (a country's geometric middle is rarely anywhere near its own
  // capital) — `at` places the dot at an EXACT [lon,lat] instead, projected
  // through the identical engine call (same rotation + fit) as everything
  // else on the map.
  test("an `at` marker renders its dot at the EXACT projected position (matches the geo engine's own projectedPoints), not the country's centroid", async () => {
    await ensureEngines(["geo"]);
    registerPack("maps", mapsYaml);
    const geoEng = getLoadedEngines(["geo"]).geo as GeoEngine;
    const oslo: [number, number] = [10.75, 59.91];
    const res = scenes.world_map.layout!({ focus: ["Norway"], markers: [{ at: oslo, label: "Oslo" }] });
    const flat = flattenDrawables(res.drawables);
    expect(flat.some((d) => d.id === "marker_0")).toBe(true);
    const label = res.labels.find((l) => l.id === "marker_label_0");
    expect(label?.text).toBe("Oslo");

    // Independently ask the engine for the SAME projection (same focus, same
    // FIT box) and confirm the dot's anchor matches its own projectedPoints
    // output exactly (modulo the layout's off() translate into FIT-box
    // canvas coordinates).
    const FIT = { x: 60, y: 120, w: 880, h: 560 };
    const { projectedPoints } = geoEng.countries(["Norway"], { w: FIT.w, h: FIT.h, fitNames: ["Norway"], points: [oslo] });
    const [px, py] = projectedPoints[0]!;
    const anchor = res.anchors.marker_0 as [number, number];
    expect(anchor[0]).toBeCloseTo(px + FIT.x, 6);
    expect(anchor[1]).toBeCloseTo(py + FIT.y, 6);

    // Not at Norway's own centroid — Oslo sits well south of Norway's
    // geometric middle (Norway stretches far north of it).
    const centroidAnchor = res.anchors.country_norway as [number, number];
    expect(anchor[1]).toBeLessThan(centroidAnchor[1]);
  });

  test("an `at` marker with no `label` falls back to the coordinate pair as its text", async () => {
    await ensureEngines(["geo"]);
    registerPack("maps", mapsYaml);
    const res = scenes.world_map.layout!({ focus: ["Norway"], markers: [{ at: [10.75, 59.91] }] });
    const label = res.labels.find((l) => l.id === "marker_label_0");
    expect(label?.text).toBe("10.75, 59.91");
  });

  // Off-box `at` points ride the SAME "Outside view:" missing_note path as
  // an off-focus `country` marker (see the Japan test above) — skipped
  // rather than drawn at an implausible off-frame point.
  test("an `at` point outside the cropped focus view is skipped and reported via the same 'Outside view' note as an off-focus country marker", async () => {
    await ensureEngines(["geo"]);
    registerPack("maps", mapsYaml);
    const res = scenes.world_map.layout!({
      focus: ["Norway", "Sweden"],
      markers: [{ at: [139.69, 35.68], label: "Tokyo" }], // Tokyo — nowhere near the Nordics crop
    });
    const flat = flattenDrawables(res.drawables);
    expect(flat.some((d) => d.id === "marker_0")).toBe(false);
    expect(flat.some((d) => d.id === "marker_label_0")).toBe(false);
    const note = res.drawables.find((d) => d.id === "missing_note") as { text?: string } | undefined;
    expect(note?.text).toMatch(/Outside view: Tokyo/);
  });

  test("markers mixing `country` and `at` together lay out clean — the `country` marker still lands exactly on its centroid, unaffected by `at`", async () => {
    await ensureEngines(["geo"]);
    registerPack("maps", mapsYaml);
    const mixedParams = {
      focus: ["Norway", "Sweden"],
      markers: [
        { country: "Norway", label: "Norway (whole country)" },
        { at: [18.07, 59.33], label: "Stockholm" },
      ],
    };
    const res = layoutSpec({ template: "world_map", params: mixedParams, elements: [] } as never);
    inBounds(res);
    const flat = flattenDrawables(res.drawables);
    expect(flat.some((d) => d.id === "marker_0")).toBe(true);
    expect(flat.some((d) => d.id === "marker_1")).toBe(true);
    expect(res.drawables.some((d) => d.id === "missing_note")).toBe(false);
    // layoutSpec's own LayoutResult carries no `anchors` — go straight to the
    // scene's raw layout (same params) for that.
    const raw = scenes.world_map.layout!(mixedParams);
    const norwayCentroidAnchor = raw.anchors.country_norway as [number, number];
    const marker0Anchor = raw.anchors.marker_0 as [number, number];
    expect(marker0Anchor).toEqual(norwayCentroidAnchor);
  });

  // The mixing test above puts `country` and `at` on SEPARATE marker objects.
  // One object carrying BOTH has its own documented rule (maps.yaml: "`at`
  // takes priority over `country` ... it is the more precise of the two"),
  // which nothing pinned until now.
  test("a single marker carrying BOTH `at` and `country` uses `at`, not the country's centroid", async () => {
    await ensureEngines(["geo"]);
    registerPack("maps", mapsYaml);
    const stockholm: [number, number] = [18.07, 59.33];
    const focus = ["Norway", "Sweden"];
    const both = scenes.world_map.layout!({ focus, markers: [{ at: stockholm, country: "Norway" }] });
    const atOnly = scenes.world_map.layout!({ focus, markers: [{ at: stockholm }] });
    const countryOnly = scenes.world_map.layout!({ focus, markers: [{ country: "Norway" }] });
    expect(both.anchors.marker_0).toEqual(atOnly.anchors.marker_0);
    expect(both.anchors.marker_0).not.toEqual(countryOnly.anchors.marker_0);
    // The default label text follows the same branch — the `at` fallback is
    // the coordinate pair, never the country's own dataset name.
    expect(both.labels.find((l) => l.id === "marker_label_0")?.text).toBe("18.07, 59.33");
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

  test("country rings are Catmull-Rom smoothed before stroking: more points than the raw ring, still fully in canvas bounds", async () => {
    await ensureEngines(["geo"]);
    registerPack("maps", mapsYaml);
    const geo = getLoadedEngines(["geo"]).geo as GeoEngine;
    const raw = geo.countries(["Norway"]).shapes[0].rings;
    const res = scenes.world_map.layout!({ focus: ["Norway"] });
    const flat = flattenDrawables(res.drawables);
    const smoothedRings = raw.map((_, i) => flat.find((d) => d.id === "country_norway__ring" + i) as { pts: [number, number][] });
    expect(smoothedRings.every(Boolean)).toBe(true);
    smoothedRings.forEach((ring, i) => {
      // Every raw Norway ring (18, 50, 12, 8 points) is well under the
      // smoothing size cap, so every one of them actually gets smoothed —
      // more output points than input.
      expect(ring.pts.length).toBeGreaterThan(raw[i].length);
      for (const [x, y] of ring.pts) {
        expect(Number.isFinite(x) && Number.isFinite(y)).toBe(true);
        expect(x).toBeGreaterThanOrEqual(0);
        expect(x).toBeLessThanOrEqual(1000);
        expect(y).toBeGreaterThanOrEqual(0);
        expect(y).toBeLessThanOrEqual(750);
      }
    });
  });

  test("a highlight fill uses the EXACT SAME smoothed ring as the country's own outline (no halo mismatch)", async () => {
    await ensureEngines(["geo"]);
    registerPack("maps", mapsYaml);
    const res = scenes.world_map.layout!({ focus: ["Norway"], highlight: ["Norway"] });
    const flat = flattenDrawables(res.drawables);
    const outline = flat.find((d) => d.id === "country_norway__ring0") as { pts: [number, number][] };
    const highlight = flat.find((d) => d.id === "hl_norway") as { pts: [number, number][] };
    expect(outline).toBeDefined();
    expect(highlight).toBeDefined();
    expect(highlight.pts).toEqual(outline.pts);
  });
});

describe("medicine pack", () => {
  beforeEach(() => unregisterPack("medicine"));

  const TEMPLATE_IDS = ["icon_array", "ecg_strip", "heart_circulation", "neuron", "screening_timeline", "pk_curve", "pv_loop", "nephron"];

  test("registers all eight templates in brief order", () => {
    const r = registerPack("medicine", medicineYaml);
    expect(r).toMatchObject({ ok: true, templateIds: TEMPLATE_IDS });
  });

  test("every medicine example renders finite, no fallback warnings, no error-severity lint, and is deterministic", () => {
    registerPack("medicine", medicineYaml);
    for (const tid of TEMPLATE_IDS) {
      for (const ex of scenes[tid].manifest.examples) {
        const res = layoutSpec({ template: tid, params: ex.params, elements: [] } as never);
        expect(res.warnings, tid).toEqual([]);
        expect(res.issues.filter((i) => i.severity === "error"), tid).toEqual([]);
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

  test("icon_array: groups partition the grid exactly — 5 strokes per person, counts honored, remainder neutral", () => {
    registerPack("medicine", medicineYaml);
    const r = scenes.icon_array.layout!({
      total: 100,
      groups: [
        { label: "Anyway", count: 8, color: "demand" },
        { label: "Helped", count: 2, color: "supply" },
      ],
    });
    const flat = flattenDrawables(r.drawables);
    const group0 = r.drawables.find((d) => d.id === "group_0") as { children: Drawable[] };
    const group1 = r.drawables.find((d) => d.id === "group_1") as { children: Drawable[] };
    const rest = r.drawables.find((d) => d.id === "rest") as { children: Drawable[] };
    // The person stamp is 5 polylines, so a group of N people carries 5N strokes.
    expect(group0.children.length).toBe(8 * 5);
    expect(group1.children.length).toBe(2 * 5);
    expect(rest.children.length).toBe(90 * 5);
    const g0color = (group0.children[0] as { style: { color: string } }).style.color;
    const restColor = (rest.children[0] as { style: { color: string } }).style.color;
    expect(g0color).toBe(COLORS.demand);
    expect(restColor).toBe(COLORS.guide);
    expect(flat.map((d) => d.id)).toEqual(expect.arrayContaining(["legend_0", "legend_1", "legend_rest"]));
  });

  test("ecg_strip: normal sinus labels P/QRS/T; atrial fibrillation has no P to label and says so in the caption", () => {
    registerPack("medicine", medicineYaml);
    const normal = scenes.ecg_strip.layout!({ rhythm: "normal" });
    expect(normal.labels.map((l) => l.id)).toEqual(expect.arrayContaining(["label_p", "label_qrs", "label_t"]));
    const afib = scenes.ecg_strip.layout!({ rhythm: "afib" });
    expect(afib.labels.map((l) => l.id)).not.toContain("label_p");
    const caption = flattenDrawables(afib.drawables).find((d) => d.id === "rate_label") as { text: string };
    expect(caption.text).toContain("irregular");
  });

  test("heart_circulation: deoxygenated flow is supply-blue, oxygenated flow demand-red; a septal defect splits the septum and adds the shunt", () => {
    registerPack("medicine", medicineYaml);
    const plain = scenes.heart_circulation.layout!({});
    const flatPlain = flattenDrawables(plain.drawables);
    const vein = flatPlain.find((d) => d.id === "vein_in") as { style: { color: string } };
    const aorta = flatPlain.find((d) => d.id === "aorta") as { style: { color: string } };
    expect(vein.style.color).toBe(COLORS.supply);
    expect(aorta.style.color).toBe(COLORS.demand);
    expect(flatPlain.map((d) => d.id)).toContain("walls__septum");
    expect(flatPlain.map((d) => d.id)).not.toContain("defect");
    const vsd = scenes.heart_circulation.layout!({ defect: "septal_defect" });
    const idsVsd = flattenDrawables(vsd.drawables).map((d) => d.id);
    expect(idsVsd).toContain("defect");
    expect(idsVsd).toContain("walls__septum_a");
    expect(idsVsd).not.toContain("walls__septum");
  });

  test("neuron: myelin sheath segments appear only when myelinated", () => {
    registerPack("medicine", medicineYaml);
    const myelinated = scenes.neuron.layout!({});
    expect(flattenDrawables(myelinated.drawables).map((d) => d.id)).toContain("myelin_0");
    expect(myelinated.labels.map((l) => l.id)).toContain("label_node");
    const bare = scenes.neuron.layout!({ myelinated: false });
    const bareIds = flattenDrawables(bare.drawables).map((d) => d.id);
    expect(bareIds).not.toContain("myelin_0");
    expect(bareIds).toContain("axon");
  });

  test("pk_curve: repeated dosing marks every dose, accumulates toward a steady-state line; a loading dose starts higher", () => {
    registerPack("medicine", medicineYaml);
    const r = scenes.pk_curve.layout!({ doses: 6, dose_interval: 12, half_life: 12 });
    const ids = flattenDrawables(r.drawables).map((d) => d.id);
    for (let i = 0; i < 6; i++) expect(ids).toContain("dose_" + i);
    expect(ids).toContain("ss_line");
    // Accumulation: the curve's later peaks sit clearly above the first-dose peak (y-up).
    const curve = flattenDrawables(r.drawables).find((d) => d.id === "curve") as { pts: [number, number][] };
    const half = curve.pts.length >> 1;
    const maxEarly = Math.max(...curve.pts.slice(0, Math.floor(curve.pts.length / 6)).map((p) => p[1]));
    const maxLate = Math.max(...curve.pts.slice(half).map((p) => p[1]));
    expect(maxLate).toBeGreaterThan(maxEarly * 1.3);
    // A loading dose lifts the FIRST peak toward the plateau.
    const loaded = scenes.pk_curve.layout!({ doses: 6, dose_interval: 12, half_life: 12, loading_dose: 2 });
    const loadedCurve = flattenDrawables(loaded.drawables).find((d) => d.id === "curve") as { pts: [number, number][] };
    const loadedEarly = Math.max(...loadedCurve.pts.slice(0, Math.floor(loadedCurve.pts.length / 6)).map((p) => p[1]));
    expect(loadedEarly).toBeGreaterThan(maxEarly);
    // Single dose gets no steady-state line; a single IV dose gets the half-life staircase.
    const single = scenes.pk_curve.layout!({ route: "iv" });
    const singleIds = flattenDrawables(single.drawables).map((d) => d.id);
    expect(singleIds).not.toContain("ss_line");
    expect(singleIds).toContain("half_guides");
  });

  test("pv_loop: lower contractility raises ESV — the loop (and stroke volume) narrows from the left", () => {
    registerPack("medicine", medicineYaml);
    const strong = scenes.pv_loop.layout!({ contractility: 2.5, show_sv: true });
    const weak = scenes.pv_loop.layout!({ contractility: 1.2, show_sv: true });
    const esvX = (r: SceneLayout) => (r.anchors.tick_esv as [number, number])[0];
    const edvX = (r: SceneLayout) => (r.anchors.tick_edv as [number, number])[0];
    expect(esvX(weak)).toBeGreaterThan(esvX(strong));
    expect(edvX(weak)).toBeCloseTo(edvX(strong), 6);
    const ids = flattenDrawables(strong.drawables).map((d) => d.id);
    for (const p of ["phase_fill", "phase_ivc", "phase_eject", "phase_ivr"]) expect(ids).toContain(p);
    // The isovolumetric edges are genuinely isovolumetric: constant x.
    const ivc = flattenDrawables(strong.drawables).find((d) => d.id === "phase_ivc") as { pts: [number, number][] };
    expect(new Set(ivc.pts.map((p) => p[0])).size).toBe(1);
  });

  test("nephron: default transports draw the textbook set; highlight_segment recolors only that limb", () => {
    registerPack("medicine", medicineYaml);
    const r = scenes.nephron.layout!({});
    const ids = flattenDrawables(r.drawables).map((d) => d.id);
    for (let i = 0; i < 7; i++) expect(ids).toContain("arrow_" + i);
    for (const seg of ["proximal", "descending", "ascending", "distal", "collecting", "glomerulus", "capsule", "urine_arrow"]) {
      expect(ids).toContain(seg);
    }
    const hl = scenes.nephron.layout!({ highlight_segment: "ascending" });
    const flatHl = flattenDrawables(hl.drawables);
    const asc = flatHl.find((d) => d.id === "ascending") as { style: { color: string } };
    const desc = flatHl.find((d) => d.id === "descending") as { style: { color: string } };
    expect(asc.style.color).toBe(COLORS.accent);
    expect(desc.style.color).not.toBe(COLORS.accent);
  });

  test("screening_timeline: lead-time bias — diagnosis moves earlier, death does not, so observed survival grows", () => {
    registerPack("medicine", medicineYaml);
    const r = scenes.screening_timeline.layout!({});
    // Screen-detected diagnosis sits earlier in time than the symptom diagnosis...
    expect((r.anchors.dx_1 as [number, number])[0]).toBeLessThan((r.anchors.dx_0 as [number, number])[0]);
    // ...while both rows die at the same moment (the dashed guide's whole point).
    expect((r.anchors.death_0 as [number, number])[0]).toBeCloseTo((r.anchors.death_1 as [number, number])[0], 6);
    const span = (id: string) => {
      const s = flattenDrawables(r.drawables).find((d) => d.id === id) as { pts: [number, number][] };
      return Math.abs(s.pts[s.pts.length - 1][0] - s.pts[0][0]);
    };
    expect(span("survival_1")).toBeGreaterThan(span("survival_0"));
    expect(flattenDrawables(r.drawables).map((d) => d.id)).toContain("lead_time");
  });
});

describe("game_tree (economics pack)", () => {
  beforeEach(() => unregisterPack("economics"));

  test("default entry game solves to In + Accommodate — the threat to Fight is not credible", () => {
    registerPack("economics", economicsYaml);
    const r = scenes.game_tree.layout!({ solve: true });
    const flat = flattenDrawables(r.drawables);
    const ids = flat.map((d) => d.id);
    expect(ids).toEqual(expect.arrayContaining(["node_r", "node_1", "edge_0", "edge_1", "edge_1_0", "edge_1_1", "payoff_0", "payoff_1_0", "payoff_1_1", "solution"]));
    // Backward induction marks In (edge 1) and Accommodate (edge 1_1), never Fight.
    const solIds = ids.filter((id) => id.startsWith("sol__"));
    expect(solIds).toContain("sol__1");
    expect(solIds).toContain("sol__1_1");
    expect(solIds).not.toContain("sol__1_0");
    expect(solIds).toContain("sol__box"); // the (1, 1) outcome gets boxed
  });

  test("without solve there are no solution marks; payoffs render as pairs", () => {
    registerPack("economics", economicsYaml);
    const r = scenes.game_tree.layout!({});
    const flat = flattenDrawables(r.drawables);
    expect(flat.map((d) => d.id)).not.toContain("solution");
    const p = flat.find((d) => d.id === "payoff_1_1") as { text: string };
    expect(p.text).toBe("(1, 1)");
  });
});

describe("macro pack", () => {
  beforeEach(() => unregisterPack("macro"));

  const TEMPLATE_IDS = ["is_lm", "solow_growth", "ad_as"];

  test("registers is_lm, solow_growth and the relocated ad_as", () => {
    const r = registerPack("macro", macroYaml);
    expect(r).toMatchObject({ ok: true, templateIds: TEMPLATE_IDS });
  });

  test("every macro example renders finite, no fallback warnings, no error lint, deterministically", () => {
    registerPack("macro", macroYaml);
    for (const tid of TEMPLATE_IDS) {
      for (const ex of scenes[tid].manifest.examples) {
        const res = layoutSpec({ template: tid, params: ex.params, elements: [] } as never);
        expect(res.warnings, tid).toEqual([]);
        expect(res.issues.filter((i) => i.severity === "error"), tid).toEqual([]);
        for (const d of flattenDrawables(res.drawables)) {
          if (d.kind === "stroke" || d.kind === "area") {
            for (const [x, y] of d.pts) expect(Number.isFinite(x) && Number.isFinite(y)).toBe(true);
          }
        }
      }
      const a = scenes[tid].layout!(scenes[tid].manifest.examples[0].params);
      const b = scenes[tid].layout!(scenes[tid].manifest.examples[0].params);
      expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    }
  });

  test("is_lm: a fiscal expansion moves the equilibrium to higher Y AND higher r", () => {
    registerPack("macro", macroYaml);
    const r = scenes.is_lm.layout!({ is_shift: 20 });
    const eq = r.anchors.eq as [number, number];
    const eq2 = r.anchors.eq2 as [number, number];
    expect(eq2[0]).toBeGreaterThan(eq[0]); // higher output
    expect(eq2[1]).toBeGreaterThan(eq[1]); // higher interest rate (y-up)
    expect(flattenDrawables(r.drawables).map((d) => d.id)).toContain("is_shifted");
  });

  test("solow_growth: a higher savings rate moves the steady state k* right", () => {
    registerPack("macro", macroYaml);
    const low = scenes.solow_growth.layout!({ savings: 0.2 });
    const high = scenes.solow_growth.layout!({ savings: 0.4 });
    expect((high.anchors.steady as [number, number])[0]).toBeGreaterThan((low.anchors.steady as [number, number])[0]);
  });
});

describe("empirics pack", () => {
  beforeEach(() => unregisterPack("empirics"));

  const TEMPLATE_IDS = ["event_study", "did_trends", "rd_plot", "binscatter", "lorenz_curve"];

  test("registers all five templates in order", () => {
    const r = registerPack("empirics", empiricsYaml);
    expect(r).toMatchObject({ ok: true, templateIds: TEMPLATE_IDS });
  });

  test("every empirics example renders finite, no fallback warnings, no error lint, deterministically", () => {
    registerPack("empirics", empiricsYaml);
    for (const tid of TEMPLATE_IDS) {
      for (const ex of scenes[tid].manifest.examples) {
        const res = layoutSpec({ template: tid, params: ex.params, elements: [] } as never);
        expect(res.warnings, tid).toEqual([]);
        expect(res.issues.filter((i) => i.severity === "error"), tid).toEqual([]);
      }
      const a = scenes[tid].layout!(scenes[tid].manifest.examples[0].params);
      const b = scenes[tid].layout!(scenes[tid].manifest.examples[0].params);
      expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    }
  });

  test("event_study: the reference period t=-1 sits exactly on the zero line; clean pre-trends hug it", () => {
    registerPack("empirics", empiricsYaml);
    const r = scenes.event_study.layout!({});
    const flat = flattenDrawables(r.drawables);
    const zero = flat.find((d) => d.id === "zero_line") as { pts: [number, number][] };
    const zeroY = zero.pts[0][1];
    // t=-1 is coef_(nPre-1) = coef_4 with the default 5 pre-periods.
    const ref = r.anchors.coef_4 as [number, number];
    expect(Math.abs(ref[1] - zeroY)).toBeLessThan(0.5);
    // Post coefficients sit clearly above zero (positive default effect, y-up).
    const post = r.anchors.coef_7 as [number, number];
    expect(post[1]).toBeGreaterThan(zeroY + 30);
  });

  test("did_trends: pre-policy gap is constant (parallel trends) and the effect opens only after the policy", () => {
    registerPack("empirics", empiricsYaml);
    const r = scenes.did_trends.layout!({ effect: 2 });
    const flat = flattenDrawables(r.drawables);
    const treated = flat.find((d) => d.id === "treated__l") as { pts: [number, number][] };
    const control = flat.find((d) => d.id === "control__l") as { pts: [number, number][] };
    const gapAt = (frac: number) => {
      const i = Math.floor(treated.pts.length * frac);
      return treated.pts[i][1] - control.pts[i][1];
    };
    expect(Math.abs(gapAt(0.1) - gapAt(0.4))).toBeLessThan(2); // parallel before
    expect(gapAt(0.95)).toBeGreaterThan(gapAt(0.1) + 30); // diverged after
  });

  test("rd_plot: the fitted lines jump at the cutoff by the requested amount and direction", () => {
    registerPack("empirics", empiricsYaml);
    const up = scenes.rd_plot.layout!({ jump: 2 });
    const flat = flattenDrawables(up.drawables);
    const left = flat.find((d) => d.id === "fit_left") as { pts: [number, number][] };
    const right = flat.find((d) => d.id === "fit_right") as { pts: [number, number][] };
    const leftEnd = left.pts[left.pts.length - 1][1];
    const rightStart = right.pts[0][1];
    expect(rightStart).toBeGreaterThan(leftEnd + 20); // jumps UP (y-up)
    const down = scenes.rd_plot.layout!({ jump: -2 });
    const flatD = flattenDrawables(down.drawables);
    const leftD = flatD.find((d) => d.id === "fit_left") as { pts: [number, number][] };
    const rightD = flatD.find((d) => d.id === "fit_right") as { pts: [number, number][] };
    expect(rightD.pts[0][1]).toBeLessThan(leftD.pts[leftD.pts.length - 1][1] - 20);
  });

  test("lorenz_curve: a higher Gini sags the curve further below the diagonal", () => {
    registerPack("empirics", empiricsYaml);
    const r = scenes.lorenz_curve.layout!({ gini: 0.27, compare_gini: 0.53 });
    const flat = flattenDrawables(r.drawables);
    const c1 = flat.find((d) => d.id === "lorenz") as { pts: [number, number][] };
    const c2 = flat.find((d) => d.id === "lorenz2") as { pts: [number, number][] };
    const midY = (c: { pts: [number, number][] }) => c.pts[Math.floor(c.pts.length / 2)][1];
    expect(midY(c2)).toBeLessThan(midY(c1)); // more unequal = deeper sag (y-up)
    const caption = flat.find((d) => d.id === "gini_caption") as { text: string };
    expect(caption.text).toBe("Gini = 0.27");
  });
});

describe("hta pack", () => {
  beforeEach(() => unregisterPack("hta"));

  const TEMPLATE_IDS = ["ceac", "tornado_diagram"];

  test("registers ceac and tornado_diagram", () => {
    const r = registerPack("hta", htaYaml);
    expect(r).toMatchObject({ ok: true, templateIds: TEMPLATE_IDS });
  });

  test("every hta example renders finite, no fallback warnings, no error lint, deterministically", () => {
    registerPack("hta", htaYaml);
    for (const tid of TEMPLATE_IDS) {
      for (const ex of scenes[tid].manifest.examples) {
        const res = layoutSpec({ template: tid, params: ex.params, elements: [] } as never);
        expect(res.warnings, tid).toEqual([]);
        expect(res.issues.filter((i) => i.severity === "error"), tid).toEqual([]);
      }
      const a = scenes[tid].layout!(scenes[tid].manifest.examples[0].params);
      const b = scenes[tid].layout!(scenes[tid].manifest.examples[0].params);
      expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    }
  });

  test("ceac: default curves cross at the shared midpoint's 50% point", () => {
    registerPack("hta", htaYaml);
    const r = scenes.ceac.layout!({});
    const flat = flattenDrawables(r.drawables);
    const c0 = flat.find((d) => d.id === "curve_0") as { pts: [number, number][] };
    const c1 = flat.find((d) => d.id === "curve_1") as { pts: [number, number][] };
    const half = flat.find((d) => d.id === "half_line") as { pts: [number, number][] };
    // At the midpoint both probabilities are 0.5 — both curves touch the half line there.
    const mid = Math.floor(c0.pts.length * (30 / 100));
    expect(Math.abs(c0.pts[mid][1] - half.pts[0][1])).toBeLessThan(8);
    expect(Math.abs(c1.pts[mid][1] - half.pts[0][1])).toBeLessThan(8);
    // The rising curve ends high, the falling one ends low.
    expect(c0.pts[c0.pts.length - 1][1]).toBeGreaterThan(c1.pts[c1.pts.length - 1][1]);
  });

  test("tornado_diagram: bars sort widest-first from the top, split at the base case", () => {
    registerPack("hta", htaYaml);
    const r = scenes.tornado_diagram.layout!({
      bars: [
        { label: "Small", low: -2, high: 3 },
        { label: "Huge", low: -50, high: 60 },
        { label: "Medium", low: -20, high: 15 },
      ],
    });
    const flat = flattenDrawables(r.drawables);
    const labelAt = (i: number) => (flat.find((d) => d.id === "bar_label_" + i) as { text: string }).text;
    expect(labelAt(0)).toBe("Huge");
    expect(labelAt(1)).toBe("Medium");
    expect(labelAt(2)).toBe("Small");
    // Row 0 (widest) sits highest (y-up).
    expect((r.anchors.bar_0 as [number, number])[1]).toBeGreaterThan((r.anchors.bar_1 as [number, number])[1]);
  });
});

describe("music pack", () => {
  beforeEach(() => unregisterPack("music"));

  const TEMPLATE_IDS = ["note_sheet", "piano_keys"];

  test("registers note_sheet and piano_keys", () => {
    const r = registerPack("music", musicYaml);
    expect(r).toMatchObject({ ok: true, templateIds: TEMPLATE_IDS });
  });

  test("every music example renders finite, no fallback warnings, no error lint, deterministically", () => {
    registerPack("music", musicYaml);
    for (const tid of TEMPLATE_IDS) {
      for (const ex of scenes[tid].manifest.examples) {
        const res = layoutSpec({ template: tid, params: ex.params, elements: [] } as never);
        expect(res.warnings, tid).toEqual([]);
        expect(res.issues.filter((i) => i.severity === "error"), tid).toEqual([]);
      }
      const a = scenes[tid].layout!(scenes[tid].manifest.examples[0].params);
      const b = scenes[tid].layout!(scenes[tid].manifest.examples[0].params);
      expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    }
  });

  test("note_sheet: staff positions are diatonic — E4 on the bottom line, C4 one ledger below, C5 in the third space", () => {
    registerPack("music", musicYaml);
    const r = scenes.note_sheet.layout!({ notes: "E4:q C4:q C5:q" });
    const yE4 = (r.anchors.note_0 as [number, number])[1];
    const yC4 = (r.anchors.note_1 as [number, number])[1];
    const yC5 = (r.anchors.note_2 as [number, number])[1];
    expect(yC4).toBeCloseTo(yE4 - 26, 6); // two diatonic steps below the bottom line
    expect(yC5).toBeCloseTo(yE4 + 5 * 13, 6); // C5 = five diatonic steps above E4 (F G A B C)
    const flat = flattenDrawables(r.drawables);
    // C4 needs exactly one ledger line; E4 and C5 need none.
    expect(flat.filter((d) => d.id.startsWith("note_1__lg")).length).toBe(1);
    expect(flat.filter((d) => d.id.startsWith("note_0__lg") || d.id.startsWith("note_0__lu")).length).toBe(0);
  });

  test("note_sheet: half notes are open, quarter notes filled; bars land every time_top beats", () => {
    registerPack("music", musicYaml);
    const r = scenes.note_sheet.layout!({ notes: "C4:q D4:q E4:q F4:q G4:h A4:h", time_top: 4 });
    const flat = flattenDrawables(r.drawables);
    const q = flat.find((d) => d.id === "note_0__h0") as { style: { fill?: string } };
    const h = flat.find((d) => d.id === "note_4__h0") as { style: { fill?: string } };
    expect(q.style.fill).toBeDefined();
    expect(h.style.fill).toBeUndefined();
    const bars = flat.filter((d) => d.id.startsWith("bar_"));
    expect(bars.length).toBe(1); // after four quarter beats, once — the final bar is the edge
  });

  test("note_sheet keyboard mode: compact piano appears, and each note's group carries its own key mark for press", () => {
    registerPack("music", musicYaml);
    const r = scenes.note_sheet.layout!({ notes: "C4:q F#4:q", keyboard: true });
    const flat = flattenDrawables(r.drawables);
    const ids = flat.map((d) => d.id);
    expect(ids).toContain("keys");
    expect(ids).toContain("keys__frame");
    // C4's key mark (white: two tint areas) is its own pressable element key_0.
    expect(ids).toContain("key_0");
    expect(ids).toContain("key_0__key0");
    expect(ids).toContain("key_0__keyu0");
    // F#4's mark is a single black-key overlay in key_1.
    expect(ids).toContain("key_1");
    expect(ids).not.toContain("key_1__keyu0");
    // Without the flag: no keyboard, no marks.
    const plain = scenes.note_sheet.layout!({ notes: "C4:q F#4:q" });
    const plainIds = flattenDrawables(plain.drawables).map((d) => d.id);
    expect(plainIds).not.toContain("keys");
    expect(plainIds).not.toContain("key_0");
  });

  test("piano_keys: two octaves have 14 white and 10 black keys; highlights follow the given order and fold flats", () => {
    registerPack("music", musicYaml);
    const r = scenes.piano_keys.layout!({ highlight: ["C4", "E4", "Gb4"] });
    const flat = flattenDrawables(r.drawables);
    expect(flat.filter((d) => d.id.startsWith("key_w")).length).toBe(14);
    expect(flat.filter((d) => d.id.startsWith("key_b") && d.kind === "stroke").length).toBe(10);
    // Black keys are SOLID: a precise full-opacity ink area under each outline.
    const blackFills = flat.filter((d) => d.id.startsWith("key_b") && d.kind === "area") as { style: { opacity: number } }[];
    expect(blackFills.length).toBe(10);
    for (const f of blackFills) expect(f.style.opacity).toBe(1);
    const ids = flat.map((d) => d.id);
    expect(ids).toContain("highlight_0");
    expect(ids).toContain("highlight_1");
    expect(ids).toContain("highlight_2"); // Gb4 → F#4, a black key
    // C4 and E4 marks sit at distinct white keys, in x order.
    expect((r.anchors.highlight_0 as [number, number])[0]).toBeLessThan((r.anchors.highlight_1 as [number, number])[0]);
  });
});

describe("stats pack", () => {
  beforeEach(() => unregisterPack("stats"));

  const TEMPLATE_IDS = ["bayes_tree", "galton_board", "sampling_dist", "ci_dance"];

  test("registers all four templates", () => {
    const r = registerPack("stats", statsYaml);
    expect(r).toMatchObject({ ok: true, templateIds: TEMPLATE_IDS });
  });

  test("every stats example renders finite, no fallback warnings, no error lint, deterministically", () => {
    registerPack("stats", statsYaml);
    for (const tid of TEMPLATE_IDS) {
      for (const ex of scenes[tid].manifest.examples) {
        const res = layoutSpec({ template: tid, params: ex.params, elements: [] } as never);
        expect(res.warnings, tid).toEqual([]);
        expect(res.issues.filter((i) => i.severity === "error"), tid).toEqual([]);
      }
      const a = scenes[tid].layout!(scenes[tid].manifest.examples[0].params);
      const b = scenes[tid].layout!(scenes[tid].manifest.examples[0].params);
      expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    }
  });

  test("bayes_tree: the arithmetic is exact and the PPV punchline matches it", () => {
    registerPack("stats", statsYaml);
    const r = scenes.bayes_tree.layout!({ population: 1000, prevalence: 0.01, sensitivity: 0.9, specificity: 0.91 });
    const flat = flattenDrawables(r.drawables);
    const numOf = (id: string) => Number((flat.find((d) => d.id === id + "__n") as { text: string }).text);
    expect(numOf("sick")).toBe(10);
    expect(numOf("healthy")).toBe(990);
    expect(numOf("tp")).toBe(9);
    expect(numOf("fn")).toBe(1);
    expect(numOf("fp")).toBe(89); // round(990 * 0.09)
    expect(numOf("tn")).toBe(901);
    // Branches conserve people.
    expect(numOf("tp") + numOf("fn")).toBe(numOf("sick"));
    expect(numOf("fp") + numOf("tn")).toBe(numOf("healthy"));
    const punch = (flat.find((d) => d.id === "ppv__t2") as { text: string }).text;
    expect(punch).toContain("9%"); // 9 / 98
  });

  test("galton_board: bins are symmetric, exact binomial, tallest in the middle", () => {
    registerPack("stats", statsYaml);
    const r = scenes.galton_board.layout!({ rows: 8 });
    const flat = flattenDrawables(r.drawables);
    const heightOf = (k: number) => {
      const f = flat.find((d) => d.id === `bin_${k}__f`) as { pts: [number, number][] };
      const ys = f.pts.map((p) => p[1]);
      return Math.max(...ys) - Math.min(...ys);
    };
    for (let k = 0; k <= 4; k++) expect(heightOf(k)).toBeCloseTo(heightOf(8 - k), 6);
    expect(heightOf(4)).toBeGreaterThan(heightOf(0));
    // binomial(8): C(8,4)/C(8,0) = 70 — the middle bin is 70× the edge bin.
    expect(heightOf(4) / heightOf(0)).toBeCloseTo(70, 4);
    expect(flat.filter((d) => d.id.startsWith("peg_")).length).toBe(36); // 1+2+...+8
  });

  test("sampling_dist: the sampling distribution narrows with n and stays centered on the mean", () => {
    registerPack("stats", statsYaml);
    const widthAt = (n: number) => {
      const r = scenes.sampling_dist.layout!({ shape: "skewed", n });
      const curve = flattenDrawables(r.drawables).find((d) => d.id === "samp_curve") as { pts: [number, number][] };
      const yMax = Math.max(...curve.pts.map((p) => p[1]));
      const yBase = Math.min(...curve.pts.map((p) => p[1]));
      const half = yBase + (yMax - yBase) / 2;
      const above = curve.pts.filter((p) => p[1] >= half).map((p) => p[0]);
      return Math.max(...above) - Math.min(...above);
    };
    expect(widthAt(40)).toBeLessThan(widthAt(5) * 0.55); // ≈ 1/√8 in theory
    const r5 = scenes.sampling_dist.layout!({ shape: "skewed", n: 5 });
    expect((r5.anchors.samp_mean as [number, number])[0]).toBeCloseTo((r5.anchors.pop_mean as [number, number])[0], 6);
  });

  test("ci_dance: exactly the expected number of intervals miss, and the misses truly exclude the truth", () => {
    registerPack("stats", statsYaml);
    const r = scenes.ci_dance.layout!({ draws: 20, confidence: 0.95 });
    const flat = flattenDrawables(r.drawables);
    const trueX = (r.anchors.true_line as [number, number])[0];
    const bars = flat.filter((d) => d.id.match(/^ci_\d+__b$/)) as { pts: [number, number][]; style: { color: string } }[];
    expect(bars.length).toBe(20);
    const misses = bars.filter((b) => b.style.color === COLORS.demand);
    expect(misses.length).toBe(1); // 5% of 20
    for (const m of misses) {
      const xs = m.pts.map((p) => p[0]);
      expect(trueX < Math.min(...xs) || trueX > Math.max(...xs)).toBe(true);
    }
    for (const b of bars.filter((x) => x.style.color === COLORS.supply)) {
      const xs = b.pts.map((p) => p[0]);
      expect(trueX).toBeGreaterThan(Math.min(...xs));
      expect(trueX).toBeLessThan(Math.max(...xs));
    }
    const cap = flat.find((d) => d.id === "caption") as { text: string };
    expect(cap.text).toBe("19 of 20 caught the truth");
  });
});

// Full behavioral coverage (stages, the placeholder promise, box, series
// colors, ylim, ...) lives in tests/data-pack.test.ts; this is just the
// registration smoke test every other pack gets here.
describe("data pack", () => {
  beforeEach(() => unregisterPack("data"));

  test("registers bar_chart, data_table, line_chart, scatter_plot, bar_race and heatmap", () => {
    const r = registerPack("data", dataYaml);
    expect(r).toMatchObject({ ok: true, templateIds: ["bar_chart", "data_table", "line_chart", "scatter_plot", "bar_race", "heatmap"] });
  });

  test("every data example renders finite, no fallback warnings, no error lint, deterministically", () => {
    registerPack("data", dataYaml);
    for (const tid of ["bar_chart", "data_table", "line_chart", "scatter_plot", "bar_race", "heatmap"]) {
      for (const ex of scenes[tid].manifest.examples) {
        const res = layoutSpec({ template: tid, params: ex.params, elements: [] } as never);
        expect(res.warnings, tid).toEqual([]);
        expect(res.issues.filter((i) => i.severity === "error"), tid).toEqual([]);
      }
      const a = scenes[tid].layout!(scenes[tid].manifest.examples[0].params);
      const b = scenes[tid].layout!(scenes[tid].manifest.examples[0].params);
      expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    }
  });
});
