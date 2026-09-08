// The connect gate's own source-drift test, in gates.test.ts's own style:
// there is no jsdom anywhere in this repo (vitest.config.ts sets
// `environment: "node"` and no file opts out), so a gate cannot actually be
// mounted, pressed or dragged in a test. What follows checks only the things
// whose absence would fail SILENTLY — everything else is on Hans's smoke
// checklist (task-6-report.md), which the plan names as a merge condition.
//
// Review round 1 (finding 4) proved this style of test can pass over a
// broken thing: deleting the restorer and every assertion in the old
// "hides and restores, both by data-leaf-id" test still passed, because the
// hide selector alone supplied both string matches. The fix wasn't a
// stronger regex — it was moving the actual logic (the selector, the
// restore loop, the snap-radius math) into connect-model.ts, where it is
// pure and genuinely tested (tests/connect-model.test.ts). What's left here
// checks that the gate USES those tested seams rather than re-implementing
// any of them inline — the wiring itself stays on the by-hand checklist.
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

  it("hides and restores through the tested connect-model seam, not a re-implementation", () => {
    const domImport = /import\s*\{([^}]*)\}\s*from\s*"\.\/connect-model";/.exec(source)?.[1] ?? "";
    // The selector, the restore loop, and the snap-radius math are all pure
    // functions with their own real tests in connect-model.test.ts — this
    // file only wires them to actual DOM nodes, which is the one part a
    // node test can't see mounted. Importing them, rather than
    // reimplementing any of the three inline, is what makes that split real.
    expect(domImport).toMatch(/\bhiddenLeafSelector\b/);
    expect(domImport).toMatch(/\brestoreOpacity\b/);
    expect(domImport).toMatch(/\bsnapRadiusFor\b/);
    expect(source).not.toMatch(/function medianNearestNeighbour/);
    expect(source).not.toMatch(/function snapRadiusFor/);
    // The wiring itself: real nodes found by the shared selector, hidden and
    // saved via the same property restoreOpacity puts back.
    expect(source).toMatch(/querySelectorAll[^\n]*hiddenLeafSelector\(answer\)/);
    expect(source).toMatch(/\.style\.opacity\s*=\s*"0"/);
    expect(source).toMatch(/restoreOpacity\(saved,/);
  });

  it("reuses sameEdge for pairwise edge equality, instead of a second, untested copy", () => {
    const domImport = /import\s*\{([^}]*)\}\s*from\s*"\.\/connect-model";/.exec(source)?.[1] ?? "";
    expect(domImport).toMatch(/\bsameEdge\b/);
    expect(source).toMatch(/sameEdge\(s,\s*e\)/);
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

  it("decides the star gesture from where the pointer came up, never from how far it moved", () => {
    // Review round 1, finding 1: a tap that drifts past a distance threshold
    // and lifts on the same star used to do nothing at all — real fingers
    // drift more than a few CSS px routinely. There is now no threshold to
    // drift past.
    expect(source).not.toMatch(/DRAG_MIN_PX/);
    expect(source).toMatch(/upStar\.id\s*===\s*pressed\.id/);
    expect(source).toMatch(/armed\s*=\s*armed\s*&&\s*armed\.id\s*===\s*pressed\.id\s*\?\s*null\s*:\s*pressed/);
  });

  it("captures the pointer unconditionally on pointerdown, so a miss can still end the gesture", () => {
    // Review round 1, finding 2: capture taken only when the press hit a
    // star left a press-on-empty-space, released outside the gate, with the
    // gesture slot stuck forever. The exact old guard shape must not recur.
    expect(source).not.toContain("if (downStar) {");
    expect(source).toMatch(/gate\.setPointerCapture\(e\.pointerId\)/);
    expect(source).toMatch(/addEventListener\(\s*"lostpointercapture"/);
  });

  it("never captures a press that lands on the Done/Skip buttons themselves", () => {
    // Self-caught while fixing the above: capturing unconditionally also
    // captures a press that starts ON a <button> child of the gate, which
    // retargets that button's own "click" (a pointer-capture compatibility
    // mouse event) to the gate instead — silently breaking Done and Skip.
    const downBody = /gate\.addEventListener\(\s*"pointerdown"[\s\S]*?\n\s*\}\);/.exec(source)?.[0] ?? "";
    expect(downBody).not.toBe("");
    expect(downBody).toMatch(/instanceof HTMLButtonElement/);
    // The guard must come before setPointerCapture is ever reached.
    expect(downBody.indexOf("instanceof HTMLButtonElement")).toBeLessThan(downBody.indexOf("setPointerCapture"));
  });

  it("clears the armed star whenever a gesture completes a segment, not only on cancel", () => {
    // Review round 1, finding 3: tap A, drag A→B to draw the line, then tap
    // B used to silently re-toggle (and so erase) the edge just drawn,
    // because `armed` survived the drag that completed it.
    const upStarBranch = /else if \(upStar\) \{([\s\S]*?)\n\s*\}/.exec(source)?.[1] ?? "";
    expect(upStarBranch).toMatch(/toggleEdge/);
    expect(upStarBranch).toMatch(/armed\s*=\s*null/);
    const missedEdgeBranch = /else if \(missedEdge\) \{([\s\S]*?)\n\s*\}/.exec(source)?.[1] ?? "";
    expect(missedEdgeBranch).toMatch(/toggleEdge/);
    expect(missedEdgeBranch).toMatch(/armed\s*=\s*null/);
  });

  it("tells the viewer both halves of the gesture, like every other figgate's hint", () => {
    expect(source).toMatch(/cs-figgate-hint/);
    expect(source).toMatch(/Press a star and drag to the next/);
    expect(source).toMatch(/[Cc]lick a line to remove it/);
  });

  it("never mutates stage.style.touchAction — .cs-figgate's own CSS already covers exactly the gate's lifetime", () => {
    // Review round 1, finding 6: a JS save/restore on a SHARED element,
    // restored only after the linger, could leak "none" onto the stage past
    // this gate's own lifetime if two connect gates ever overlapped.
    expect(source).not.toMatch(/stage\.style\.touchAction/);
  });

  it("pointermove only moves the rubber band — it never re-measures every star or rebuilds the marks", () => {
    // Review round 1, finding 8: the old single render() re-queried every
    // star's client position and rebuilt the whole overlay on every move
    // event, which would visibly lag a drag on a phone.
    const moveBody = /gate\.addEventListener\(\s*"pointermove"[\s\S]*?\n\s*\}\);/.exec(source)?.[0] ?? "";
    expect(moveBody).not.toBe("");
    expect(moveBody).toMatch(/updateBand\(\)/);
    expect(moveBody).not.toMatch(/positionStars\(\)/);
    expect(moveBody).not.toMatch(/renderMarks\(\)/);
  });

  it("computes connectSummary once per finish, not once for display and again for the resolve", () => {
    const finishBody = /const finish = \(\): void => \{([\s\S]*?)\n {6}\};/.exec(source)?.[1] ?? "";
    expect(finishBody).not.toBe("");
    expect(finishBody.match(/connectSummary\(/g)?.length ?? 0).toBe(1);
  });
});
