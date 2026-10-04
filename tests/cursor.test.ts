// The pointer cursor during figure questions and widget gestures — source
// pins, in gates.test.ts's own style: there is no jsdom anywhere in this
// repo (vitest.config.ts sets `environment: "node"`), so the actual computed
// cursor a browser paints cannot be asserted here. What follows checks that
// the pieces the cursor depends on are wired the way the design calls for:
// .cs-figgate itself carries no cursor any more (every gate now shows what's
// under the pointer, via cs-cardable or a widget's own grab/grabbing), the
// connect question shows a pencil on a class of its own, no crosshair is
// left anywhere in src (ui/cursors.ts says why), and the
// click-ask's overlay drives cs-cardable itself since infocard.ts's own
// toggle always reads a plain figgate as closed to it. The rest is on Hans's
// smoke checklist (docs/superpowers/plans/2026-09-14-widget-bodies-smoke.md).
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { CURSOR, guessCursor } from "../src/ui/cursors";
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
  test(".cs-figgate.cs-connectgate has its own rule (the hand under the gate's pencil)", () => {
    expect(css).toContain(".cs-figgate.cs-connectgate { cursor: pointer; }");
  });
  test("the hand shows through a click-ask's overlay: cs-cardable reaches the gate too", () => {
    expect(css).toContain(".cs-stage.cs-cardable .cs-figgate { cursor: pointer; }");
  });
  // Both grab and grabbing reach through a gate the way cardable's own
  // through-gate rule does — a press before DRAG_MIN is otherwise invisible
  // during a question: the gate is the element actually under the pointer,
  // and .cs-stage.cs-grabbable alone only styles the STAGE.
  test("cs-grabbable/cs-grabbing exist, and BOTH reach through a gate the way cs-cardable's own through-gate rule does", () => {
    expect(css).toContain(".cs-stage.cs-grabbable, .cs-stage.cs-grabbable .cs-figgate { cursor: grab; }");
    expect(css).toContain(".cs-stage.cs-grabbing, .cs-stage.cs-grabbing .cs-figgate { cursor: grabbing; }");
  });
  // The through-gate variants of cardable, grab and grabbing are all three
  // classes — a real specificity tie, broken only by source order. This is
  // the order that has to hold for a live press/drag to ever win over a
  // lingering hover: cardable-through-gate first, then grab (a press that
  // hasn't crossed DRAG_MIN yet), then grabbing last of all (nothing may
  // out-rank an actual drag in progress).
  test("cardable-through-gate < grab(-through-gate) < grabbing(-through-gate) in source order — the tie-break a live press and a live drag both need to win", () => {
    const cardableGate = css.indexOf(".cs-stage.cs-cardable .cs-figgate {");
    const grab = css.indexOf(".cs-stage.cs-grabbable, .cs-stage.cs-grabbable .cs-figgate {");
    const grabbing = css.indexOf(".cs-stage.cs-grabbing, .cs-stage.cs-grabbing .cs-figgate {");
    expect(cardableGate).toBeGreaterThan(-1);
    expect(grab).toBeGreaterThan(cardableGate);
    expect(grabbing).toBeGreaterThan(grab);
  });
  // connectgate's crosshair is LOWER specificity than cardable-through-gate
  // (two classes, not three) and so wins in practice only because the two
  // conditions never coexist — not because of source order. It is still
  // placed after cardable-through-gate so the file's ordering reads
  // consistently with everything else that says what a figgate shows.
  test("connectgate is declared after cardable-through-gate too, for the same readability reason (though specificity, not order, is what actually protects it)", () => {
    const cardableGate = css.indexOf(".cs-stage.cs-cardable .cs-figgate {");
    const connectgate = css.indexOf(".cs-figgate.cs-connectgate {");
    expect(connectgate).toBeGreaterThan(cardableGate);
  });
  // The idle rule (playback, mouse still) must keep winning regardless of
  // this round's additions: 3 class selectors (.cs-figure.cs-still .cs-stage)
  // beats the 2-class stage-level grab/grabbing/cardable rules outright, by
  // specificity alone — no ordering trick required, so this just pins that
  // nobody accidentally raised a new rule's specificity to match it.
  test(".cs-figure.cs-still .cs-stage still hides the cursor outright while idle-playing", () => {
    expect(css).toContain(".cs-figure.cs-still .cs-stage { cursor: none; }");
  });
});

describe("connect-gate.ts — draws with the pencil", () => {
  test("the gate mounts cs-figgate cs-connectgate", () => {
    expect(connectGate).toContain('h("div", { class: "cs-figgate cs-connectgate" }');
  });
  test("and sets the pencil cursor on itself", () => {
    expect(connectGate).toContain("gate.style.cursor = CURSOR.pen;");
  });
});

describe("no crosshair (ui/cursors.ts: Hans's standing rule — friendly symbols)", () => {
  const root = fileURLToPath(new URL("../src", import.meta.url));
  const files = (dir: string): string[] =>
    readdirSync(dir).flatMap((f) => {
      const p = join(dir, f);
      return statSync(p).isDirectory() ? files(p) : [p];
    });
  test("the word appears nowhere in src but the design note that says why not", () => {
    const hits = files(root)
      .filter((f) => /\.(ts|css|html|js)$/.test(f))
      .flatMap((f) =>
        readFileSync(f, "utf8")
          .split("\n")
          .map((line, i) => ({ f, i, line }))
          .filter(({ line }) => /crosshair/i.test(line)),
      )
      .filter(({ f, line }) => !(f.endsWith(join("ui", "cursors.ts")) && line.trimStart().startsWith("//")))
      .map(({ f, i }) => `${f}:${i + 1}`);
    expect(hits).toEqual([]);
  });
  test("every guess kind has a friendly cursor, hovering and working it", () => {
    for (const kind of ["height", "curve", "angle", "count", "point", "market"] as const) {
      for (const state of ["hover", "drag"] as const) expect(guessCursor(kind, state)).not.toMatch(/crosshair/);
    }
    expect(guessCursor("point", "hover")).toBe("pointer");
    expect(guessCursor("height", "hover")).toBe("grab");
    expect(guessCursor("height", "drag")).toBe("grabbing");
    expect(guessCursor("curve", "drag")).toBe(CURSOR.pen);
  });
  test("the pencil is an inline svg with its tip as the hotspot, falling back to the hand", () => {
    expect(CURSOR.pen).toMatch(/^url\("data:image\/svg\+xml,[^"]+"\) 3 21, pointer$/);
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
