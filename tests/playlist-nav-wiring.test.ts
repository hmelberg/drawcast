// Wiring of the playlist navigation rules (player-nav round, 2026-09-17):
// the pure model in src/playlist/nav-model.ts is exercised in
// playlist-nav.test.ts; this file pins that the session and the control bar
// actually consult it, and that the per-item dots are gone.
import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

const session = readFileSync(new URL("../src/playlist/session.ts", import.meta.url), "utf8");
const controls = readFileSync(new URL("../src/ui/controls.ts", import.meta.url), "utf8");
const css = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");

describe("player-nav wiring", () => {
  test("the per-item dots are gone from the control bar and the stylesheet (the ☰ panel is the item navigation)", () => {
    expect(session).not.toContain("pl-dot");
    expect(css).not.toContain(".pl-dot");
    expect(session).toContain("panelBtn");
  });
  test("the step buttons offer the session first refusal at an item border", () => {
    expect(controls).toMatch(/onStepEdge\?\(dir: "back" \| "forward"\): boolean/);
    expect(controls).toMatch(/if \(opts\.onStepEdge\?\.\("back"\)\) return;\s*\n\s*hd\.timeline\.stepBack\(\)/);
    expect(controls).toMatch(/if \(opts\.onStepEdge\?\.\("forward"\)\) return;\s*\n\s*hd\.timeline\.stepForward\(\)/);
  });
  test("the session answers both hooks from the pure model", () => {
    expect(session).toMatch(/import \{ edgeStep, replayTarget \} from "\.\/nav-model"/);
    expect(session).toMatch(/onStepEdge: \(dir\) =>[\s\S]*edgeStep\(dir,/);
    expect(session).toMatch(/beforePlay: \(\) =>[\s\S]*replayTarget\(\{ finishedLast/);
    // The previous beforePlay (the editor's) keeps first refusal.
    expect(session).toMatch(/opts\.controls\?\.beforePlay\?\.\(\)/);
  });
  test("the flag that arms the whole-drawcast replay is set only by the LAST item's done and dropped on any other state", () => {
    expect(session).toMatch(/finishedLast = i === items\.length - 1/);
    expect(session).toMatch(/else \{\s*\n\s*finishedLast = false;/);
  });
});
