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

  // Regression: a small focus selection used to be projected at its true
  // (tiny) share of a WORLD-fitted box, drawing a postage-stamp map with
  // acres of white space around it. Focus mode now fits the projection to
  // just the union of the requested countries, so a small selection fills
  // most of the frame.
  test("focus mode fits the projection to just the requested countries — the union fills most of the box, not a sliver of a world-fitted one", async () => {
    const eng = await geo();
    const w = 1000, h = 750;
    const { shapes } = eng.countries(["Norway", "Sweden"], { w, h });
    const { minX, minY, maxX, maxY } = bounds(shapes);
    const spanX = (maxX - minX) / w;
    const spanY = (maxY - minY) / h;
    expect(Math.max(spanX, spanY)).toBeGreaterThan(0.55);
  });

  test('world mode ("all") is unaffected by the focus fit change: the whole world still spans nearly the full box width', async () => {
    const eng = await geo();
    const w = 1000, h = 750;
    const { shapes } = eng.countries("all", { w, h });
    const { minX, maxX } = bounds(shapes);
    expect((maxX - minX) / w).toBeGreaterThan(0.9);
  });
});
