// The daily visit record per name. Pure — no Blobs, no network.
import { describe, expect, it } from "vitest";
import { addVisit, refDomain, visitKey } from "../netlify/lib/name-visits.mts";

describe("name visits", () => {
  it("adds a visit to an empty day", () => {
    expect(addVisit(null, { country: "NO", source: "name", ref: "t.co" })).toEqual({ count: 1, country: { NO: 1 }, source: { name: 1 }, ref: { "t.co": 1 } });
  });
  it("accumulates and leaves an empty referrer out", () => {
    const r = addVisit(addVisit(null, { country: "NO", source: "name", ref: "" }), { country: "SE", source: "lecture", ref: "" });
    expect(r).toEqual({ count: 2, country: { NO: 1, SE: 1 }, source: { name: 1, lecture: 1 }, ref: {} });
  });
  it("caps each map at 50 keys, the rest under 'other'", () => {
    let r = null;
    for (let i = 0; i < 60; i++) r = addVisit(r, { country: `C${i}`, source: "name", ref: "" });
    expect(Object.keys(r!.country).length).toBe(51);
    expect(r!.country.other).toBe(10);
  });
  it("refDomain", () => {
    expect(refDomain("https://www.facebook.com/x?y")).toBe("www.facebook.com");
    expect(refDomain("https://drawcast.app/#x")).toBe("");
    expect(refDomain("nonsense")).toBe("");
    expect(visitKey("qaly", "2026-09-29")).toBe("v/qaly/2026-09-29");
  });
});
