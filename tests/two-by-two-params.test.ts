// two_by_two_table's params for a book page (2026-10-05): label_size, the
// margin totals, a native box, and the a/b/c/d cell letters on request only.
import { describe, expect, test } from "vitest";
import { layoutTwoByTwoTable, type TwoByTwoParams } from "../src/scenes/two_by_two_table/layout";
import { flattenDrawables, type TextDrawable } from "../src/layout/model";
import { layoutSpec, nativeBox, elementBBoxes } from "../src/layout/layout";
import { heuristicMeasure } from "../src/layout/measure";
import { templateParamErrors } from "../src/scenes/params-check";
import { scenes } from "../src/scenes/registry";

const base: TwoByTwoParams = {
  row_label: "Test",
  col_label: "Disease",
  row_values: ["Positive", "Negative"],
  col_values: ["Sick", "Healthy"],
  cells: [["9", "89"], ["1", "901"]],
};
const texts = (p: Partial<TwoByTwoParams>) => flattenDrawables(layoutTwoByTwoTable({ ...base, ...p } as TwoByTwoParams).drawables).filter((d): d is TextDrawable => d.kind === "text");
const text = (p: Partial<TwoByTwoParams>, id: string) => texts(p).find((d) => d.id === id);

describe("two_by_two_table params", () => {
  test("cell letters only when asked", () => {
    expect(texts({}).some((d) => /letter/.test(d.id))).toBe(false);
    const letters = texts({ cell_letters: true }).filter((d) => /letter/.test(d.id)).map((d) => d.text);
    expect(letters.sort()).toEqual(["a", "b", "c", "d"]);
  });

  test("totals: true sums the cells into the margins", () => {
    expect(text({}, "row_total_0")).toBeUndefined();
    expect(text({ totals: true }, "row_total_0")?.text).toBe("98");
    expect(text({ totals: true }, "row_total_1")?.text).toBe("902");
    expect(text({ totals: true }, "col_total_0")?.text).toBe("10");
    expect(text({ totals: true }, "col_total_1")?.text).toBe("990");
    expect(text({ totals: true }, "grand_total")?.text).toBe("1000");
    expect(text({ totals: true }, "row_totals_head")?.text).toBe("Total");
    expect(text({ totals: true, total_label: "Sum" }, "col_totals_head")?.text).toBe("Sum");
  });

  test("totals written by the author win, and thousands keep their commas", () => {
    expect(text({ row_totals: ["98 people", "902 people"] }, "row_total_0")?.text).toBe("98 people");
    expect(text({ totals: true, cells: [["1,200", "800"], ["300", "2,700"]] }, "grand_total")?.text).toBe("5,000");
  });

  test("totals: true over cells that are not numbers draws none, and says so", () => {
    const l = layoutTwoByTwoTable({ ...base, cells: [["TP", "FP"], ["FN", "TN"]], totals: true });
    expect(flattenDrawables(l.drawables).some((d) => d.id === "row_total_0")).toBe(false);
    expect(l.warnings?.some((w) => /totals/.test(w))).toBe(true);
  });

  test("label_size sizes the headers and captions", () => {
    expect(text({}, "row_header_0")?.fontSize).toBe(22);
    expect(text({ label_size: 30 }, "row_header_0")?.fontSize).toBe(30);
    expect(text({ label_size: 30 }, "col_title")?.fontSize).toBe(30);
  });

  test("without the new params the table is drawn exactly as before", () => {
    expect(text({}, "row_header_0")?.pos).toEqual([240, 435]);
    expect(text({}, "col_title")?.pos).toEqual([500, 595]);
  });

  test("a native box: the table, headers and totals inside the right half, at full text size", () => {
    expect(nativeBox("two_by_two_table")).toBe(true);
    expect(templateParamErrors("two_by_two_table", { ...base, box: "right" })).toEqual([]);
    const l = layoutSpec({ template: "two_by_two_table", params: { ...base, totals: true, box: { x: 520, y: 120, w: 440, h: 420 } }, commands: [] } as never, heuristicMeasure);
    for (const [id, b] of elementBBoxes(l, heuristicMeasure)) {
      expect(b.x, id).toBeGreaterThanOrEqual(519);
      expect(b.x + b.w, id).toBeLessThanOrEqual(961);
      expect(b.y, id).toBeGreaterThanOrEqual(119);
      expect(b.y + b.h, id).toBeLessThanOrEqual(541);
    }
    const header = flattenDrawables(l.drawables).find((d) => d.id === "row_header_0") as TextDrawable;
    expect(header.fontSize).toBe(22);
  });

  test("the manifest documents the new params", () => {
    const props = (scenes.two_by_two_table.manifest.params_schema as { properties: Record<string, unknown> }).properties;
    for (const k of ["label_size", "totals", "row_totals", "col_totals", "total_label", "box", "cell_letters"]) expect(props[k], k).toBeDefined();
  });
});
