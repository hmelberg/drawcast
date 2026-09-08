// The committed sky tables. Generated once by scripts/build-sky-data.mjs and
// committed, the way the anatomy atlas and the periodic table are: the app
// never fetches, and these assertions are what a re-run has to survive.
// The numbers come from docs/superpowers/specs/2026-09-07-sky-data-measured.md,
// measured against d3-celestial on 2026-09-06.

import { describe, expect, test } from "vitest";
import starTable from "../src/scenes/space/sky/stars.json";
import conTable from "../src/scenes/space/sky/constellations.json";
import namesJson from "../src/scenes/space/sky-names.json";

const names = namesJson as unknown as {
  source: string;
  constellations: Record<string, { la: string; en: string; nb: string }>;
  stars_nb: Record<string, string>;
};
const stars = starTable.stars;
const cons = conTable.constellations;
const byHip = new Map(stars.map((s) => [s.i, s]));

describe("the star table", () => {
  test("is the magnitude-4.5 UNION, not a magnitude cut", () => {
    // 1 040 measured. A rebuild that drifts a little is fine; one that drops
    // a fifth of the sky is not.
    expect(stars.length).toBeGreaterThanOrEqual(1000);
    expect(stars.length).toBeLessThanOrEqual(1100);
    expect(starTable.limit_mag).toBe(4.5);
    // The union property, checkable on the committed file alone: every star
    // here is either inside the cut or wanted by a constellation line.
    const wanted = new Set(cons.flatMap((c) => c.e.flat()));
    for (const s of stars) {
      expect(s.m <= 4.5 || wanted.has(s.i), `HIP ${s.i} at mag ${s.m} is neither bright nor on a line`).toBe(true);
    }
    // …and the union really does reach past the cut: 119 of the 750 line
    // stars are fainter than 4.5, the faintest at 5.89.
    expect(Math.max(...stars.map((s) => s.m))).toBeGreaterThan(5.5);
  });

  test("every record is a usable star", () => {
    for (const s of stars) {
      expect(Number.isInteger(s.i) && s.i > 0, `bad HIP ${s.i}`).toBe(true);
      expect(s.c[0]).toBeGreaterThanOrEqual(0);
      expect(s.c[0]).toBeLessThan(360);
      expect(Math.abs(s.c[1])).toBeLessThanOrEqual(90);
      expect(Number.isFinite(s.m)).toBe(true);
      expect(s.b === null || Number.isFinite(s.b)).toBe(true);
    }
    expect(new Set(stars.map((s) => s.i)).size).toBe(stars.length);
  });

  test("the brightest star is Sirius, and it carries its name", () => {
    const brightest = stars.reduce((a, b) => (b.m < a.m ? b : a));
    expect(brightest.n).toBe("Sirius");
    expect(brightest.m).toBeLessThan(-1.4);
  });

  test("the stars a teaching chart names are named", () => {
    const named = new Map(stars.filter((s) => s.n).map((s) => [s.n, s]));
    for (const n of ["Sirius", "Vega", "Capella", "Rigel", "Procyon", "Betelgeuse", "Altair", "Aldebaran", "Antares", "Spica", "Pollux", "Deneb", "Regulus", "Polaris"]) {
      expect(named.has(n), `${n} is not in the table`).toBe(true);
    }
    // Names are for the stars a viewer can be asked about; the faint field is
    // anonymous. Measured: ~170 stars at mag ≤ 3.0 carry one.
    expect(named.size).toBeGreaterThanOrEqual(100);
    expect(named.get("Polaris")!.nb).toBe("Polarstjernen");
  });
});

describe("the constellation figures", () => {
  test("all 88, with names in three languages", () => {
    expect(cons.length).toBe(88);
    expect(new Set(cons.map((c) => c.a)).size).toBe(88);
    for (const c of cons) {
      for (const k of ["la", "en", "nb"] as const) expect(c[k].trim(), `${c.a}.${k}`).not.toBe("");
    }
    expect(cons.find((c) => c.a === "UMa")).toMatchObject({ la: "Ursa Major", en: "The Great Bear", nb: "Store bjørn" });
    expect(cons.find((c) => c.a === "Ori")).toMatchObject({ la: "Orion", nb: "Orion" });
  });

  // The band, not a number: 741 edges ship, and the count moves when upstream
  // adds detail to the raw lines (735 when the round was planned, 741 when the
  // pinned commit was measured). What must not move is the SHAPE of an edge —
  // a sorted pair of stars this table actually holds.
  test("every edge is a sorted pair of catalogue stars, and the total stays in the measured band", () => {
    const total = cons.reduce((n, c) => n + c.e.length, 0);
    expect(total).toBeGreaterThanOrEqual(700);
    expect(total).toBeLessThanOrEqual(780);
    for (const c of cons) {
      for (const [a, b] of c.e) {
        expect(byHip.has(a), `${c.a}: HIP ${a} is not in stars.json`).toBe(true);
        expect(byHip.has(b), `${c.a}: HIP ${b} is not in stars.json`).toBe(true);
        expect(a).toBeLessThan(b); // sorted pairs, so an edge has one spelling
      }
      expect(new Set(c.e.map((p) => p.join("-"))).size, `${c.a} has a duplicate edge`).toBe(c.e.length);
    }
  });

  test("the figures are the sizes the measurement found", () => {
    const size = (a: string) => cons.find((c) => c.a === a)!.e.length;
    expect(size("CMi")).toBe(1);
    expect(size("CVn")).toBe(1);
    const biggest = [...cons].sort((x, y) => y.e.length - x.e.length).slice(0, 5).map((c) => c.a);
    expect(biggest[0]).toBe("Sgr");
    expect(biggest).toContain("Ori");
    expect(size("Ori")).toBeGreaterThanOrEqual(20);
    expect(size("Ori")).toBeLessThanOrEqual(28);
  });

  test("Orion's belt is three named stars joined in a row", () => {
    const ori = cons.find((c) => c.a === "Ori")!;
    const hips = new Set(ori.e.flat());
    const belt = ["Mintaka", "Alnilam", "Alnitak"].map((n) => stars.find((s) => s.n === n));
    for (const s of belt) expect(s, "a belt star is missing").toBeDefined();
    for (const s of belt) expect(hips.has(s!.i), `${s!.n} is not on an Orion line`).toBe(true);
  });
});

describe("the hand-written names file", () => {
  test("carries all 88 constellations, and every one the tables use", () => {
    expect(Object.keys(names.constellations)).toHaveLength(88);
    for (const c of cons) expect(names.constellations, c.a).toHaveProperty(c.a);
  });

  test("says where its Norwegian comes from", () => {
    expect(names.source).toMatch(/Wikipedia/);
    expect(names.source).toMatch(/CC BY-SA/);
  });
});
