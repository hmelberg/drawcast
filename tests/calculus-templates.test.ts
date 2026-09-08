import { beforeAll, describe, expect, test } from "vitest";
import { ensureEnabledPacks } from "../src/scenes/packs";
import { scenes } from "../src/scenes/registry";
import { layoutSpec } from "../src/layout/layout";
import { sliderSpecs } from "../src/ui/tray-model";

beforeAll(async () => {
  await ensureEnabledPacks(["mathlogic"]);
});

const lay = (template: string, params: Record<string, unknown>) => layoutSpec({ template, params, elements: [] } as never);
const textOf = (out: ReturnType<typeof lay>, id: string) => (out.drawables.find((d) => d.id === id) as { text?: string } | undefined)?.text ?? "";

describe("riemann_sum", () => {
  test("registers ready with n as a slider", () => {
    expect(scenes.riemann_sum?.manifest.status).toBe("ready");
    expect(sliderSpecs(scenes.riemann_sum.manifest.params_schema).map((s) => s.path)).toContain("n");
  });
  test("n bars under the curve, lint-clean across the animate range; the sum approaches the integral", () => {
    const sums: number[] = [];
    for (const n of [1, 6, 40, 200]) {
      const out = lay("riemann_sum", { expr: "x*x/10 + 1", x_from: 0, x_to: 10, a: 2, b: 8, n });
      expect(out.warnings, `n=${n}`).toEqual([]);
      expect(out.issues.filter((i) => i.severity === "error"), `n=${n}`).toEqual([]);
      expect(out.order.filter((id) => /^bar_\d+$/.test(id))).toHaveLength(n);
      const m = /Σ ≈ ([\d.]+)/.exec(textOf(out, "sum_label"));
      expect(m, `n=${n}`).not.toBeNull();
      sums.push(Number(m![1]));
    }
    // ∫₂⁸ (x²/10 + 1) dx = (512 − 8)/30 + 6 = 22.8
    expect(Math.abs(sums[3] - 22.8)).toBeLessThan(0.2);
    expect(Math.abs(sums[0] - 22.8)).toBeGreaterThan(Math.abs(sums[3] - 22.8));
    expect(textOf(lay("riemann_sum", { n: 6 }), "exact_label")).toMatch(/∫ ≈/);
  });
  test("a fractional n rounds; right and midpoint rules bracket the integral for an increasing curve", () => {
    expect(lay("riemann_sum", { n: 5.6 }).order.filter((id) => /^bar_\d+$/.test(id))).toHaveLength(6);
    const left = Number(/Σ ≈ ([\d.]+)/.exec(textOf(lay("riemann_sum", { n: 6, rule: "left" }), "sum_label"))![1]);
    const right = Number(/Σ ≈ ([\d.]+)/.exec(textOf(lay("riemann_sum", { n: 6, rule: "right" }), "sum_label"))![1]);
    expect(left).toBeLessThan(right);
  });
  test("both manifest examples lint clean", () => {
    for (const ex of scenes.riemann_sum.manifest.examples) {
      const out = lay("riemann_sum", ex.params);
      expect(out.warnings).toEqual([]);
      expect(out.issues.filter((i) => i.severity === "error")).toEqual([]);
    }
  });
});

describe("tangent_secant", () => {
  test("registers ready with h as a slider", () => {
    expect(scenes.tangent_secant?.manifest.status).toBe("ready");
    expect(sliderSpecs(scenes.tangent_secant.manifest.params_schema).map((s) => s.path)).toContain("h");
  });
  test("the secant's slope converges on the derivative as h shrinks; every frame is lint-clean", () => {
    const slopes: number[] = [];
    for (const h of [4, 1, 0.05]) {
      const out = lay("tangent_secant", { expr: "x*x/10 + 1", x_from: 0, x_to: 10, at: 4, h });
      expect(out.warnings, `h=${h}`).toEqual([]);
      expect(out.issues.filter((i) => i.severity === "error"), `h=${h}`).toEqual([]);
      for (const id of ["axes", "curve", "point_a", "point_b", "secant", "tangent", "run", "rise", "slope_label", "derivative_label"]) expect(out.order, `${id} at h=${h}`).toContain(id);
      slopes.push(Number(/≈ (-?[\d.]+)/.exec(textOf(out, "slope_label"))![1]));
    }
    expect(textOf(lay("tangent_secant", { at: 4 }), "derivative_label")).toMatch(/f′\(4\) = 0\.80/);
    expect(Math.abs(slopes[2] - 0.8)).toBeLessThan(0.02);
    expect(Math.abs(slopes[0] - 0.8)).toBeGreaterThan(Math.abs(slopes[2] - 0.8));
    // the Δ labels give way when the triangle is too small to carry them
    expect(lay("tangent_secant", { at: 4, h: 4 }).order).toContain("label_dx");
    expect(lay("tangent_secant", { at: 4, h: 0.05 }).order).not.toContain("label_dx");
  });
  test("at the domain's right edge, the secant stays finite (no NaN slope)", () => {
    for (const params of [{ at: 10 }, { at: 10, h: 0.01 }]) {
      const out = lay("tangent_secant", params);
      expect(out.warnings, JSON.stringify(params)).toEqual([]);
      expect(out.issues.filter((i) => i.severity === "error"), JSON.stringify(params)).toEqual([]);
      expect(out.order, JSON.stringify(params)).toContain("secant");
      expect(textOf(out, "slope_label"), JSON.stringify(params)).toMatch(/slope ≈ -?[\d.]+$/);
    }
  });
  test("at below the domain's left edge clamps to x_from and stays finite too", () => {
    const out = lay("tangent_secant", { at: -5 });
    expect(out.warnings).toEqual([]);
    expect(out.issues.filter((i) => i.severity === "error")).toEqual([]);
    expect(out.order).toContain("secant");
    expect(textOf(out, "slope_label")).toMatch(/slope ≈ -?[\d.]+$/);
  });
  test("both manifest examples lint clean", () => {
    for (const ex of scenes.tangent_secant.manifest.examples) {
      const out = lay("tangent_secant", ex.params);
      expect(out.warnings).toEqual([]);
      expect(out.issues.filter((i) => i.severity === "error")).toEqual([]);
    }
  });
});
