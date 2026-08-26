import { afterEach, describe, expect, test } from "vitest";
import { layoutSpec } from "../src/layout/layout";
import { flattenDrawables } from "../src/layout/model";
import { scenes } from "../src/scenes/registry";

describe("layoutSpec", () => {
  afterEach(() => {
    delete scenes.temp_stub_scene;
  });

  test("templated spec produces scene drawables plus placed labels", () => {
    const r = layoutSpec({ template: "supply_demand", params: {}, commands: [{ draw: ["axes"] }] });
    expect(r.order).toContain("axes");
    expect(r.order).toContain("demand_curve");
    const flat = flattenDrawables(r.drawables);
    const labelD = flat.find((d) => d.id === "label_D");
    expect(labelD?.kind).toBe("text");
  });

  test("unknown template falls through to tier-2 with a warning", () => {
    const r = layoutSpec({
      template: "does_not_exist",
      elements: [{ id: "c", type: "curve", direction: "decreasing" }],
      commands: [{ draw: ["c"] }],
    });
    expect(r.warnings.join(" ")).toMatch(/does_not_exist/);
    expect(r.order).toContain("c");
  });

  test("stub template falls through gracefully", () => {
    // markov_model/cost_effectiveness_plane were the last built-in stubs
    // (promoted to ready templates); register a throwaway stub here instead
    // of relying on a real template staying unimplemented forever.
    scenes.temp_stub_scene = {
      manifest: { name: "temp_stub_scene", status: "stub", description: "test-only stub", params_schema: {}, element_ids: {}, examples: [] },
    };
    const r = layoutSpec({
      template: "temp_stub_scene",
      elements: [{ id: "healthy", type: "node", shape: "circle", text: "Healthy" }],
      commands: [{ draw: ["healthy"] }],
    });
    expect(r.warnings.join(" ")).toMatch(/stub/i);
    expect(r.order).toContain("healthy");
  });

  test("extra elements can attach labels to scene-produced ids", () => {
    const r = layoutSpec({
      template: "supply_demand",
      params: {},
      elements: [{ id: "note", type: "label", text: "Market clears here", attach_to: "equilibrium_point" }],
      commands: [{ draw: ["axes"] }],
    });
    const note = flattenDrawables(r.drawables).find((d) => d.id === "note");
    expect(note?.kind).toBe("text");
    // attached near the equilibrium, not dumped at canvas center fallback
    expect(r.warnings.join(" ")).not.toMatch(/unknown attach_to/);
  });

  test("default supply/demand layout is lint-clean", () => {
    const r = layoutSpec({ template: "supply_demand", params: {}, commands: [] });
    expect(r.issues.filter((i) => i.severity === "error")).toEqual([]);
  });
});

describe("text fades in by default", () => {
  const drawOptsOf = (r: ReturnType<typeof layoutSpec>, id: string): { mode: string; duration: number } | undefined => {
    const d = flattenDrawables(r.drawables).find((x) => x.id === id);
    return d && "drawOpts" in d ? (d as { drawOpts: { mode: string; duration: number } }).drawOpts : undefined;
  };

  test("a plain text element gets a sketch fade, not an instant pop", () => {
    const r = layoutSpec({ elements: [{ id: "t", type: "text", text: "hello", x: 500, y: 375 }], commands: [] });
    expect(drawOptsOf(r, "t")).toEqual({ mode: "sketch", duration: 400 });
  });

  test("an attached label fades too", () => {
    const r = layoutSpec({
      elements: [
        { id: "t", type: "text", text: "anchor", x: 500, y: 375 },
        { id: "lbl", type: "label", attach_to: "t", text: "the note" },
      ],
      commands: [],
    });
    expect(drawOptsOf(r, "lbl")?.mode).toBe("sketch");
  });

  test("an explicit instant draw still wins", () => {
    const r = layoutSpec({
      elements: [{ id: "t", type: "text", text: "x", x: 500, y: 375, draw: { mode: "instant" } }],
      commands: [],
    });
    expect(drawOptsOf(r, "t")?.duration).toBe(0);
  });
});
