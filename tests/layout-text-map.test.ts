// A template computes its own captions: an SEIR spec that names its
// compartments ["S","E","I","R"] never contains the word "Susceptible" — the
// layout supplies it. So a translated copy carries those words in text_map,
// and the layout substitutes them on the way out. Measured before building
// this: 67 of the 114 bundled drawcasts draw text the spec does not hold.

import { describe, expect, test } from "vitest";
import { applyTextMap, collectDrawnText } from "../src/layout/text-map";
import type { Drawable } from "../src/layout/model";
import type { LabelRequest } from "../src/layout/labels";

function textDrawable(id: string, text: string): Drawable {
  return { id, kind: "text", pos: [0, 0], text, fontSize: 20, anchor: "middle", z: 2, style: {}, drawOpts: {} } as unknown as Drawable;
}
function group(id: string, children: Drawable[]): Drawable {
  return { id, kind: "group", z: 1, style: {}, drawOpts: {}, children } as unknown as Drawable;
}
function labelRequest(id: string, text: string): LabelRequest {
  return { id, anchor: [0, 0], side: "above", text, fontSize: 20, style: {}, drawOpts: {} } as unknown as LabelRequest;
}

describe("collectDrawnText", () => {
  test("finds text inside groups, not just at the top level", () => {
    const drawables = [textDrawable("t1", "Energy"), group("box", [textDrawable("t2", "Susceptible")])];
    expect(collectDrawnText(drawables, [labelRequest("l1", "Reaction progress")])).toEqual(["Energy", "Susceptible", "Reaction progress"]);
  });

  test("reports each distinct string once, however often it is drawn", () => {
    expect(collectDrawnText([textDrawable("a", "Cost"), textDrawable("b", "Cost")], [])).toEqual(["Cost"]);
  });
});

describe("applyTextMap", () => {
  test("substitutes drawn text, reaching inside groups", () => {
    const drawables = [group("box", [textDrawable("t", "Susceptible")])];
    applyTextMap(drawables, [], { Susceptible: "Anfällig" });
    expect(collectDrawnText(drawables, [])).toEqual(["Anfällig"]);
  });

  test("substitutes label requests too, so the solver places the word that gets drawn", () => {
    const labels = [labelRequest("l", "Reaction progress")];
    applyTextMap([], labels, { "Reaction progress": "Reaktionsverlauf" });
    expect(labels[0].text).toBe("Reaktionsverlauf");
  });

  test("leaves text the map does not mention exactly as it was", () => {
    const drawables = [textDrawable("t", "β·S·I")];
    applyTextMap(drawables, [], { Susceptible: "Anfällig" });
    expect(collectDrawnText(drawables, [])).toEqual(["β·S·I"]);
  });
});
