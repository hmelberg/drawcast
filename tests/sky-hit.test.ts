// A click on the sky must reach what was clicked. The trap this file exists
// for: round 1 drew a `frame` with closed: true, elementRings handed it an
// outline covering the whole canvas, and hitElement's outline pass returned it
// for every click and never reached the box pass (src/ui/hit.ts, "Pass 1").
// A sky map draws a horizon circle, which is the same shape and the same risk.

import { beforeAll, describe, expect, test } from "vitest";
import { ensureEnabledPacks } from "../src/scenes/packs";
import { DEFAULT_SETTINGS } from "../src/store";
import { ensureEngines } from "../src/scenes/engines";
import { elementBBoxes, elementRings, layoutSpec } from "../src/layout/layout";
import { hitElement } from "../src/ui/hit";

const AT = "2026-09-07T21:00:00Z";

beforeAll(async () => {
  await ensureEnabledPacks(DEFAULT_SETTINGS.enabledPacks);
  await ensureEngines(["space", "sky"]);
});

const lay = (params: Record<string, unknown>) =>
  layoutSpec({ template: "sky_map", params: { time: AT, ...params }, elements: [] } as never);

function clickOn(params: Record<string, unknown>, id: string): string | null {
  const r = lay(params);
  const b = elementBBoxes(r).get(id);
  if (!b) throw new Error(`no box for ${id}`);
  return hitElement(elementBBoxes(r), [b.x + b.w / 2, b.y + b.h / 2], 18, elementRings(r));
}

describe("the horizon is drawn but owns no clicks", () => {
  test("it declares no outline", () => {
    const r = lay({});
    expect(r.order).toContain("horizon");
    expect([...elementRings(r).keys()]).not.toContain("horizon");
  });

  test("a click on a marked star answers that star, not the rim it sits inside", () => {
    expect(clickOn({ mark: ["Vega"] }, "vega")).toBe("vega");
    expect(clickOn({ mark: ["Vega", "Deneb"] }, "deneb")).toBe("deneb");
  });

  test("a click on a planet answers that planet", () => {
    expect(clickOn({}, "saturn")).toBe("saturn");
  });
});

describe("the Moon answers for its whole disc, lit or not", () => {
  test("the centre of a crescent moon is still the Moon", () => {
    const params = { time: "2026-02-22T20:00:00Z", show: ["moon"] };
    expect(clickOn(params, "moon")).toBe("moon");
    const r = lay(params);
    // It has a ring, and the ring is the whole disc — not just the crescent.
    const rings = elementRings(r).get("moon")!;
    const box = elementBBoxes(r).get("moon")!;
    const areas = rings.map((ring) => {
      let a = 0;
      for (let i = 0; i < ring.length; i++) { const p = ring[i], q = ring[(i + 1) % ring.length]; a += p[0] * q[1] - q[0] * p[1]; }
      return Math.abs(a) / 2;
    });
    expect(Math.max(...areas)).toBeGreaterThan(0.6 * box.w * box.h);
  });
});

describe("a constellation answers for its own patch of sky", () => {
  const WINTER = "2026-12-20T21:00:00Z";
  test("a click inside a singled-out figure answers that figure", () => {
    expect(clickOn({ time: WINTER, mark: ["Orion"] }, "con_ori")).toBe("con_ori");
  });

  test("a click on a named star inside it answers the star, which is the smaller thing", () => {
    // Smallest box wins (src/ui/hit.ts pass 2), and that is the right answer:
    // a click ON Betelgeuse means Betelgeuse. This is why the constellation
    // questions in this round are quizzes and typed answers, not click asks.
    expect(clickOn({ time: WINTER, mark: ["Orion", "Betelgeuse"] }, "betelgeuse")).toBe("betelgeuse");
  });

  test("in a portrait every star of the figure answers for itself", () => {
    const params = { time: WINTER, focus: "Orion" };
    for (const id of ["betelgeuse", "rigel"]) expect(clickOn(params, id), id).toBe(id);
  });
});
