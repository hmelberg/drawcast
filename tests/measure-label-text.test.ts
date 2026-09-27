// A measure's label is drawn text: without {value} it is written as it
// stands, and it reads {var} tokens like any other text. The 2026-09-27
// prompt-lab tax cast drew "$1035.1" and "+$1.4 fans4.9" — the measured
// length was glued onto a label the author meant as the whole text.
import { describe, expect, test } from "vitest";
import { formatMeasure } from "../src/layout/measures";
import { layoutSpec } from "../src/layout/layout";
import { heuristicMeasure } from "../src/layout/measure";
import { flattenDrawables } from "../src/layout/model";
import { expandSpec } from "../src/spec/expand";
import { interpolateVars } from "../src/spec/vars";
import type { Spec } from "../src/spec/types";

const textOf = (out: ReturnType<typeof layoutSpec>, id: string) => (flattenDrawables(out.drawables).find((d) => d.id === id) as { text?: string } | undefined)?.text;

describe("measure label text", () => {
  test("a label without {value} is drawn as written", () => {
    expect(formatMeasure(35.1, { label: "$10", scale: 1 })).toBe("$10");
    expect(formatMeasure(35.1, { label: "$10", scale: 1, unit: "cm" })).toBe("$10");
    expect(formatMeasure(35.1, { label: "{value}", scale: 1 })).toBe("35.1");
  });

  test("the tax wedge's gap labels: vars filled, no number appended", () => {
    const spec = {
      vars: { fb: 1.4, fs: 8.6 },
      elements: [
        { id: "fans_bracket", type: "path", points: [[100, 300], [100, 380]] },
        { id: "sell_bracket", type: "path", points: [[200, 300], [200, 420]] },
        { id: "ten_bracket", type: "path", points: [[300, 300], [300, 400]] },
        { id: "gap_fans", type: "measure", of: "fans_bracket", label: "+${fb:1} fans" },
        { id: "gap_sell", type: "measure", of: "sell_bracket", label: "−${fs:1} sellers" },
        { id: "ten_gap", type: "measure", of: "ten_bracket", label: "$10" },
        { id: "side", type: "measure", of: "ten_bracket", label: "{fb} → {value}" },
      ],
      commands: [{ draw: ["fans_bracket", "sell_bracket", "ten_bracket", "gap_fans", "label_gap_fans", "gap_sell", "label_gap_sell", "ten_gap", "label_ten_gap", "side", "label_side"] }],
    } as unknown as Spec;
    const out = layoutSpec(expandSpec(spec), heuristicMeasure);
    expect(textOf(out, "label_gap_fans")).toBe("+$1.4 fans");
    expect(textOf(out, "label_gap_sell")).toBe("−$8.6 sellers");
    expect(textOf(out, "label_ten_gap")).toBe("$10");
    expect(textOf(out, "label_side")).toBe("1.4 → 100");
    expect(out.warnings.filter((w) => /value/.test(w))).toEqual([]);
  });
});

describe("thousands grouping in drawn text: {m:0,}", () => {
  test("a comma in an English cast, a no-break space beside a decimal comma", () => {
    expect(interpolateVars("{m:0,} kr", { m: 1234567 }).text).toBe("1,234,567 kr");
    expect(interpolateVars("{m:0,} kr", { m: 1234567 }, true).text).toBe("1 234 567 kr");
    expect(interpolateVars("{m:2,}", { m: -12500.5 }, true).text).toBe("-12 500,50");
    expect(interpolateVars("{m:,}", { m: 999 }).text).toBe("999");
    expect(interpolateVars("{m:0}", { m: 12500 }).text).toBe("12500");
  });
});
