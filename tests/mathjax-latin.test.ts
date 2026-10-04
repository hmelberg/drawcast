// Norwegian letters in a formula (\text{kostnad per år}) need Fira's "latin"
// dynamic file. Under Vite SSR — what cast.mjs check/frames lay out with —
// the dynamic files registered on a second copy of the font class, and the
// first å threw "dynamic file 'latin' failed to load" (mathjax-fonts/fira.ts).
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { ensureEngines, getLoadedEngines, type MathJaxEngine } from "../src/scenes/engines";

const SPEC = {
  title: "t",
  lang: "nb",
  elements: [
    { id: "f", type: "math", tex: "\\text{kostnad per år} = \\frac{\\text{bør}}{æ}", x: 500, y: 300 },
    { id: "g", type: "math", tex: "Q_{\\text{nå}} = 5", x: 500, y: 150 },
  ],
  commands: [{ draw: ["f", "g"], speak: "Her er det." }],
};

describe("formulas with non-ASCII text", () => {
  test("in the test runner", async () => {
    await ensureEngines(["mathjax"]);
    const mj = getLoadedEngines(["mathjax"]).mathjax as MathJaxEngine;
    const r = mj.layoutTeX(SPEC.elements[0].tex);
    expect(r.outlines.some((o) => o.token.c === "E5")).toBe(true);
  });

  test("under Vite SSR: cast.mjs check lays them out", () => {
    const dir = mkdtempSync(join(tmpdir(), "dc-math-"));
    try {
      const file = join(dir, "math.json");
      writeFileSync(file, JSON.stringify(SPEC));
      const out = execFileSync("node", ["scripts/cast.mjs", "check", file], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
      expect(out).toMatch(/^valid/m);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 60000);
});
