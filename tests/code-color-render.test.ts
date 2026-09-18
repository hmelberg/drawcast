// Renders a `code` element through the real SVG backend against the
// mini-dom shim (tests/helpers/mini-dom.ts — this repo carries no jsdom) and
// inspects the actual DOM drawLeaf builds: a coloured source line becomes
// nested <tspan fill="…"> runs, a plain run gets no fill attribute, and a
// wrapped multi-row line marks its row tspans with data-row (the marker
// render/svg-backend.ts's `type` mode reads to tell a ROW from a coloured
// line's own RUN tspans). The per-frame reveal math itself is covered
// DOM-free in tests/type-reveal.test.ts; this test is the static structure
// that math reads.

import { describe, expect, test } from "vitest";
import { rendererFor } from "../src/render/svg-backend";
import { layoutSpec } from "../src/layout/layout";
import { heuristicMeasure } from "../src/layout/measure";
import { tokenColor } from "../src/code/highlight";
import { installMiniDom, FakeNode, leafNodesFor } from "./helpers/mini-dom";
import type { Spec } from "../src/spec/types";

const spec = (el: object): Spec => ({ elements: [{ id: "c1", type: "code", language: "python", code: "print(1)", ...el }], commands: [{ draw: ["c1"] }] }) as unknown as Spec;

async function mountAndFind(s: Spec, leafId: string) {
  const { doc, restore } = installMiniDom();
  try {
    const layout = layoutSpec(s, heuristicMeasure);
    const container = new FakeNode("div", doc as never);
    await rendererFor("clean").mount(layout, s as never, container as never);
    // drawLeaf stamps `dataset.leafId` on the leaf's OWN wrapper <g> — the
    // <text> itself sits one level inside it.
    const g = leafNodesFor(container, leafId).find((n) => n.tagName === "g")!;
    return g.querySelectorAll("text")[0]!;
  } finally {
    restore();
  }
}

describe("drawLeaf: coloured runs become nested tspans", () => {
  test("a single-row coloured line: <text> holds one tspan per run directly, no row wrapper", async () => {
    const text = await mountAndFind(spec({ show: "code", code: "if x:", language: "python" }), "c1_line_1");
    // No `lines` (unwrapped) → drawLeaf's single-row branch: run tspans sit
    // directly on <text>, none marked data-row (there is no separate ROW
    // wrapper to mark).
    expect(text.children.every((c) => c.tagName === "tspan")).toBe(true);
    expect(text.children.some((c) => c.dataset.row)).toBe(false);
    const texts = text.children.map((c) => c.textContent);
    expect(texts.join("")).toBe("if x:");
    const ifSpan = text.children.find((c) => c.textContent === "if")!;
    expect(ifSpan.getAttribute("fill")).toBe(tokenColor("keyword"));
    // A plain run (the trailing " x:") carries no fill attribute at all —
    // it inherits the ancestor <text>'s own color.
    const plainSpan = text.children.find((c) => c.textContent === " x:")!;
    expect(plainSpan.hasAttribute("fill")).toBe(false);
  });

  test("a wrapped multi-row line: each ROW tspan is marked data-row and nests its own run tspans", async () => {
    const long = "x = " + Array.from({ length: 30 }, (_, i) => `term_${i}`).join(" + ");
    const text = await mountAndFind(spec({ show: "code", code: long, language: "python" }), "c1_line_1");
    expect(text.children.length).toBeGreaterThan(1);
    for (const row of text.children) {
      expect(row.tagName).toBe("tspan");
      expect(row.dataset.row).toBe("1");
      expect(row.getAttribute("dy")).not.toBeNull(); // the row-positioning attribute, unchanged
      // Every row's own children are run tspans whose texts concatenate to
      // that row's textContent-equivalent (the row tspan itself carries no
      // direct text — only its nested run tspans do).
      expect(row.children.length).toBeGreaterThan(0);
      for (const run of row.children) expect(run.tagName).toBe("tspan");
    }
  });

  test("an uncoloured pane (the output pane) keeps the old shape: no nested tspans at all", async () => {
    const OK = JSON.stringify({ ok: true, stdout: "hello", stderr: "", figures: [] });
    const text = await mountAndFind(spec({ show: "left", code: "print(1)", code_result: OK }), "c1__out0");
    expect(text.children.length).toBe(0);
    expect(text.textContent).toBe("hello");
  });
});
