import { beforeEach, describe, expect, test } from "vitest";
import anatomyYaml from "../src/scenes/packs/anatomy.yaml?raw";
import { registerPack, unregisterPack } from "../src/scenes/packs";
import { scenes } from "../src/scenes/registry";
import { ensureEngines } from "../src/scenes/engines";
import { flattenDrawables, leafDrawables } from "../src/layout/model";
import { layoutSpec } from "../src/layout/layout";

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
