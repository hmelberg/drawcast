// plot3d's filled surface (style "mesh" / "solid", src/scenes/plot3d/mesh.ts):
// cells as exact fills painted back to front between the axes and the wires,
// coloured by height on the template's fixed z scale or lit by a light that
// stays with the viewer; the wires' hidden stretches cut away. The default
// ("wire") is held to the pack version by tests/plot3d-parity.test.ts.
import { beforeAll, describe, expect, test } from "vitest";
import { ensureEngines } from "../src/scenes/engines";
import { layoutPlot3d, pageOf } from "../src/scenes/plot3d/layout";
import { lintPlot3d } from "../src/scenes/plot3d/lint";
import { readModel, type Plot3dParams, type Vec3 } from "../src/scenes/plot3d/model";
import { buildCells, cellColor, clipPolygon, heightColor, HEIGHT_RAMP, lambert, LIGHT_CAM } from "../src/scenes/plot3d/mesh";
import { plotSurface } from "../src/scenes/plot3d/widget";
import { relativeLuminance } from "../src/layout/ink";
import { layoutSpec } from "../src/layout/layout";
import { flattenDrawables, Z_STROKE, type Pt } from "../src/layout/model";
import { buildWidgetScene } from "../src/scenes/widget-scene";
import { scenes } from "../src/scenes/registry";
import type { RenderHandle } from "../src/render";

const BOWL: Plot3dParams = { surface: "x^2 + y^2", style: "mesh" };
const HILLS: Plot3dParams = {
  surface: "exp(-((x-1)^2 + (y-1)^2)) + 0.7*exp(-((x+1.2)^2 + (y+0.8)^2)/0.6) - 0.5*exp(-((x+0.5)^2 + (y-1.5)^2)/0.5)",
  domain: [-3, 3],
  grid_n: 20,
  style: "mesh",
  color_by: "height",
  shading: true,
  legend: true,
};
const SADDLE: Plot3dParams = { surface: "a*x^2 - b*y^2", params: { a: { value: 1, min: -1, max: 1 }, b: { value: 1, min: -1, max: 1 } }, style: "mesh" };

type Leaf = { id: string; kind: string; pts?: Pt[]; style: { fill?: string; opacity: number }; z: number };
const leaves = (P: Plot3dParams): Leaf[] => flattenDrawables(layoutPlot3d(P).drawables) as unknown as Leaf[];
const pageFor = (p: Plot3dParams) => layoutSpec({ template: "plot3d", params: p, commands: [] } as unknown as RenderHandle["spec"]);

beforeAll(async () => {
  await ensureEngines(["mathjax"]);
});

describe("style", () => {
  test("wire is the default and draws no fill; mesh and solid draw one cell per grid square, exact, in the stroke layer", () => {
    expect(readModel({ surface: "x" }).fill.style).toBe("wire");
    expect(leaves({ surface: "x^2" }).some((d) => d.id.startsWith("surface_fill__"))).toBe(false);
    for (const style of ["mesh", "solid"]) {
      const cells = leaves({ ...BOWL, style }).filter((d) => /^surface_fill__\d+_\d+$/.test(d.id));
      expect(cells).toHaveLength(11 * 11);
      for (const c of cells) {
        expect(c.kind).toBe("area");
        expect((c as unknown as { precise: boolean }).precise).toBe(true);
        expect(c.z).toBe(Z_STROKE);
        expect(c.style.opacity).toBe(0.8);
      }
    }
    expect(leaves({ ...BOWL, opacity: 0.5 }).find((d) => d.id === "surface_fill__0_0")!.style.opacity).toBe(0.5);
  });
  test("a curve or points draw no fill whatever the style says", () => {
    expect(leaves({ curve: { x_expr: "cos(t)", y_expr: "sin(t)", z_expr: "t/6" }, style: "mesh" }).some((d) => d.id.startsWith("surface_fill__"))).toBe(false);
  });
  test("mesh wires are thin ink over the fills; solid's are all but gone", () => {
    const mesh = leaves(BOWL).filter((d) => d.id.startsWith("wire_") && d.kind === "stroke");
    const solid = leaves({ ...BOWL, style: "solid" }).filter((d) => d.id.startsWith("wire_") && d.kind === "stroke");
    expect(mesh.length).toBeGreaterThan(0);
    for (const w of mesh) expect((w.style as unknown as { strokeWidth: number }).strokeWidth).toBeLessThan(2);
    for (const w of solid) expect(w.style.opacity).toBeLessThan(0.3);
  });
});

describe("paint order", () => {
  test("axes first, then the cells far to near, then the wires, then the marks", () => {
    const l = layoutPlot3d({ ...HILLS, marks: [{ at: [1, 1] }] });
    const o = l.order;
    const idx = (re: RegExp): number[] => o.map((id, k) => (re.test(id) ? k : -1)).filter((k) => k >= 0);
    const axes = idx(/^axis_[xyz]$/);
    const cells = idx(/^surface_fill$/);
    const wires = idx(/^wire_/);
    const marks = idx(/^mark_\d+$/);
    expect(Math.max(...axes)).toBeLessThan(Math.min(...cells));
    expect(Math.max(...cells)).toBeLessThan(Math.min(...wires));
    expect(Math.max(...wires)).toBeLessThan(Math.min(...marks));
  });
  test("a nearer cell is drawn later: the cells come out far to near", () => {
    // A warped 6 × 6 grid under an arbitrary projection: depth is whatever the camera says.
    const n = 6;
    const world: Vec3[][] = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j): Vec3 => [j, Math.sin(i * j), i]));
    const proj = world.map((row) => row.map(([x, y, z]) => ({ x: x * 10, y: y * 10 + z * 3, depth: 50 - z * 2 + x * 0.7 + y })));
    const cells = buildCells(world, proj, (v) => v, () => 0.5, "height", true);
    expect(cells).toHaveLength(25);
    for (let k = 1; k < cells.length; k++) expect(cells[k].depth).toBeLessThanOrEqual(cells[k - 1].depth);
    const mean = (i: number, j: number): number => (proj[i][j].depth + proj[i][j + 1].depth + proj[i + 1][j].depth + proj[i + 1][j + 1].depth) / 4;
    let best = [0, 0];
    for (let i = 0; i < n - 1; i++) for (let j = 0; j < n - 1; j++) if (mean(i, j) < mean(best[0], best[1])) best = [i, j];
    expect([cells[24].i, cells[24].j]).toEqual(best);
  });
  test("in the layout, at every camera, the cell nearest the eye is painted last and the farthest first", () => {
    for (const azimuth_deg of [0, 35, 120, 200, 290])
      for (const elevation_deg of [-30, 22, 70]) {
        // A flat plane: a cell's depth is its centre's distance along the view, exactly.
        const P: Plot3dParams = { surface: "0*x", style: "mesh", azimuth_deg, elevation_deg };
        const cellOrder = leaves(P).map((d) => d.id).filter((id) => id.startsWith("surface_fill__"));
        const az = (azimuth_deg * Math.PI) / 180;
        // toward the eye: proj3's z1 (the plane has no height), sign by elevation's cosine (> 0 here)
        const toEye = (id: string): number => {
          const [i, j] = id.split("__")[1].split("_").map(Number);
          const m = readModel(P);
          const step = (m.domain[1] - m.domain[0]) / (m.gridN - 1);
          return (m.domain[0] + (j + 0.5) * step) * Math.sin(az) + (m.domain[0] + (i + 0.5) * step) * Math.cos(az);
        };
        const eyes = cellOrder.map(toEye);
        expect(eyes[0], `az ${azimuth_deg}`).toBeCloseTo(Math.min(...eyes));
        expect(eyes[eyes.length - 1], `az ${azimuth_deg}`).toBeCloseTo(Math.max(...eyes));
      }
  });
  test("the sort is exact on a flat plane: depth never decreases along the paint order", () => {
    const P: Plot3dParams = { surface: "0*x", style: "mesh", azimuth_deg: 20, elevation_deg: 30 };
    const m = readModel(P);
    const n = m.gridN;
    const step = (m.domain[1] - m.domain[0]) / (n - 1);
    const az = (20 * Math.PI) / 180;
    const eye = leaves(P)
      .map((d) => d.id)
      .filter((id) => id.startsWith("surface_fill__"))
      .map((id) => {
        const [i, j] = id.split("__")[1].split("_").map(Number);
        return (m.domain[0] + (j + 0.5) * step) * Math.sin(az) + (m.domain[0] + (i + 0.5) * step) * Math.cos(az);
      });
    for (let k = 1; k < eye.length; k++) expect(eye[k]).toBeGreaterThanOrEqual(eye[k - 1] - 1e-9);
  });
});

describe("colour", () => {
  test("the height ramp grows lighter all the way up — monotone in z", () => {
    let prev = -1;
    for (let k = 0; k <= 40; k++) {
      const L = relativeLuminance(heightColor(k / 40));
      expect(L).toBeGreaterThan(prev);
      prev = L;
    }
    expect(heightColor(0)).toBe(HEIGHT_RAMP[0]);
    expect(heightColor(1)).toBe(HEIGHT_RAMP[HEIGHT_RAMP.length - 1]);
  });
  test("on the surface: a higher cell is a lighter one (height, unshaded)", () => {
    const cells = leaves({ ...BOWL, color_by: "height" }).filter((d) => d.id.startsWith("surface_fill__"));
    const byId = new Map(cells.map((c) => [c.id, relativeLuminance(c.style.fill!)]));
    // The bowl's centre is its bottom, a corner its top.
    expect(byId.get("surface_fill__5_5")!).toBeLessThan(byId.get("surface_fill__0_0")!);
    expect(byId.get("surface_fill__5_5")!).toBeLessThan(byId.get("surface_fill__3_5")!);
    expect(byId.get("surface_fill__3_5")!).toBeLessThan(byId.get("surface_fill__0_5")!);
  });
  test("with parameters the colours hold their scale: a cell at one height keeps its colour while a slider moves", () => {
    const colourAt = (a: number): string => leaves({ ...SADDLE, params: { a: { value: a, min: -1, max: 1 }, b: { value: 1, min: -1, max: 1 } } }).find((d) => d.id === "surface_fill__5_5")!.style.fill!;
    // The centre cell of the saddle hardly moves with a; its colour must not either.
    expect(colourAt(1)).toBe(colourAt(0.2));
    // …while a cell out along x, whose height a sets, changes.
    const edge = (a: number): string => leaves({ ...SADDLE, params: { a: { value: a, min: -1, max: 1 }, b: { value: 1, min: -1, max: 1 } } }).find((d) => d.id === "surface_fill__5_0")!.style.fill!;
    expect(relativeLuminance(edge(1))).toBeGreaterThan(relativeLuminance(edge(-1)));
  });
  test("shading: a cell facing the light is brighter than one facing away", () => {
    expect(lambert(LIGHT_CAM)).toBeCloseTo(1);
    expect(lambert([-LIGHT_CAM[0], -LIGHT_CAM[1], LIGHT_CAM[2]])).toBeLessThan(0.5);
    // Two-sided: the underside is lit as it faces the eye.
    expect(lambert([0, 0, 1])).toBeCloseTo(lambert([0, 0, -1]));
    expect(relativeLuminance(cellColor("shade", 0, true, 1))).toBeGreaterThan(relativeLuminance(cellColor("shade", 0, true, 0.4)));
    expect(relativeLuminance(cellColor("height", 0.5, true, 1))).toBeGreaterThan(relativeLuminance(cellColor("height", 0.5, true, 0.4)));
    // On the surface: a tent roof, one side toward the light (upper left), one away.
    const P: Plot3dParams = { surface: "-abs(x)", style: "mesh", color_by: "shade", azimuth_deg: 0, elevation_deg: 20 };
    const c = leaves(P).filter((d) => d.id.startsWith("surface_fill__"));
    const lum = (id: string): number => relativeLuminance(c.find((d) => d.id === id)!.style.fill!);
    // x < 0 (screen left, j small) faces the light from the upper left.
    expect(lum("surface_fill__5_1")).toBeGreaterThan(lum("surface_fill__5_9"));
  });
  test("shade follows the viewer: orbiting half way round swaps which side is lit", () => {
    const lum = (az: number, id: string): number => relativeLuminance(leaves({ surface: "-abs(x)", style: "mesh", color_by: "shade", azimuth_deg: az, elevation_deg: 20 }).find((d) => d.id === id)!.style.fill!);
    expect(lum(0, "surface_fill__5_1")).toBeGreaterThan(lum(0, "surface_fill__5_9"));
    expect(lum(180, "surface_fill__5_9")).toBeGreaterThan(lum(180, "surface_fill__5_1"));
  });
});

describe("ids", () => {
  test("surface is the wires then the fill; surface_fill one element of all the cells; surface_wires the wires; legend the colour bar and its words", () => {
    const l = layoutPlot3d(HILLS);
    const g = l.groups!;
    const fill = l.drawables.find((d) => d.id === "surface_fill") as unknown as { kind: string; children: { id: string }[] };
    expect(fill.kind).toBe("group");
    expect(fill.children).toHaveLength(19 * 19);
    expect(l.order.filter((id) => id.startsWith("surface_fill"))).toEqual(["surface_fill"]);
    expect(g.surface_wires).toHaveLength(40);
    expect(g.surface_wires.every((id) => /^wire_(row|col)_\d+$/.test(id))).toBe(true);
    expect(g.surface).toEqual([...g.surface_wires, "surface_fill"]);
    expect(g.legend).toEqual(["colorbar", "colorbar_max", "colorbar_min", "colorbar_label"]);
    expect(l.order).toEqual(expect.arrayContaining(["colorbar", "colorbar_min", "colorbar_max"]));
    expect(l.drawnWith?.colorbar).toEqual(["colorbar_max", "colorbar_min", "colorbar_label"]);
    // No legend without height colours or without asking.
    expect(layoutPlot3d({ ...HILLS, legend: false }).order).not.toContain("colorbar");
    expect(layoutPlot3d({ ...HILLS, color_by: "shade" }).order).not.toContain("colorbar");
  });
  test("a filled figure lays out with no issue and no warning, around the orbit", () => {
    // (Zoomed in, an axis letter clamped to the box can land on its own axis — wire figures too: an open issue, not the fill's.)
    for (const base of [HILLS, SADDLE, { ...BOWL, style: "solid" as const }, { ...HILLS, legend: false, color_by: "shade" as const }])
      for (const azimuth_deg of [0, 90, 200, 300])
        for (const elevation_deg of [-40, 22, 80]) {
          const res = pageFor({ ...base, azimuth_deg, elevation_deg });
          expect(res.issues, JSON.stringify({ azimuth_deg, elevation_deg })).toEqual([]);
          expect(res.warnings, JSON.stringify({ azimuth_deg, elevation_deg })).toEqual([]);
        }
  });
  test("the fills are paper to orbit, like the wires", () => {
    const sc = buildWidgetScene(scenes["plot3d"], HILLS as unknown as Record<string, unknown>, { layout: pageFor(HILLS) })!;
    const box = plotSurface(sc)!;
    const b = sc.boxes.get("surface_fill")!;
    expect(b.x >= box.x && b.x + b.w <= box.x + box.w && b.y >= box.y && b.y + b.h <= box.y + box.h).toBe(true);
  });
});

describe("hidden lines", () => {
  test("a wire behind the hill is cut; from above nothing is hidden", () => {
    const hill: Plot3dParams = { surface: "exp(-(x^2 + y^2))", domain: [-2, 2], grid_n: 16, style: "mesh", azimuth_deg: 0, elevation_deg: 5 };
    const pieces = (P: Plot3dParams): number =>
      flattenDrawables(layoutPlot3d(P).drawables).filter((d) => /^wire_col_\d+(__s\d+)?$/.test(d.id) && d.kind === "stroke").length;
    const wireCount = (P: Plot3dParams): number => layoutPlot3d(P).order.filter((id) => id.startsWith("wire_col_")).length;
    // Low and level: the far half of the middle columns is behind the hill — they break in pieces or lose their back part.
    const low = layoutPlot3d(hill);
    const mid = flattenDrawables(low.drawables).filter((d) => /^wire_col_8(__s\d+)?$/.test(d.id) && d.kind === "stroke") as unknown as { pts: Pt[] }[];
    const full = flattenDrawables(layoutPlot3d({ ...hill, style: "wire" }).drawables).find((d) => d.id === "wire_col_8") as unknown as { pts: Pt[] };
    const drawn = mid.reduce((s, w) => s + w.pts.length, 0);
    expect(drawn).toBeLessThan(full.pts.length);
    // Straight down: every wire whole.
    const top = { ...hill, elevation_deg: 85 };
    expect(pieces(top)).toBe(wireCount(top));
  });
});

describe("clip", () => {
  test("a polygon is cut to the box", () => {
    const b = { x0: 0, y0: 0, x1: 10, y1: 10 };
    expect(clipPolygon([[2, 2], [4, 2], [4, 4]], b)).toEqual([[2, 2], [4, 2], [4, 4]]);
    const cut = clipPolygon([[-5, 5], [5, 5], [5, 15], [-5, 15]], b);
    for (const [x, y] of cut) expect(x >= 0 && x <= 10 && y >= 0 && y <= 10).toBe(true);
    expect(clipPolygon([[20, 20], [30, 20], [30, 30]], b).length).toBeLessThan(3);
  });
  test("zoomed, the fills and wires stay in the plot's box — and off the legend's column", () => {
    const P = { ...HILLS, zoom: 2.5 };
    const box = pageOf(readModel(P)).box;
    const legend = leaves(P).filter((d) => d.id.startsWith("colorbar__"));
    for (const d of leaves(P))
      if (/^(surface_fill__|wire_)/.test(d.id) && d.pts) for (const [x, y] of d.pts) expect(x >= box.x0 - 1e-6 && x <= box.x1 + 1e-6 && y >= box.y0 - 1e-6 && y <= box.y1 + 1e-6).toBe(true);
    for (const d of legend) for (const [x] of d.pts!) expect(x).toBeGreaterThan(box.x1);
  });
});

describe("lint", () => {
  test("an unknown style or color_by, an opacity out of range, a legend with nothing to explain", () => {
    const msgs = (P: Plot3dParams) => lintPlot3d(P).map((i) => `${i.severity}: ${i.message}`);
    expect(msgs(HILLS)).toEqual([]);
    expect(msgs({ ...HILLS, style: "shaded" })).toEqual(['warn: style "shaded" is not one of wire, mesh, solid — drawn as "wire"']);
    expect(msgs({ ...HILLS, color_by: "z" })).toEqual(['warn: color_by "z" is not one of height, shade, flat — drawn as "height"']);
    expect(msgs({ ...HILLS, opacity: 1.5 })).toEqual(["warn: opacity 1.5 is outside 0.1–1 — drawn at 1"]);
    expect(msgs({ ...HILLS, opacity: 0 })).toEqual(["warn: opacity 0 is outside 0.1–1 — drawn at 0.1"]);
    expect(msgs({ surface: "x", opacity: 0.5 })).toEqual(['warn: color_by, shading, opacity and legend fill the surface — they do nothing with style "wire" (use "mesh" or "solid")']);
    expect(msgs({ ...HILLS, color_by: "shade" })).toEqual(['warn: legend explains height colours — it needs color_by "height"']);
  });
});

describe("performance", () => {
  test("a 20 × 20 mesh lays out in a few milliseconds", () => {
    const P: Plot3dParams = { ...HILLS, params: { A: { value: 1, min: 0, max: 2 } }, surface: `A*(${HILLS.surface})` };
    for (let k = 0; k < 5; k++) layoutPlot3d({ ...P, azimuth_deg: k });
    const N = 40;
    let t0 = performance.now();
    for (let k = 0; k < N; k++) layoutPlot3d({ ...P, azimuth_deg: 30 + k });
    const template = (performance.now() - t0) / N;
    t0 = performance.now();
    for (let k = 0; k < N; k++) layoutPlot3d({ ...P, style: "wire", azimuth_deg: 30 + k });
    const wire = (performance.now() - t0) / N;
    const pageMs = (Q: Plot3dParams): number => {
      for (let k = 0; k < 3; k++) pageFor({ ...Q, azimuth_deg: k });
      const t = performance.now();
      for (let k = 0; k < 10; k++) pageFor({ ...Q, azimuth_deg: 30 + k });
      return (performance.now() - t) / 10;
    };
    const page = pageMs(P);
    const pageWire = pageMs({ ...P, style: "wire" });
    console.log(`plot3d mesh 20×20: template layout ${template.toFixed(2)} ms (wire ${wire.toFixed(2)} ms); whole page ${page.toFixed(2)} ms (wire ${pageWire.toFixed(2)} ms)`);
    expect(template).toBeLessThan(25);
  });
});
