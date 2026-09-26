import { describe, expect, test } from "vitest";
import { detailRuns, firstSentence } from "../src/ui/details-render";
import { cardTargets } from "../src/ui/card-model";
import type { Spec } from "../src/spec/types";

describe("formal details", () => {
  test("text and math runs, inline and display", () => {
    expect(detailRuns("Demand is $Q = 100 - P$, so $$P = 40$$ here.")).toEqual([
      { kind: "text", s: "Demand is " },
      { kind: "math", s: "Q = 100 - P" },
      { kind: "text", s: ", so " },
      { kind: "display", s: "P = 40" },
      { kind: "text", s: " here." },
    ]);
  });
  test("the hover preview is the first sentence, math kept whole", () => {
    expect(firstSentence("Demand is $Q = 100.5 - P$. It bends.")).toBe("Demand is $Q = 100.5 - P$.");
    expect(firstSentence("No full stop")).toBe("No full stop");
  });
  test("an element's details, a label's, and the spec map for template parts", () => {
    const spec = {
      title: "t",
      template: "supply_demand",
      details: { demand_curve: "Demand is $Q = 100 - P$." },
      elements: [
        { id: "ramp", type: "polygon", points: [], details: "A ramp at 30°." },
        { id: "l", type: "label", text: "Friction", attach_to: "arrow_f", details: "At most μN." },
      ],
    } as unknown as Spec;
    const t = cardTargets(spec);
    expect(t.get("demand_curve")?.details).toBe("Demand is $Q = 100 - P$.");
    expect(t.get("ramp")?.details).toBe("A ramp at 30°.");
    expect(t.get("arrow_f")?.details).toBe("At most μN.");
    expect(t.get("arrow_f")?.name).toBe("Friction");
  });
});

import { buildSystemBlocks } from "../src/llm/prompt";
describe("the prompt builder inserts parts verbatim", () => {
  test("a `$` pattern in the schema or few-shots is text, not a replacement pattern", () => {
    const { prefix } = buildSystemBlocks("A {{SCHEMA}} B {{FEWSHOTS}} C", {
      schema: { d: "`$…$` and $$x$$ and $& and $'" },
      catalog: "",
      fewshots: "costs $` 5",
      exemplars: "",
    } as never);
    expect(prefix).toBe('A {"d":"`$…$` and $$x$$ and $& and $\'"} B costs $` 5 C');
  });
});
