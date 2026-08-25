import { describe, expect, test } from "vitest";
import { ensureEngines, getLoadedEngines, type GeoEngine } from "../src/scenes/engines";

async function geo(): Promise<GeoEngine> {
  await ensureEngines(["geo"]);
  return getLoadedEngines(["geo"]).geo as GeoEngine;
}

function allFinite(pts: [number, number][]): boolean {
  return pts.every(([x, y]) => Number.isFinite(x) && Number.isFinite(y));
}

describe("geo engine (real load — node, no DOM)", () => {
  test("countries(['Norway']) returns one shape with a real ring, finite points, no missing, centroid inside the box", async () => {
    const eng = await geo();
    const { shapes, missing, centroids } = eng.countries(["Norway"]);
    expect(missing).toEqual([]);
    expect(shapes).toHaveLength(1);
    expect(shapes[0].name).toBe("Norway");
    expect(shapes[0].rings.length).toBeGreaterThanOrEqual(1);
    const allPts = shapes[0].rings.flat();
    expect(allPts.length).toBeGreaterThanOrEqual(30);
    expect(allFinite(allPts)).toBe(true);
    // rings are closed (first point repeats as last, world-atlas convention) —
    // projection is a pure function, so the repeated raw [lon,lat] projects to
    // the exact same [x,y] both times.
    for (const ring of shapes[0].rings) {
      expect(ring.length).toBeGreaterThanOrEqual(4);
      expect(ring[0]).toEqual(ring[ring.length - 1]);
    }
    const c = centroids.Norway;
    expect(c).toBeDefined();
    const [w, h] = [1000, 750];
    expect(c[0]).toBeGreaterThanOrEqual(0);
    expect(c[0]).toBeLessThanOrEqual(w);
    expect(c[1]).toBeGreaterThanOrEqual(0);
    expect(c[1]).toBeLessThanOrEqual(h);
  });

  test("name match is case-insensitive", async () => {
    const eng = await geo();
    const { shapes, missing } = eng.countries(["norway", "SWEDEN"]);
    expect(missing).toEqual([]);
    expect(shapes.map((s) => s.name).sort()).toEqual(["Norway", "Sweden"]);
  });

  test("unknown country name is reported in missing, not thrown", async () => {
    const eng = await geo();
    const { shapes, missing } = eng.countries(["Atlantis"]);
    expect(missing).toEqual(["Atlantis"]);
    expect(shapes).toEqual([]);
  });

  test("a mix of known and unknown names splits between shapes and missing", async () => {
    const eng = await geo();
    const { shapes, missing } = eng.countries(["Norway", "Atlantis"]);
    expect(shapes.map((s) => s.name)).toEqual(["Norway"]);
    expect(missing).toEqual(["Atlantis"]);
  });

  // Regression: fc.features has exactly one entry per country, so matching
  // used to do only one missing.splice() per feature — a duplicate VALID
  // request left a phantom leftover in `missing` for a name that was in fact
  // found. Requested names are now de-duplicated case-insensitively up front.
  test("a duplicate valid name is de-duplicated: one shape, empty missing", async () => {
    const eng = await geo();
    const { shapes, missing } = eng.countries(["Norway", "Norway"]);
    expect(shapes).toHaveLength(1);
    expect(shapes[0].name).toBe("Norway");
    expect(missing).toEqual([]);
  });

  test("a duplicate valid name mixed with case variants and a duplicate unknown name still resolves correctly", async () => {
    const eng = await geo();
    const { shapes, missing } = eng.countries(["Norway", "norway", "Atlantis", "Atlantis"]);
    expect(shapes.map((s) => s.name)).toEqual(["Norway"]);
    expect(missing).toEqual(["Atlantis"]);
  });

  test('countries("all") returns at least 150 country shapes', async () => {
    const eng = await geo();
    const { shapes, missing } = eng.countries("all");
    expect(shapes.length).toBeGreaterThanOrEqual(150);
    expect(missing).toEqual([]);
  });

  test("every projected coordinate (rings and centroids) lands within [0,w]x[0,h] for a custom box", async () => {
    const eng = await geo();
    const w = 400, h = 300;
    const { shapes, centroids } = eng.countries("all", { w, h });
    for (const shape of shapes) {
      for (const ring of shape.rings) {
        for (const [x, y] of ring) {
          expect(x).toBeGreaterThanOrEqual(0);
          expect(x).toBeLessThanOrEqual(w);
          expect(y).toBeGreaterThanOrEqual(0);
          expect(y).toBeLessThanOrEqual(h);
        }
      }
      const c = centroids[shape.name];
      expect(c[0]).toBeGreaterThanOrEqual(0);
      expect(c[0]).toBeLessThanOrEqual(w);
      expect(c[1]).toBeGreaterThanOrEqual(0);
      expect(c[1]).toBeLessThanOrEqual(h);
    }
  });

  test("y is flipped to y-up: Norway (far north) centroid sits in the upper half of the box, Indonesia (equatorial/south) does not sit as high", async () => {
    const eng = await geo();
    const h = 750;
    const { centroids } = eng.countries(["Norway", "Indonesia"], { w: 1000, h });
    // y-up, origin bottom-left: a northern country should have a LARGER y than
    // an equatorial one once y-down (SVG/d3) has been flipped to y-up.
    expect(centroids.Norway[1]).toBeGreaterThan(h / 2);
    expect(centroids.Norway[1]).toBeGreaterThan(centroids.Indonesia[1]);
  });

  test("determinism: two calls with the same args produce byte-identical output", async () => {
    const eng = await geo();
    const a = eng.countries(["Norway", "Sweden"]);
    const b = eng.countries(["Norway", "Sweden"]);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  function bounds(shapes: { rings: [number, number][][] }[]) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const s of shapes) {
      for (const ring of s.rings) {
        for (const [x, y] of ring) {
          minX = Math.min(minX, x);
          maxX = Math.max(maxX, x);
          minY = Math.min(minY, y);
          maxY = Math.max(maxY, y);
        }
      }
    }
    return { minX, minY, maxX, maxY };
  }

  function spans(shapes: { rings: [number, number][][] }[], w: number, h: number) {
    const { minX, minY, maxX, maxY } = bounds(shapes);
    return { spanX: (maxX - minX) / w, spanY: (maxY - minY) / h };
  }

  // Regression: a small focus selection used to be projected at its true
  // (tiny) share of a WORLD-fitted box, drawing a postage-stamp map with
  // acres of white space around it. Focus mode now fits the projection to
  // just the union of the requested countries, so a small selection fills
  // most of the frame. Math.min (not Math.max) of the two spans: a country
  // that's wide but flat (or tall but narrow) can legitimately fail one
  // axis and still be a correct, non-collapsed fit — see the Russia/Chile
  // tests below — but BOTH axes collapsing is the bug this guards against.
  test("focus mode fits the projection to just the requested countries — the union fills most of the box in both dimensions, not a sliver of a world-fitted one", async () => {
    const eng = await geo();
    const w = 1000, h = 750;
    const { shapes } = eng.countries(["Norway", "Sweden"], { w, h });
    const { spanX, spanY } = spans(shapes, w, h);
    expect(Math.min(spanX, spanY)).toBeGreaterThan(0.5); // measured ~0.565/0.920
  });

  test('world mode ("all") is unaffected by the focus fit change: the whole world still spans nearly the full box width', async () => {
    const eng = await geo();
    const w = 1000, h = 750;
    const { shapes } = eng.countries("all", { w, h });
    const { minX, maxX } = bounds(shapes);
    expect((maxX - minX) / w).toBeGreaterThan(0.9);
  });

  // Regression (antimeridian): a MultiPolygon straddling +/-180 deg has raw
  // longitudes at both extremes of the range, so a naive bounding box spans
  // nearly the whole projected width no matter how compact the country
  // actually is — collapsing the OTHER dimension to a sliver once that
  // width gets scaled to fit the box. Before the fix, Fiji measured
  // spanX=0.94/spanY=0.009 (a flat horizontal line) and Russia measured
  // spanX=0.94/spanY=0.18. Both dimensions must now be substantial for a
  // roughly-compact country (Fiji); Russia is checked separately below
  // because it is genuinely wide-and-flat on the globe, not a bug.
  test("antimeridian: Fiji (straddles +/-180 deg) fits in both dimensions, not just one", async () => {
    const eng = await geo();
    const w = 1000, h = 750;
    const { shapes, missing } = eng.countries(["Fiji"], { w, h });
    expect(missing).toEqual([]);
    const { spanX, spanY } = spans(shapes, w, h);
    expect(Math.min(spanX, spanY)).toBeGreaterThan(0.5); // measured ~0.755/0.920
  });

  // Russia is genuinely wide-and-flat on the globe (~9000km E-W, much less
  // N-S) — a single global "both spans > X" floor would be wrong for it
  // even with antimeridian handling fully correct, so it's asserted per
  // axis against its own true aspect ratio instead of Fiji's shared floor:
  // spanX close to the box's full width (it's the widest thing in view),
  // and spanY clearly OUT of "collapsed sliver" territory (measured 0.18
  // before the fix; 0.373 after — genuinely tall enough to read as a
  // country, not a line).
  test("antimeridian: Russia (straddles +/-180 deg, genuinely wide-and-flat) is wide but not collapsed to a sliver", async () => {
    const eng = await geo();
    const w = 1000, h = 750;
    const { shapes, missing } = eng.countries(["Russia"], { w, h });
    expect(missing).toEqual([]);
    const { spanX, spanY } = spans(shapes, w, h);
    expect(spanX).toBeGreaterThan(0.8);
    expect(spanY).toBeGreaterThan(0.3);
  });

  // Sanity check for the "per-case, not one global floor" design above: a
  // genuinely tall-thin country (Chile) is EXPECTED to fail a wide spanX —
  // that's correct, not a regression — so only its tall dimension is
  // asserted.
  test("a genuinely tall-thin country (Chile) is expected to have a narrow spanX — no global floor should demand otherwise", async () => {
    const eng = await geo();
    const w = 1000, h = 750;
    const { shapes, missing } = eng.countries(["Chile"], { w, h });
    expect(missing).toEqual([]);
    const { spanY } = spans(shapes, w, h);
    expect(spanY).toBeGreaterThan(0.85); // measured ~0.920
  });

  // Regression (fit dilution): a name resolved for its centroid only (e.g.
  // a marker far from the focus set) must not drag the FIT box out to
  // include it — that's the same "world_map draws tiny" collapse, just
  // triggered by a marker instead of a focus list.
  test("fitNames isolates the fit from names that are resolved but not meant to be fit — a distant name in `names` but not `fitNames` doesn't dilute it", async () => {
    const eng = await geo();
    const w = 1000, h = 750;
    const diluted = eng.countries(["Norway", "Sweden", "Japan"], { w, h });
    const dilutedSpan = spans(diluted.shapes.filter((s) => s.name !== "Japan"), w, h);
    // Without fitNames, Japan (on the other side of the globe) IS part of
    // the fit set — Norway+Sweden collapse, reproducing the original bug.
    expect(Math.max(dilutedSpan.spanX, dilutedSpan.spanY)).toBeLessThan(0.3);

    const isolated = eng.countries(["Norway", "Sweden", "Japan"], { w, h, fitNames: ["Norway", "Sweden"] });
    const isolatedSpan = spans(isolated.shapes.filter((s) => s.name !== "Japan"), w, h);
    expect(Math.min(isolatedSpan.spanX, isolatedSpan.spanY)).toBeGreaterThan(0.5);
    // fitNames restricts the FIT, not what gets resolved: Japan still gets
    // a real shape/centroid from the SAME (Nordics-fit) projection — just
    // one that lands far outside the [0,w]x[0,h] box, since Japan is
    // nowhere near where the projection was actually fit to.
    const japan = isolated.shapes.find((s) => s.name === "Japan");
    expect(japan).toBeDefined();
    const jc = isolated.centroids.Japan;
    expect(jc).toBeDefined();
    expect(jc[0] < 0 || jc[0] > w || jc[1] < 0 || jc[1] > h).toBe(true);
  });

  test("fitNames is ignored in world mode (fitSize on the whole world either way)", async () => {
    const eng = await geo();
    const w = 1000, h = 750;
    const withFitNames = eng.countries("all", { w, h, fitNames: ["Norway"] });
    const withoutFitNames = eng.countries("all", { w, h });
    expect(JSON.stringify(withFitNames)).toBe(JSON.stringify(withoutFitNames));
  });

  test("o.points is empty/omitted by default: projectedPoints is an empty array, not undefined", async () => {
    const eng = await geo();
    const { projectedPoints } = eng.countries(["Norway"], { w: 1000, h: 750 });
    expect(projectedPoints).toEqual([]);
  });

  // Regression target for the "capitals at country centroids" bug: a marker
  // needs to land at its OWN exact lon/lat, not a country's centroid. o.points
  // is projected through the exact SAME projection (same rotation + fit) as
  // the shapes/centroids above, so it lands consistently with them.
  test("o.points projects an exact lon/lat through the SAME projection as the shapes — Oslo (focus Norway) lands inside the box, in Norway's own southern portion", async () => {
    const eng = await geo();
    const w = 1000, h = 750;
    const { shapes, projectedPoints } = eng.countries(["Norway"], { w, h, points: [[10.75, 59.91]] });
    expect(projectedPoints).toHaveLength(1);
    const oslo = projectedPoints[0];
    expect(oslo).not.toBeNull();
    const [ox, oy] = oslo!;
    expect(ox).toBeGreaterThanOrEqual(0);
    expect(ox).toBeLessThanOrEqual(w);
    expect(oy).toBeGreaterThanOrEqual(0);
    expect(oy).toBeLessThanOrEqual(h);
    // Norway's own ring bbox (y-up: north = larger y) — Oslo, near Norway's
    // south coast, must sit in the LOWER (southern) half of that bbox, not
    // at the country's geometric centroid (which sits much further north,
    // mid-country — the bug this whole feature fixes).
    const { minY, maxY } = bounds(shapes);
    expect(oy).toBeLessThan((minY + maxY) / 2);
  });

  // Pin the actual (rather than assumed) out-of-view behavior: geoNaturalEarth1
  // has no hard clip circle (see the class doc above), so a point nowhere near
  // the fit set does NOT come back null — it comes back a real, finite
  // coordinate, just far outside the [0,w]x[0,h] box.
  test("a point on the far side of the world from the fit set returns a real, finite coordinate far outside the box (not null — geoNaturalEarth1 has no hard clip circle)", async () => {
    const eng = await geo();
    const w = 1000, h = 750;
    // Roughly antipodal to Norway's own fit-rotation center.
    const { projectedPoints } = eng.countries(["Norway"], { w, h, points: [[-170, -60]] });
    expect(projectedPoints).toHaveLength(1);
    const p = projectedPoints[0];
    expect(p).not.toBeNull();
    const [x, y] = p!;
    expect(Number.isFinite(x) && Number.isFinite(y)).toBe(true);
    expect(x < 0 || x > w || y < 0 || y > h).toBe(true);
  });
});
