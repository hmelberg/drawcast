// The sky's pure half: the projection, the alt/az transform, the dot, the
// clock. Every number here is checkable by hand or against astronomy-engine,
// and none of it needs the browser or the engine chunk.

import { describe, expect, test } from "vitest";
import * as A from "astronomy-engine";
import starTable from "../src/scenes/space/sky/stars.json";
import conTable from "../src/scenes/space/sky/constellations.json";
import {
  CHART, DEG, PLACES, STAR_TINTS, altAz, conId, constellationName, edgeStars, expandConstellations,
  expandStars, localClock, noteClauses, precess, project, resolveTime, starColor, starId, starName, starRadius,
} from "../src/scenes/space/sky-rules";
import type { ConstellationTable, StarTable } from "../src/scenes/space/sky-types";
import { relativeLuminance } from "./contrast";

const starRadiusOf = starRadius;

const stars = expandStars(starTable as unknown as StarTable);
const cons = expandConstellations(conTable as unknown as ConstellationTable);
const ground = "#faf6ec"; // kit.GROUND — the figure's paper

function contrast(a: string, b: string): number {
  const [x, y] = [relativeLuminance(a), relativeLuminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

describe("the projection — a planisphere held overhead", () => {
  test("the zenith is the centre and the horizon is the rim", () => {
    expect(project({ alt: 90, az: 0 })).toEqual([CHART.cx, CHART.cy]);
    const [x, y] = project({ alt: 0, az: 0 });
    expect(Math.hypot(x - CHART.cx, y - CHART.cy)).toBeCloseTo(CHART.r, 6);
  });

  test("north is at the top and EAST IS ON THE LEFT — the chart is held up, not laid down", () => {
    const n = project({ alt: 0, az: 0 });
    const e = project({ alt: 0, az: 90 });
    const s = project({ alt: 0, az: 180 });
    const w = project({ alt: 0, az: 270 });
    expect(n[1]).toBeGreaterThan(CHART.cy);   // y-up: north is above the centre
    expect(s[1]).toBeLessThan(CHART.cy);
    expect(e[0]).toBeLessThan(CHART.cx);      // east on the LEFT
    expect(w[0]).toBeGreaterThan(CHART.cx);
  });

  test("below the horizon lands outside the circle, which is how the template omits it", () => {
    const [x, y] = project({ alt: -10, az: 45 });
    expect(Math.hypot(x - CHART.cx, y - CHART.cy)).toBeGreaterThan(CHART.r);
  });

  test("halfway up is NOT halfway out — stereographic stretches toward the rim", () => {
    const [x, y] = project({ alt: 45, az: 0 });
    const r = Math.hypot(x - CHART.cx, y - CHART.cy);
    expect(r / CHART.r).toBeCloseTo(Math.tan(22.5 * DEG), 6);
    expect(r / CHART.r).toBeLessThan(0.5);
  });
});

describe("alt/az agrees with astronomy-engine's own Horizon()", () => {
  // The reason this file may hand-roll the transform at all: it is not an
  // approximation of Horizon(), it is the same answer, and it costs a tenth of
  // a millisecond for a thousand stars where a thousand Horizon() calls do not.
  const at = new Date("2026-09-07T21:00:00Z");
  const obs = new A.Observer(59.91, 10.75, 0);
  const lst = (A.SiderealTime(at) + 10.75 / 15) * 15;
  const rot = A.Rotation_EQJ_EQD(at).rot;

  test.each([
    ["Betelgeuse", 88.7929, 7.4071],
    ["Polaris", 37.9545, 89.2641],
    ["Sirius", 101.2872, -16.7161],
  ])("%s lands where Horizon() puts it", (_name, ra, dec) => {
    const d = precess(rot, ra, dec);
    const mine = altAz(d.ra, d.dec, lst, 59.91);
    const theirs = A.Horizon(at, obs, d.ra / 15, d.dec, "");
    expect(mine.alt).toBeCloseTo(theirs.altitude, 4);
    expect(mine.az).toBeCloseTo(theirs.azimuth, 4);
  });

  test("precession is worth doing: 26 years moves a star by about a third of a degree", () => {
    const d = precess(rot, 88.7929, 7.4071);
    expect(Math.abs(d.ra - 88.7929)).toBeGreaterThan(0.3);
    expect(Math.abs(d.dec - 7.4071)).toBeLessThan(0.05);
  });

  test("Polaris sits at the latitude, whatever the hour", () => {
    for (const h of [0, 6, 12, 18]) {
      const t = new Date(Date.UTC(2026, 8, 7, h));
      const l = (A.SiderealTime(t) + 10.75 / 15) * 15;
      const p = precess(A.Rotation_EQJ_EQD(t).rot, 37.9545, 89.2641);
      expect(altAz(p.ra, p.dec, l, 59.91).alt, `hour ${h}`).toBeCloseTo(59.91, 0);
    }
  });
});

describe("the dot", () => {
  test("brighter is bigger, and the size does not move when limit_mag does", () => {
    expect(starRadiusOf(-1.46)).toBeGreaterThan(starRadiusOf(0));
    expect(starRadiusOf(0)).toBeGreaterThan(starRadiusOf(2));
    expect(starRadiusOf(2)).toBeGreaterThan(starRadiusOf(4));
    expect(starRadiusOf(-1.46)).toBeCloseTo(4.905, 2);
    expect(starRadiusOf(4.5)).toBe(1.3);   // the floor: still visible ink
    expect(starRadiusOf(5.89)).toBe(1.3);
    expect(starRadiusOf(-20)).toBe(5.4);   // the cap
  });

  test("the B−V tint runs blue to orange, and every tint reads on the paper", () => {
    expect(starColor(-0.2)).toBe(STAR_TINTS[0].color);
    expect(starColor(2.0)).toBe(STAR_TINTS[STAR_TINTS.length - 1].color);
    expect(starColor(null)).toBe(starColor(0.45));   // no colour index: neutral
    for (const t of STAR_TINTS) {
      expect(contrast(t.color, ground), t.color).toBeGreaterThanOrEqual(4.5);
    }
  });
});

describe("the clock", () => {
  test("an ISO instant with an offset is that instant", () => {
    expect(resolveTime("2026-09-07T22:00:00+02:00", 0, 0, 10.75).toISOString()).toBe("2026-09-07T20:00:00.000Z");
  });

  test("an ISO datetime with no offset is read as UTC", () => {
    expect(resolveTime("2026-09-07T22:00", 0, 0, 10.75).toISOString()).toBe("2026-09-07T22:00:00.000Z");
  });

  test("the string Date itself writes round-trips — milliseconds and all", () => {
    // `toISOString()` ALWAYS emits ".mmm", so this is the commonest ISO string
    // there is: every generated timestamp, every sweep, every `new Date(x)`
    // handed back as text. The pattern used to reject it and fall through to
    // `now` WITHOUT A WORD — a figure that names a date and draws today, and a
    // 200-moment sweep in tests/sky-template.test.ts that was really two
    // hundred copies of one real instant.
    const now = new Date("2000-01-01T00:00:00Z");
    for (const iso of ["2026-01-06T16:22:58.800Z", "2026-09-07T21:00:00.000Z", "2026-02-22T20:00:00.123+02:00"]) {
      expect(resolveTime(iso, 0, 0, 10.75, now).toISOString(), iso).toBe(new Date(iso).toISOString());
    }
    // …and with no offset it is still read as UTC, fraction included.
    expect(resolveTime("2026-09-07T22:00:30.250", 0, 0, 10.75, now).toISOString()).toBe("2026-09-07T22:00:30.250Z");
  });

  test("a bare date is 22:00 local solar time where the observer stands", () => {
    // Oslo, lon 10.75 -> 22:00 local solar is 21:17 UTC.
    expect(resolveTime("2026-09-07", 0, 0, 10.75).toISOString()).toBe("2026-09-07T21:17:00.000Z");
    // …and at the prime meridian it really is 22:00 UTC.
    expect(resolveTime("2026-09-07", 0, 0, 0).toISOString()).toBe("2026-09-07T22:00:00.000Z");
  });

  test("hours and days shift whatever it resolved to, fractions allowed", () => {
    expect(resolveTime("2026-09-07T22:00Z", 6, 0, 0).toISOString()).toBe("2026-09-08T04:00:00.000Z");
    expect(resolveTime("2026-09-07T22:00Z", 0, -1.5, 0).toISOString()).toBe("2026-09-06T10:00:00.000Z");
  });

  test("now, nonsense and nothing all mean the injected moment", () => {
    const now = new Date("2026-03-01T12:00:00Z");
    for (const v of ["now", "", "tonight", undefined, 7]) {
      expect(resolveTime(v, 0, 0, 0, now).getTime(), String(v)).toBe(now.getTime());
    }
  });

  test("a string that only LOOKS like a date does not become a different one", () => {
    // A regex match is not a date. Date.UTC and Date.parse both ROLL what will
    // not fit — "2026-13-45" becomes 2027-02-14, "2026-02-30" becomes March 2,
    // "T25:00" becomes tomorrow at 01:00 — so the figure would name one date
    // and draw another. That is the "now" fallback's own defect one step
    // later, and it is the fallback these belong in instead. Silent, on
    // purpose: throwing would blank the figure over a typo.
    const now = new Date("2026-03-01T12:00:00Z");
    for (const bad of [
      "2026-13-45", "2026-00-10", "2026-02-30", "2027-02-29",
      "2026-13-45T10:00", "2026-02-30T10:00", "2026-02-30T10:00:00+02:00",
      "2026-09-07T25:00", "2026-09-07T12:61", "2026-09-07T10:00:60",
      "2026-09-07T25:00:00Z", "2026-09-07T12:61:00+02:00",
    ]) {
      expect(resolveTime(bad, 0, 0, 0, now).getTime(), bad).toBe(now.getTime());
    }
    // …and every form next door to one of those still resolves to itself.
    expect(resolveTime("2026-12-31", 0, 0, 0, now).toISOString()).toBe("2026-12-31T22:00:00.000Z");
    expect(resolveTime("2024-02-29T23:59:59Z", 0, 0, 0, now).toISOString()).toBe("2024-02-29T23:59:59.000Z");
    expect(resolveTime("2026-09-07T23:59:59.999+02:00", 0, 0, 0, now).toISOString()).toBe("2026-09-07T21:59:59.999Z");
    // T24:00 is the one ISO clock that rolls ON PURPOSE — midnight ending the
    // day — so it keeps the meaning it has rather than being thrown out with
    // T25:00.
    expect(resolveTime("2026-09-07T24:00:00Z", 0, 0, 0, now).toISOString()).toBe("2026-09-08T00:00:00.000Z");
  });

  test("the written clock is local solar time, and it needs no timezone table", () => {
    expect(localClock(new Date("2026-09-07T21:17:00Z"), 10.75)).toEqual({ date: "2026-09-07", time: "22:00" });
    expect(localClock(new Date("2026-09-07T23:30:00Z"), 18.96).date).toBe("2026-09-08");   // Tromsø rolls over
  });
});

describe("names, ids and the caption", () => {
  test("three languages give three different labels, which is what makes 'write the Latin name' answerable", () => {
    const uma = cons.find((c) => c.abbr === "UMa")!;
    expect(constellationName(uma, "la")).toBe("Ursa Major");
    expect(constellationName(uma, "en")).toBe("The Great Bear");
    expect(constellationName(uma, "nb")).toBe("Store bjørn");
  });

  test("a star keeps its proper name unless Norwegian has its own", () => {
    const polaris = stars.find((s) => s.name === "Polaris")!;
    const sirius = stars.find((s) => s.name === "Sirius")!;
    expect(starName(polaris, "nb")).toBe("Polarstjernen");
    expect(starName(polaris, "en")).toBe("Polaris");
    expect(starName(sirius, "nb")).toBe("Sirius");
    expect(starName(stars.find((s) => s.name === null)!, "en")).toBeNull();
  });

  test("ids: a proper name in lower case, else hip_<n>; a constellation is con_<abbr>", () => {
    expect(starId(stars.find((s) => s.name === "Sirius")!)).toBe("sirius");
    expect(starId({ hip: 12345, ra: 0, dec: 0, mag: 5, bv: null, name: null, name_nb: null })).toBe("hip_12345");
    expect(starId({ hip: 1, ra: 0, dec: 0, mag: 5, bv: null, name: "Kaus Australis", name_nb: null })).toBe("kaus_australis");
    expect(conId(cons.find((c) => c.abbr === "UMa")!)).toBe("con_uma");
  });

  test("the caption's clauses come in the order they matter, cheapest last", () => {
    const all = noteClauses({ daylight: true, below: ["Jupiter"], unknown: ["krypton"], symbols: true }, "en");
    expect(all).toHaveLength(4);
    expect(all[0]).toMatch(/^The Sun is up/);
    expect(all[1]).toBe("Below the horizon: Jupiter");
    expect(all[2]).toBe("Unknown: krypton");
    expect(all[3]).toMatch(/symbols/);
    expect(noteClauses({ daylight: false, below: [], unknown: [], symbols: false }, "en")).toEqual([]);
    expect(noteClauses({ daylight: false, below: ["Jupiter"], unknown: [], symbols: false }, "nb")[0]).toBe("Under horisonten: Jupiter");
  });

  test("the observer presets are the four the tray offers", () => {
    expect(PLACES.map((p) => p.id)).toEqual(["oslo", "bergen", "tromso", "equator"]);
    expect(PLACES[0]).toMatchObject({ lat: 59.91, lon: 10.75 });
    for (const p of PLACES) {
      expect(Math.abs(p.lat)).toBeLessThanOrEqual(90);
      expect(Math.abs(p.lon)).toBeLessThanOrEqual(180);
    }
  });
});

describe("expanding the committed tables", () => {
  test("every compact star record becomes a usable Star", () => {
    expect(stars.length).toBe((starTable as unknown as StarTable).stars.length);
    const s = stars.find((x) => x.name === "Sirius")!;
    expect(s.hip).toBeGreaterThan(0);
    expect(s.dec).toBeLessThan(0);
    expect(s.name_nb).toBeNull();
  });

  test("edgeStars gives a figure's own stars, once each, in order", () => {
    const ori = cons.find((c) => c.abbr === "Ori")!;
    const hips = edgeStars(ori);
    expect(new Set(hips).size).toBe(hips.length);
    expect([...hips].sort((a, b) => a - b)).toEqual(hips);
    expect(hips.length).toBeGreaterThanOrEqual(15);
    expect(hips.every((h) => stars.some((s) => s.hip === h))).toBe(true);
  });
});
