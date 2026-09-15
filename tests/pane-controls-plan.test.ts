// Plan-level check for `<id>_ctls` (pane-controls final wave, item 5): the
// group id a `pane: controls` panel registers (code-controls-pane.ts) must
// expand, at plan time, to every row exactly once — and because expanding it
// counts as MENTIONING each row, the implicit final draw (render/plan.ts)
// must not sweep them in a second time. ghost-player.test.ts's planFor
// pattern (layoutSpec → elementBBoxes → planCommands + planOptionsFor) is
// reused here rather than going through layoutSpec's own drawables tree,
// since only the PLAN's draw steps say whether a row was mentioned twice.
import { describe, expect, test } from "vitest";
import { elementBBoxes, layoutSpec } from "../src/layout/layout";
import { heuristicMeasure } from "../src/layout/measure";
import { planOptionsFor } from "../src/render/index";
import { planCommands, type Plan, type PlanStep } from "../src/render/plan";
import type { Spec } from "../src/spec/types";

const OK = JSON.stringify({ ok: true, stdout: "42", stderr: "", figures: [] });

function planFor(spec: Spec): Plan {
  const layout = layoutSpec(spec, heuristicMeasure);
  const bboxes = elementBBoxes(layout, heuristicMeasure);
  return planCommands(spec.commands as never, layout.order, { bboxOf: (id) => bboxes.get(id) ?? null, ...planOptionsFor(spec, layout) });
}

describe("pane: controls — <id>_ctls end-to-end", () => {
  const spec: Spec = {
    elements: [
      {
        id: "sim",
        type: "code",
        language: "python",
        show: "left",
        width: 900,
        pane: "controls",
        code_result: OK,
        controls: ["n", "log"],
        code: "n = (1, 50)\nlog = False\nprint(n)",
      },
    ],
    commands: [{ draw: ["sim_ctls"] }],
  } as unknown as Spec;

  test("draw: [sim_ctls] expands to every row, each appearing exactly once across the plan's draw steps", () => {
    const plan = planFor(spec);
    const drawSteps = plan.steps.filter((s): s is Extract<PlanStep, { kind: "draw" }> => s.kind === "draw");
    const drawIds = drawSteps.flatMap((s) => s.ids);
    const counts = new Map<string, number>();
    for (const id of drawIds) counts.set(id, (counts.get(id) ?? 0) + 1);
    for (const row of ["sim_ctl_n", "sim_ctl_log"]) {
      expect(counts.get(row), `${row} should be drawn exactly once`).toBe(1);
    }
  });

  test("the implicit final draw does not draw a row again (it was already mentioned via the group)", () => {
    const plan = planFor(spec);
    const implicit = plan.steps.find((s): s is Extract<PlanStep, { kind: "draw" }> => s.kind === "draw" && s.implicit === true);
    if (!implicit) return; // nothing left unmentioned — the strongest possible pass
    expect(implicit.ids).not.toContain("sim_ctl_n");
    expect(implicit.ids).not.toContain("sim_ctl_log");
  });
});
