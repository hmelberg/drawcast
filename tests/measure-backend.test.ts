import { describe, expect, test } from "vitest";
import { layoutSpec } from "../src/layout/layout";
import { heuristicMeasure } from "../src/layout/measure";
import { rendererFor } from "../src/render/svg-backend";
import { installMiniDom, FakeNode } from "./helpers/mini-dom";

const SPEC = { elements: [{ id: "sq", type: "polygon", points: [[200, 200], [300, 200], [300, 300], [200, 300]] }, { id: "ar", type: "measure", of: "sq", label: "A = {value}" }], commands: [{ draw: ["sq", "ar"] }] };

describe("setText on the SVG backend", () => {
  for (const style of ["clean", "sketchy"] as const) {
    test(`rewrites a text leaf's content and restores it when unlisted (${style})`, async () => {
      const { restore, doc } = installMiniDom();
      try {
        const layout = layoutSpec(SPEC as never, heuristicMeasure);
        const container = new FakeNode("div", doc as never);
        const mounted = await rendererFor(style).mount(layout, SPEC as never, container as never);
        const el = mounted.elements.get("label_ar")!;
        el.finish();
        const textNode = () => { const out: FakeNode[] = []; const walk = (n: FakeNode) => { if (n.tagName === "text") out.push(n); n.children.forEach(walk); }; walk(container); return out.find((t) => (t.textContent ?? "").includes("A = ")); };
        expect(textNode()!.textContent).toBe("A = 10000");
        el.setText!({ label_ar: "A = 40000" });
        expect(textNode()!.textContent).toBe("A = 40000");
        el.setText!({});
        expect(textNode()!.textContent).toBe("A = 10000");
      } finally {
        restore();
      }
    });
  }
});
