import { describe, expect, test } from "vitest";
import { planCommands, type PlanStep } from "../src/render/plan";
import { rendererFor } from "../src/render/svg-backend";
import { layoutSpec } from "../src/layout/layout";
import { heuristicMeasure } from "../src/layout/measure";
import { validateSpec } from "../src/spec/schema";
import { installMiniDom, FakeNode } from "./helpers/mini-dom";

const SPEC = {
  elements: [
    { id: "h", type: "node", shape: "rect", text: "Households", x: 200, y: 375 },
    { id: "f", type: "node", shape: "rect", text: "Firms", x: 800, y: 375 },
    { id: "money", type: "arrow", from: { ref: "f" }, to: { ref: "h" }, curved: true, style: { color: "#2f6b8f" } },
  ],
  commands: [{ draw: ["h", "f", "money"] }, { flow: { along: ["money"] }, speak: "Money circulates." }],
};

describe("flow planning", () => {
  test("defaults, the narration hold, and the schema", () => {
    const plan = planCommands(SPEC.commands as never, ["h", "f", "money"], { bboxOf: () => ({ x: 0, y: 0, w: 10, h: 10 }) });
    const step = plan.steps[1] as Extract<PlanStep, { kind: "flow" }>;
    expect(step).toMatchObject({ kind: "flow", ids: ["money"], seconds: 3, speed: 120, spacing: 24, marks: "dots", reverse: false, untilNarrationEnd: true });
    const timed = planCommands([{ flow: { along: "money", duration: 2, kind: "dashes", reverse: true, speed: 60 } }], ["money"], {});
    expect(timed.steps[0]).toMatchObject({ kind: "flow", seconds: 2, marks: "dashes", reverse: true, speed: 60 });
    expect((timed.steps[0] as { untilNarrationEnd?: boolean }).untilNarrationEnd).toBeUndefined();
    expect(validateSpec(SPEC as never).ok).toBe(true);
    expect(validateSpec({ ...SPEC, commands: [{ flow: { speed: 3 } }] } as never).ok).toBe(false);
  });
});

describe("setFlow on the SVG backend", () => {
  for (const style of ["clean", "sketchy"] as const) {
    test(`an overlay path inside the stroke's own group, dashed and offset by the distance travelled; endFlow removes it (${style})`, async () => {
      const { restore, doc } = installMiniDom();
      try {
        const layout = layoutSpec(SPEC as never, heuristicMeasure);
        const container = new FakeNode("div", doc as never);
        const mounted = await rendererFor(style).mount(layout, SPEC as never, container as never);
        for (const el of mounted.elements.values()) el.finish();
        const effects = mounted.effects!;
        const leaf = () => {
          const out: FakeNode[] = [];
          const walk = (n: FakeNode) => { if (n.dataset.leafId === "money") out.push(n); n.children.forEach(walk); };
          walk(container);
          return out[0];
        };
        const before = leaf().children.length;
        effects.setFlow!(["money"], { spacing: 24, marks: "dots", reverse: false }, { travelled: 30, alpha: 1 });
        const overlay = leaf().children[leaf().children.length - 1];
        expect(leaf().children.length).toBe(before + 1);
        expect(overlay.getAttribute("stroke-dasharray")).toBe("0.1 24");
        expect(overlay.getAttribute("stroke-dashoffset")).toBe("-6.00"); // 30 mod 24, forwards
        expect(overlay.getAttribute("stroke")).toBe("#2f6b8f");
        effects.setFlow!(["money"], { spacing: 24, marks: "dots", reverse: false }, { travelled: 31, alpha: 0.5 });
        expect(leaf().children.length).toBe(before + 1); // reused, not re-added
        expect(overlay.getAttribute("opacity")).toBe("0.475");
        effects.endFlow!(["money"]);
        expect(leaf().children.length).toBe(before);
      } finally {
        restore();
      }
    });
  }
});
