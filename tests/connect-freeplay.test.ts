// Free play (interactivity spec §6, the third-and-fourth interaction kinds
// after piano/chess/periodic): a paused click on a planet, a star or a
// constellation opens its card. Follows tests/periodic-interaction.test.ts's
// shape — that file is the pattern for exactly this, the periodic table's
// own scene-names branch — but goes one step further than its "info card"
// block did: it calls `sceneNamesFor` itself, against REAL sky_map and
// solar_system layouts, rather than a hand-rolled stand-in fed to
// cardTargets. A test that only exercises activitiesFor/KNOWN_INTERACTIONS/
// the manifest would stay green even if both new branches returned `[]` —
// which is the entire feature — so this file is what actually calls the
// code that names a click.

import { beforeAll, describe, expect, it } from "vitest";
import spaceYaml from "../src/scenes/packs/space.yaml?raw";
import { registerPack, unregisterPack } from "../src/scenes/packs";
import { ensureEngines } from "../src/scenes/engines";
import { activitiesFor } from "../src/ui/quiz-model";
import { sceneNamesFor } from "../src/ui/infocard";
import { KNOWN_INTERACTIONS } from "../src/scenes/types";
import { scenes } from "../src/scenes/registry";
import { layoutSpec, type LayoutResult } from "../src/layout/layout";
import type { RenderHandle } from "../src/render";

// A fixed instant, Oslo (SKY_DEFAULTS' own default place): Ursa Minor is
// circumpolar there, so it and its stars are up whatever the clock says —
// picked BECAUSE it is boring astronomically, not despite it. Saturn (16.7°
// up at this moment; every other naked-eye body is below the horizon, hand-
// checked against the real ephemeris before writing this file) is what
// stands in for "a planet" in the unfocused chart.
const AT = "2026-09-07T21:00:00Z";
const DATE = "2026-09-06";

/** The minimal shape `sceneNamesFor` actually reads off a RenderHandle — its
 *  own two fields, not the whole render pipeline (fonts, timeline, a live
 *  DOM container) `render()` would otherwise force every test here to pay
 *  for. `layout` is `layoutSpec`'s own return value, unmodified — the same
 *  object `hd.layout` holds in production (`render/index.ts`: `layout =
 *  applyTextStyle(layoutSpec(spec, measure), textStyle)`). */
const handleFor = (template: string, params: Record<string, unknown>, layout: LayoutResult): RenderHandle =>
  ({ spec: { template, params, elements: [] }, layout }) as unknown as RenderHandle;

const namesOf = (hd: RenderHandle): Map<string, string> => new Map(sceneNamesFor(hd).map((n) => [n.id, n.name]));

// The space pack registers lazily and its two engines load asynchronously
// (packs.ts / engines.ts) — every real-layout `beforeAll` below runs AFTER
// this one, so `layoutSpec` never runs ahead of registration the way a
// describe-body-level call would (collection runs before any `beforeAll`).
beforeAll(async () => {
  await ensureEngines(["sky", "space"]);
  unregisterPack("space");
  registerPack("space", spaceYaml);
});

describe("the interaction is declared, not sniffed", () => {
  it("both templates declare their interaction", () => {
    expect(scenes.solar_system.manifest.interactions).toEqual(["space"]);
    expect(scenes.sky_map.manifest.interactions).toEqual(["sky"]);
  });
  it("knows the two new kinds", () => {
    expect(KNOWN_INTERACTIONS).toContain("space");
    expect(KNOWN_INTERACTIONS).toContain("sky");
  });
});

describe("activitiesFor: a declaration alone must not cost the generic drill", () => {
  it("keeps the generic drill for a kind with no bespoke activity of its own", () => {
    // The trap this pins: activitiesFor used to return the parts drill ONLY
    // when a figure declared nothing at all, so declaring an interaction for
    // the sake of CARDS would silently take the drill away.
    expect(activitiesFor(["sky"], 12).map((a) => a.id)).toEqual(["parts_quiz"]);
    expect(activitiesFor(["space"], 9).map((a) => a.id)).toEqual(["parts_quiz"]);
  });
  it("still gives a bespoke kind its own activities and no generic one", () => {
    expect(activitiesFor(["piano"], 30).map((a) => a.id)).toEqual(["note_quiz"]);
  });
  it("gives nothing to a figure with too few parts", () => {
    expect(activitiesFor(["sky"], 2)).toEqual([]);
  });
});

describe("sceneNamesFor(sky): a focused constellation, on the real catalogue", () => {
  // Confirmed by hand against the bundled tables before writing this test:
  // Ursa Minor's edges touch HIP 11767 (Polaris/Polarstjernen), 72607
  // (Kochab), 75097 (Pherkad) and four unnamed stars — 77055, 79822, 82080,
  // 85822 — every one of which `focus` singles out as its own drawable.
  const focusSpec = { time: AT, focus: "Ursa Minor" };
  let res: LayoutResult;
  let hd: RenderHandle;
  beforeAll(() => {
    res = layoutSpec({ template: "sky_map", params: focusSpec, elements: [] } as never);
    hd = handleFor("sky_map", focusSpec, res);
  });

  it("really did draw the ids this test is about to name", () => {
    // Guards the fixture, not the code under test: if the template ever stops
    // drawing one of these ids, the assertions below would start passing for
    // the wrong reason (nothing to find, rather than the right name found).
    for (const id of ["frame", "con_umi", "stars", "polaris", "hip_77055"]) expect(res.order).toContain(id);
  });

  it("names the lifted constellation", () => {
    expect(namesOf(hd).get("con_umi")).toBe("The Little Bear");
  });

  it("names a proper-named star", () => {
    expect(namesOf(hd).get("polaris")).toBe("Polaris");
  });

  it("falls back to HIP <n> for a star with no proper name", () => {
    expect(namesOf(hd).get("hip_77055")).toBe("HIP 77055");
    expect(namesOf(hd).get("hip_79822")).toBe("HIP 79822");
  });

  it("speaks Norwegian when the figure does — Polaris really is a different word there", () => {
    const nbSpec = { ...focusSpec, names: "nb" };
    const resNb = layoutSpec({ template: "sky_map", params: nbSpec, elements: [] } as never);
    const names = namesOf(handleFor("sky_map", nbSpec, resNb));
    expect(names.get("polaris")).toBe("Polarstjernen");
    expect(names.get("con_umi")).toBe("Lille bjørn");
  });

  it("gives nothing for the dome, the unmarked field, or a group leaf", () => {
    const names = namesOf(hd);
    expect(names.has("frame")).toBe(false);
    expect(names.has("stars")).toBe(false);
    // No leaf id reaches the top-level order in production (that is the
    // whole reason the `__` rule exists), so this checks the defence
    // directly: append the shapes the field and a lifted figure really use
    // for their leaves and confirm they are screened out, not merely absent.
    const withLeaves = handleFor("sky_map", focusSpec, { ...res, order: [...res.order, "stars__hip_77055", "con_umi__0"] });
    const namesWithLeaves = namesOf(withLeaves);
    expect(namesWithLeaves.has("stars__hip_77055")).toBe(false);
    expect(namesWithLeaves.has("con_umi__0")).toBe(false);
  });
});

describe("sceneNamesFor(sky): the unfocused chart still names its bodies", () => {
  const showSpec = { time: AT };
  let res: LayoutResult;
  let hd: RenderHandle;
  beforeAll(() => {
    res = layoutSpec({ template: "sky_map", params: showSpec, elements: [] } as never);
    hd = handleFor("sky_map", showSpec, res);
  });

  it("really did draw saturn, the group ids, and no lifted constellation", () => {
    expect(res.order).toContain("saturn");
    expect(res.order).toContain("stars");
    expect(res.order).toContain("figures");
  });

  it("names the one visible planet", () => {
    expect(namesOf(hd).get("saturn")).toBe("Saturn");
  });

  it("gives nothing for the star field or the loose constellation-lines group", () => {
    const names = namesOf(hd);
    expect(names.has("stars")).toBe(false);
    expect(names.has("figures")).toBe(false);
  });
});

describe("sceneNamesFor(space): the solar system, on the real table", () => {
  const dateSpec = { date: DATE };
  let res: LayoutResult;
  let hd: RenderHandle;
  beforeAll(() => {
    res = layoutSpec({ template: "solar_system", params: dateSpec, elements: [] } as never);
    hd = handleFor("solar_system", dateSpec, res);
  });

  it("really did draw the ids this test is about to name", () => {
    for (const id of ["sun", "earth", "orbit_earth", "label_earth"]) expect(res.order).toContain(id);
  });

  it("names a planet and the Sun", () => {
    const names = namesOf(hd);
    expect(names.get("earth")).toBe("Earth");
    expect(names.get("sun")).toBe("Sun");
  });

  it("speaks Norwegian when the figure does", () => {
    const nbSpec = { ...dateSpec, names: "nb" };
    const resNb = layoutSpec({ template: "solar_system", params: nbSpec, elements: [] } as never);
    expect(namesOf(handleFor("solar_system", nbSpec, resNb)).get("earth")).toBe("Jorden");
  });

  it("gives nothing for an orbit guide, a label text, or a group leaf", () => {
    const names = namesOf(hd);
    expect(names.has("orbit_earth")).toBe(false);
    expect(names.has("label_earth")).toBe(false);
    // "saturn__disc" is the real leaf shape a ringed body's own group uses
    // (`bodyElement` in space.yaml, `id + "__disc"`), not an invented one.
    const withLeaf = handleFor("solar_system", dateSpec, { ...res, order: [...res.order, "saturn__disc"] });
    expect(namesOf(withLeaf).has("saturn__disc")).toBe(false);
  });
});
