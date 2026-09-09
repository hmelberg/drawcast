// The not-loaded path needs a module registry where mathjax was NEVER loaded
// — the engine cache is module-level and `ensureEngines` is one-way, so this
// cannot live in math-element.test.ts (its beforeAll loads the engine for the
// whole file). Vitest isolates test files, so this one keeps a cold cache.
import { describe, expect, test } from "vitest";
import { enginesLoaded } from "../src/scenes/engines";
import { layoutSpec } from "../src/layout/layout";

describe("math element without the mathjax engine", () => {
  test("warns instead of throwing, and draws nothing", () => {
    expect(enginesLoaded(["mathjax"])).toBe(false);
    const r = layoutSpec({
      elements: [{ id: "m", type: "math", tex: "x", x: 100, y: 100 }],
      commands: [{ draw: ["m"] }],
    });
    expect(r.warnings).toContain('math "m": mathjax engine not loaded — skipped');
    expect(r.issues.filter((i) => i.severity === "error")).toEqual([]);
    expect(r.drawables.filter((d) => d.id === "m" || d.id.startsWith("m__g"))).toEqual([]);
  });
});
