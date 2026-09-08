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

  it("resolves through connectResolution, not a re-implemented pass/fail ternary", () => {
    // Which string a grade resolves to — the answer id on a pass, the
    // summary otherwise — is a pure decision pinned in node
    // (tests/connect-model.test.ts, including the destructive check: the
    // two arms inverted). This file can only check that the gate USES that
    // tested seam instead of re-deriving the same ternary inline, where an
    // inversion would again be invisible to every test here.
    const domImport = /import\s*\{([^}]*)\}\s*from\s*"\.\/connect-model";/.exec(source)?.[1] ?? "";
    expect(domImport).toMatch(/\bconnectResolution\b/);
    expect(source).toMatch(/gradeConnect\(/);
    expect(source).toMatch(/resolve\(connectResolution\(grade,\s*answer\)\)/);
    // Not re-implemented inline: no second `grade.pass ?` ternary feeding resolve.
    expect(source).not.toMatch(/resolve\(grade\.pass\s*\?/);
  });

  it("decides the star gesture from where the pointer came up, never from how far it moved", () => {
    // Review round 1, finding 1: a tap that drifts past a distance threshold
    // and lifts on the same star used to do nothing at all — real fingers
    // drift more than a few CSS px routinely. There is now no threshold to
    // drift past.
    expect(source).not.toMatch(/DRAG_MIN_PX/);
    expect(source).toMatch(/upStar\.id\s*!==\s*pressed\.id/);
    expect(source).toMatch(/upStar\.id\s*===\s*pressed\.id/);
  });

  it("actually completes the two-tap path: an earlier armed star closes against THIS tap", () => {
    // Review round 2, finding 1: round 1's fix removed the distance
    // threshold but never added a branch that READS `armed` to build an
    // edge — tap A then tap B just moved a highlight and drew nothing. This
    // is the one line that makes the two-tap path (the one that has to work
    // on touch) actually draw something.
    expect(source).toMatch(/armed\s*&&\s*armed\.id\s*!==\s*pressed\.id/);
    const completion = /armed\s*&&\s*armed\.id\s*!==\s*pressed\.id\s*\)\s*\{([\s\S]{0,200}?)\}/.exec(source)?.[1] ?? "";
    expect(completion).toMatch(/toggleEdge\(drawn,\s*makeEdge\(armed\.id,\s*pressed\.id\)\)/);
    expect(completion).toMatch(/armed\s*=\s*null/);
    // Named as ONE gesture, not two — the exact comment finding 1 asked for,
    // so the completion branch doesn't get "simplified" back out.
    expect(source).toMatch(/SAME gesture/);
  });

  it("cancels outright on empty space, per finding 4 — armed is actually cleared, not just claimed to be", () => {
    // Round 1's comment claimed clearGesture() already cleared `armed` on a
    // release over empty space; clearGesture() never touched `armed` at
    // all, so the claim was false — inert only because nothing yet
    // completed a tap-armed pair (finding 1), and about to become a live
    // bug the moment that got fixed.
    const emptySpaceBranch = /else if \(pressed\) \{([\s\S]{0,120}?)\}/.exec(source)?.[1] ?? "";
    expect(emptySpaceBranch).toMatch(/armed\s*=\s*null/);
  });

  it("captures the pointer unconditionally on pointerdown, so a miss can still end the gesture", () => {
    // Review round 1, finding 2: capture taken only when the press hit a
    // star left a press-on-empty-space, released outside the gate, with the
    // gesture slot stuck forever. The exact old guard shape must not recur.
    expect(source).not.toContain("if (downStar) {");
    expect(source).toMatch(/gate\.setPointerCapture\(e\.pointerId\)/);
    expect(source).toMatch(/addEventListener\(\s*"lostpointercapture"/);
  });

  it("never captures a press that lands on the Done/Skip buttons themselves, even a labelled inner element", () => {
    // Self-caught fixing the above: capturing unconditionally also captures
    // a press that starts ON a <button> child of the gate, which retargets
    // that button's own "click" (a pointer-capture compatibility mouse
    // event) to the gate instead — silently breaking Done and Skip. Round 2
    // asked for `closest("button")`, not a same-element check, so a label
    // or icon wrapped inside the pill can't slip past the guard.
    const downBody = /gate\.addEventListener\(\s*"pointerdown"[\s\S]*?\n\s*\}\);/.exec(source)?.[0] ?? "";
    expect(downBody).not.toBe("");
    expect(downBody).not.toMatch(/instanceof HTMLButtonElement/);
    expect(downBody).toMatch(/\.closest\(\s*"button"\s*\)/);
    // The guard must come before setPointerCapture is ever reached.
    expect(downBody.indexOf('closest("button")')).toBeLessThan(downBody.indexOf("setPointerCapture"));
  });

  it("clears the armed star whenever a gesture completes a segment, not only on cancel", () => {
    // Review round 1, finding 3: tap A, drag A→B to draw the line, then tap
    // B used to silently re-toggle (and so erase) the edge just drawn,
    // because `armed` survived the drag that completed it.
    const dragBranch = /if \(pressed && upStar && upStar\.id !== pressed\.id\) \{([\s\S]*?)\n\s*\}/.exec(source)?.[1] ?? "";
    expect(dragBranch).toMatch(/toggleEdge/);
    expect(dragBranch).toMatch(/armed\s*=\s*null/);
    const missedEdgeBranch = /else if \(missedEdge\) \{([\s\S]*?)\n\s*\}/.exec(source)?.[1] ?? "";
    expect(missedEdgeBranch).toMatch(/toggleEdge/);
    expect(missedEdgeBranch).toMatch(/armed\s*=\s*null/);
  });

  it("tells the viewer both halves of the gesture, like every other figgate's hint", () => {
    expect(source).toMatch(/cs-connect-hint/);
    expect(source).toMatch(/Press a star and drag to the next/);
    expect(source).toMatch(/[Cc]lick a line to remove it/);
  });

  it("lays out Done, the status stack, and Skip so they cannot collide, rather than nudged pixel offsets", () => {
    // Review round 2, finding 5: a 58-character hint at bottom: 1.1rem ran
    // under Done/Skip at bottom: 1.2rem on a narrow phone — fixed with a
    // layout, not a bigger number. cs-figgate-skip (every OTHER gate's own
    // independently-absolutely-positioned corner pill) is deliberately left
    // off the skip button here — its position now comes from being a flex
    // child of the bar instead, which is what makes collision structurally
    // impossible rather than merely untuned-into today.
    expect(source).toMatch(/cs-connect-bar/);
    expect(source).toMatch(/cs-connect-status/);
    // Checked on the actual skip button's class list, not the whole file —
    // the class is deliberately named (and explained) in a comment nearby.
    const skipCall = /skip = h\("button",\s*\{\s*class:\s*"([^"]*)"/.exec(source)?.[1] ?? "";
    expect(skipCall).not.toBe("");
    expect(skipCall).not.toMatch(/cs-figgate-skip/);
  });

  it("never mutates stage.style.touchAction — .cs-figgate's own CSS already covers exactly the gate's lifetime", () => {
    // Review round 1, finding 6 (upheld on re-review): a JS save/restore on
    // a SHARED element, restored only after the linger, could leak "none"
    // onto the stage past this gate's own lifetime if two connect gates
    // ever overlapped. .cs-figgate already sets touch-action: none on the
    // GATE div itself (styles.css:1191), scoped by construction.
    expect(source).not.toMatch(/stage\.style\.touchAction/);
  });

  it("remeasures via a ResizeObserver on the stage, disconnected on every exit path", () => {
    // Review round 2, findings 2 and 3: a star cache that measures zero at
    // mount (a gate opening the same frame the figure appears, a hidden
    // tab) stayed empty forever with only a window `resize` listener — and
    // anything that resizes the STAGE without resizing the window (a panel
    // opening, a caption reflow, a CSS transition, a viewBox change) left
    // the dots and segments painted at stale coordinates while hit-testing,
    // which measures live, stayed correct — so a click would land on a star
    // that isn't where it's drawn. A ResizeObserver on stage fixes both: it
    // fires on anything that resizes the stage, INCLUDING the first time it
    // goes from zero to a real size.
    expect(source).toMatch(/new ResizeObserver\(/);
    expect(source).toMatch(/ro\.observe\(stage\)/);
    expect(source).toMatch(/ro\.disconnect\(\)/);
    // The window listener is a fallback for a runtime with no
    // ResizeObserver, not kept alongside it — the observer subsumes a
    // window resize (which resizes the stage too) as one case among many.
    const stopObserving = /let stopObserving: \(\) => void;([\s\S]*?)\n\s{6}const remove/.exec(source)?.[1] ?? "";
    expect(stopObserving).toMatch(/typeof ResizeObserver/);
    expect(stopObserving).toMatch(/window\.addEventListener\("resize"/);
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

  it("stamps no cs-connect-* class in the markup that the stylesheet leaves unstyled", () => {
    // Review round 3, finding 2: cs-connect-counter/-summary/-done were
    // stamped by the flex-bar rewrite with no CSS rule left for them — a
    // class in the markup and nowhere in the stylesheet reads as live
    // styling to the next person who touches this. Every cs-connect-*
    // class this file creates must appear as a selector in styles.css.
    // (This test itself caught a SECOND instance while being written:
    // cs-connectgate, orphaned since round 1 removed its only rule — see
    // the gate's own "no connect-specific modifier class" comment.)
    const css = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");
    // Three shapes this file stamps a class through: h()'s plain string,
    // setAttribute with a plain string, and setAttribute with a template
    // literal (a dynamic verdict/armed suffix) — the `${...}` is stripped
    // from the WHOLE captured value first, so a suffix glued directly onto
    // the static prefix with no space (cs-connect-star${armed ? ... : ...})
    // doesn't survive as a garbled fragment once split on whitespace.
    const rawValues = [
      ...[...source.matchAll(/class:\s*"([^"]*)"/g)].map((m) => m[1]),
      ...[...source.matchAll(/setAttribute\("class",\s*"([^"]*)"\)/g)].map((m) => m[1]),
      ...[...source.matchAll(/setAttribute\("class",\s*`([^`]*)`/g)].map((m) => m[1]),
    ];
    const classes = new Set(
      rawValues
        .map((c) => c.replace(/\$\{[^}]*\}/g, ""))
        .flatMap((c) => c.split(/\s+/))
        .map((c) => c.trim())
        .filter((c) => c.startsWith("cs-connect")),
    );
    expect(classes.size).toBeGreaterThan(0); // the extraction itself must find something, or this test proves nothing
    expect([...classes]).toEqual(
      expect.arrayContaining([
        "cs-connect-ink",
        "cs-connect-star",
        "cs-connect-line",
        "cs-connect-band",
        "cs-connect-bar",
        "cs-connect-status",
        "cs-connect-hint",
        "cs-connect-counter",
        "cs-connect-summary",
      ]),
    ); // pins the extraction against silently finding nothing for one of the known classes
    for (const cls of classes) {
      expect(css).toMatch(new RegExp(`\\.${cls}\\b`));
    }
  });
});

describe("connect gate CSS (src/styles.css)", () => {
  const css = () => readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");

  it("the hint keeps the shared waitgate nudge; the counter and summary do not — via disjoint selectors, not a specificity fight", () => {
    // Review round 3, finding 1: .cs-connect-status .cs-waitgate-pill {
    // animation: none } was specificity (0,2,0) and matched the hint too
    // (it's a .cs-waitgate-pill inside .cs-connect-status); .cs-connect-hint
    // {animation: waitgate-nudge} at (0,1,0) lost that fight every time, so
    // the nudge that draws the eye to the one instruction the viewer needs
    // never ran. The fix must not reintroduce a selector that matches BOTH
    // the hint and the counter/summary.
    const text = css();
    // Requires the brace so a comment MENTIONING the old broken selector
    // (as this very fix's own explanation does, right above the real rule)
    // doesn't itself trip the check — only an actual, active rule would.
    expect(text).not.toMatch(/\.cs-connect-status\s+\.cs-waitgate-pill\s*\{/);
    const offRule = /\.cs-connect-counter,\s*\n?\s*\.cs-connect-summary\s*\{([^}]*)\}/.exec(text)?.[1] ?? "";
    expect(offRule).toMatch(/animation:\s*none/);
    const hintRule = /\.cs-connect-hint\s*\{([^}]*)\}/.exec(text)?.[1] ?? "";
    expect(hintRule).toMatch(/animation:\s*waitgate-nudge/);
  });
});
