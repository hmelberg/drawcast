import { beforeAll, describe, expect, test } from "vitest";
import fewshots from "../src/llm/prompts/fewshots.json";
import { validateSpec } from "../src/spec/schema";
import { domainMapping, elementBBoxes, layoutSpec } from "../src/layout/layout";
import { planCommands } from "../src/render/plan";
import { planOptionsFor } from "../src/render/index";
import { lintCommands } from "../src/lint/lint";
import { ensureEnabledPacks } from "../src/scenes/packs";
import { ensureEnginesForSpecs } from "../src/scenes/engines";
import type { Command, Spec } from "../src/spec/types";

const examples = fewshots as { request: string; spec: Spec }[];

beforeAll(async () => {
  // The data-bridge few-shot uses the data pack's bar_chart; the free-fall
  // few-shot's `math` element needs the mathjax engine, exactly as the app
  // loads it before rendering (ensureEnginesForSpecs).
  await ensureEnabledPacks(["data"]);
  await ensureEnginesForSpecs(examples.map((ex) => ex.spec));
});

describe("bundled fewshots stay exemplary", () => {
  test.each(examples.map((ex) => [ex.request, ex.spec] as const))("%s — validates and every command id resolves", (_req, spec) => {
    expect(validateSpec(spec).ok).toBe(true);
    const layout = layoutSpec(spec);
    const bboxes = elementBBoxes(layout);
    // Planned the way render() plans it: without planOptionsFor a `group` id
    // never expands to its members and a perfectly good `draw: ["pump"]`
    // reads as an unknown id.
    const plan = planCommands(spec.commands, layout.order, {
      bboxOf: (id) => bboxes.get(id) ?? null,
      windows: layout.windows ?? {},
      ...domainMapping(spec.domain),
      ...planOptionsFor(spec, layout),
    });
    expect(plan.warnings.filter((w) => w.includes("unknown id"))).toEqual([]);
    // A few-shot is prompt text, not a rendered figure, so its `image` and
    // `icon` elements carry no embedded `strokes` (a bundled example does —
    // see tests/examples.test.ts). The layout draws nothing for them and says
    // so; that one warning is the exemption, and nothing else is.
    expect(layout.warnings.filter((w) => !/^no image found/.test(w) && !/^no icon for/.test(w))).toEqual([]);
  });

  test.each(examples.map((ex) => [ex.request, ex.spec] as const))(
    "%s — at most one opening (announcement) speak precedes the first draw",
    (_req, spec) => {
      const commands = (spec.commands ?? []) as Command[];
      const firstDraw = commands.findIndex((c) => c.draw !== undefined);
      const speaksBefore = commands.slice(0, firstDraw).filter((c) => c.speak !== undefined);
      expect(speaksBefore.length).toBeLessThanOrEqual(1);
    },
  );

  test.each(examples.map((ex) => [ex.request, ex.spec] as const))("%s — no command-level lint issue (slow-start / talky-stretch)", (_req, spec) => {
    expect(lintCommands(spec)).toEqual([]);
  });
});
