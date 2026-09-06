import { describe, expect, test } from "vitest";
import body from "../src/scenes/anatomy/atlas-body.json";
import skeleton from "../src/scenes/anatomy/atlas-skeleton.json";
import viscera from "../src/scenes/anatomy/atlas-viscera.json";
import type { Atlas, AtlasPart, AnatomyEngine } from "../src/scenes/anatomy/types";
import { ensureEngines, getLoadedEngines } from "../src/scenes/engines";

const BODY = body as unknown as Atlas;
const SKELETON = skeleton as unknown as Atlas;
const VISCERA = viscera as unknown as Atlas;
const ATLASES: [string, Atlas, number][] = [
  ["body", BODY, 1500],
  ["skeleton", SKELETON, 4000],
  ["viscera", VISCERA, 4000],
];
/** Parents may live in another file: the bones' parents are the body atlas's regions. */
const EVERY_PART: Record<string, AtlasPart> = { ...BODY.parts, ...SKELETON.parts, ...VISCERA.parts };

const pointsIn = (p: AtlasPart) => p.rings.reduce((s, r) => s + r.outer.length + (r.holes ?? []).reduce((t, h) => t + h.length, 0), 0);
const bbox = (pts: [number, number][]) => ({
  x0: Math.min(...pts.map((p) => p[0])), x1: Math.max(...pts.map((p) => p[0])),
  y0: Math.min(...pts.map((p) => p[1])), y1: Math.max(...pts.map((p) => p[1])),
});

describe.each(ATLASES)("%s atlas", (_name, atlas, budget) => {
  test("stays inside its point budget", () => {
    expect(Object.values(atlas.parts).reduce((s, p) => s + pointsIn(p), 0)).toBeLessThanOrEqual(budget);
  });

  test("declares the shared coordinate space", () => {
    expect(atlas.view).toBe("anterior");
    expect(atlas.space).toEqual([1000, 2000]);
  });

  test("every part is well formed", () => {
    for (const [id, p] of Object.entries(atlas.parts)) {
      expect(id, `${id}: id must be snake_case`).toMatch(/^[a-z][a-z0-9_]*$/);
      expect(p.name.en, `${id}: needs an English name`).toBeTruthy();
      expect(["skeleton", "viscera"]).toContain(p.system);
      expect(["bone", "joint", "organ", "region", "outline", "group"]).toContain(p.kind);
      expect([1, 2, 3]).toContain(p.detail);
      expect(["any", "female", "male"]).toContain(p.sex);
      expect(Number.isFinite(p.depth), `${id}: depth`).toBe(true);
      if (p.kind === "group") expect(p.rings, `${id}: a group owns no geometry`).toEqual([]);
      else expect(p.rings.length, `${id}: needs at least one ring`).toBeGreaterThan(0);
      for (const ring of p.rings) {
        expect(ring.outer.length, `${id}: an outer ring needs at least 3 points`).toBeGreaterThanOrEqual(3);
        const ob = bbox(ring.outer);
        for (const [x, y] of ring.outer) {
          expect(Number.isFinite(x) && Number.isFinite(y), `${id}: non-finite point`).toBe(true);
          expect(x >= -1 && x <= 1001 && y >= -1 && y <= 2001, `${id}: point outside the atlas space`).toBe(true);
        }
        for (const hole of ring.holes ?? []) {
          expect(hole.length).toBeGreaterThanOrEqual(3);
          const hb = bbox(hole);
          expect(hb.x0 >= ob.x0 - 0.2 && hb.x1 <= ob.x1 + 0.2 && hb.y0 >= ob.y0 - 0.2 && hb.y1 <= ob.y1 + 0.2, `${id}: hole outside its outer ring`).toBe(true);
        }
      }
    }
  });

  test("every parent reference resolves somewhere in the atlas set", () => {
    for (const [id, p] of Object.entries(atlas.parts)) {
      if (p.parent === null) continue;
      expect(EVERY_PART[p.parent], `${id}: parent "${p.parent}" exists in no atlas`).toBeDefined();
    }
  });
});

test("the part-of tree has no cycles", () => {
  for (const id of Object.keys(EVERY_PART)) {
    const seen = new Set<string>();
    let cur: string | null = id;
    while (cur) {
      expect(seen.has(cur), `${id}: cycle through ${cur}`).toBe(false);
      seen.add(cur);
      cur = EVERY_PART[cur]?.parent ?? null;
    }
  }
});

test("no id is defined in two atlases", () => {
  const ids = [...Object.keys(BODY.parts), ...Object.keys(SKELETON.parts), ...Object.keys(VISCERA.parts)];
  expect(new Set(ids).size).toBe(ids.length);
});

test("the body atlas carries the outline and seventeen skeleton regions", () => {
  expect(BODY.parts.body_outline.kind).toBe("outline");
  expect(Object.values(BODY.parts).filter((p) => p.kind === "region").length).toBe(17);
});

test("the skeleton atlas carries the named bones and thirteen joints", () => {
  for (const id of ["femur_left", "femur_right", "ribs", "sternum", "hand_right", "cranium"]) expect(EVERY_PART[id], id).toBeDefined();
  expect(Object.values(SKELETON.parts).filter((p) => p.kind === "joint").length).toBe(13);
  for (const id of ["knee_left", "elbow_right", "jaw"]) expect(SKELETON.parts[id]?.kind).toBe("joint");
});

test("every region hull encloses the bones it stands for", () => {
  // A detail-1 silhouette must cover its detail-2 children's boxes, or focus on
  // a region would crop away part of what the region is.
  const children = (region: string) => Object.entries(EVERY_PART).filter(([, p]) => p.parent === region && p.kind === "bone");
  for (const [id, region] of Object.entries(BODY.parts)) {
    if (region.kind !== "region") continue;
    const hull = bbox(region.rings[0].outer);
    for (const [cid, child] of children(id)) {
      const cb = bbox(child.rings.flatMap((r) => r.outer));
      expect(cb.x0 >= hull.x0 - 1 && cb.x1 <= hull.x1 + 1 && cb.y0 >= hull.y0 - 1 && cb.y1 <= hull.y1 + 1, `${cid} escapes ${id}`).toBe(true);
    }
  }
});

test("the sexed organs are the only sexed parts", () => {
  const sexed = Object.entries(EVERY_PART).filter(([, p]) => p.sex !== "any").map(([id]) => id).sort();
  expect(sexed).toEqual(["prostate", "uterus"]);
});

describe("the anatomy engine", () => {
  test("merges the body atlas with the requested systems and filters by sex", async () => {
    await ensureEngines(["anatomy"]);
    const eng = getLoadedEngines(["anatomy"]).anatomy as AnatomyEngine;

    expect(eng.space()).toEqual([1000, 2000]);

    const organs = eng.parts({ systems: ["viscera"], sex: "neutral" });
    expect(organs.heart).toBeDefined();
    expect(organs.gallbladder, "detail is the template's business — every organ comes back").toBeDefined();
    expect(organs.body_outline, "the outline always comes back").toBeDefined();
    expect(organs.abdomen, "grouping parts always come back").toBeDefined();
    expect(organs.femur_left, "skeleton was not asked for").toBeUndefined();
    expect(organs.hand_left, "nor its regions").toBeUndefined();

    const bones = eng.parts({ systems: ["skeleton"], sex: "neutral" });
    expect(bones.femur_left).toBeDefined();
    expect(bones.hand_left, "regions ride with their system").toBeDefined();
    expect(bones.knee_left).toBeDefined();
    expect(bones.heart).toBeUndefined();

    const both = eng.parts({ systems: ["skeleton", "viscera"], sex: "neutral" });
    expect(both.femur_left).toBeDefined();
    expect(both.heart).toBeDefined();

    expect(eng.parts({ systems: ["viscera"], sex: "neutral" }).uterus).toBeUndefined();
    expect(eng.parts({ systems: ["viscera"], sex: "female" }).uterus).toBeDefined();
    expect(eng.parts({ systems: ["viscera"], sex: "female" }).prostate).toBeUndefined();
    expect(eng.parts({ systems: ["viscera"], sex: "male" }).prostate).toBeDefined();
  });

  test("returns the atlas objects themselves, never copies, so calling it per layout is cheap", async () => {
    await ensureEngines(["anatomy"]);
    const eng = getLoadedEngines(["anatomy"]).anatomy as AnatomyEngine;
    const a = eng.parts({ systems: ["skeleton"], sex: "neutral" });
    const b = eng.parts({ systems: ["skeleton"], sex: "neutral" });
    expect(a.femur_left).toBe(b.femur_left);
  });
});

test("the joints sit where their bones meet", () => {
  // The knee circle's centre lies between the femur's lowest and the tibia's highest point.
  const centre = (id: string) => { const b = bbox(SKELETON.parts[id].rings[0].outer); return [(b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2]; };
  const [, kneeY] = centre("knee_left");
  const femurBottom = bbox(SKELETON.parts.femur_left.rings.flatMap((r) => r.outer)).y1;
  const tibiaTop = bbox(SKELETON.parts.tibia_left.rings.flatMap((r) => r.outer)).y0;
  expect(kneeY).toBeGreaterThan(femurBottom - 40);
  expect(kneeY).toBeLessThan(tibiaTop + 40);
});
