// The player round (2026-09-08): the standalone viewer laid out as a watch
// page. Measured before it on a live #gh= link: the shell appeared at
// ~1 s with `.player-figure` at 960×16 px — an empty bordered strip — and
// jumped to 960×752 only when the figure mounted; on a 730 px window the
// play bar landed below the fold. The frame is now sized from the viewport
// before anything is fetched, the title/count/share/comments sit below it
// as page furniture, and the figure box no longer collapses between the
// items of a playlist. The node suite has no DOM, so these hold the shape
// of the CSS and the source; what they look like is a browser's business.
import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

const css = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
const strip = (s: string) => s.replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, "");
const viewer = strip(readFileSync(new URL("../src/viewer.ts", import.meta.url), "utf8"));
const session = strip(readFileSync(new URL("../src/playlist/session.ts", import.meta.url), "utf8"));
const run = viewer.slice(viewer.indexOf("export async function runViewer("));

/** The declarations of every rule whose selector matches `pattern`. */
function rulesMatching(pattern: RegExp): string[] {
  const out: string[] = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  for (let m = re.exec(css); m !== null; m = re.exec(css)) {
    if (pattern.test(m[1].trim())) out.push(m[2]);
  }
  return out;
}

describe("the viewer's frame has its shape before the figure mounts", () => {
  test("the stage's height comes from the viewport, not from content", () => {
    const def = rulesMatching(/^\.viewer-body$/).join(" ");
    expect(def).toMatch(/--viewer-stage-h:\s*min\(/);
    expect(def).toContain("100vh");
    const stage = rulesMatching(/^\.viewer-body \.player-figure:not\(:fullscreen\) \.cs-stage$/);
    expect(stage).toHaveLength(1);
    expect(stage[0]).toMatch(/height:\s*var\(--viewer-stage-h\)/);
    // Width follows the height through the stage's aspect-ratio; auto side
    // margins keep the flex column from stretching it back (the fullscreen
    // rule's construction).
    expect(stage[0]).toMatch(/width:\s*auto/);
    expect(stage[0]).toMatch(/margin:\s*0 auto/);
  });

  test("the frame is that tall from the first paint — a min-height, so a tray can still grow it", () => {
    const frame = rulesMatching(/^\.viewer-body \.player-figure:not\(:fullscreen\)$/);
    expect(frame).toHaveLength(1);
    expect(frame[0]).toMatch(/min-height:\s*calc\(var\(--viewer-stage-h\)/);
    expect(frame[0]).not.toMatch(/(^|[^-])height:/);
  });

  test("fullscreen keeps its own sizing: the viewer rules step aside for it", () => {
    for (const sel of css.match(/[^{}]*\.viewer-body \.player-figure[^{}]*(?=\{)/g) ?? []) {
      if (/\.cs-stage|^\s*\.viewer-body \.player-figure\s*$/.test(sel)) expect(sel).toContain(":not(:fullscreen)");
    }
  });

  test("the loading line waits inside the frame and steps aside for the figure", () => {
    expect(run).toMatch(/h\("div", \{ class: "player-figure" \}, status\)/);
    expect(rulesMatching(/^\.viewer-body \.player-figure:not\(:fullscreen\):has\(\.cs-figure\) > \.viewer-status$/)[0]).toMatch(/display:\s*none/);
  });
});

describe("everything about the drawcast sits below the frame", () => {
  test("the title is in the meta row under the figure, not above it", () => {
    const wrap = /h\("div", \{ class: "viewer-wrap" \}([^)]*)\)/.exec(run)!;
    expect(wrap[1]).not.toContain("titleEl");
    expect(wrap[1].indexOf("figureHost")).toBeLessThan(wrap[1].indexOf("metaEl"));
    expect(run).toMatch(/\{ class: "viewer-meta" \},\s*titleEl,/);
  });

  test("the frame's own title band is off on the page and back in fullscreen", () => {
    expect(rulesMatching(/^\.viewer-body \.player-figure:not\(:fullscreen\) \.cs-title$/)[0]).toMatch(/display:\s*none/);
  });

  test("share is an icon in the control bar; the footer strip is gone", () => {
    expect(run).toMatch(/trailing: \[shareBtn\]/);
    expect(viewer).toMatch(/icon\("share"\)/);
    expect(viewer).not.toContain("viewer-footer");
    expect(rulesMatching(/\.viewer-footer/)).toEqual([]);
    // The way back to the app survives, as a quiet link in the meta row.
    expect(run).toMatch(/class: "viewer-made"/);
  });

  test("comments go under the meta row, outside the player's box", () => {
    expect(run).toMatch(/metaEl\.insertAdjacentElement\("afterend", box\)/);
  });
});

describe("the playlist's cuts", () => {
  test("the box keeps its height while one figure is swapped for the next", () => {
    const swap = session.slice(session.indexOf("async function swapFigure("), session.indexOf("function chainsOn("));
    expect(swap).toMatch(/host\.style\.minHeight = `\$\{held\}px`/);
    expect(swap).toMatch(/handle\?\.destroy\(\);/);
    expect(swap).toMatch(/finally \{\s*host\.style\.minHeight = "";/);
    // Every mount path swaps through it — none destroys the old figure on its own.
    for (const fn of ["mountItem", "mountCard", "mountTitlePage"]) {
      const body = session.slice(session.indexOf(`async function ${fn}(`));
      const head = body.slice(0, body.indexOf("if (destroyed) {\n      hd.destroy();"));
      expect(head, fn).toContain("await swapFigure(");
      expect(head, fn).not.toContain("handle?.destroy()");
    }
  });

  test("the replay button does not flash at a chapter boundary", () => {
    expect(rulesMatching(/^\.cs-stage\.cs-chaining \.cs-bigplay$/)[0]).toMatch(/display:\s*none/);
    expect(session).toMatch(/function chainsOn\(i: number\): boolean \{\s*return items\.length > 1 && i < items\.length - 1 && modeRef !== "instant";/);
    // Wired into both places a "done" continues: the item chain and the cover.
    expect(session).toMatch(/markChaining\(s, chainsOn\(i\)\)/);
    expect(session).toMatch(/markChaining\(s, modeRef !== "instant"\)/);
  });
});
