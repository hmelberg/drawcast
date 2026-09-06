import { beforeEach, describe, expect, test } from "vitest";
import anatomyYaml from "../src/scenes/packs/anatomy.yaml?raw";
import { registerPack, unregisterPack } from "../src/scenes/packs";
import { scenes } from "../src/scenes/registry";
import { ensureEngines } from "../src/scenes/engines";
import { flattenDrawables, leafDrawables } from "../src/layout/model";
import { elementBBoxes, elementRings, layoutSpec } from "../src/layout/layout";
import { hitElement } from "../src/ui/hit";
import { validateSpec } from "../src/spec/schema";
import { planCommands } from "../src/render/plan";

const lay = (params: Record<string, unknown>) => scenes.anatomy.layout!(params);
const idsOf = (params: Record<string, unknown>) => lay(params).order;
/** Label ids, wherever the layout put them: solver requests (focus mode) or
 *  placed text drawables (whole-body columns). Both land in `order`. */
const labelIds = (r: ReturnType<typeof lay>) => r.order.filter((id) => id.startsWith("label_"));
const labelText = (r: ReturnType<typeof lay>, id: string): string | undefined => {
  const req = r.labels.find((l) => l.id === id);
  if (req) return req.text;
  const d = flattenDrawables(r.drawables).find((x) => x.id === id);
  return d && d.kind === "text" ? d.text : undefined;
};

describe("anatomy template", () => {
  beforeEach(async () => {
    unregisterPack("anatomy");
    await ensureEngines(["anatomy"]);
    registerPack("anatomy", anatomyYaml);
  });

  test("registers as one ready template", () => {
    unregisterPack("anatomy");
    expect(registerPack("anatomy", anatomyYaml)).toMatchObject({ ok: true, templateIds: ["anatomy"] });
  });

  test("draws the outline and the organs by default, and no bones", () => {
    const ids = idsOf({});
    expect(ids).toContain("body_outline");
    expect(ids).toContain("heart");
    expect(ids).toContain("liver");
    expect(ids).toContain("kidney_left"); // detail 2 is the default
    expect(ids).not.toContain("gallbladder"); // detail 3
    expect(ids).not.toContain("femur_left");
    expect(ids).not.toContain("abdomen"); // grouping parts are never drawn
  });

  test("systems chooses what is drawn", () => {
    const bones = idsOf({ systems: ["skeleton"] });
    expect(bones).toContain("femur_left");
    expect(bones).toContain("knee_left");
    expect(bones).not.toContain("heart");
    const both = idsOf({ systems: ["skeleton", "viscera"], detail: 1 });
    expect(both).toContain("thigh_left");
    expect(both).toContain("heart");
  });

  test("detail draws the leaves at that level: the hand is a mitten at 1 and 2, bones at 3", () => {
    expect(idsOf({ systems: ["skeleton"], detail: 1 })).toContain("hand_left");
    expect(idsOf({ systems: ["skeleton"], detail: 1 })).not.toContain("femur_left"); // thigh_left instead
    expect(idsOf({ systems: ["skeleton"], detail: 1 })).toContain("thigh_left");
    expect(idsOf({ systems: ["skeleton"], detail: 2 })).toContain("hand_left");
    expect(idsOf({ systems: ["skeleton"], detail: 2 })).toContain("femur_left");
    expect(idsOf({ systems: ["skeleton"], detail: 2 })).not.toContain("thigh_left");
    const fine = idsOf({ systems: ["skeleton"], detail: 3 });
    expect(fine).toContain("carpals_left");
    expect(fine).not.toContain("hand_left");
  });

  test("every drawn part is ink plus wash on the same ring, so it has an outline AND a clickable shape", () => {
    const flat = flattenDrawables(lay({}).drawables);
    const heart = flat.find((d) => d.id === "heart");
    expect(heart?.kind).toBe("group");
    const leaves = leafDrawables([heart!]);
    const fill = leaves.find((d) => d.kind === "area");
    const ink = leaves.find((d) => d.kind === "stroke");
    expect(fill).toBeDefined();
    expect(ink).toBeDefined();
    expect((ink as { closed?: boolean }).closed).toBe(true);
    expect((ink as { pts: unknown }).pts).toEqual((fill as { pts: unknown }).pts);
  });

  test("a joint is drawn as a closed ring, not a filled shape", () => {
    const flat = flattenDrawables(lay({ systems: ["skeleton"] }).drawables);
    const knee = leafDrawables([flat.find((d) => d.id === "knee_left")!]);
    expect(knee.every((d) => d.kind === "stroke" && (d as { closed?: boolean }).closed)).toBe(true);
  });

  test("names chooses the label language and falls back to English", () => {
    expect(labelText(lay({ labels: "all", detail: 1, names: "nb" }), "label_liver")).toBe("Lever");
    expect(labelText(lay({ labels: "all", detail: 1, names: "la" }), "label_liver")).toBe("Hepar");
    expect(labelText(lay({ labels: "all", detail: 1 }), "label_liver")).toBe("Liver");
  });

  test("the whole figure fits the canvas at every level and with both systems", () => {
    for (const detail of [1, 2, 3]) {
      const res = layoutSpec({ template: "anatomy", params: { systems: ["skeleton", "viscera"], detail }, elements: [] } as never);
      expect(res.issues.filter((i) => i.severity === "error"), `detail ${detail}`).toEqual([]);
      expect(res.warnings, `detail ${detail}`).toEqual([]);
    }
  });
});

describe("anatomy: narrowing and naming", () => {
  beforeEach(async () => {
    unregisterPack("anatomy");
    await ensureEngines(["anatomy"]);
    registerPack("anatomy", anatomyYaml);
  });

  test("focus keeps the named part and its children, drops the rest, and leaves the outline out", () => {
    const ids = idsOf({ focus: ["abdomen"] });
    expect(ids).toContain("liver");
    expect(ids).toContain("stomach");
    expect(ids).toContain("gallbladder"); // focus pins its subtree to detail 3
    expect(ids).not.toContain("brain");
    expect(ids).not.toContain("body_outline");
    expect(ids).toContain("frame");
  });

  test("focus on a region shows its small bones", () => {
    const ids = idsOf({ systems: ["skeleton"], focus: ["hand_left"] });
    expect(ids).toContain("carpals_left");
    expect(ids).toContain("phalanges_hand_left");
    expect(ids).not.toContain("hand_left");
    expect(ids).not.toContain("femur_left");
  });

  test("focus enlarges what it keeps", () => {
    const spread = (params: Record<string, unknown>) => {
      const flat = leafDrawables(flattenDrawables(lay(params).drawables)).filter((d) => d.id.startsWith("liver__"));
      const xs = flat.flatMap((d) => ("pts" in d ? d.pts.map((p) => p[0]) : []));
      return Math.max(...xs) - Math.min(...xs);
    };
    expect(spread({ focus: ["abdomen"] })).toBeGreaterThan(spread({}) * 1.5);
  });

  test("nothing a focus figure draws leaves the canvas", () => {
    for (const focus of [["abdomen"], ["hand_left"], ["knee_left"], ["skull"]]) {
      const res = layoutSpec({ template: "anatomy", params: { systems: ["skeleton", "viscera"], focus }, elements: [] } as never);
      expect(res.issues.filter((i) => i.rule === "out-of-canvas").map((i) => i.message), focus.join()).toEqual([]);
      expect(res.issues.filter((i) => i.severity === "error").map((i) => i.message), focus.join()).toEqual([]);
    }
  });

  test("highlight tints without removing anything", () => {
    const r = lay({ highlight: ["liver"] });
    expect(r.order).toContain("liver");
    expect(r.order).toContain("brain"); // nothing was cropped away
    const liverInk = leafDrawables(flattenDrawables(r.drawables)).find((d) => d.id === "liver__ink0");
    const brainInk = leafDrawables(flattenDrawables(r.drawables)).find((d) => d.id === "brain__ink0");
    expect(liverInk!.style.color).not.toBe(brainInk!.style.color);
  });

  test("a Norwegian or Latin name finds the same part as the id", () => {
    expect(idsOf({ focus: ["Lever"] })).toContain("liver");
    expect(idsOf({ focus: ["Hepar"] })).toContain("liver");
    expect(idsOf({ systems: ["skeleton"], focus: ["Venstre kne"] })).toContain("knee_left");
  });

  test("an unknown name is noted, not fatal", () => {
    const r = lay({ highlight: ["spleen", "flux capacitor"] });
    const note = flattenDrawables(r.drawables).find((d) => d.id === "missing_note");
    expect(note).toBeDefined();
    expect((note as { text: string }).text).toContain("flux capacitor");
    expect(r.order).toContain("spleen");
  });

  test("labels: all names every drawn part except the joints; none names nothing", () => {
    const named = labelIds(lay({ systems: ["skeleton", "viscera"], labels: "all", detail: 2 }));
    expect(named).toContain("label_femur_left");
    expect(named).toContain("label_liver");
    expect(named).not.toContain("label_knee_left");
    expect(labelIds(lay({ labels: "none", highlight: ["liver"] }))).toEqual([]);
  });

  test("a highlighted joint does get its name", () => {
    expect(labelIds(lay({ systems: ["skeleton"], highlight: ["knee_left"] }))).toContain("label_knee_left");
  });

  test("whole-body names sit outside the silhouette with a leader; focus names are placed by the solver", () => {
    const whole = lay({ labels: "all", detail: 1 });
    expect(whole.labels).toEqual([]); // nothing left to the solver
    const flat = flattenDrawables(whole.drawables);
    const liver = flat.find((d) => d.id === "label_liver");
    expect(liver?.kind).toBe("text");
    expect(flat.find((d) => d.id === "label_liver_leader")?.kind).toBe("stroke");
    expect(whole.order).not.toContain("label_liver_leader"); // a sub-drawable, not an element
    const focus = lay({ focus: ["abdomen"] });
    expect(focus.labels.map((l) => l.id)).toContain("label_liver");
  });

  test("markers land on the part they name", () => {
    const r = lay({ markers: [{ part: "heart", label: "Here" }] });
    expect(r.order).toContain("marker_0");
    expect(r.anchors.marker_0).toEqual(r.anchors.heart);
  });

  test("the drawn scene never exceeds its point budget", () => {
    const r = lay({ systems: ["skeleton", "viscera"], detail: 3 });
    const pts = leafDrawables(r.drawables).reduce((s, d) => s + ("pts" in d ? d.pts.length : 0), 0);
    // Ink and wash share each ring, so the drawable count is twice the atlas count; the budget is on atlas points.
    expect(pts).toBeLessThanOrEqual(2 * 4000 + 200);
  });
});

describe("anatomy: findings", () => {
  beforeEach(async () => {
    unregisterPack("anatomy");
    await ensureEngines(["anatomy"]);
    registerPack("anatomy", anatomyYaml);
  });

  const inkOf = (params: Record<string, unknown>, id: string) => {
    const d = leafDrawables(lay(params).drawables).find((x) => x.id === id + "__ink0");
    return d && "pts" in d ? d.pts : [];
  };
  const width = (p: number[][]) => Math.max(...p.map((q) => q[0])) - Math.min(...p.map((q) => q[0]));

  test("an enlarged organ is drawn bigger than the normal one", () => {
    const normal = inkOf({}, "heart");
    const big = inkOf({ findings: [{ part: "heart", condition: "enlarged", severity: "severe" }] }, "heart");
    expect(width(big)).toBeGreaterThan(width(normal) * 1.15);
  });

  test("a fracture draws a mark on the bone", () => {
    const ids = idsOf({ systems: ["skeleton"], findings: [{ part: "femur_left", condition: "fracture" }] });
    expect(ids).toContain("finding_femur_left");
  });

  test("an unknown condition still draws a marked patch instead of failing", () => {
    expect(idsOf({ findings: [{ part: "liver", condition: "wibble" }] })).toContain("finding_liver");
  });

  test("a finding on a name that does not resolve is noted, and the figure survives", () => {
    const r = lay({ findings: [{ part: "the thing", condition: "mass" }] });
    expect(r.order).toContain("missing_note");
    expect(r.order).toContain("liver");
  });

  test("a finding is silent unless it is given a label — the viewer is meant to work it out", () => {
    const quiet = lay({ findings: [{ part: "liver", condition: "mass" }], labels: "none" });
    expect(labelIds(quiet)).not.toContain("label_finding_liver");
    const told = lay({ findings: [{ part: "liver", condition: "mass", label: "Metastasis" }], labels: "none" });
    expect(labelIds(told)).toContain("label_finding_liver");
  });

  test("an absent organ is drawn as an empty dashed outline", () => {
    const leaves = leafDrawables(lay({ findings: [{ part: "spleen", condition: "absent" }] }).drawables);
    expect(leaves.find((d) => d.id === "spleen__fill0")).toBeUndefined();
    const ink = leaves.find((d) => d.id === "spleen__ink0");
    expect(ink?.style.dash).toBe(true);
  });

  test("a figure with findings is still lint-clean", () => {
    const res = layoutSpec({ template: "anatomy", params: { systems: ["skeleton"], detail: 2, labels: "none", findings: [{ part: "femur_left", condition: "fracture", severity: "severe" }] }, elements: [] } as never);
    expect(res.issues.map((i) => i.message)).toEqual([]);
  });
});

describe("anatomy: asking the viewer to find things", () => {
  beforeEach(async () => {
    unregisterPack("anatomy");
    await ensureEngines(["anatomy"]);
    registerPack("anatomy", anatomyYaml);
  });

  const centroidOf = (ring: [number, number][]): [number, number] => [
    ring.reduce((s, p) => s + p[0], 0) / ring.length,
    ring.reduce((s, p) => s + p[1], 0) / ring.length,
  ];

  test("a locate-the-organ spec validates, plans, and its answer is a real element", () => {
    const spec = {
      title: "Find the liver",
      template: "anatomy",
      params: { systems: ["viscera"], detail: 2, labels: "none" },
      elements: [],
      commands: [
        { draw: ["body_outline", "liver", "stomach", "heart"] },
        { ask: { question: "Click on the liver.", widget: "click", answer: "liver", right: "The liver sits under the right ribs, the body's largest gland." } },
      ],
    };
    expect(validateSpec(spec)).toMatchObject({ ok: true });
    const res = layoutSpec(spec as never);
    expect(res.order).toContain("liver");
    const plan = planCommands(spec.commands as never, res.order);
    expect(plan.warnings.filter((w) => w.includes("unknown id"))).toEqual([]);
  });

  test("a click inside the liver resolves to the liver, not to a neighbour whose box overlaps it", () => {
    const res = layoutSpec({ template: "anatomy", params: { systems: ["viscera"], detail: 2, labels: "none" }, elements: [] } as never);
    const boxes = elementBBoxes(res);
    const rings = elementRings(res);
    expect(rings.get("liver"), "the liver must be a closed shape").toBeDefined();
    expect(hitElement(boxes, centroidOf(rings.get("liver")![0] as [number, number][]), 0, rings)).toBe("liver");
    // The stomach's box overlaps the liver's; its own centroid still answers "stomach".
    expect(hitElement(boxes, centroidOf(rings.get("stomach")![0] as [number, number][]), 0, rings)).toBe("stomach");
  });

  test("a click on a joint answers the joint, though it sits on top of two bones", () => {
    const res = layoutSpec({ template: "anatomy", params: { systems: ["skeleton"], detail: 2, labels: "none" }, elements: [] } as never);
    const boxes = elementBBoxes(res);
    const rings = elementRings(res);
    expect(hitElement(boxes, centroidOf(rings.get("knee_left")![0] as [number, number][]), 0, rings)).toBe("knee_left");
  });

  test("every drawn part can be the answer to a click ask", () => {
    const res = layoutSpec({ template: "anatomy", params: { systems: ["skeleton", "viscera"], detail: 2, labels: "none" }, elements: [] } as never);
    const rings = elementRings(res);
    for (const id of res.order) {
      if (id === "body_outline" || id === "frame" || id === "missing_note" || id === "title") continue;
      expect(rings.has(id), `${id} has no outline to click on`).toBe(true);
    }
  });
});
