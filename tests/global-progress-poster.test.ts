// Two player fixes (Hans 2026-09-24):
// - "The page number … seems to be local, within its chapter. Could it be
//   global?" — a multi-part cast counts its steps across ALL parts.
// - "The first page is supposed to be the final drawing" — the poster is the
//   finished drawing, whole page, full strength.

import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

const controls = readFileSync(new URL("../src/ui/controls.ts", import.meta.url), "utf8");
const session = readFileSync(new URL("../src/playlist/session.ts", import.meta.url), "utf8");
const player = readFileSync(new URL("../src/render/player.ts", import.meta.url), "utf8");

describe("the counter and the bar count the whole cast", () => {
  test("controls show offset + done over the whole total, and seek globally", () => {
    expect(controls).toMatch(/const globalDone = \(done: number\): number => \(opts\.progress \? opts\.progress\.offset\(\) \+ \(opts\.progress\.pinned \? 0 : done\) : done\);/);
    expect(controls).toMatch(/stepInd\.textContent = `\$\{g\}\/\$\{T\}`;/);
    expect(controls).toMatch(/if \(opts\.progress\) opts\.progress\.seek\(seekStep\(/);
  });

  test("the session estimates each part from its commands, then uses the exact count once mounted", () => {
    expect(session).toMatch(/const stepCounts = items\.map\(/);
    expect(session).toMatch(/stepCounts\[i\] = hd\.timeline\.totalSteps;/);
    expect(session).toMatch(/progress,\s*trailing: \[panelBtn/);
    // A seek into another part jumps there, then steps to the local point.
    expect(session).toMatch(/void jump\(i, false\)\.then\(\(\) => handle\?\.timeline\.renderUpTo\(local\)\);/);
    // The title page is page 0 of the whole, not its own "3/3".
    expect(session).toMatch(/progress: \{ \.\.\.progress, offset: \(\) => 0, pinned: true \}/);
  });
});

describe("the poster is the finished drawing", () => {
  test("the end state, repainted with the whole page in view and nothing dimmed", () => {
    const at = player.indexOf("showPoster(): void {");
    const body = player.slice(at, at + 1200);
    expect(body).toMatch(/this\.renderUpTo\(this\.plan\.steps\.length\);/);
    expect(body).toMatch(/this\.applyScene\(\{ \.\.\.end, camera: null, opacities: \{\} \}\);/);
  });
});
