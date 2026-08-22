// The four domain scenes (free_body, ring_molecule, protein_secondary,
// cell_diagram): element ids, determinism, and every manifest example
// rendering through the real layoutSpec pipeline without error-level lint.

import { describe, expect, test } from "vitest";
import { scenes } from "../src/scenes/registry";
import { layoutSpec } from "../src/layout/layout";
import { flattenDrawables } from "../src/layout/model";
import { layoutFreeBody } from "../src/scenes/free_body/layout";
import { layoutRingMolecule } from "../src/scenes/ring_molecule/layout";
import { layoutProteinSecondary } from "../src/scenes/protein_secondary/layout";

const NEW_SCENES = ["free_body", "ring_molecule", "protein_secondary", "cell_diagram"] as const;

describe("registry", () => {
  test("all four domain scenes are registered and ready", () => {
    for (const name of NEW_SCENES) {
      expect(scenes[name]).toBeDefined();
      expect(scenes[name].manifest.status).toBe("ready");
      expect(scenes[name].layout).toBeDefined();
    }
  });
});

describe("manifest examples through the real pipeline", () => {
  for (const name of NEW_SCENES) {
    for (const [i, ex] of scenes[name].manifest.examples.entries()) {
      test(`${name} example ${i} ("${ex.request}") renders without errors`, () => {
        const res = layoutSpec({ template: name, params: ex.params, elements: [] } as never);
        expect(res.warnings).toEqual([]);
        expect(res.issues.filter((iss) => iss.severity === "error")).toEqual([]);
        expect(res.drawables.length).toBeGreaterThan(0);
        // Everything on-canvas-ish: no NaN, nothing wildly out of bounds.
        for (const d of flattenDrawables(res.drawables)) {
          if (d.kind === "stroke" || d.kind === "area") {
            for (const [x, y] of d.pts) {
              expect(Number.isFinite(x) && Number.isFinite(y)).toBe(true);
              expect(Math.abs(x)).toBeLessThan(2000);
              expect(Math.abs(y)).toBeLessThan(2000);
            }
          }
        }
      });
    }
  }
});

describe("determinism", () => {
  for (const name of NEW_SCENES) {
    test(`${name} produces identical output on repeated calls`, () => {
      const params = scenes[name].manifest.examples[0].params;
      const a = scenes[name].layout!(params);
      const b = scenes[name].layout!(params);
      expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    });
  }
});

describe("layoutFreeBody", () => {
  test("draws body, ground, one arrow + label per force", () => {
    const r = layoutFreeBody({
      forces: [
        { id: "gravity", label: "F_g", angle_deg: 270 },
        { id: "normal", label: "N", angle_deg: 90 },
      ],
    });
    const ids = flattenDrawables(r.drawables).map((d) => d.id);
    expect(ids).toContain("ground");
    expect(ids).toContain("body");
    expect(ids).toContain("force_gravity");
    expect(ids).toContain("force_normal");
    expect(r.labels.map((l) => l.id)).toEqual(expect.arrayContaining(["label_gravity", "label_normal"]));
  });

  test("incline mode draws wedge, hatching, and angle arc; flat mode does not", () => {
    const flat = layoutFreeBody({ forces: [] });
    const inc = layoutFreeBody({ incline_deg: 30, forces: [] });
    expect(flattenDrawables(flat.drawables).map((d) => d.id)).not.toContain("incline");
    const incIds = flattenDrawables(inc.drawables).map((d) => d.id);
    expect(incIds).toContain("incline");
    expect(incIds).toContain("angle_arc");
    expect(inc.labels.map((l) => l.id)).toContain("label_angle");
  });

  test("force magnitude scales arrow length", () => {
    const r = layoutFreeBody({
      forces: [
        { id: "big", label: "B", angle_deg: 0, magnitude: 1 },
        { id: "small", label: "S", angle_deg: 180, magnitude: 0.2 },
      ],
    });
    const len = (id: string) => {
      const d = flattenDrawables(r.drawables).find((d) => d.id === id);
      if (!d || d.kind !== "stroke") throw new Error(`no stroke ${id}`);
      const [a, b] = [d.pts[0], d.pts[d.pts.length - 1]];
      return Math.hypot(b[0] - a[0], b[1] - a[1]);
    };
    expect(len("force_big")).toBeGreaterThan(len("force_small") + 50);
  });
});

describe("layoutRingMolecule", () => {
  test("hexagon has 6 bonds; aromatic adds inner double bonds; heteroatom trims its bonds", () => {
    const r = layoutRingMolecule({ ring_size: 6, aromatic: true, atoms: [null, null, "N", null, null, null] });
    const ids = flattenDrawables(r.drawables).map((d) => d.id);
    expect(ids.filter((id) => /^bond_\d$/.test(id))).toHaveLength(6);
    expect(ids.filter((id) => /^dbond_\d$/.test(id))).toHaveLength(3);
    expect(ids).toContain("atom_2");
    // Bonds adjacent to the N vertex are shorter than a full edge.
    const bond = (i: number) => {
      const d = flattenDrawables(r.drawables).find((d) => d.id === `bond_${i}`);
      if (!d || d.kind !== "stroke") throw new Error("missing bond");
      return Math.hypot(d.pts[1][0] - d.pts[0][0], d.pts[1][1] - d.pts[0][1]);
    };
    expect(bond(1)).toBeLessThan(bond(4) - 10);
  });

  test("substituent renders spur and text at requested vertex", () => {
    const r = layoutRingMolecule({ substituents: [{ position: 0, text: "OH" }] });
    const ids = flattenDrawables(r.drawables).map((d) => d.id);
    expect(ids).toContain("sub_0");
    expect(ids).toContain("sub_0_body");
  });
});

describe("layoutProteinSecondary", () => {
  test("explicit segments produce one drawable per segment plus termini", () => {
    const r = layoutProteinSecondary({
      segments: [{ kind: "loop" }, { kind: "helix", label: "α-helix" }, { kind: "sheet" }],
    });
    const ids = flattenDrawables(r.drawables).map((d) => d.id);
    expect(ids).toEqual(expect.arrayContaining(["n_term", "c_term", "seg_0", "seg_1", "seg_2", "seg_2_fill"]));
  });

  test("ss string becomes runs with auto-labeled first helix and strand", () => {
    const r = layoutProteinSecondary({ ss: "CCHHHHHCCEEEECC" });
    expect(r.labels.map((l) => l.text)).toEqual(expect.arrayContaining(["α-helix", "β-strand"]));
  });
});

describe("cell_diagram (doc template)", () => {
  const layout = (params: Record<string, unknown>) => scenes.cell_diagram.layout!(params);

  test("organelle subset draws only what is asked", () => {
    const r = layout({ organelles: ["nucleus"] });
    const ids = flattenDrawables(r.drawables).map((d) => d.id);
    expect(ids).toContain("nucleus");
    expect(ids).not.toContain("mito");
    expect(ids).not.toContain("golgi");
  });

  test("labels: false suppresses name labels", () => {
    const r = layout({ labels: false });
    expect(r.labels).toHaveLength(0);
  });

  test("cell_diagram is registered from a template doc (no TS layout module)", () => {
    expect(scenes.cell_diagram.manifest.status).toBe("ready");
    expect(scenes.cell_diagram.layout).toBeDefined();
  });
});
