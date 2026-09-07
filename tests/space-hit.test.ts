// A click on a body must land on that body. The `focus` figures draw a frame
// around the portrait, and a frame that declares a closed OUTLINE shadows
// every element inside it: hitElement's outline pass returns the smallest
// outline containing the point and never reaches the box pass, so a
// full-canvas border answers every click (src/ui/hit.ts, "Pass 1"). That broke
// the ⊕ Space section's "click a moon to look closer", and with it click and
// drag questions on any focus figure, since all three share hitElement.

import { beforeAll, describe, expect, test } from "vitest";
import { ensureEnabledPacks } from "../src/scenes/packs";
import { DEFAULT_SETTINGS } from "../src/store";
import { ensureEngines } from "../src/scenes/engines";
import { elementBBoxes, elementRings, layoutSpec } from "../src/layout/layout";
import { flattenDrawables, type TextDrawable } from "../src/layout/model";
import { hitElement } from "../src/ui/hit";

beforeAll(async () => {
  await ensureEnabledPacks(DEFAULT_SETTINGS.enabledPacks);
  await ensureEngines(["space"]);
});

const lay = (params: Record<string, unknown>) =>
  layoutSpec({ template: "solar_system", params, elements: [] } as never);

/** What a click dead-centre on `id` resolves to, through the same call the gates make. */
function clickOn(params: Record<string, unknown>, id: string): string | null {
  const r = lay(params);
  const boxes = elementBBoxes(r);
  const b = boxes.get(id);
  if (!b) throw new Error(`no box for ${id}`);
  return hitElement(boxes, [b.x + b.w / 2, b.y + b.h / 2], 18, elementRings(r));
}

const MOONS = { focus: "jupiter", moons: ["jupiter"], date: "2026-09-09" };

describe("a click on a body lands on that body", () => {
  test("the focus portrait: every moon answers for itself", () => {
    const got = Object.fromEntries(["io", "europa", "ganymede", "callisto"].map((id) => [id, clickOn(MOONS, id)]));
    expect(got).toEqual({ io: "io", europa: "europa", ganymede: "ganymede", callisto: "callisto" });
  });

  // KNOWN LIMIT, recorded rather than hidden. The centre of a focus portrait
  // has its spin axis drawn through it, and a thin line's box is far smaller
  // than the disc's, so hitElement's box pass answers "axis" for a click dead
  // centre on the body. Harmless where it was found — the centre IS the focus,
  // so that click should change nothing — but a click question aimed at the
  // centre body of a portrait would grade against the axis. The honest fix is
  // to let a filled disc declare an outline (kit.ball emits one point plus a
  // circle hint, so it declares none today), which is a change to shared
  // hit-testing that every template using circle hints would feel. See
  // src/scenes/space/README.md.
  test("the centre of a portrait still loses to its own axis — the known limit", () => {
    expect(clickOn(MOONS, "jupiter")).toBe("axis");
  });

  test("the frame is drawn but owns no clicks — it is a border, not a region", () => {
    const r = lay(MOONS);
    expect(r.order).toContain("frame");
    expect([...elementRings(r).keys()]).not.toContain("frame");
  });

  test("the whole-system views keep working", () => {
    const top = { view: "top", scale: "schematic", date: "2026-09-06" };
    for (const id of ["mars", "earth", "jupiter"]) expect(clickOn(top, id), id).toBe(id);
  });
});

// Walking to a moon carried the authored `moons` with it, and that value names
// satellites of the body the viewer just left — so the figure grew a note
// reading like an error the viewer had caused. The tray clears it by sending an
// empty filter, which the template reads as "this body's own moons".
describe("looking closer does not accuse the viewer of naming something unknown", () => {
  const noteOf = (params: Record<string, unknown>): string | null => {
    const d = flattenDrawables(lay(params).drawables).find((x) => x.id === "missing_note") as
      | TextDrawable
      | undefined;
    return d ? d.text : null;
  };

  test("the authored figure carries no note", () => {
    expect(noteOf(MOONS)).toBeNull();
  });

  test("walking to a moon with the authored moons still set is what produced the note", () => {
    expect(noteOf({ ...MOONS, focus: "io" })).toBe("Unknown: jupiter (not a moon of io)");
  });

  test("an empty filter is what the tray sends instead, and it draws the body's own moons", () => {
    expect(noteOf({ ...MOONS, focus: "io", moons: [] })).toBeNull();
    expect(lay({ ...MOONS, focus: "earth", moons: [] }).order).toContain("moon");
  });
});
