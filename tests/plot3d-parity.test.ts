// plot3d moved from the mathlogic pack (a YAML layout) to a built-in
// TypeScript template (src/scenes/plot3d, 2026-09-27). This holds every
// figure the pack version drew — the bundled examples at each camera their
// casts animate to, the manifest's examples, the orbit sweep the pack tests
// walked — to what it drew then: the same ids in the same order, the same
// geometry, the same placed labels. tests/fixtures/plot3d-parity.json was
// written by the pack version (PLOT3D_PARITY_WRITE=1) before the move.
import { readFileSync, writeFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import examples from "../src/examples.json";
import { layoutSpec } from "../src/layout/layout";
import { flattenDrawables } from "../src/layout/model";
import "../src/scenes/registry";

const FIXTURE = new URL("./fixtures/plot3d-parity.json", import.meta.url);

/** Every params the pack version was seen drawing. */
export function parityCases(): { name: string; params: Record<string, unknown> }[] {
  const out: { name: string; params: Record<string, unknown> }[] = [];
  for (const [i, ex] of (examples as { spec?: { template?: string; params?: Record<string, unknown>; commands?: { animate?: Record<string, unknown> }[] } }[]).entries()) {
    const s = ex.spec;
    if (s?.template !== "plot3d") continue;
    let p = { ...(s.params ?? {}) };
    out.push({ name: `example ${i}`, params: p });
    for (const [k, c] of (s.commands ?? []).entries()) {
      if (!c.animate) continue;
      p = { ...p, ...c.animate };
      out.push({ name: `example ${i} after animate ${k}`, params: p });
    }
  }
  const kinds: [string, Record<string, unknown>][] = [
    ["saddle", { surface: "x^2 - y^2" }],
    ["helix", { curve: { x_expr: "cos(t)", y_expr: "sin(t)", z_expr: "t/6", t_min: 0, t_max: 12 * Math.PI } }],
    ["points", { points: [{ at: [0.6, 0.6, 0.6], label: "A" }, { at: [-0.6, 0.4, -0.5], label: "B" }] }],
  ];
  for (const [name, base] of kinds)
    for (const azimuth_deg of [0, 45, 90, 135, 180, 225, 270, 315])
      for (const elevation_deg of [-45, 0, 22, 80]) out.push({ name: `${name} az ${azimuth_deg} el ${elevation_deg}`, params: { ...base, azimuth_deg, elevation_deg } });
  out.push({ name: "wild", params: { surface: "100*x" } });
  out.push({ name: "grid 5 domain", params: { surface: "sin(x)*cos(y)", domain: [-3, 3], grid_n: 5, title: "Waves" } });
  out.push({ name: "distance", params: { surface: "x*y", distance: 20, axis_labels: { x: "u", y: "v", z: "w" } } });
  out.push({ name: "empty", params: {} });
  out.push({ name: "points one", params: { points: [{ at: [0.5, 0.5, 0.5], label: "P" }, { at: [-0.5, -0.5, -0.5] }] } });
  return out;
}

const r3 = (v: number): number => Math.round(v * 1000) / 1000;

/** What a figure is, for the comparison: ids, order, geometry, labels. */
export function fingerprint(params: Record<string, unknown>): unknown {
  const res = layoutSpec({ template: "plot3d", params, elements: [] } as never);
  const flat = flattenDrawables(res.drawables).map((d) => {
    const g = d as unknown as { id: string; kind: string; pts?: [number, number][]; pos?: [number, number]; text?: string };
    return { id: g.id, kind: g.kind, ...(g.pts ? { pts: g.pts.map(([x, y]) => [r3(x), r3(y)]) } : {}), ...(g.pos ? { pos: [r3(g.pos[0]), r3(g.pos[1])] } : {}), ...(g.text !== undefined ? { text: g.text } : {}) };
  });
  return { order: res.order, drawables: flat, issues: res.issues.map((i) => i.message), warnings: res.warnings };
}

describe("plot3d parity with the pack version", () => {
  const cases = parityCases();
  if (process.env.PLOT3D_PARITY_WRITE === "1") {
    test("write the fixture", async () => {
      const { registerPack } = await import("../src/scenes/packs");
      const yaml = (await import("../src/scenes/packs/mathlogic.yaml?raw")).default;
      registerPack("mathlogic", yaml);
      const out: Record<string, unknown> = {};
      for (const c of cases) out[c.name] = { params: c.params, figure: fingerprint(c.params) };
      writeFileSync(FIXTURE, JSON.stringify(out));
    });
    return;
  }
  const fixture = JSON.parse(readFileSync(FIXTURE, "utf8")) as Record<string, { params: Record<string, unknown>; figure: unknown }>;
  test("the fixture covers every case", () => {
    expect(Object.keys(fixture).sort()).toEqual(cases.map((c) => c.name).sort());
  });
  for (const c of cases) {
    test(c.name, () => {
      expect(fingerprint(c.params)).toEqual(fixture[c.name].figure);
    });
  }
});
