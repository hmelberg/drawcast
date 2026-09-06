import { describe, expect, test } from "vitest";
import { mkdtempSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseCatalogue, elementsFor, fetchStl } from "../scripts/anatomy/bp3d.mjs";

const parts = `"id"\ten
FMA7197\tliver
FMA71335\tset of carpal bones
FMA24435\tright scaphoid
FMA24436\tleft scaphoid
FMA23709\tscaphoid
FMA231315\tset of phalanges
FMA24459\tdistal phalanx of right thumb
FMA32634\tproximal phalanx of right second toe
FMA46565\tskull
FMA52748\tmandible
FMA9999\tleft maxilla
`;
const composites = `composite id\tcomposite name\tprimitive id\tprimitive name
FMA71335\tset of carpal bones\tFMA24435\tright scaphoid
FMA71335\tset of carpal bones\tFMA24436\tleft scaphoid
FMA71335\tset of carpal bones\tFMA23709\tscaphoid
FMA231315\tset of phalanges\tFMA24459\tdistal phalanx of right thumb
FMA231315\tset of phalanges\tFMA32634\tproximal phalanx of right second toe
FMA46565\tskull\tFMA52748\tmandible
FMA46565\tskull\tFMA9999\tleft maxilla
`;

describe("the BodyParts3D catalogue", () => {
  const cat = parseCatalogue(parts, composites);

  test("maps ids to English names and composites to their elements", () => {
    expect(cat.names.get("FMA7197")).toBe("liver");
    expect(cat.composites.get("FMA71335")!.map((e) => e.id)).toEqual(["FMA24435", "FMA24436", "FMA23709"]);
  });

  test("a plain part is its own element list", () => {
    expect(elementsFor(cat, { fma: ["FMA7197"] })).toEqual(["FMA7197"]);
  });

  test("a sided composite keeps only elements named for that side, dropping the laterality-neutral duplicates", () => {
    expect(elementsFor(cat, { composite: "FMA71335", side: "right" })).toEqual(["FMA24435"]);
    expect(elementsFor(cat, { composite: "FMA71335", side: "left" })).toEqual(["FMA24436"]);
  });

  test("a filter separates finger bones from toe bones inside one composite", () => {
    expect(elementsFor(cat, { composite: "FMA231315", side: "right", filter: /finger|thumb/ })).toEqual(["FMA24459"]);
    expect(elementsFor(cat, { composite: "FMA231315", side: "right", filter: /toe/ })).toEqual(["FMA32634"]);
  });

  test("exclude removes an element from a composite", () => {
    expect(elementsFor(cat, { composite: "FMA46565", exclude: ["FMA52748"] })).toEqual(["FMA9999"]);
  });

  test("an unknown composite is an error, not an empty list", () => {
    expect(() => elementsFor(cat, { composite: "FMA0" })).toThrow(/FMA0/);
  });
});

describe("fetchStl", () => {
  test("writes a downloaded file into the cache and serves it from there next time; a 404 is null", async () => {
    const dir = mkdtempSync(join(tmpdir(), "bp3d-"));
    let calls = 0;
    const fetchImpl = (async (url: string) => {
      calls++;
      if (url.endsWith("FMA1.stl")) return new Response(new Uint8Array([1, 2, 3]), { status: 200 });
      return new Response("nope", { status: 404 });
    }) as unknown as typeof fetch;
    const a = await fetchStl("FMA1", { cacheDir: dir, mirror: "https://x/", fetchImpl });
    expect(Array.from(a!)).toEqual([1, 2, 3]);
    expect(existsSync(join(dir, "FMA1.stl"))).toBe(true);
    const b = await fetchStl("FMA1", { cacheDir: dir, mirror: "https://x/", fetchImpl });
    expect(Array.from(b!)).toEqual([1, 2, 3]);
    expect(calls).toBe(1); // second call came from the cache
    expect(await fetchStl("FMA2", { cacheDir: dir, mirror: "https://x/", fetchImpl })).toBeNull();
    expect(readFileSync(join(dir, "FMA2.missing"), "utf8")).toBe("404"); // the miss is remembered too
    expect(await fetchStl("FMA2", { cacheDir: dir, mirror: "https://x/", fetchImpl })).toBeNull();
    expect(calls).toBe(2);
  });
});
