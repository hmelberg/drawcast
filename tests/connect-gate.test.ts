// The connect gate's own source-drift test, in gates.test.ts's own style:
// there is no jsdom anywhere in this repo (vitest.config.ts sets
// `environment: "node"` and no file opts out), so a gate cannot actually be
// mounted, pressed or dragged in a test. What follows checks only the things
// whose absence would fail SILENTLY — everything else is on Hans's smoke
// checklist (task-6-report.md), which the plan names as a merge condition.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("../src/ui/connect-gate.ts", import.meta.url), "utf8");

describe("connect-gate.ts", () => {
  it("mounts under cs-figgate, the class GATE_SELECTOR already covers", () => {
    // A gate that names its OWN class and forgets cs-figgate is invisible to
    // gateIsOpen — the stage's other gestures (free play, info cards) would
    // fight it, which is exactly the silent failure gates.test.ts exists for.
    expect(source).toMatch(/class:\s*"cs-figgate\b/);
  });

  it("asks connectOpens before mounting anything, and does not re-implement its rule", () => {
    const domImport = /import\s*\{([^}]*)\}\s*from\s*"\.\/connect-model";/.exec(source)?.[1] ?? "";
    expect(domImport).toMatch(/\bconnectOpens\b/);

    const openIdx = source.indexOf("connectOpens(");
    const mountIdx = source.indexOf("stage.appendChild(gate)");
    expect(openIdx).toBeGreaterThan(-1);
    expect(mountIdx).toBeGreaterThan(-1);
    // The admission check happens strictly before the gate is ever attached
    // to the stage — false must mean no gate at all, not a gate that mounts
    // and then immediately tears itself down.
    expect(openIdx).toBeLessThan(mountIdx);

    // false -> resolve(null), inline, right there — not a flag threaded
    // through to some other branch.
    const guard = /if\s*\(!connectOpens\(key\)\)\s*\{([\s\S]{0,120}?)\}/.exec(source);
    expect(guard).not.toBeNull();
    expect(guard![1]).toMatch(/resolve\(null\)/);
  });

  it("hides the figure's own lines and restores them, both by data-leaf-id", () => {
    const hits = source.match(/data-leaf-id/g) ?? [];
    // At minimum: the selector that hides them, and a restore that is
    // documented (or itself written) against the very same attribute — a
    // hider and a restorer that don't name the same thing can drift apart
    // silently, which is the whole reason gates.test.ts exists for its own
    // guard list.
    expect(hits.length).toBeGreaterThanOrEqual(2);
    expect(source).toMatch(/querySelectorAll[^\n]*data-leaf-id/);
    // Saved and restored via the SAME property it hides with (inline
    // opacity), not a second, drifting mechanism (visibility, display, a
    // CSS class toggle the stylesheet might not define).
    expect(source).toMatch(/\.style\.opacity\s*=\s*"0"/);
    expect(source.match(/\.style\.opacity/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
  });

  it("converts every point via clientPointFor / logicalPoint, never its own client-rect math", () => {
    const domImport = /import\s*\{([^}]*)\}\s*from\s*"\.\/dom";/.exec(source)?.[1] ?? "";
    expect(domImport).toMatch(/\blogicalPoint\b/);
    expect(domImport).toMatch(/\bclientPointFor\b/);
    // The round-2 orientation trap lives in hand-rolled client-rect math and
    // a manual CANVAS.h - y flip — dom.ts already owns the single flip.
    expect(source).not.toMatch(/getBoundingClientRect/);
    expect(source).not.toMatch(/CANVAS\.h\s*-/);
  });

  it("uses LINGER_MS of 2600, the same as every other card", () => {
    expect(source).toMatch(/LINGER_MS\s*=\s*2600/);
  });

  it("resolves the answer id on a pass and the (unequal) summary string otherwise", () => {
    // gradeConnect's pass decides which of the two the player's branch sees;
    // connectSummary can never equal the answer id, so a wrong drawing can't
    // accidentally walk the right-goto path.
    expect(source).toMatch(/gradeConnect\(/);
    expect(source).toMatch(/connectSummary\(/);
    expect(source).toMatch(/\.pass\s*\?/);
  });
});
