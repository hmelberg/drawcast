// The pointer cursor during figure questions and widget gestures — source
// pins, in gates.test.ts's own style: there is no jsdom anywhere in this
// repo (vitest.config.ts sets `environment: "node"`), so the actual computed
// cursor a browser paints cannot be asserted here. What follows checks that
// the pieces the cursor depends on are wired the way the design calls for:
// .cs-figgate itself carries no cursor any more (every gate now shows what's
// under the pointer, via cs-cardable or a widget's own grab/grabbing), the
// connect question alone keeps its crosshair on a class of its own, and the
// click-ask's overlay drives cs-cardable itself since infocard.ts's own
// toggle always reads a plain figgate as closed to it. The rest is on Hans's
// smoke checklist (docs/superpowers/plans/2026-09-14-widget-bodies-smoke.md).
import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

const css = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");
const connectGate = readFileSync(new URL("../src/ui/connect-gate.ts", import.meta.url), "utf8");
const controls = readFileSync(new URL("../src/ui/controls.ts", import.meta.url), "utf8");
const infocard = readFileSync(new URL("../src/ui/infocard.ts", import.meta.url), "utf8");

/** The `.cs-figgate { ... }` block's own body, up to the next rule. */
function figgateBlock(): string {
  const at = css.indexOf(".cs-figgate {");
  return css.slice(at, css.indexOf("}", at));
}

describe("styles.css — the gate's own cursor", () => {
  test(".cs-figgate itself carries no cursor — every other rule says what's under the pointer instead", () => {
    expect(figgateBlock()).not.toContain("crosshair");
    expect(figgateBlock()).not.toContain("cursor");
  });
  test("only .cs-figgate.cs-connectgate keeps the crosshair", () => {
    expect(css).toContain(".cs-figgate.cs-connectgate { cursor: crosshair; }");
  });
  test("the hand shows through a click-ask's overlay: cs-cardable reaches the gate too", () => {
    expect(css).toContain(".cs-stage.cs-cardable .cs-figgate { cursor: pointer; }");
  });
  test("cs-grabbable/cs-grabbing exist, and the grabbing rule reaches through a gate the way cs-cardable's does", () => {
    expect(css).toContain(".cs-stage.cs-grabbable { cursor: grab; }");
    expect(css).toContain(".cs-stage.cs-grabbing, .cs-stage.cs-grabbing .cs-figgate { cursor: grabbing; }");
  });
  // Same specificity as cs-cardable's two rules (2 and 3 classes respectively)
  // — a tie the cascade breaks by source order alone, so a drag in progress
  // must come AFTER cs-cardable in the file or a lingering hover would win.
  test("cs-grabbable and cs-grabbing are declared after cs-cardable — the tie-break a live drag needs to win", () => {
    const cardable = css.indexOf(".cs-stage.cs-cardable {");
    const grabbable = css.indexOf(".cs-stage.cs-grabbable {");
    const grabbing = css.indexOf(".cs-stage.cs-grabbing,");
    expect(cardable).toBeGreaterThan(-1);
    expect(grabbable).toBeGreaterThan(cardable);
    expect(grabbing).toBeGreaterThan(cardable);
  });
  // The idle rule (playback, mouse still) must keep winning regardless of
  // this round's additions: 3 class selectors (.cs-figure.cs-idle .cs-stage)
  // beats the 2-class stage-level grab/grabbing/cardable rules outright, by
  // specificity alone — no ordering trick required, so this just pins that
  // nobody accidentally raised a new rule's specificity to match it.
  test(".cs-figure.cs-idle .cs-stage still hides the cursor outright while idle-playing", () => {
    expect(css).toContain(".cs-figure.cs-idle .cs-stage { cursor: none; }");
  });
});

describe("connect-gate.ts — keeps its own crosshair", () => {
  test("the gate mounts cs-figgate cs-connectgate", () => {
    expect(connectGate).toContain('h("div", { class: "cs-figgate cs-connectgate" }');
  });
});

describe("controls.ts — the click ask drives its own hand cursor", () => {
  /** figureGateFor's own body: the click-ask gate, up to the next top-level function. */
  function figureGateFor(): string {
    return controls.slice(controls.indexOf("function figureGateFor"), controls.indexOf("\nexport function askGateFor"));
  }
  test("a pointermove listener on the gate hit-tests with the click's own boxes/rings/slop", () => {
    const body = figureGateFor();
    expect(body).toMatch(/gate\.addEventListener\("pointermove", \(e\) => \{[\s\S]*?hitElement\(boxes, p, 18, rings\)[\s\S]*?\}\);/);
  });
  test("it toggles cs-cardable on the stage, not some class of its own", () => {
    expect(figureGateFor()).toContain('stage.classList.toggle("cs-cardable", on)');
  });
  test("the pointermove listener stops propagation — infocard.ts's own stage-level toggle sits on an ancestor and would otherwise run right after it and undo the class within the same event", () => {
    const body = figureGateFor();
    const moveAt = body.indexOf('gate.addEventListener("pointermove"');
    const moveBlock = body.slice(moveAt, body.indexOf("});", moveAt));
    expect(moveBlock).toContain("e.stopPropagation()");
  });
  test("the class comes off when the gate is removed", () => {
    const removeAt = controls.indexOf("function figureGateFor");
    const remove = controls.slice(removeAt, controls.indexOf("const onAbort =", removeAt));
    expect(remove).toContain('stage.classList.remove("cs-cardable")');
  });
});

describe("infocard.ts — the hand allows the widget's own gate", () => {
  test("the toggle reads .cs-widgetgate, not just the playing state", () => {
    expect(infocard).toContain('const own = stage.querySelector(".cs-widgetgate") !== null;');
    expect(infocard).toContain('const on = (hd.timeline.state !== "playing" || own) && (targetAt(e) !== null || overWidget(e));');
  });
});
