// "Click the line that …" on a code panel (2026-10-05, the microdata course):
// a click anywhere along the line's row — right of a short line, or in the
// gap between two — answers that line, never the panel.
import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { elementBBoxes, elementRings, layoutSpec } from "../src/layout/layout";
import { expandSpec } from "../src/spec/expand";
import { hitElement, rowBands } from "../src/ui/hit";

const spec = {
  title: "T",
  elements: [{ id: "md", type: "code", language: "microdata", width: 960, font_size: 18, show: "below", lines: 6, frame: "screen", code: "require no.ssb.fdb:54 as db\ncreate-dataset persons\nimport db/BEFOLKNING_KJOENN as sex\nimport db/INNTEKT_WLONN 2022-01-01 as wage\nsummarize wage" }],
  commands: [{ draw: ["md"] }],
};

test("a click right of a short line, or in a gap, answers that line", () => {
  const l = layoutSpec(expandSpec(spec as never));
  const raw = elementBBoxes(l);
  const boxes = rowBands(raw);
  const rings = elementRings(l);
  const l4 = raw.get("md_line_4")!, l5 = raw.get("md_line_5")!;
  // Far right of line 5's short text.
  expect(hitElement(raw, [l5.x + l5.w + 300, l5.y + l5.h / 2], 18, rings)).toBe("md");
  expect(hitElement(boxes, [l5.x + l5.w + 300, l5.y + l5.h / 2], 18, rings)).toBe("md_line_5");
  // Just above line 4's text box, in the gap towards line 3.
  expect(hitElement(boxes, [l4.x + 20, l4.y + l4.h + 2], 18, rings)).toBe("md_line_4");
  // On the text itself, as before.
  expect(hitElement(boxes, [l4.x + 20, l4.y + l4.h / 2], 18, rings)).toBe("md_line_4");
});

test("rows never overlap and boxes of other ids are untouched", () => {
  const l = layoutSpec(expandSpec(spec as never));
  const raw = elementBBoxes(l);
  const b = rowBands(raw);
  const r3 = b.get("md_line_3")!, r4 = b.get("md_line_4")!;
  expect(r4.y + r4.h).toBeLessThanOrEqual(r3.y + 1e-9);
  expect(b.get("md")).toEqual(raw.get("md"));
});

test("the course's own question resolves", () => {
  // lecture 1 part 3 asks for md_line_4 (the INNTEKT_WLONN import): same layout as above.
  expect(readFileSync("src/ui/controls.ts", "utf8")).toMatch(/rowBands\(elementBBoxes\(hd\.layout/);
});
