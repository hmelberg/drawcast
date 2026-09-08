// The sky section's rules, DOM-free: what a click on the chart means, what the
// card says, which Wikipedia article to ask for, and what the pills offer.
// The DOM half (sky-explore.ts) has no unit tests, the same split the anatomy
// Body section and the round-1 Space section use — which is a reason to keep
// that file thin, not an excuse.

import { beforeAll, describe, expect, test } from "vitest";
import spaceYaml from "../src/scenes/packs/space.yaml?raw";
import { registerPack, unregisterPack } from "../src/scenes/packs";
import { scenes } from "../src/scenes/registry";
import { ensureEngines, getLoadedEngines } from "../src/scenes/engines";
import type { AltAz, Chart, Constellation, SkyEngine, Star } from "../src/scenes/space/sky-types";
import type { SpaceEngine } from "../src/scenes/space/types";
import { cardFacts, phaseLine } from "../src/ui/space-model";
import {
  DAY_CHOICES, HOUR_CHOICES, bodyLang, conWikiTitle, constellationFacts, focusTransform, inFrame, starFacts, starWikiTitle,
  targetAt, visibleField,
} from "../src/ui/sky-model";

let sky: SkyEngine;
let spc: SpaceEngine;
beforeAll(async () => {
  await ensureEngines(["sky", "space"]);
  sky = getLoadedEngines(["sky"]).sky as SkyEngine;
  spc = getLoadedEngines(["space"]).space as SpaceEngine;
});

describe("what a click on the chart means", () => {
  const stars = [
    { hip: 1, at: [100, 100] as [number, number] },
    { hip: 2, at: [400, 400] as [number, number] },
  ];
  const segs = [{ abbr: "Ori", a: [200, 200] as [number, number], b: [300, 200] as [number, number] }];

  test("a click on a star is that star, and the nearest one wins", () => {
    expect(targetAt([102, 103], stars, segs)).toEqual({ kind: "star", hip: 1 });
    expect(targetAt([398, 401], stars, segs)).toEqual({ kind: "star", hip: 2 });
  });

  test("a click on a line is its constellation — a star still wins when both are near", () => {
    expect(targetAt([250, 204], stars, segs)).toEqual({ kind: "constellation", abbr: "Ori" });
    // A star inside the slop beats a line inside the slop: the smaller,
    // definite thing is what the viewer aimed at.
    expect(targetAt([205, 202], [{ hip: 9, at: [205, 203] }], segs)).toEqual({ kind: "star", hip: 9 });
  });

  test("a click on empty sky is nothing, not the nearest thing on the page", () => {
    expect(targetAt([700, 700], stars, segs)).toBeNull();
  });

  test("the slop is a real radius, not a bounding box", () => {
    expect(targetAt([100, 113], stars, [], 14)).toEqual({ kind: "star", hip: 1 });
    expect(targetAt([110, 110], stars, [], 14)).toBeNull();   // 14.1 away, diagonally
  });

  // Every shown Sun/Moon/planet is its own separate drawable in the template
  // (unlike the one-element star field), so it is a hit target on exactly
  // the same footing as a star — this is the case that failed before bodies
  // were threaded through targetAt/visibleField at all.
  test("a click on a body is that body, not nothing and not the nearest unrelated star", () => {
    const bodies = [{ id: "saturn", at: [600, 600] as [number, number] }];
    expect(targetAt([602, 601], stars, segs, undefined, bodies)).toEqual({ kind: "body", id: "saturn" });
    // Without a body list at all (the pre-fix call shape), the same click
    // finds nothing there — a body the caller never passed in was never on
    // the page, and empty sky is not the nearest star two rings away.
    expect(targetAt([602, 601], stars, segs)).toBeNull();
  });
});

describe("the card", () => {
  test("a star's card carries the facts a chart cannot draw", () => {
    const s = sky.findStar("Betelgeuse")!;
    const facts = starFacts(s, { alt: 32.5, az: 128.4 }, "en");
    const label = (k: string) => facts.find((f) => f.label === k)?.value;
    expect(label("Magnitude")).toMatch(/^0\.\d/);
    expect(label("Colour")).toMatch(/red|orange/i);
    expect(label("Altitude")).toBe("33° above the horizon");
    expect(label("Direction")).toMatch(/south-east/i);
    // Below the horizon is said, not shown as a negative number.
    expect(starFacts(s, { alt: -4, az: 10 }, "en").find((f) => f.label === "Altitude")!.value).toMatch(/below the horizon/i);
    // No position at all (the tray asked before the sky was computed).
    expect(starFacts(s, null, "en").some((f) => f.label === "Altitude")).toBe(false);
    expect(starFacts(s, null, "nb").some((f) => f.label === "Lysstyrke")).toBe(true);
  });

  test("a constellation's card gives all three names, its size and its brightest star", () => {
    const c = sky.findConstellation("Ori")!;
    const brightest = sky.stars().filter((s) => sky.edgeStars(c).includes(s.hip)).reduce((a, b) => (b.mag < a.mag ? b : a));
    const facts = constellationFacts(c, brightest, sky.edgeStars(c).length, "en");
    const label = (k: string) => facts.find((f) => f.label === k)?.value;
    expect(label("Latin")).toBe("Orion");
    expect(label("Norwegian")).toBe("Orion");
    expect(label("Brightest star")).toMatch(/^(Rigel|Betelgeuse)/);
    expect(label("Stars in the figure")).toBe(String(sky.edgeStars(c).length));
    expect(constellationFacts(c, null, 0, "nb").find((f) => f.label === "Latin")!.value).toBe("Orion");
  });
});

describe("Wikipedia", () => {
  test("a constellation's article is disambiguated in each language", () => {
    const c = sky.findConstellation("Ori")!;
    expect(conWikiTitle(c, "en")).toBe("Orion (constellation)");
    expect(conWikiTitle(c, "nb")).toBe("Orion (stjernebilde)");
    expect(conWikiTitle(c, "la")).toBe("Orion (constellation)");
  });

  test("a star's article is its proper name, in the language's own spelling", () => {
    expect(starWikiTitle(sky.findStar("Sirius")!, "en")).toBe("Sirius");
    expect(starWikiTitle(sky.findStar("Polaris")!, "nb")).toBe("Polarstjernen");
    expect(starWikiTitle(sky.findStar("Polaris")!, "en")).toBe("Polaris");
  });
});

describe("the pills", () => {
  test("the hour and the date offer what a lesson about the sky needs", () => {
    expect(HOUR_CHOICES.map((c) => c.value)).toEqual([0, 1, 6]);
    expect(DAY_CHOICES.map((c) => c.value)).toEqual([0, 30, 182]);
    for (const c of [...HOUR_CHOICES, ...DAY_CHOICES]) {
      expect(c.label.en.trim()).not.toBe("");
      expect(c.label.nb.trim()).not.toBe("");
    }
  });

  test("the places are the engine's own four, so the tray and the chart agree", () => {
    expect(sky.places().map((p) => p.id)).toEqual(["oslo", "bergen", "tromso", "equator"]);
  });
});

// A `focus` portrait is the same projection through a magnifying glass
// (space.yaml's sky_map layout, "Z"): the section's click overlay has to
// apply the exact same transform, or every click on a focused chart lands on
// the wrong star. Pure geometry, so it is pinned here rather than trusted.
describe("the focus transform", () => {
  test("no points to fit is the identity — the template's own fallback (stop focusing) leaves nothing to zoom", () => {
    const id = focusTransform([]);
    expect(id([12, 34])).toEqual([12, 34]);
  });

  test("a small figure is zoomed up around its own centre, to a maximum of 6", () => {
    const pts: [number, number][] = [[490, 380], [510, 380], [500, 400]]; // a 20×20 box at (500, 390)
    const f = focusTransform(pts, { x0: 60, y0: 80, x1: 940, y1: 700 });
    expect(f([500, 390])[0]).toBeCloseTo(500, 5);
    expect(f([500, 390])[1]).toBeCloseTo(390, 5);
    // (940-60-2·110)/20 = 33 both axes → clamped to the cap.
    expect(f([510, 380])).toEqual([560, 330]);
  });

  test("zoom never drops under 1 — a figure that already fills the frame is not shrunk further", () => {
    const pts: [number, number][] = [[0, 0], [1000, 750]];
    const f = focusTransform(pts, { x0: 60, y0: 80, x1: 940, y1: 700 });
    // bbox centre (500, 375); zoom clamps to 1, so a point offset by (100, 0)
    // from centre lands exactly 100 away, not compressed further.
    expect(f([600, 375])).toEqual([600, 390]);
  });
});

describe("in the frame", () => {
  const frame = { x0: 60, y0: 80, x1: 940, y1: 700 };
  test("inside, on the edge, and outside", () => {
    expect(inFrame([500, 390], frame)).toBe(true);
    expect(inFrame([60, 80], frame)).toBe(true);
    expect(inFrame([59, 390], frame)).toBe(false);
    expect(inFrame([500, 701], frame)).toBe(false);
  });
});

// visibleField reconstructs the template's own three rules for what is
// actually on the page — sky-explore.ts's click overlay hit-tests against
// exactly this, never against the whole catalogue. Small synthetic tables
// throughout, so each rule is checked in isolation from the real one's 1 040
// stars and 88 figures (those are sky-template.test.ts's job).
describe("the visible field", () => {
  const CHART: Chart = { cx: 500, cy: 385, r: 285 };
  const star = (hip: number, mag: number): Star => ({ hip, ra: 0, dec: 0, mag, bv: null, name: null, name_nb: null });
  const con = (abbr: string, edges: [number, number][]): Constellation => ({ abbr, name: { la: abbr, en: abbr, nb: abbr }, edges });
  const byHip = (a: number, b: number): number => a - b;

  test("a star past limit_mag is on the page only when a drawn line reaches it", () => {
    const stars = [star(1, 2.0), star(2, 5.0), star(3, 5.0)];
    const constellations = [con("Aaa", [[1, 3]])];
    const pos = new Map<number, AltAz>([
      [1, { alt: 80, az: 10 }],
      [2, { alt: 70, az: 90 }],
      [3, { alt: 60, az: 200 }],
    ]);
    const f = visibleField({ stars, constellations, pos, chart: CHART, limitMag: 4.5, mode: "both" });
    // Star 2 stays out: past the limit, and no drawn line reaches it.
    expect(f.stars.map((s) => s.hip).sort(byHip)).toEqual([1, 3]);
    expect(f.segs).toHaveLength(1);
    expect(f.segs[0].abbr).toBe("Aaa");
  });

  test('"names" draws no lines, so it exempts no faint star and offers no line to click', () => {
    const stars = [star(1, 2.0), star(3, 5.0)];
    const constellations = [con("Aaa", [[1, 3]])];
    const pos = new Map<number, AltAz>([[1, { alt: 80, az: 10 }], [3, { alt: 60, az: 200 }]]);
    const f = visibleField({ stars, constellations, pos, chart: CHART, limitMag: 4.5, mode: "names" });
    expect(f.segs).toHaveLength(0);
    expect(f.stars.map((s) => s.hip)).toEqual([1]);
  });

  test('"none" draws no figures at all, even where a line would otherwise be visible', () => {
    const stars = [star(1, 2.0), star(3, 5.0)];
    const constellations = [con("Aaa", [[1, 3]])];
    const pos = new Map<number, AltAz>([[1, { alt: 80, az: 10 }], [3, { alt: 60, az: 200 }]]);
    const f = visibleField({ stars, constellations, pos, chart: CHART, limitMag: 4.5, mode: "none" });
    expect(f.segs).toHaveLength(0);
    expect(f.stars.map((s) => s.hip)).toEqual([1]);
  });

  test("an edge with one star below the horizon is not drawn, and reaches no one", () => {
    const stars = [star(1, 2.0), star(4, 5.0)];
    const constellations = [con("Bbb", [[1, 4]])];
    const pos = new Map<number, AltAz>([[1, { alt: 80, az: 10 }], [4, { alt: -5, az: 0 }]]);
    const f = visibleField({ stars, constellations, pos, chart: CHART, limitMag: 4.5, mode: "both" });
    expect(f.segs).toHaveLength(0);
    expect(f.stars.some((s) => s.hip === 4)).toBe(false); // below the horizon regardless
  });

  test("a star named in mark/highlight is on the page whatever limit_mag says, with no line at all", () => {
    const stars = [star(1, 2.0), star(2, 5.0)];
    const pos = new Map<number, AltAz>([[1, { alt: 80, az: 10 }], [2, { alt: 70, az: 90 }]]);
    const f = visibleField({ stars, constellations: [], pos, chart: CHART, limitMag: 4.5, mode: "both", markStars: new Set([2]) });
    expect(f.stars.map((s) => s.hip).sort(byHip)).toEqual([1, 2]);
  });

  test("under focus, the field is magnified around the figure's own centre and cropped to the frame", () => {
    const stars = [star(1, 2.0), star(3, 6.0), star(9, 1.0)];
    const constellations = [con("Foo", [[1, 3]])];
    const pos = new Map<number, AltAz>([
      [1, { alt: 89, az: 0 }],
      [3, { alt: 88, az: 90 }],
      // A bright, otherwise-always-shown star well away from the tiny figure
      // above — the portrait's whole point is that the sky AROUND the
      // subject goes, however bright.
      [9, { alt: 45, az: 180 }],
    ]);
    const whole = visibleField({ stars, constellations, pos, chart: CHART, limitMag: 4.5, mode: "both" });
    expect(whole.stars.map((s) => s.hip).sort(byHip)).toEqual([1, 3, 9]);

    const focused = visibleField({ stars, constellations, pos, chart: CHART, limitMag: 4.5, mode: "both", focus: constellations[0] });
    expect(focused.stars.map((s) => s.hip).sort(byHip)).toEqual([1, 3]); // 9 is cropped away by the portrait
    const p1whole = whole.stars.find((s) => s.hip === 1)!.at;
    const p1focus = focused.stars.find((s) => s.hip === 1)!.at;
    expect(p1focus).not.toEqual(p1whole); // the same star, magnified to a different screen point
  });

  test("no focus at all behaves exactly like the whole sky (the caller's own fallback when a figure never rises)", () => {
    const stars = [star(1, 2.0)];
    const pos = new Map<number, AltAz>([[1, { alt: 80, az: 10 }]]);
    const f = visibleField({ stars, constellations: [], pos, chart: CHART, limitMag: 4.5, mode: "both" });
    expect(f.stars.map((s) => s.hip)).toEqual([1]);
  });

  // Every shown body is its own separate drawable in the template, with no
  // magnitude cutoff to exempt — it is on the page exactly when it is above
  // the horizon (and, under focus, inside the crop). Omitting `bodies`
  // altogether (as every test above does) must still leave the field empty:
  // this is the case that failed before bodies existed here at all.
  test("bodies are on the page exactly when they are up, and never otherwise", () => {
    const empty = visibleField({ stars: [], constellations: [], pos: new Map(), chart: CHART, limitMag: 4.5, mode: "both" });
    expect(empty.bodies).toEqual([]);
    const bodies: Record<string, AltAz> = { saturn: { alt: 30, az: 100 }, mercury: { alt: -2, az: 10 } };
    const f = visibleField({ stars: [], constellations: [], pos: new Map(), chart: CHART, limitMag: 4.5, mode: "both", bodies });
    expect(f.bodies.map((b) => b.id)).toEqual(["saturn"]); // mercury is below the horizon
  });

  test("under focus, a body outside the crop is dropped, the same as a background star", () => {
    const constellations = [con("Foo", [[1, 3]])];
    const pos = new Map<number, AltAz>([[1, { alt: 89, az: 0 }], [3, { alt: 88, az: 90 }]]);
    const bodies: Record<string, AltAz> = { saturn: { alt: 45, az: 180 } }; // far from the tiny focused figure
    const f = visibleField({
      stars: [], constellations, pos, chart: CHART, limitMag: 4.5, mode: "both", bodies, focus: constellations[0],
    });
    expect(f.bodies).toEqual([]);
  });
});

// The sky section reuses round 1's own card functions (space-model.ts) for a
// body — nothing new to test there — but the SkyLang → SpaceLang collapse
// (Latin chart labels fall back to English facts) is this section's own
// rule, and the Moon is the body a viewer is most likely to click, since it
// is the one drawn with a phase in the first place.
describe("a body's card", () => {
  test("Latin chart labels fall back to English facts; Norwegian stays Norwegian", () => {
    expect(bodyLang("la")).toBe("en");
    expect(bodyLang("en")).toBe("en");
    expect(bodyLang("nb")).toBe("nb");
  });

  test("a body's card carries real facts, and the Moon's phase line is never empty", () => {
    const moon = spc.body("moon")!;
    const facts = cardFacts(moon, spc.all(), bodyLang("en"));
    expect(facts.length).toBeGreaterThan(0);
    expect(facts.some((f) => f.label === "Radius")).toBe(true);
    const phase = spc.phase(new Date("2026-09-20T20:00:00Z"));
    expect(phaseLine(phase, bodyLang("en"))).toMatch(/^Phase: .+, \d+ % lit$/);
    expect(phaseLine(phase, bodyLang("nb"))).toMatch(/^Fase: .+, \d+ % opplyst$/);
  });
});

// ---------------------------------------------------------------------------
// The one test that holds the two ends together.
//
// Everything above this line is synthetic: three stars, one figure, positions
// invented so a rule can be read in isolation. That is the right shape for a
// rule — and it is exactly why none of it can see the failure that matters
// here. visibleField and focusTransform RE-DERIVE the template's own drawing
// rules (the crop, `pad`, the zoom clamp, the centre of the frame, which
// stars a figure exempts from limit_mag), and two re-derivations that merely
// agree with themselves can drift apart without a single test going red. The
// consequence is round 1's own bug report: every click on a focused chart
// lands on the wrong star, with a green suite.
//
// So: draw the real thing, and check the tray's field against the drawing's
// own anchors. The template puts every star of a focused figure in `anchors`
// — `hip_<number>` where the catalogue has no proper name, the name in lower
// case where it has one — which is the drawn position, in canvas units. If
// the two sides ever stop reading the same SKY_DEFAULTS, this is what says so.
describe("the tray's field against the template's own drawing", () => {
  const WINTER = "2026-12-20T21:00:00Z"; // Orion is up over Oslo on a December evening

  beforeAll(() => {
    unregisterPack("space");
    registerPack("space", spaceYaml);
  });

  test("under focus, every star the portrait draws is where the click overlay thinks it is", () => {
    const D = sky.defaults;
    const drawn = scenes.sky_map.layout!({ time: WINTER, focus: "Orion" });
    const at = sky.resolveTime(WINTER, undefined, undefined, D.lon);
    const field = visibleField({
      stars: sky.stars(),
      constellations: sky.constellations(),
      pos: sky.starPositions(at, D.lat, D.lon),
      chart: sky.chart,
      limitMag: sky.limitMag(undefined),
      mode: "both",
      focus: sky.findConstellation("Orion")!,
    });

    const seen = new Map(field.stars.map((s) => [s.hip, s.at]));
    const hipOfId = new Map(sky.stars().map((s) => [sky.starId(s), s.hip]));
    let checked = 0, anonymous = 0, named = 0;
    for (const [id, anchor] of Object.entries(drawn.anchors)) {
      const hip = hipOfId.get(id);
      if (hip === undefined) continue;                    // a label, a body, the frame
      const p = seen.get(hip);
      expect(p, `${id} is drawn at ${anchor.join(",")} but is not in the click field at all`).toBeDefined();
      expect(Math.hypot(p![0] - anchor[0], p![1] - anchor[1]), `${id} is drawn and clicked in two different places`).toBeLessThan(1);
      checked++;
      if (id.startsWith("hip_")) anonymous++; else named++;
    }
    // Orion's lines reach 23 stars, and both kinds of id have to be covered:
    // the ones with proper names (betelgeuse, rigel) and the ones without.
    expect(checked).toBeGreaterThanOrEqual(20);
    expect(anonymous).toBeGreaterThan(0);
    expect(named).toBeGreaterThan(0);
    expect(drawn.anchors.betelgeuse).toBeDefined();
  });

  test("and the same holds with the whole sky, where no magnifying glass is involved", () => {
    const D = sky.defaults;
    const drawn = scenes.sky_map.layout!({ time: WINTER, mark: ["Sirius", "Vega", "Capella"] });
    const at = sky.resolveTime(WINTER, undefined, undefined, D.lon);
    const marked = new Set(["Sirius", "Vega", "Capella"].map((n) => sky.findStar(n)!.hip));
    const field = visibleField({
      stars: sky.stars(),
      constellations: sky.constellations(),
      pos: sky.starPositions(at, D.lat, D.lon),
      chart: sky.chart,
      limitMag: sky.limitMag(undefined),
      mode: "both",
      markStars: marked,
    });
    const seen = new Map(field.stars.map((s) => [s.hip, s.at]));
    for (const name of ["sirius", "vega", "capella"]) {
      const anchor = drawn.anchors[name];
      if (anchor === undefined) continue;                 // that one has set by 21:00
      const hip = sky.findStar(name)!.hip;
      const p = seen.get(hip);
      expect(p, `${name} is drawn but not clickable`).toBeDefined();
      expect(Math.hypot(p![0] - anchor[0], p![1] - anchor[1]), name).toBeLessThan(1);
    }
    expect(drawn.anchors.vega ?? drawn.anchors.capella).toBeDefined();
  });
});
