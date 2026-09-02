import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { ensureEnabledPacks } from "../src/scenes/packs";
import { scenes } from "../src/scenes/registry";
import { layoutSpec } from "../src/layout/layout";
import { heuristicMeasure } from "../src/layout/measure";
import type { Spec } from "../src/spec/types";

// Hans's live bug (2026-09-02): a published cast on a PACK template
// (rd_plot, empirics) played voice and captions over a BLANK canvas in the
// standalone viewer — viewer.ts was the one entry point that never
// registered pack templates (main.ts, compiler.ts and engine-render.ts all
// do), and an unknown template falls through to the spec's loose elements,
// silently. Two layers pin the fix: the viewer registers ALL packs before
// mounting (an author's template choice must not depend on the VIEWER's
// settings), and an unknown template is a visible error, never a blank page.

const viewer = readFileSync(new URL("../src/viewer.ts", import.meta.url), "utf8");

describe("the standalone viewer and pack templates", () => {
  test("viewer.ts registers every pack before it mounts", () => {
    expect(viewer).toMatch(/ensureEnabledPacks\(Object\.keys\(PACK_DEFS\)\)/);
    // Awaited before the playlist mounts, not fired and forgotten.
    expect(viewer.indexOf("ensureEnabledPacks")).toBeGreaterThan(0);
    expect(viewer).toMatch(/await\s+(packsReady|ensureEnabledPacks)/);
  });

  test("viewer.ts refuses an unknown template loudly instead of mounting a blank page", () => {
    expect(viewer).toMatch(/unknown template|does not know/);
  });

  test("with the empirics pack registered, the blank first part draws its template", async () => {
    await ensureEnabledPacks(["empirics"]);
    expect(scenes["rd_plot"]).toBeDefined();
    // Item 0 of the live cast, minimized: template params + one annotation,
    // NO loose elements — exactly the shape that rendered as nothing.
    const spec = {
      template: "rd_plot",
      params: { jump: 2, slope: 0.22, curvature: 0.006, noise: 0.3, x_label: "Age", cutoff_label: "65", title: "The jump at 65" },
      elements: [],
      commands: [],
    } as unknown as Spec;
    const l = layoutSpec(spec, heuristicMeasure);
    expect(l.drawables.length).toBeGreaterThan(0);
    expect(l.order.length).toBeGreaterThan(1);
  });
});
