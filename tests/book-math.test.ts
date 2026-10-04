// A book's text-pane math must recover from a failed engine load: before
// 2026-10-03 one failed load (a chunk lost to a redeploy, a dropped
// connection) left every formula in the session as raw TeX — the Bayes book
// showed `\dfrac{9}{9 + 89} \approx 9\%` as plain code.
import { beforeEach, describe, expect, test, vi } from "vitest";

const state = vi.hoisted(() => ({ fail: true, loaded: false }));
const fakeEngine = {
  fontFor: () => "fira",
  layoutTeX: () => ({ outlines: [{ pts: [[0, 0], [1, 0], [1, 1], [0, 1]] as [number, number][], glyph: 0, token: {} }], tokens: [], w: 1, h: 1 }),
};
vi.mock("../src/scenes/engines", () => ({
  ensureEngines: async () => {
    if (state.fail) throw new Error("Failed to fetch dynamically imported module");
    state.loaded = true;
  },
  ensureMathFont: async () => {},
  getLoadedEngines: () => {
    if (!state.loaded) throw new Error('engine "mathjax" not loaded');
    return { mathjax: fakeEngine };
  },
}));

/** Enough of a DOM element for upgradeMath. */
function fakeRoot(html: string) {
  const unescape = (s: string): string => s.replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&amp;/g, "&");
  const els = [...html.matchAll(/<code class="bk-tex-fallback" data-tex="([^"]*)"( data-display="")?>(.*?)<\/code>/g)].map((m) => ({
    getAttribute: (n: string) => (n === "data-tex" ? unescape(m[1]) : null),
    hasAttribute: (n: string) => n === "data-display" && m[2] !== undefined,
    outerHTML: m[0],
  }));
  return { els, querySelectorAll: () => els };
}

describe("book math", () => {
  beforeEach(() => {
    vi.resetModules();
    state.fail = true;
    state.loaded = false;
  });

  test("a failed load writes plain TeX, then a retry draws it in place", async () => {
    const { loadBookMath, texSvg, upgradeMath } = await import("../src/book/math");
    expect(await loadBookMath()).toBe(false);
    const inline = texSvg("\\dfrac{9}{9 + 89} \\approx 9\\%", false);
    const display = texSvg("P(+)", true);
    // Readable while the engine is out; the TeX kept for drawing it later.
    expect(inline).toBe('<code class="bk-tex-fallback" data-tex="\\dfrac{9}{9 + 89} \\approx 9\\%">9/(9 + 89) ≈ 9%</code>');
    expect(display).toBe('<code class="bk-tex-fallback" data-tex="P(+)" data-display="">P(+)</code>');
    const root = fakeRoot(inline + display);
    expect(upgradeMath(root)).toBe(0); // still out: nothing touched

    state.fail = false; // the network is back
    expect(await loadBookMath()).toBe(true); // the failure was not remembered
    expect(upgradeMath(root)).toBe(2);
    expect(root.els[0].outerHTML).toMatch(/^<svg class="bk-tex"[^>]*aria-label="\\dfrac\{9\}\{9 \+ 89\} \\approx 9\\%"/);
    // The display formula keeps its display size (1.25 × the inline one).
    expect(root.els[1].outerHTML).toContain("width:0.625em");
  });

  test("plain text for TeX: fractions, \\text, symbols, escapes", async () => {
    const { plainTex } = await import("../src/book/math");
    expect(plainTex("\\dfrac{9}{9 + 89} \\approx 9\\%")).toBe("9/(9 + 89) ≈ 9%");
    expect(plainTex("P(\\text{sick} \\mid +) = \\frac{P(+ \\mid \\text{sick})\\,P(\\text{sick})}{P(+)}")).toBe(
      "P(sick | +) = (P(+ | sick) P(sick))/P(+)",
    );
    expect(plainTex("\\frac{0.9 \\times 0.01}{0.098} \\approx 0.09")).toBe("(0.9 × 0.01)/0.098 ≈ 0.09");
    expect(plainTex("\\sqrt{x^{2}} \\le \\frac12")).toBe("√(x^2) ≤ 1/2");
  });

  test("an engine a figure loaded later is taken up without another load", async () => {
    const { loadBookMath, texSvg } = await import("../src/book/math");
    expect(await loadBookMath()).toBe(false);
    state.loaded = true; // the figure's own math brought the engine in
    expect(texSvg("x", false)).toMatch(/^<svg class="bk-tex"/);
  });
});
