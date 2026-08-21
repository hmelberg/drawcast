import { describe, expect, test } from "vitest";
import fewshots from "../src/llm/prompts/fewshots.json";
import { validateSpec } from "../src/spec/schema";
import { layoutSpec } from "../src/layout/layout";
import { planCommands } from "../src/render/plan";
import type { Command, Spec } from "../src/spec/types";

const examples = fewshots as { request: string; spec: Spec }[];

describe("bundled fewshots stay exemplary", () => {
  test.each(examples.map((ex) => [ex.request, ex.spec] as const))("%s — validates and every command id resolves", (_req, spec) => {
    expect(validateSpec(spec).ok).toBe(true);
    const layout = layoutSpec(spec);
    const plan = planCommands(spec.commands, layout.order);
    expect(plan.warnings.filter((w) => w.includes("unknown id"))).toEqual([]);
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
});
