import { beforeAll, describe, expect, test } from "vitest";
import {
  buildTreatmentSystem,
  buildTreatmentUser,
  stagingNote,
  takeTemplateGaps,
  treatmentTemplate,
  DEFAULT_TREATMENT_EFFORT,
  STORYLINE_PROMPT_SOURCE,
} from "../src/llm/treatment";
import { catalogIndexText, fullEntryIds, storyTemplateLines } from "../src/scenes/catalog";
import { scenes } from "../src/scenes/registry";
import { ensureEnabledPacks, PACK_DEFS } from "../src/scenes/packs";
import { validateSpec } from "../src/spec/schema";
import { parseTemplateDoc } from "../src/scenes/doc";

describe("the storyline", () => {
  test("the sheet carries every storyline rule", () => {
    const s = STORYLINE_PROMPT_SOURCE;
    expect(s).toMatch(/Open with the question, as asked/);
    expect(s).toMatch(/misconception/);
    expect(s).toMatch(/One insight, named plainly at the end/);
    expect(s).toMatch(/illustrative/);
    expect(s).toMatch(/Change one thing at a time/);
    expect(s).toMatch(/GHOST/);
    expect(s).toMatch(/Key numbers on the canvas too/);
    expect(s).toMatch(/Every beat draws, moves or changes something/);
    expect(s).toMatch(/Figure budget/);
    expect(s).toMatch(/at most ONE temporary supporting piece/);
    expect(s).toMatch(/gone after beat 7/);
    expect(s).toMatch(/Focus sparingly/);
    expect(s).toMatch(/caveat/);
    expect(s).toMatch(/Never bend the story to fit a template/);
    expect(s).toMatch(/EXPLORE beat/);
    expect(s).toMatch(/transfer quiz/);
    expect(s).toMatch(/`wrong` hint/);
    expect(s).toContain("14–20 short sentences");
    expect(s).toMatch(/^TEMPLATE:/m);
    // Say WHAT, never WHERE.
    expect(s).toMatch(/never WHERE/);
  });

  test("the system prompt: the shortlist with its interactions, then the library index", () => {
    const sys = buildTreatmentSystem("- supply_demand: Curves.\n  Viewer can: drag a curve.", "- a: A.\n- b: B.");
    expect(sys.startsWith(STORYLINE_PROMPT_SOURCE.trim())).toBe(true);
    expect(sys).toContain("## Templates shortlisted for this request");
    expect(sys).toContain("Viewer can: drag a curve.");
    expect(sys).toContain("## The rest of the library");
    expect(sys).toContain("- b: B.");
    expect(buildTreatmentSystem("")).toMatch(/plan a freehand figure/);
    expect(buildTreatmentSystem("")).not.toContain("## The rest of the library");
  });

  test("the storyline's effort defaults to medium", () => {
    expect(DEFAULT_TREATMENT_EFFORT).toBe("medium");
  });

  test("the TEMPLATE line names a template, or none", () => {
    expect(treatmentTemplate("QUESTION: q\nTEMPLATE: supply_demand\nFIGURE: …")).toBe("supply_demand");
    expect(treatmentTemplate("**TEMPLATE:** `decision_tree`")).toBe("decision_tree");
    expect(treatmentTemplate("TEMPLATE: none")).toBeNull();
    expect(treatmentTemplate("TEMPLATE: freehand")).toBeNull();
    expect(treatmentTemplate("QUESTION: no template line")).toBeNull();
  });

  test("the user turn: the request and the brief", () => {
    expect(buildTreatmentUser("Why?", "Directing brief:\n- short")).toBe("Why?\n\nDirecting brief:\n- short");
    expect(buildTreatmentUser("Why?")).toBe("Why?");
  });

  test("the staging note: lines sacred, ink not, the budget, temporary marks, the gap channel", () => {
    const note = stagingNote("QUESTION: why?");
    expect(note).toContain("## The storyline to stage");
    expect(note).toMatch(/The LINES are sacred: keep what each says and their order/);
    expect(note).toMatch(/tighten a line to fit/);
    expect(note).toMatch(/The INK is not: the layout is yours/);
    expect(note).toMatch(/merge, shrink or drop a planned piece/);
    expect(note).toMatch(/one main figure, drawn large, and at most one temporary supporting piece/);
    expect(note).toMatch(/Honour every `temporary` mark: erase or fade/);
    expect(note).toContain('"template_gaps": [{"template": "<id>", "missing":');
    expect(note.endsWith("QUESTION: why?")).toBe(true);
  });

  test("gap notes come off the reply before validation, normalised; malformed ones are dropped", () => {
    const reply = { title: "t", elements: [{ id: "a", type: "shape", shape: "rect", x: 300, y: 300, width: 120, height: 80 }], commands: [{ draw: ["a"], speak: "A box." }], template_gaps: [{ template: "supply_demand", missing: "a second demand curve " }, { template: "", missing: "x" }, "junk"] };
    expect(takeTemplateGaps(reply)).toEqual([{ template: "supply_demand", missing: "a second demand curve" }]);
    expect("template_gaps" in reply).toBe(false);
    expect(validateSpec(reply).ok).toBe(true);
    expect(takeTemplateGaps({ elements: [] })).toEqual([]);
    expect(takeTemplateGaps(null)).toEqual([]);
    // The schema is closed: a gap note left on a spec would fail validation.
    expect(validateSpec({ elements: [], commands: [], template_gaps: [] }).ok).toBe(false);
  });
});

describe("template interaction lines (SceneManifest.interaction)", () => {
  const LIVE = [
    "supply_demand",
    "decision_tree",
    "markov_model",
    "equation_plot",
    "plot3d",
    "unit_circle",
    "indifference_budget",
    "is_lm",
    "ad_as",
    "motion_graphs",
    "refraction",
    "field_lines",
    "titration_curve",
    "maxwell_boltzmann",
    "sir_compartments",
    "reed_frost",
    "des_process",
    "des_hta",
    "ray_diagram",
    "projectile_motion",
  ];
  beforeAll(async () => {
    await ensureEnabledPacks(Object.keys(PACK_DEFS));
  });

  test("every template with a live widget says, in one short line, what the viewer can do", () => {
    for (const id of LIVE) {
      const line = scenes[id]?.manifest.interaction;
      expect(line, id).toBeTruthy();
      expect(line!.length, id).toBeLessThanOrEqual(200);
      expect(line!.includes("\n"), id).toBe(false);
    }
  });

  test("the storyline's template lines carry the description and the interaction", () => {
    const text = storyTemplateLines(["supply_demand", "timeline", "nope"]);
    expect(text).toMatch(/^- supply_demand: /m);
    expect(text).toMatch(/^ {2}Viewer can: Drag a curve's middle to shift it/m);
    expect(text).toMatch(/^- timeline: /m);
    expect(text).not.toContain("nope");
    // Both carry one since 2026-09-29 (the timeline pans and zooms while paused).
    expect(text.split("\n").filter((l) => l.startsWith("  Viewer can:"))).toHaveLength(2);
    expect(storyTemplateLines(["supply_demand"], { excludeIds: ["supply_demand"] })).toBe("");
  });

  test("the library index is one line per ready template; fullEntryIds reads a catalog block's full entries", () => {
    const index = catalogIndexText();
    expect(index).toMatch(/^- supply_demand: /m);
    expect(catalogIndexText({ excludeIds: ["supply_demand"] })).not.toMatch(/^- supply_demand: /m);
    expect(fullEntryIds("x\n### Scene template: supply_demand (READY — prefer this when it fits)\n…\n### Scene template: timeline (READY — prefer)")).toEqual(["supply_demand", "timeline"]);
  });

  test("a template document may declare interaction; it must be a non-empty string", () => {
    const base = "template: t_x\nversion: 1\nkit: 1\nstatus: stub\ndescription: A thing.\nparams: {}\nelement_ids: {}\nexamples: []\n";
    expect(parseTemplateDoc(base + "interaction: Drag it.\n").errors).toEqual([]);
    expect(parseTemplateDoc(base + "interaction: 3\n").errors.join()).toMatch(/interaction must be a non-empty string/);
  });
});
